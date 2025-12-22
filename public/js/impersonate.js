import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-functions.js";
import { signInWithCustomToken } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { auth, functions } from './firebase-config.js';
import { showToast, showConfirm } from './toast.js';

const impersonationKey = 'impersonation_manager';

/**
 * Hàm gọi Cloud Function để lấy token và đăng nhập vào tài khoản mục tiêu.
 * @param {string} targetUid - UID của user muốn login vào
 */
export async function loginAsUser(targetUid) {
    const confirmed = await showConfirm({
        title: 'Xác nhận Giả danh',
        message: 'Bạn có chắc chắn muốn đăng nhập dưới quyền người dùng này? Hành động này sẽ được ghi lại và bạn có thể quay lại tài khoản của mình bất cứ lúc nào.',
        okText: 'Đăng nhập',
        cancelText: 'Hủy',
        okClass: 'btn-warning' // Sử dụng màu vàng để cảnh báo
    });

    if (!confirmed) return;

    try {
        // Hiển thị loading (tùy chọn)
        console.log("Đang yêu cầu quyền truy cập...");
        const manager = auth.currentUser;
        if (!manager) {
            throw new Error("Không thể xác định người dùng quản lý hiện tại.");
        }

        // 1. Lưu thông tin của Manager vào sessionStorage để hiển thị trên banner
        const managerInfo = {
            uid: manager.uid,
            displayName: manager.displayName || manager.email,
            returnUrl: window.location.href // Lưu URL hiện tại để quay lại sau khi thoát
        };
        sessionStorage.setItem(impersonationKey, JSON.stringify(managerInfo));

        // 2. Gọi Cloud Function để lấy token của người dùng mục tiêu
        const impersonateFunc = httpsCallable(functions, 'impersonateUser');
        const result = await impersonateFunc({ uid: targetUid });
        
        const { token } = result.data;

        if (token) {
            console.log("Đã nhận token, đang chuyển đổi tài khoản...");
            
            // 3. Đăng nhập bằng Custom Token. Việc này sẽ tự động sign-out tài khoản Manager hiện tại.
            await signInWithCustomToken(auth, token);
            
            showToast("Đăng nhập giả danh thành công! Trang sẽ tải lại.", 'success');
            // 4. Chuyển hướng về trang chủ hoặc dashboard tương ứng
            setTimeout(() => window.location.href = "/", 1500);
        }
    } catch (error) {
        // Nếu có lỗi, xóa thông tin giả danh đã lưu
        sessionStorage.removeItem(impersonationKey);
        console.error("Lỗi giả danh:", error);
        // Thay thế alert bằng popup tùy chỉnh
        await showConfirm({
            title: 'Giả danh thất bại',
            message: `Không thể giả danh người dùng. Lỗi: ${error.message}`,
            okText: 'Đã hiểu',
            cancelText: null // Ẩn nút Hủy để hoạt động như một alert
        });
    }
}

/**
 * Hàm để thoát khỏi chế độ giả danh và quay lại tài khoản Manager.
 */
export async function stopImpersonating() {
    const managerInfo = getManagerInfo();
    if (!managerInfo) return;

    try {
        console.log("Đang yêu cầu quay lại tài khoản Manager...");
        const revertFunc = httpsCallable(functions, 'revertImpersonation');
        const result = await revertFunc();

        const { token: managerToken } = result.data;

        if (managerToken) {
            await signInWithCustomToken(auth, managerToken);
            const returnUrl = managerInfo.returnUrl || '/'; // Lấy URL đã lưu hoặc mặc định về trang chủ
            sessionStorage.removeItem(impersonationKey);
            showToast("Đã quay lại tài khoản Manager thành công!", 'success');
            setTimeout(() => window.location.href = returnUrl, 1000);
        }
    } catch (error) {
        console.error("Lỗi khi thoát giả danh:", error);
        showToast(`Không thể thoát chế độ giả danh: ${error.message}`, 'error');
    }
}

/**
 * Kiểm tra xem có đang trong chế độ giả danh hay không và lấy thông tin Manager.
 * @returns {object|null} Trả về thông tin của manager nếu đang giả danh, ngược lại trả về null.
 */
export function getManagerInfo() {
    const managerInfoStr = sessionStorage.getItem(impersonationKey);
    return managerInfoStr ? JSON.parse(managerInfoStr) : null;
}