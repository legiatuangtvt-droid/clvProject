import { onAuthStateChanged, signOut, updateProfile, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { doc, getDoc, updateDoc, collection, query, where, limit, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
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
    injectSharedElements(); // Chèn các thành phần dùng chung vào trang
    await displayUserName(user); // Hiển thị tên
    setupProfileFunctionality(user); // Thiết lập chức năng cho nút bút chì
    setupScrollToTop(); // Thêm hàm thiết lập nút cuộn lên đầu trang
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

// Hàm chèn các thành phần HTML dùng chung (dropdown, modals) vào trang
function injectSharedElements() {
    // 1. Chèn Dropdown Menu vào sau nút bút chì
    const userInfoDiv = document.querySelector('.user-info');
    if (userInfoDiv && !document.getElementById('profile-dropdown')) {
        const dropdownHTML = `
            <div id="profile-dropdown" class="profile-dropdown" style="display: none;">
                <a href="#" id="change-info-btn"><i class="fas fa-user-edit"></i> Thay đổi thông tin</a>
                <a href="#" id="change-password-btn"><i class="fas fa-key"></i> Thay đổi mật khẩu</a>
            </div>
        `;
        // Chèn dropdown vào trong .user-info
        userInfoDiv.insertAdjacentHTML('beforeend', dropdownHTML);
    }

    // 2. Chèn các Modals vào cuối thẻ body (nếu chúng chưa tồn tại)
    if (!document.getElementById('profile-modal')) {
        const modalsHTML = `
            <!-- Modal Chỉnh sửa thông tin cá nhân -->
            <div id="profile-modal" class="modal-overlay" style="display: none;">
                <div class="modal-content">
                    <h2>Chỉnh sửa thông tin</h2>
                    <div class="form-group">
                        <label for="name-input">Tên hiển thị</label>
                        <input type="text" id="name-input" placeholder="Nhập tên của bạn">
                    </div>
                    <div class="modal-actions">
                        <button id="cancel-edit-button" class="btn-cancel">Hủy</button>
                        <button id="save-name-button" class="btn-save">Lưu thay đổi</button>
                    </div>
                </div>
            </div>

            <!-- Modal Thay đổi mật khẩu -->
            <div id="password-modal" class="modal-overlay" style="display: none;">
                <div class="modal-content">
                    <h2>Thay đổi mật khẩu</h2>
                    <div class="form-group">
                        <label for="current-password">Mật khẩu hiện tại</label>
                        <div class="password-input-wrapper">
                            <input type="password" id="current-password" required>
                            <button type="button" class="password-toggle-btn" title="Hiển thị mật khẩu"><i class="fas fa-eye"></i><i class="fas fa-eye-slash" style="display: none;"></i></button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="new-password">Mật khẩu mới</label>
                        <div class="password-input-wrapper">
                            <input type="password" id="new-password" required>
                            <button type="button" class="password-toggle-btn" title="Hiển thị mật khẩu"><i class="fas fa-eye"></i><i class="fas fa-eye-slash" style="display: none;"></i></button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="confirm-new-password">Xác nhận mật khẩu mới</label>
                        <div class="password-input-wrapper">
                            <input type="password" id="confirm-new-password" required>
                            <button type="button" class="password-toggle-btn" title="Hiển thị mật khẩu"><i class="fas fa-eye"></i><i class="fas fa-eye-slash" style="display: none;"></i></button>
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button id="cancel-password-change-btn" class="btn-cancel">Hủy</button>
                        <button id="save-password-btn" class="btn-save">Lưu mật khẩu mới</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalsHTML);
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
function setupProfileFunctionality(user) {
  const editButton = document.getElementById('edit-profile-button');
  if (!editButton) {
    return;
  }
  
  const profileDropdown = document.getElementById('profile-dropdown');
  const profileModal = document.getElementById('profile-modal');
  const passwordModal = document.getElementById('password-modal');

  // Event listener cho nút bút chì để mở dropdown
  editButton.addEventListener('click', (e) => {
    e.stopPropagation();
    if (profileDropdown) {
      profileDropdown.style.display = profileDropdown.style.display === 'block' ? 'none' : 'block';
    }
  });

  // Ẩn dropdown khi click ra ngoài
  document.addEventListener('click', () => {
    if (profileDropdown) profileDropdown.style.display = 'none';
  });

  // Mở modal thay đổi thông tin
  document.getElementById('change-info-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (profileModal && user) {
      document.getElementById('name-input').value = user.displayName || '';
      profileModal.style.display = 'flex';
      if (profileDropdown) profileDropdown.style.display = 'none';
    }
  });

  // Mở modal thay đổi mật khẩu
  document.getElementById('change-password-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (passwordModal) {
      passwordModal.style.display = 'flex';
      if (profileDropdown) profileDropdown.style.display = 'none';
      document.getElementById('current-password').value = '';
      document.getElementById('new-password').value = '';
      document.getElementById('confirm-new-password').value = '';
    }
  });

  // Xử lý các nút hủy
  document.getElementById('cancel-edit-button')?.addEventListener('click', () => profileModal.style.display = 'none');
  document.getElementById('cancel-password-change-btn')?.addEventListener('click', () => passwordModal.style.display = 'none');

  // Xử lý nút hiển thị/ẩn mật khẩu
  const togglePasswordVisibility = (e) => {
    const button = e.currentTarget;
    const wrapper = button.closest('.password-input-wrapper');
    const input = wrapper.querySelector('input');
    const eyeIcon = button.querySelector('.fa-eye');
    const eyeSlashIcon = button.querySelector('.fa-eye-slash');

    if (input.type === 'password') {
        input.type = 'text';
        eyeIcon.style.display = 'none';
        eyeSlashIcon.style.display = 'inline';
    } else {
        input.type = 'password';
        eyeIcon.style.display = 'inline';
        eyeSlashIcon.style.display = 'none';
    }
  };
  document.querySelectorAll('.password-toggle-btn').forEach(btn => btn.addEventListener('click', togglePasswordVisibility));

  // Xử lý lưu tên mới
  document.getElementById('save-name-button')?.addEventListener('click', async () => {
    const nameInput = document.getElementById('name-input');
    const newName = nameInput.value.trim();
    if (!newName) {
      showToast('Tên không được để trống.', 'error');
      return;
    }
    try {
      await updateProfile(user, { displayName: newName });
      document.getElementById('user-name').textContent = newName;
      profileModal.style.display = 'none';
      showToast('Cập nhật thông tin thành công!', 'success');
    } catch (error) {
      console.error("Lỗi cập nhật profile:", error);
      showToast('Có lỗi xảy ra khi cập nhật thông tin.', 'error');
    }
  });

  // Xử lý lưu mật khẩu mới
  document.getElementById('save-password-btn')?.addEventListener('click', async () => {
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmNewPassword = document.getElementById('confirm-new-password').value;

    if (!currentPassword || !newPassword || !confirmNewPassword) {
      showToast('Vui lòng nhập đầy đủ mật khẩu.', 'error');
      return;
    }
    if (newPassword.length < 6) {
      showToast('Mật khẩu mới phải có ít nhất 6 ký tự.', 'error');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      showToast('Mật khẩu xác nhận không khớp.', 'error');
      return;
    }

    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);
      passwordModal.style.display = 'none';
      showToast('Thay đổi mật khẩu thành công!', 'success');
    } catch (error) {
      console.error("Lỗi đổi mật khẩu:", error);
      if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        showToast('Mật khẩu hiện tại không chính xác.', 'error');
      } else {
        showToast('Có lỗi xảy ra, không thể đổi mật khẩu.', 'error');
      }
    }
  });
}

// 4. Xử lý nút "Quay lại đầu trang"
function setupScrollToTop() {
    const scrollToTopBtn = document.querySelector('.scroll-to-top-btn');
    if (!scrollToTopBtn) return;

    // Phần tử chính chứa thanh cuộn
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    // Lắng nghe sự kiện cuộn trên phần tử main-content
    mainContent.addEventListener('scroll', () => {
        if (mainContent.scrollTop > 200) {
            scrollToTopBtn.classList.add('show');
        } else {
            scrollToTopBtn.classList.remove('show');
        }
    });

    // Xử lý click để cuộn lên đầu
    scrollToTopBtn.addEventListener('click', (e) => {
        e.preventDefault();
        mainContent.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

// 4. Xử lý thu/mở menu
function setupMenuToggle() {
    const sidebar = document.querySelector('.sidebar');
    const topBar = document.querySelector('.top-bar');
    if (!sidebar || !topBar) return;    

    // Logic được chia làm 2 trường hợp: Mobile và Desktop
    if (window.innerWidth <= 768) {
        // --- TRƯỜNG HỢP 2: MOBILE ---
        // Cần tạo nút hamburger và overlay để người dùng có thể click mở/đóng menu.
        
        // Cải tiến: Chỉ tạo nút nếu nó chưa tồn tại để tránh trùng lặp
        let menuToggleBtn = topBar.querySelector('.menu-toggle-btn');
        if (!menuToggleBtn) {
            menuToggleBtn = document.createElement('button');
            menuToggleBtn.innerHTML = '<i class="fas fa-bars"></i>';
            menuToggleBtn.className = 'menu-toggle-btn icon-button';
            menuToggleBtn.title = 'Mở menu';
    
            // Chèn nút hamburger vào đầu top-bar
            topBar.prepend(menuToggleBtn);
        }

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
    else {
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
}