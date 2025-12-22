import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-functions.js";
import { signInWithCustomToken } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { auth, functions } from './firebase-config.js';

const impersonationKey = 'impersonation_manager';

/**
 * Hàm gọi Cloud Function để lấy token và đăng nhập vào tài khoản mục tiêu.
 * @param {string} targetUid - UID của user muốn login vào
 */
export async function loginAsUser(targetUid) {
    if (!confirm("Bạn có chắc chắn muốn đăng nhập dưới quyền người dùng này? Hành động này sẽ được ghi lại và bạn có thể quay lại tài khoản của mình bất cứ lúc nào.")) {
        return;
    }

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
            
            alert("Đăng nhập giả danh thành công! Trang sẽ tải lại.");
            // 4. Chuyển hướng về trang chủ hoặc dashboard tương ứng
            window.location.href = "/"; 
        }
    } catch (error) {
        // Nếu có lỗi, xóa thông tin giả danh đã lưu
        sessionStorage.removeItem(impersonationKey);
        console.error("Lỗi giả danh:", error);
        alert("Không thể giả danh: " + error.message);
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
            sessionStorage.removeItem(impersonationKey);
            alert("Đã quay lại tài khoản Manager thành công!");
            window.location.reload();
        }
    } catch (error) {
        console.error("Lỗi khi thoát giả danh:", error);
        alert("Không thể thoát chế độ giả danh: " + error.message);
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