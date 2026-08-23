import {
  ref,
  onValue,
  onDisconnect,
  remove,
  set,
  push
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

import {
  database
} from "./firebase-config.js";

const RoomManager = (() => {

  let currentRoomId = null;
  let currentUserId = null;
  let isMuted = false;
  let currentVolume = 1;

  let localStream = null;
  let peers = {};
  let audioElements = {};
  let analyser = null;
  let audioContext = null;


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
   * 退出処理
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

    onDisconnect(userRef)
      .remove()
      .then(() => {

        console.log(
          "ユーザー退出監視登録完了"
        );

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

    let pc = peers[from];

    if (!pc) {
      pc = createPeer(from);
      peers[from] = pc;
    }

    await pc.setRemoteDescription(
      new RTCSessionDescription(
        offer
      )
    );

    const answer =
      await pc.createAnswer();

    await pc.setLocalDescription(answer);

    set(
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

  }


  /*
   * Answer受信
   */
  async function handleAnswer(
    from,
    answer
  ) {

    const pc = peers[from];

    if (pc) {
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

        location.href = "https://aoaoaoreinn-a11y.github.io/call/index.html";

      })
      .catch(err => {

        console.error(err);
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
    leaveRoom

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

  if (room && user && name) {
    RoomManager.enter(
      room,
      user,
      name
    );
  }
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
