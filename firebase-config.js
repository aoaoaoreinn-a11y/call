import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getDatabase
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";


const firebaseConfig = {
  databaseURL:
    "https://mike-ebcae-default-rtdb.firebaseio.com/"
};


const app =
  initializeApp(firebaseConfig);


export const database =
  getDatabase(app);
