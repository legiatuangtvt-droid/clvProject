import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

// Cấu hình Firebase của bạn
const firebaseConfig = {
  apiKey: "AIzaSyAeKLP-tnWtygrNybiVyUDcpTwxlCi7DbQ",
  authDomain: "thptclvqt.firebaseapp.com",
  projectId: "thptclvqt",
  storageBucket: "thptclvqt.firebasestorage.app",
  messagingSenderId: "618930711710",
  appId: "1:618930711710:web:858b0a81a29a7799721f8f",
  measurementId: "G-E3H9L4FW4D"
};

// Khởi tạo Firebase
export const app = initializeApp(firebaseConfig);

// Khởi tạo và export các dịch vụ Firebase để tái sử dụng
export const auth = getAuth(app);
export const firestore = getFirestore(app);