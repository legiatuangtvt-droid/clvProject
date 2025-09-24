import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  limit,
  getDocs,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { auth, firestore } from './firebase-config.js';

onAuthStateChanged(auth, async (user) => { // Kiểm tra nếu người dùng đã đăng nhập, chuyển hướng họ
  if (user) {
    // Người dùng đã đăng nhập, chuyển hướng họ đi
    await redirectUser(user);
  }
});

// --- Lấy các phần tử DOM ---
const loginForm = document.getElementById('login-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const emailError = document.getElementById('email-error');
const passwordError = document.getElementById('password-error');
const rememberMeCheckbox = document.getElementById('remember');
const successMessage = document.getElementById('successMessage');
const submitButton = loginForm.querySelector('button[type="submit"]');

// --- Xử lý hiển thị/ẩn mật khẩu ---
const showPasswordButton = document.getElementById('show-password');

showPasswordButton.addEventListener('click', () => {
  if (passwordInput.type === 'password') {
      passwordInput.type = 'text';
      showPasswordButton.classList.add('toggled');
  } else {
      passwordInput.type = 'password';
      showPasswordButton.classList.remove('toggled');
  }
});

const statusDiv = document.getElementById('status');

// --- Xử lý sự kiện nhập liệu để xóa lỗi ---
emailInput.addEventListener('input', () => {
  if (emailError) emailError.textContent = '';
});
passwordInput.addEventListener('input', () => {
  if (passwordError) passwordError.textContent = '';
});

// --- Xử lý đăng nhập ---
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = emailInput.value;
  const password = passwordInput.value;
  const rememberMe = rememberMeCheckbox.checked;

  // Reset error messages
  emailError.textContent = '';
  passwordError.textContent = '';
  statusDiv.textContent = '';

  // Disable button and show loader
  submitButton.disabled = true;
  submitButton.classList.add('loading');


  try {
    // Đặt persistence
    const persistence = rememberMe ? browserLocalPersistence : browserSessionPersistence;
    await setPersistence(auth, persistence);

    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Hiển thị màn hình thành công
    successMessage.classList.add('visible');

    // Chuyển hướng sau một khoảng thời gian ngắn
    setTimeout(async () => {
      await redirectUser(user);
    }, 1500); // 1.5 giây

  } catch (error) {
    console.error("Lỗi đăng nhập:", error.code, error.message);
    handleLoginError(error);
  }
});

// --- Xử lý lỗi đăng nhập ---
function handleLoginError(error) {
  statusDiv.style.color = '#d9534f'; // Màu đỏ cho lỗi
  // Re-enable button
  submitButton.classList.remove('loading');
  submitButton.disabled = false;

  switch (error.code) {
    case 'auth/invalid-email':
      emailError.textContent = 'Email không hợp lệ.';
      break;
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      statusDiv.textContent = 'Email hoặc mật khẩu không chính xác.';
      break;
    case 'auth/user-disabled':
      statusDiv.textContent = 'Tài khoản này đã bị vô hiệu hóa.';
      break;
    default:
      statusDiv.textContent = 'Đã có lỗi xảy ra. Vui lòng thử lại.';
      break;
  }
}

// --- Chuyển hướng người dùng ---
async function redirectUser(user) {
  try {
    const userDocRef = doc(firestore, "users", user.uid);
    const userDocSnap = await getDoc(userDocRef);

    // Kiểm tra vai trò (rule) để chuyển hướng
    if (userDocSnap.exists()) {
      const userData = userDocSnap.data();
      if (userData.rule === 'manager') {
        window.location.href = 'manager-main.html';
      } else if (userData.rule === 'supervisory') {
        window.location.href = 'supervisory-main.html';
      } else {
        // Xử lý cho teacher hoặc các vai trò khác không xác định
        window.location.href = 'teacher.html';
      }
    } else {
      window.location.href = 'teacher.html';
    }
  } catch (e) {
    console.error("[Redirect] Lỗi khi lấy vai trò người dùng, chuyển hướng về trang giáo viên mặc định:", e);
    window.location.href = 'teacher.html';
  }
}

// --- Xử lý quên mật khẩu ---
document.getElementById('forgot-password-link').addEventListener('click', async (e) => {
  e.preventDefault();
  const email = emailInput.value;
  if (!email) {
    statusDiv.textContent = 'Vui lòng nhập email của bạn để khôi phục mật khẩu.';
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    statusDiv.textContent = 'Email khôi phục đã được gửi. Vui lòng kiểm tra hộp thư.';
    statusDiv.style.color = 'green';
  } catch (error) {
    console.error("Lỗi gửi email khôi phục:", error);
    statusDiv.textContent = 'Lỗi khi gửi email. Vui lòng kiểm tra lại địa chỉ email.';
  }
});

// --- Hiệu ứng gợn sóng cho nút ---
function createRipple(event) {
    const button = event.currentTarget;

    // Tạo phần tử span cho hiệu ứng
    const circle = document.createElement("span");
    const diameter = Math.max(button.clientWidth, button.clientHeight);
    const radius = diameter / 2;

    // Thiết lập style và vị trí
    circle.style.width = circle.style.height = `${diameter}px`;
    circle.style.left = `${event.clientX - button.getBoundingClientRect().left - radius}px`;
    circle.style.top = `${event.clientY - button.getBoundingClientRect().top - radius}px`;
    circle.classList.add("ripple");

    button.appendChild(circle);

    // Tự động xóa phần tử ripple sau khi animation kết thúc để dọn dẹp DOM
    circle.addEventListener('animationend', () => {
        circle.remove();
    });
}

submitButton.addEventListener("click", createRipple);
