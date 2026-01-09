import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-storage.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-functions.js";

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
export const storage = getStorage(app);
export const functions = getFunctions(app);

// Cấu hình cho môi trường local development
// Kiểm tra xem có đang chạy trên localhost không
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    console.log('🔧 Running in LOCAL mode - using emulators if available');

    // Nếu muốn sử dụng Functions emulator trên local, bỏ comment dòng dưới
    // import { connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-functions.js";
    // connectFunctionsEmulator(functions, "localhost", 5001);

    // LƯU Ý: Khi chạy local, nếu KHÔNG sử dụng emulator thì Functions vẫn gọi về production
    // Để sử dụng production Functions trên local: KHÔNG cần làm gì thêm (mặc định)
    // Để sử dụng emulator: Bỏ comment các dòng trên và chạy: firebase emulators:start
}