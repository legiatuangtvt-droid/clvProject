/**
 * Hiển thị một thông báo toast.
 * @param {string} message - Nội dung thông báo.
 * @param {string} type - Loại thông báo ('success', 'error', 'info'). Mặc định là 'info'.
 * @param {number} duration - Thời gian hiển thị (ms). Mặc định là 3000ms.
 */
export function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) {
        console.error('Toast container not found!');
        return;
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`; // Sửa lại cách gán class

    // Tạo icon dựa trên loại thông báo
    const icon = document.createElement('i');
    const iconClasses = {
        success: 'fas fa-check-circle',
        error: 'fas fa-times-circle',
        info: 'fas fa-info-circle',
        warning: 'fas fa-exclamation-triangle'
    };
    icon.className = `toast-icon ${iconClasses[type] || iconClasses['info']}`;

    // Tạo phần tử chứa nội dung thông báo
    const messageSpan = document.createElement('span');
    messageSpan.textContent = message;

    // Thêm icon và nội dung vào toast
    toast.appendChild(icon);
    toast.appendChild(messageSpan);

    // Thêm toast mới vào đầu container để nó xuất hiện ở trên cùng
    container.prepend(toast);

    // Thêm class để kích hoạt animation
    setTimeout(() => {
        toast.classList.add('show');
    }, 100);

    // Tự động xóa toast sau một khoảng thời gian
    setTimeout(() => {
        if (toast) {
            toast.classList.remove('show');
            // Đảm bảo toast được xóa khỏi DOM ngay cả khi transitionend không kích hoạt
            setTimeout(() => {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 500); // 500ms là thời gian của hiệu ứng transition trong CSS
        }
    }, duration);
}

/**
 * Thiết lập trạng thái tải cho một nút.
 * @param {HTMLElement} button - Phần tử nút cần thay đổi.
 * @param {boolean} isLoading - True để hiển thị trạng thái tải, false để trở lại bình thường.
 * @param {string} [loadingText=''] - Văn bản tùy chọn hiển thị khi đang tải.
 */
export function setButtonLoading(button, isLoading, loadingText = '') {
    if (!button) return;
    const textSpan = button.querySelector('.btn-text');

    if (isLoading) {
        button.disabled = true;
        button.classList.add('loading');
        if (textSpan && loadingText) textSpan.textContent = loadingText;
    } else {
        button.disabled = false;
        button.classList.remove('loading');
    }
}

/**
 * Hiển thị một hộp thoại xác nhận (confirm) hoặc thông báo (alert) tùy chỉnh.
 * @param {object} options - Các tùy chọn cho hộp thoại.
 * @param {string} options.title - Tiêu đề của hộp thoại.
 * @param {string} options.message - Nội dung thông báo.
 * @param {string} [options.okText='Xác nhận'] - Chữ trên nút OK.
 * @param {string|null} [options.cancelText='Hủy'] - Chữ trên nút Hủy. Nếu là null, nút Hủy sẽ bị ẩn.
 * @param {string} [options.okClass='btn-save'] - Class CSS cho nút OK.
 * @param {string} [options.cancelClass='btn-cancel'] - Class CSS cho nút Hủy.
 * @returns {Promise<boolean>} - Promise sẽ resolve thành true nếu nhấn OK, false nếu nhấn Hủy hoặc đóng hộp thoại.
 */
export function showConfirm({
    title = 'Xác nhận',
    message = 'Bạn có chắc chắn?',
    okText = 'Xác nhận',
    cancelText = 'Hủy',
    okClass = 'btn-save',
    cancelClass = 'btn-cancel'
}) {
    return new Promise((resolve) => {
        const existingModal = document.getElementById('clv-generic-confirm-modal');
        if (existingModal) existingModal.remove();

        const modal = document.createElement('div');
        modal.id = 'clv-generic-confirm-modal';
        modal.className = 'modal-overlay';
        modal.style.display = 'flex';

        modal.innerHTML = `
            <div class="modal-content" style="max-width: 450px;">
                <h2>${title}</h2>
                <p>${message}</p>
                <div class="modal-actions">
                    ${cancelText ? `<button id="clv-confirm-cancel" class="${cancelClass}">${cancelText}</button>` : ''}
                    <button id="clv-confirm-ok" class="${okClass}">${okText}</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const close = (result) => {
            modal.remove();
            resolve(result);
        };

        document.getElementById('clv-confirm-ok').addEventListener('click', () => close(true));
        if (cancelText) {
            document.getElementById('clv-confirm-cancel').addEventListener('click', () => close(false));
        }
        modal.addEventListener('click', (e) => {
            if (e.target === modal && cancelText) close(false);
        });
    });
}