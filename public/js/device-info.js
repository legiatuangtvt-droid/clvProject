import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { firestore } from "./firebase-config.js";

document.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('device-info-container');

    const renderError = (message) => {
        container.innerHTML = `<div class="error-message"><i class="fas fa-exclamation-triangle"></i> ${message}</div>`;
    };

    const renderDeviceInfo = (data) => {
        const usageGV = data.usageObject?.includes('GV') ? 'Có' : 'Không';
        const usageHS = data.usageObject?.includes('HS') ? 'Có' : 'Không';

        // NEW: Tạo HTML cho liên kết tài liệu hướng dẫn
        let manualHtml = '';
        if (data.manualUrl) {
            manualHtml = `
                <div class="info-row">
                    <span class="info-label"><i class="fas fa-file-pdf fa-fw"></i> Tài liệu:</span>
                    <span class="info-value">
                        <a href="${data.manualUrl}" class="btn-link" target="_blank" rel="noopener noreferrer">${data.manualFileName || 'Xem/Tải về'}</a>
                    </span>
                </div>`;
        }

        container.innerHTML = `
            <div class="info-row">
                <span class="info-label"><i class="fas fa-desktop fa-fw"></i> Tên thiết bị:</span>
                <span class="info-value">${data.name || ''}</span>
            </div>
            <div class="info-row">
                <span class="info-label"><i class="fas fa-ruler-combined fa-fw"></i> Đơn vị tính:</span>
                <span class="info-value">${data.unit || ''}</span>
            </div>
             <div class="info-row">
                <span class="info-label"><i class="fas fa-boxes fa-fw"></i> Tổng số lượng:</span>
                <span class="info-value">${data.quantity || 0}</span>
            </div>
            <div class="info-row">
                <span class="info-label"><i class="fas fa-tag fa-fw"></i> Chủ đề:</span>
                <span class="info-value">${data.topic || ''}</span>
            </div>
            <div class="info-row">
                <span class="info-label"><i class="fas fa-bullseye fa-fw"></i> Mục đích:</span>
                <span class="info-value">${data.purpose || ''}</span>
            </div>
            <div class="info-row">
                <span class="info-label"><i class="fas fa-align-left fa-fw"></i> Mô tả:</span>
                <span class="info-value">${data.description || ''}</span>
            </div>
            <div class="info-row">
                <span class="info-label"><i class="fas fa-users fa-fw"></i> Đối tượng sử dụng:</span>
                <span class="info-value">Giáo viên: ${usageGV} | Học sinh: ${usageHS}</span>
            </div>
            ${manualHtml}
        `;
    };

    try {
        const urlParams = new URLSearchParams(window.location.search);
        const deviceId = urlParams.get('id');

        // --- XỬ LÝ URL "BẨN" TỪ ZALO HOẶC CÁC NGUỒN KHÁC ---
        // Giữ lại chỉ tham số 'id' và loại bỏ các tham số thừa (utm_*, zarsrc, ...)
        const cleanUrl = `${window.location.pathname}?id=${deviceId}`;
        // Cập nhật URL trên thanh địa chỉ mà không tải lại trang.
        // Điều này giúp URL trông gọn gàng và tránh lỗi khi người dùng sao chép/chia sẻ.
        if (window.location.href !== window.location.origin + cleanUrl) {
            window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
        }

        if (!deviceId) {
            renderError("Không tìm thấy ID thiết bị trong địa chỉ URL.");
            return;
        }

        const deviceRef = doc(firestore, 'devices', deviceId);
        const docSnap = await getDoc(deviceRef);

        if (docSnap.exists()) {
            renderDeviceInfo(docSnap.data());
        } else {
            renderError("Không tìm thấy thiết bị với ID được cung cấp.");
        }
    } catch (error) {
        console.error("Lỗi khi tải thông tin thiết bị:", error);
        renderError("Đã xảy ra lỗi khi tải dữ liệu. Vui lòng thử lại.");
    }
});