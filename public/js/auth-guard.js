import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { doc, getDoc, updateDoc, collection, query, where, limit, getDocs } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { auth, firestore } from './firebase-config.js';

import { showToast } from './toast.js';
// 1. Bảo vệ trang: Kiểm tra trạng thái đăng nhập của người dùng
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // Nếu không có người dùng nào đăng nhập, chuyển hướng về trang chủ
    console.log("Người dùng chưa đăng nhập. Chuyển về trang đăng nhập.");
    window.location.href = 'index.html';
  } else {
    // Nếu người dùng đã đăng nhập, lấy và hiển thị tên của họ
    await displayUserName(user);
    // setupEditFunctionality(user); // Tạm thời vô hiệu hóa
    setupMenuToggle(); // Thêm hàm thiết lập cho menu
  }
});

// Hàm để lấy và hiển thị tên người dùng
async function displayUserName(user) {
  const namePlaceholder = document.getElementById('user-name');
  if (!namePlaceholder) return;

  try {    
    // Ưu tiên 1: Tìm trong collection 'teachers' trước, vì đây là nguồn tên đầy đủ và chính xác nhất cho giáo viên.
    const teachersRef = collection(firestore, "teachers");
    const teacherQuery = query(teachersRef, where("uid", "==", user.uid), limit(1));
    const teacherSnapshot = await getDocs(teacherQuery);

    if (!teacherSnapshot.empty) {
        const teacherData = teacherSnapshot.docs[0].data();
        if (teacherData.teacher_name) {
            namePlaceholder.textContent = teacherData.teacher_name;
            return; // Tìm thấy tên giáo viên, kết thúc.
        }
    }

    // Ưu tiên 2: Nếu không tìm thấy trong 'teachers' (có thể là manager/supervisory), tìm trong 'users'.
    const userDocRef = doc(firestore, "users", user.uid);
    const userDocSnap = await getDoc(userDocRef);

    if (userDocSnap.exists()) {
      const userData = userDocSnap.data();
      if (userData.name) {
        namePlaceholder.textContent = userData.name;
        return;
      }
    }

    // Phương án cuối cùng: Nếu không tìm thấy tên ở đâu, hiển thị email.
    console.warn(`Không tìm thấy tên cụ thể cho user UID: ${user.uid}. Sử dụng email.`);
    namePlaceholder.textContent = user.email;

  } catch (error) {
    console.error("Lỗi khi lấy thông tin người dùng:", error);
    // Nếu có lỗi, hiển thị email làm dự phòng
    namePlaceholder.textContent = user.email;
  }
}

// 2. Xử lý chức năng đăng xuất
const logoutButton = document.getElementById('logout-button');
logoutButton.addEventListener('click', async () => {
  try {
    await signOut(auth);
    console.log('Đăng xuất thành công!');
    window.location.href = 'index.html'; // Chuyển hướng về trang đăng nhập sau khi đăng xuất
  } catch (error) {
    console.error('Lỗi khi đăng xuất:', error);
    showToast('Đã có lỗi xảy ra khi đăng xuất. Vui lòng thử lại.', 'error');
  }
});

// 3. Xử lý chức năng chỉnh sửa tên với Modal
function setupEditFunctionality(user) {
  const modal = document.getElementById('profile-modal');
  const editButton = document.getElementById('edit-profile-button');
  const cancelButton = document.getElementById('cancel-edit-button');
  const saveButton = document.getElementById('save-name-button');
  const nameInput = document.getElementById('name-input');
  const namePlaceholder = document.getElementById('user-name');

  if (!modal || !editButton || !cancelButton || !saveButton || !nameInput) {
    // Nếu đang ở trang không có các element này (vd: teacher.html), thì không làm gì cả
    return;
  }

  const openModal = () => {
    nameInput.value = namePlaceholder.textContent; // Điền tên hiện tại vào ô input
    modal.style.display = 'flex';
  };

  const closeModal = () => {
    modal.style.display = 'none';
  };

  editButton.addEventListener('click', openModal);
  cancelButton.addEventListener('click', closeModal);

  // Đóng modal khi nhấn ra ngoài
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  saveButton.addEventListener('click', async () => {
    const newName = nameInput.value.trim();
    if (newName && newName !== namePlaceholder.textContent) {
      try {
        const userDocRef = doc(firestore, "users", user.uid);
        await updateDoc(userDocRef, { name: newName });
        namePlaceholder.textContent = newName; // Cập nhật giao diện ngay lập tức
        showToast('Cập nhật tên thành công!', 'success');
      } catch (error) {
        console.error("Lỗi khi cập nhật tên:", error);
        showToast('Đã có lỗi xảy ra, không thể cập nhật tên.', 'error');
      }
    }
    closeModal();
  });
}

// 4. Xử lý thu/mở menu
function setupMenuToggle() {
    const sidebar = document.querySelector('.sidebar');
    const topBar = document.querySelector('.top-bar');
    if (!sidebar || !topBar) return;

    // Logic được chia làm 2 trường hợp: Mobile và Desktop
    if (window.innerWidth > 768) {
        // --- TRƯỜNG HỢP 1: DESKTOP ---
        // Chỉ cần xử lý sự kiện hover để mở/đóng menu.
        // Không cần tạo nút hamburger.
        sidebar.addEventListener('mouseenter', () => {
            sidebar.classList.add('expanded');
        });

        sidebar.addEventListener('mouseleave', () => {
            sidebar.classList.remove('expanded');
        });
    }
    else {
        // --- TRƯỜNG HỢP 2: MOBILE ---
        // Cần tạo nút hamburger và overlay để người dùng có thể click mở/đóng menu.
        const menuToggleBtn = document.createElement('button');
        menuToggleBtn.innerHTML = '<i class="fas fa-bars"></i>';
        menuToggleBtn.className = 'menu-toggle-btn icon-button';
        menuToggleBtn.title = 'Mở menu';

        // Chèn nút hamburger vào đầu top-bar
        topBar.prepend(menuToggleBtn);

        const overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        overlay.style.display = 'none';
        document.body.appendChild(overlay);

        const toggleMenu = () => {
            const isExpanded = sidebar.classList.toggle('expanded');
            overlay.style.display = isExpanded ? 'block' : 'none';
        };

        menuToggleBtn.addEventListener('click', toggleMenu);
        overlay.addEventListener('click', toggleMenu);
    }
}