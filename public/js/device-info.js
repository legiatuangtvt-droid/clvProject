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

        container.innerHTML = `
            <div class="info-row">
                <span class="info-label"><i class="fas fa-desktop fa-fw"></i> Tên thiết bị:</span>
                <span class="info-value">${data.name || 'N/A'}</span>
            </div>
            <div class="info-row">
                <span class="info-label"><i class="fas fa-tag fa-fw"></i> Chủ đề:</span>
                <span class="info-value">${data.topic || 'N/A'}</span>
            </div>
            <div class="info-row">
                <span class="info-label"><i class="fas fa-bullseye fa-fw"></i> Mục đích:</span>
                <span class="info-value">${data.purpose || 'N/A'}</span>
            </div>
            <div class="info-row">
                <span class="info-label"><i class="fas fa-align-left fa-fw"></i> Mô tả:</span>
                <span class="info-value">${data.description || 'N/A'}</span>
            </div>
            <div class="info-row">
                <span class="info-label"><i class="fas fa-users fa-fw"></i> Đối tượng sử dụng:</span>
                <span class="info-value">Giáo viên: ${usageGV} | Học sinh: ${usageHS}</span>
            </div>
            <div class="info-row">
                <span class="info-label"><i class="fas fa-ruler-combined fa-fw"></i> Đơn vị tính:</span>
                <span class="info-value">${data.unit || 'N/A'}</span>
            </div>
             <div class="info-row">
                <span class="info-label"><i class="fas fa-boxes fa-fw"></i> Tổng số lượng:</span>
                <span class="info-value">${data.quantity || 0}</span>
            </div>
        `;
    };

    try {
        const urlParams = new URLSearchParams(window.location.search);
        const deviceId = urlParams.get('id');

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