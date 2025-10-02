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