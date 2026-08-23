import {
  ref,
  onValue,
  onDisconnect,
  remove,
  set,
  push,
  get
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

import {
  database
} from "./firebase-config.js";

const RoomManager = (() => {

  let currentRoomId = null;
  let currentUserId = null;
  let currentUserName = "";
  let isMuted = false;
  let currentVolume = 1;

  let localStream = null;
  let peers = {};
  let audioElements = {};
  let analyser = null;
  let audioContext = null;

  let processedOffers = {};
  let processedAnswers = {};
  let creatingOffer = {};


  /*
   * Firebase Socket監視
   */
  function watchUsers(roomId) {

    const usersRef =
      ref(
        database,
        "rooms/" +
        roomId +
        "/users"
      );

    onValue(
      usersRef,
      snapshot => {

        const users =
          snapshot.val() || {};

        renderUsers(users);

        Object.keys(users).forEach(id => {
          if (
            id !== currentUserId &&
            !peers[id] &&
            currentUserId < id
          ) {
            makeOffer(id);
          }
        });

      }
    );
  }


  /*
   * シグナリング監視
   */
  function watchSignal() {

    const signalRef =
      ref(
        database,
        "rooms/" +
        currentRoomId +
        "/signal/" +
        currentUserId
      );

    onValue(signalRef, snapshot => {

      const data =
        snapshot.val();

      if (!data) return;

      if (data.offer) {
        const from =
          data.offer.from;

        handleOffer(
          from,
          data.offer.data
        );
      }

      if (data.answer) {
        const from =
          data.answer.from;

        handleAnswer(
          from,
          data.answer.data
        );
      }

      if (data.candidates) {
        Object.values(data.candidates).forEach(cand => {
          handleCandidate(
            cand.from,
            cand.data
          );
        });
      }

    });
  }


  /*
   * メッセージ監視（一時チャット・取得後即削除）
   */
  function watchMessages() {

    const chatRef =
      ref(
        database,
        "rooms/" +
        currentRoomId +
        "/chat"
      );

    onValue(chatRef, snapshot => {

      const data =
        snapshot.val();

      if (!data) return;

      Object.entries(data)
        .forEach(([key, msg]) => {

          const box =
            document.getElementById(
              "panelMessages"
            );

          if (!box) return;

          const wrapper =
            document.createElement("div");

          wrapper.className =
            "panel-message";

          const icon =
            document.createElement("span");

          icon.className =
            "chat-icon";

          icon.textContent =
            getInitial(msg.name);

          const text =
            document.createElement("span");

          text.textContent =
            msg.text;

          wrapper.appendChild(icon);
          wrapper.appendChild(text);

          box.appendChild(wrapper);

          // 表示後すぐ削除
          remove(
            ref(
              database,
              "rooms/" +
              currentRoomId +
              "/chat/" +
              key
            )
          );

        });

    });

  }


  /*
   * 退出処理・ルーム削除監視（onDisconnectで確実にルーム削除まで対応）
   */
  function setupDisconnect() {

    const userRef =
      ref(
        database,
        "rooms/" +
        currentRoomId +
        "/users/" +
        currentUserId
      );

    const roomRef =
      ref(
        database,
        "rooms/" +
        currentRoomId
      );

    const usersRef =
      ref(
        database,
        "rooms/" +
        currentRoomId +
        "/users"
      );

    get(usersRef).then(snapshot => {
      const users = snapshot.val() || {};
      const userKeys = Object.keys(users);

      if (userKeys.length <= 1) {
        onDisconnect(roomRef).remove().then(() => {
          console.log("ルーム切断時削除監視登録完了（最後の人）");
        });
      } else {
        onDisconnect(userRef).remove().then(() => {
          console.log("ユーザー退出監視登録完了");
        });
      }
    });
  }


  /*
   * ユーザー描画
   */
  function renderUsers(users) {

    const grid =
      document.getElementById(
        "userGrid"
      );

    const empty =
      document.getElementById(
        "emptyRoom"
      );

    if (!grid || !empty) return;

    grid.innerHTML = "";

    const entries =
      Object.entries(users);

    if (entries.length === 0) {

      empty.style.display = "block";

      return;
    }

    empty.style.display = "none";

    entries.forEach(
      ([id, user]) => {

        const element =
          createUserElement(
            id,
            user
          );

        grid.appendChild(
          element
        );

      }
    );
  }


  /*
   * ユーザーアイコン作成
   */
  function createUserElement(
    id,
    user
  ) {

    const container =
      document.createElement(
        "div"
      );

    container.className =
      "user";

    const icon =
      document.createElement(
        "div"
      );

    icon.className =
      "user-icon";

    if (id === currentUserId) {
      icon.id = "myUserIcon";
    }

    icon.textContent =
      getInitial(
        user.name
      );

    const name =
      document.createElement(
        "div"
      );

    name.className =
      "user-name";

    name.textContent =
      user.name;

    container.appendChild(icon);

    container.appendChild(name);

    return container;
  }


  /*
   * 頭文字取得
   */
  function getInitial(name) {

    if (!name) {
      return "?";
    }

    return Array.from(
      name.trim()
    )[0];
  }


  /*
   * WebRTC初期化
   */
  async function startWebRTC() {
    try {
      localStream =
        await navigator.mediaDevices.getUserMedia({
          audio: true
        });

      audioContext =
        new AudioContext();

      const source =
        audioContext.createMediaStreamSource(
          localStream
        );

      analyser =
        audioContext.createAnalyser();

      source.connect(analyser);

      detectVoice();

    } catch (err) {
      console.error(
        "マイクの取得に失敗しました:",
        err
      );
    }
  }


  /*
   * PeerConnection作成
   */
  function createPeer(userId) {

    const pc =
      new RTCPeerConnection({
        iceServers: [
          {
            urls:
              "stun:stun.l.google.com:19302"
          }
        ]
      });

    if (localStream) {
      localStream
        .getTracks()
        .forEach(track => {
          pc.addTrack(
            track,
            localStream
          );
        });
    }

    pc.ontrack = e => {

      let audio =
        document.getElementById(
          "audio_" + userId
        );

      if (!audio) {
        audio =
          document.createElement("audio");

        audio.id = "audio_" + userId;
        audio.autoplay = true;
        audio.volume = currentVolume;

        document.body.appendChild(audio);
        audioElements[userId] = audio;
      }

      audio.srcObject = e.streams[0];

    };

    pc.onicecandidate = e => {

      if (e.candidate) {
        push(
          ref(
            database,
            "rooms/" +
            currentRoomId +
            "/signal/" +
            userId +
            "/candidates"
          ),
          {
            from: currentUserId,
            data: e.candidate.toJSON()
          }
        );
      }

    };

    return pc;
  }


  /*
   * Offer送信
   */
  async function makeOffer(target) {

    if (creatingOffer[target]) {
      return;
    }

    creatingOffer[target] = true;

    const pc =
      createPeer(target);

    peers[target] = pc;

    const offer =
      await pc.createOffer();

    await pc.setLocalDescription(offer);

    set(
      ref(
        database,
        "rooms/" +
        currentRoomId +
        "/signal/" +
        target +
        "/offer"
      ),
      {
        from: currentUserId,
        data: offer
      }
    );

  }


  /*
   * Offer受信・Answer送信
   */
  async function handleOffer(
    from,
    offer
  ) {

    const key = from;

    if (processedOffers[key]) {
      return;
    }

    processedOffers[key] = true;

    let pc = peers[from];

    if (!pc) {
      pc = createPeer(from);
      peers[from] = pc;
    }

    if (
      pc.signalingState !== "stable" &&
      pc.signalingState !== "have-local-offer"
    ) {
      return;
    }

    await pc.setRemoteDescription(
      new RTCSessionDescription(
        offer
      )
    );

    const answer =
      await pc.createAnswer();

    await pc.setLocalDescription(answer);

    await set(
      ref(
        database,
        "rooms/" +
        currentRoomId +
        "/signal/" +
        from +
        "/answer"
      ),
      {
        from: currentUserId,
        data: answer
      }
    );

    setTimeout(() => {
      remove(
        ref(
          database,
          "rooms/" +
          currentRoomId +
          "/signal/" +
          currentUserId +
          "/answer"
        )
      );
    }, 3000);

  }


  /*
   * Answer受信
   */
  async function handleAnswer(
    from,
    answer
  ) {

    const key = from;

    if (processedAnswers[key]) {
      return;
    }

    processedAnswers[key] = true;

    const pc = peers[from];

    if (
      pc &&
      pc.signalingState === "have-local-offer"
    ) {
      await pc.setRemoteDescription(
        new RTCSessionDescription(
          answer
        )
      );
    }

  }


  /*
   * ICE候補処理
   */
  async function handleCandidate(
    from,
    candidate
  ) {

    const pc = peers[from];

    if (pc) {
      await pc.addIceCandidate(
        new RTCIceCandidate(
          candidate
        )
      );
    }

  }


  /*
   * 発話検知
   */
  function detectVoice() {
    const data =
      new Uint8Array(
        analyser.frequencyBinCount
      );

    function loop() {
      if (!analyser) return;

      analyser.getByteFrequencyData(data);

      let volume =
        data.reduce(
          (a, b) => a + b,
          0
        ) / data.length;

      const me =
        document.getElementById(
          'myUserIcon'
        );

      if (!me) {
        requestAnimationFrame(loop);
        return;
      }

      if (volume > 20) {
        me.classList.add(
          "talking"
        );
      } else {
        me.classList.remove(
          "talking"
        );
      }

      requestAnimationFrame(loop);
    }

    loop();
  }


  /*
   * ルーム入室
   */
  async function enter(
    roomId,
    userId,
    name
  ) {

    currentRoomId =
      roomId;

    currentUserId =
      userId;

    currentUserName =
      name;

    const roomIdDisplay =
      document.getElementById(
        "roomIdDisplay"
      );

    if (roomIdDisplay) {
      roomIdDisplay.textContent =
        "Room ID: " + roomId;
    }

    await startWebRTC();
    watchUsers(roomId);
    watchSignal();
    watchMessages();
    setupDisconnect();
  }


  /*
   * ミュート切り替え
   */
  function toggleMute() {

    isMuted = !isMuted;

    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
      });
    }

    const muteBtn =
      document.getElementById("muteBtn");

    if (!muteBtn) return;

    if (isMuted) {
      muteBtn.textContent = "🔇";
      muteBtn.style.background = "#da373c";
    } else {
      muteBtn.textContent = "🔊";
      muteBtn.style.background = "#2b2d31";
    }

  }


  /*
   * 音量変更
   */
  function changeVolume(value) {

    currentVolume =
      parseFloat(value);

    Object.values(audioElements).forEach(audio => {
      audio.volume = currentVolume;
    });

  }


  /*
   * 会話送信（一時チャット用）
   */
  function pushData(message) {

    if (!message || !message.trim()) {
      return;
    }

    push(
      ref(
        database,
        "rooms/" +
        currentRoomId +
        "/chat"
      ),
      {
        user: currentUserId,
        name: currentUserName,
        text: message
      }
    );

  }


  /*
   * ルーム手動退出
   */
  function leaveRoom() {

    if (localStream) {
      localStream.getTracks().forEach(track => {
        track.stop();
      });
    }

    Object.values(peers).forEach(pc => {
      pc.close();
    });

    if (!currentRoomId || !currentUserId) {
      sessionStorage.removeItem("callroom_reload_" + currentUserId);
      location.href = "https://aoaoaoreinn-a11y.github.io/call/index.html";
      return;
    }

    const userRef =
      ref(
        database,
        "rooms/" +
        currentRoomId +
        "/users/" +
        currentUserId
      );

    remove(userRef)
      .then(() => {

        const usersRef =
          ref(
            database,
            "rooms/" +
            currentRoomId +
            "/users"
          );

        onValue(usersRef, snapshot => {

          const users = snapshot.val();

          if (!users) {

            remove(
              ref(
                database,
                "rooms/" + currentRoomId
              )
            );

          }

        }, {
          onlyOnce: true
        });

        sessionStorage.removeItem("callroom_reload_" + currentUserId);
        location.href = "https://aoaoaoreinn-a11y.github.io/call/index.html";

      })
      .catch(err => {

        console.error(err);
        sessionStorage.removeItem("callroom_reload_" + currentUserId);
        location.href = "https://aoaoaoreinn-a11y.github.io/call/index.html";

      });

  }


  /*
   * 外部から参照するAPI
   */
  return {

    enter,
    toggleMute,
    changeVolume,
    leaveRoom,
    pushData

  };

})();

window.RoomManager =
  RoomManager;

window.addEventListener("DOMContentLoaded", () => {

  const params =
    new URLSearchParams(
      location.search
    );

  const room =
    params.get("room");

  const user =
    params.get("user");

  const name =
    params.get("name");

  if (!room || !user || !name) {
    return;
  }

  const reloadKey =
    "callroom_reload_" + user;

  if (sessionStorage.getItem(reloadKey)) {

    sessionStorage.removeItem(reloadKey);

    location.href =
      "https://aoaoaoreinn-a11y.github.io/call/index.html";

    return;
  }

  sessionStorage.setItem(
    reloadKey,
    "1"
  );

  RoomManager.enter(
    room,
    user,
    name
  );

});

window.addEventListener(
  "beforeunload",
  () => {

    if (
      currentRoomId &&
      currentUserId
    ) {

      remove(
        ref(
          database,
          "rooms/" +
          currentRoomId +
          "/users/" +
          currentUserId
        )
      );

    }

  }
);
