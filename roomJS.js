import {
  ref,
  onValue,
  onDisconnect,
  remove,
  set,
  push,
  get,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

import {
  database
} from "./firebase-config.js";

const RoomManager = (() => {

  let currentRoomId = null;
  let currentUserId = null;
  let currentUserName = "";
  let currentUserColor = "#5865f2";
  let isMuted = false;
  let currentVolume = 1;

  let localStream = null;
  let localVideoStream = null;
  let cameraEnabled = false;
  let peers = {};
  let audioElements = {};
  let videoElements = {};
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

          icon.style.background =
            msg.color || "#5865f2";

          const body =
            document.createElement("div");

          body.className =
            "message-body";

          const username =
            document.createElement("div");

          username.className =
            "message-name";

          username.textContent =
            msg.name;

          const text =
            document.createElement("div");

          text.className =
            "message-text";

          text.textContent =
            msg.text;

          body.appendChild(username);
          body.appendChild(text);

          wrapper.appendChild(icon);
          wrapper.appendChild(body);

          box.appendChild(wrapper);

          box.scrollTop =
            box.scrollHeight;

          const panelCard =
            document.getElementById(
              "panelCard"
            );

          const badge =
            document.getElementById(
              "chatBadge"
            );

          if (panelCard && badge && !panelCard.classList.contains("show")) {
            badge.style.display = "inline-block";
          }

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
   * 退出処理・ルーム削除監視（onDisconnectで確実に自ユーザー削除＆無人時ルーム削除）
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

    onDisconnect(userRef)
      .remove()
      .then(() => {
        console.log("ユーザー退出監視登録完了");
      });

    const usersRef =
      ref(
        database,
        "rooms/" +
        currentRoomId +
        "/users"
      );

    onValue(
      usersRef,
      snapshot => {
        const users =
          snapshot.val();

        if (!users) {
          remove(roomRef);
        }
      }
    );
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
   * ユーザー要素作成（Meet風カード＆背景ビデオ＋前面アイコン構造）
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

    const isMe = (id === currentUserId);
    const hasCamera = isMe ? cameraEnabled : (window.remoteCameraStatus && window.remoteCameraStatus[id]);

    if (hasCamera) {
      container.classList.add("camera-active");
    }

    // ビデオボックス（背景）
    const videoBox = document.createElement("div");
    videoBox.className = "video-box";
    if (isMe) {
      videoBox.id = "myVideoBox";
    } else {
      videoBox.id = "videoBox_" + id;
    }

    const video = document.createElement("video");
    if (isMe) {
      video.id = "myVideoElement";
      video.muted = true;
      if (localVideoStream) {
        video.srcObject = localVideoStream;
      }
    }
    video.autoplay = true;
    video.playsInline = true;
    videoBox.appendChild(video);
    container.appendChild(videoBox);

    // ユーザーアイコン（前面）
    const icon =
      document.createElement(
        "div"
      );

    icon.className =
      "user-icon";

    if (isMe) {
      icon.id = "myUserIcon";
      icon.style.setProperty("--user-color", user.color || "#5865f2");
    }

    icon.textContent =
      getInitial(
        user.name
      );

    if (user.color) {
      icon.style.background = user.color;
    }
    container.appendChild(icon);

    // ユーザー名（下部固定）
    const name =
      document.createElement(
        "div"
      );

    name.className =
      "user-name";

    name.textContent =
      user.name;

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
   * 重複しないカラー生成
   */
  function createUserColor(users) {
    const colors = [
      "#5865f2",
      "#57f287",
      "#fee75c",
      "#eb459e",
      "#ed4245",
      "#9b59b6",
      "#e67e22",
      "#1abc9c",
      "#3498db",
      "#2ecc71"
    ];

    const used = Object.values(users).map(user => user.color);
    const available = colors.filter(c => !used.includes(c));

    if (available.length > 0) {
      return available[Math.floor(Math.random() * available.length)];
    }

    return "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0");
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
   * カメラ切り替え
   */
  async function toggleCamera() {
    const cameraBtn =
      document.getElementById(
        "cameraBtn"
      );

    if (cameraEnabled) {
      if (localVideoStream) {
        localVideoStream
          .getTracks()
          .forEach(t => t.stop());
      }
      localVideoStream = null;
      cameraEnabled = false;

      if (cameraBtn) {
        cameraBtn.textContent =
          "カメラ";
        cameraBtn.style.background =
          "#2b2d31";
      }

      const myBox =
        document.getElementById(
          "myVideoBox"
        );

      const myContainer = myBox ? myBox.closest(".user") : null;
      if (myContainer) {
        myContainer.classList.remove("camera-active");
      }

      Object.values(peers).forEach(pc => {
        const senders =
          pc.getSenders();
        senders.forEach(sender => {
          if (
            sender.track &&
            sender.track.kind ===
            "video"
          ) {
            pc.removeTrack(sender);
          }
        });
      });

      return;
    }

    try {
      localVideoStream =
        await navigator.mediaDevices.getUserMedia({
          video: true
        });

      cameraEnabled = true;

      if (cameraBtn) {
        cameraBtn.textContent =
          "カメラOFF";
        cameraBtn.style.background =
          "#da373c";
      }

      const myBox =
        document.getElementById(
          "myVideoBox"
        );

      const myContainer = myBox ? myBox.closest(".user") : null;
      if (myContainer) {
        myContainer.classList.add("camera-active");
      }

      const myVideo =
        document.getElementById(
          "myVideoElement"
        );

      if (myVideo) {
        myVideo.srcObject =
          localVideoStream;
      }

      Object.entries(peers).forEach(
        ([targetId, pc]) => {
          localVideoStream
            .getTracks()
            .forEach(track => {
              pc.addTrack(
                track,
                localVideoStream
              );
            });
          makeOffer(targetId);
        }
      );

    } catch (err) {
      console.error(
        "カメラの取得に失敗しました:",
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

    if (localVideoStream && cameraEnabled) {
      localVideoStream
        .getTracks()
        .forEach(track => {
          pc.addTrack(
            track,
            localVideoStream
          );
        });
    }

    pc.ontrack = e => {

      const stream = e.streams[0];

      if (e.track.kind === "audio") {
        let audio =
          document.getElementById(
            "audio_" + userId
          );

        if (!audio) {
          audio =
            document.createElement("audio");

          audio.id = "audio_" + userId;
          audio.autoplay = true;
          audio.playsInline = true;
          audio.volume = currentVolume;

          document.body.appendChild(
            audio
          );
          audioElements[userId] =
            audio;
        }

        audio.srcObject = stream;

        audio.play()
          .catch(err => {
            console.log(
              "音声自動再生がブロックされました:",
              err
            );
          });
      }

      if (e.track.kind === "video") {
        let videoBox =
          document.getElementById(
            "videoBox_" + userId
          );

        if (videoBox) {
          const container = videoBox.closest(".user");
          if (container) {
            container.classList.add("camera-active");
          }

          let video =
            videoBox.querySelector(
              "video"
            );

          if (!video) {
            video =
              document.createElement(
                "video"
              );

            video.autoplay = true;
            video.playsInline = true;
            videoBox.appendChild(
              video
            );
          }

          video.srcObject = stream;
        }
      }

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
   * ルーム入室（トランザクションによる同時入室の名前・色競合防止）
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

    const userRef = ref(
      database,
      "rooms/" +
      roomId +
      "/users/" +
      userId
    );

    const usersRef = ref(
      database,
      "rooms/" +
      roomId +
      "/users"
    );

    await runTransaction(userRef, (currentData) => {
      if (currentData) {
        return currentData;
      }
      return null;
    });

    const usersSnap = await get(usersRef);
    const users = usersSnap.val() || {};

    let count = 1;
    let uniqueName = name;
    const otherUsers = Object.entries(users)
      .filter(([id]) => id !== userId)
      .map(([id, u]) => u.name);

    while (otherUsers.includes(uniqueName)) {
      count++;
      uniqueName = name + "-" + count;
    }

    const color = createUserColor(users);

    currentUserName = uniqueName;
    currentUserColor = color;

    await set(userRef, {
      name: uniqueName,
      color: color
    });

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
        color: currentUserColor,
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

    if (localVideoStream) {
      localVideoStream.getTracks().forEach(track => {
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
    pushData,
    toggleCamera

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
    RoomManager.leaveRoom();
  }
);
