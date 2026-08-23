import {
  getDatabase,
  ref,
  set,
  get
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

import {
  database
} from "./firebase-config.js";


function generateRoomId() {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

  let result = "";

  for (let i = 0; i < 8; i++) {
    result += chars[
      Math.floor(Math.random() * chars.length)
    ];
  }

  return result;
}


function generateUserId() {
  return crypto.randomUUID()
    .replaceAll("-", "");
}


window.createRoom = function() {
  const name =
    document
      .getElementById("name")
      .value
      .trim();

  if (!name) {
    showStatus("名前を入力してください。");
    return;
  }

  showStatus("部屋を作成しています...");

  const roomId =
    generateRoomId();

  const userId =
    generateUserId();

  const now =
    Date.now();

  set(
    ref(
      database,
      "rooms/" + roomId
    ),
    {
      createdAt: now,
      owner: {
        name: name
      },
      users: {
        [userId]: {
          name: name,
          joinedAt: now
        }
      }
    }
  )
    .then(() => {
      location.href =
        "callroom.html?room=" +
        roomId +
        "&user=" +
        userId +
        "&name=" +
        encodeURIComponent(name);
    })
    .catch(error => {
      console.error(error);
      showStatus("エラー: " + error.message);
    });
};


window.joinRoom = async function() {
  const name =
    document
      .getElementById("name")
      .value
      .trim();

  if (!name) {
    showStatus("名前を入力してください。");
    return;
  }

  const roomId =
    document
      .getElementById("roomId")
      .value
      .trim();

  if (!roomId) {
    showStatus("部屋IDを入力してください。");
    return;
  }

  showStatus("部屋に参加しています...");

  try {
    const snapshot =
      await get(
        ref(
          database,
          "rooms/" + roomId
        )
      );

    if (!snapshot.exists()) {
      showStatus("その部屋は存在しません。");
      return;
    }

    const userId =
      generateUserId();

    await set(
      ref(
        database,
        "rooms/" +
        roomId +
        "/users/" +
        userId
      ),
      {
        name: name,
        joinedAt: Date.now()
      }
    );

    location.href =
      "callroom.html?room=" +
      roomId +
      "&user=" +
      userId +
      "&name=" +
      encodeURIComponent(name);

  } catch (error) {
    console.error(error);
    showStatus("エラー: " + error.message);
  }
};


function showStatus(message) {
  const status =
    document.getElementById("status");

  status.textContent = message;
  status.style.display = "block";
}
