import {
    collection,
    getDocs,
    query,
    orderBy,
    where,
    limit
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { firestore } from "./firebase-config.js";

document.addEventListener('DOMContentLoaded', () => {
    // Chỉ thực thi code nếu các element cần thiết tồn tại
    if (!document.getElementById('dashboard-container')) return;

    // Lấy các phần tử DOM
    const schoolYearEl = document.getElementById('dashboard-school-year');
    const groupCountEl = document.getElementById('group-count');
    const teacherCountEl = document.getElementById('teacher-count');
    const todayDateEl = document.getElementById('today-date');
    const todayRegsContainer = document.getElementById('today-registrations-container');

    // Hàm chính để tải và hiển thị dữ liệu
    const loadDashboardData = async () => {
        try {
            // 1. Lấy năm học mới nhất
            const yearsQuery = query(collection(firestore, 'schoolYears'), orderBy('schoolYear', 'desc'), limit(1));
            const yearsSnapshot = await getDocs(yearsQuery);

            if (yearsSnapshot.empty) {
                schoolYearEl.textContent = 'Chưa có năm học';
                groupCountEl.textContent = '0';
                teacherCountEl.textContent = '0';
                return;
            }

            const currentSchoolYear = yearsSnapshot.docs[0].data().schoolYear;
            schoolYearEl.textContent = `Năm học: ${currentSchoolYear}`;

            // 2. Tải song song số lượng tổ, giáo viên và đăng ký hôm nay
            const today = new Date();
            const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            todayDateEl.textContent = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

            // Tối ưu hóa: Tải các tổ trước, sau đó dùng group_id để tải giáo viên liên quan.
            const groupsQuery = query(collection(firestore, 'groups'), where('schoolYear', '==', currentSchoolYear));
            const todayRegsQuery = query(collection(firestore, 'registrations'), where('date', '==', todayString), orderBy('period'));

            // Tải tổ và đăng ký hôm nay song song
            const [groupsSnapshot, todayRegsSnapshot] = await Promise.all([
                getDocs(groupsQuery),
                getDocs(todayRegsQuery)
            ]);

            // Cập nhật số lượng tổ
            groupCountEl.textContent = groupsSnapshot.size;

            // Lấy danh sách group_id để truy vấn giáo viên
            const groupIds = groupsSnapshot.docs.map(doc => doc.data().group_id).filter(Boolean);
            let teachersSnapshot;
            if (groupIds.length > 0) {
                const teachersQuery = query(collection(firestore, 'teachers'), where('group_id', 'in', groupIds));
                teachersSnapshot = await getDocs(teachersQuery);
            } else {
                teachersSnapshot = { size: 0, docs: [] }; // Trả về snapshot rỗng nếu không có tổ nào
            }

            // 3. Cập nhật các thẻ đếm và hiển thị dữ liệu
            teacherCountEl.textContent = teachersSnapshot.size;
            renderTodayRegistrations(todayRegsSnapshot, teachersSnapshot);

        } catch (error) {
            console.error("Lỗi khi tải dữ liệu tổng quan:", error);
            schoolYearEl.textContent = 'Lỗi tải dữ liệu';
            todayRegsContainer.innerHTML = '<p class="error-message">Không thể tải dữ liệu đăng ký hôm nay.</p>';
        }
    };

    // Hàm xác định tiết học hiện tại dựa trên thời gian thực
    const getCurrentTeachingPeriod = () => {
        const now = new Date();
        const hour = now.getHours();
        const minute = now.getMinutes();
        const currentTime = hour + minute / 60;

        // Giả định thời gian các tiết học
        if (currentTime >= 7.0 && currentTime < 7.75) return 1;   // 7:00 - 7:45
        if (currentTime >= 7.83 && currentTime < 8.58) return 2;   // 7:50 - 8:35
        if (currentTime >= 8.67 && currentTime < 9.42) return 3;   // 8:40 - 9:25
        if (currentTime >= 9.67 && currentTime < 10.42) return 4;  // 9:40 - 10:25
        if (currentTime >= 10.5 && currentTime < 11.25) return 5;  // 10:30 - 11:15
        if (currentTime >= 13.5 && currentTime < 14.25) return 6;  // 13:30 - 14:15
        if (currentTime >= 14.33 && currentTime < 15.08) return 7; // 14:20 - 15:05
        if (currentTime >= 15.17 && currentTime < 15.92) return 8; // 15:10 - 15:55
        if (currentTime >= 16.0 && currentTime < 16.75) return 9;  // 16:00 - 16:45
        if (currentTime >= 16.83 && currentTime < 17.58) return 10; // 16:50 - 17:35
        return null; // Ngoài giờ dạy
    };

    // Hàm hiển thị danh sách đăng ký của ngày hôm nay
    const renderTodayRegistrations = (regsSnapshot, teachersSnapshot) => {
        if (regsSnapshot.empty) {
            todayRegsContainer.innerHTML = '<p>Hôm nay không có lượt đăng ký nào.</p>';
            return;
        }

        // Tạo một Map để tra cứu tên giáo viên từ UID một cách hiệu quả
        const teacherMap = new Map();
        teachersSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.uid) {
                teacherMap.set(data.uid, data.teacher_name);
            }
        });

        let tableHTML = `
            <div class="table-responsive"><table class="today-reg-table">
                <thead>
                    <tr>
                        <th>Tiết</th>
                        <th>Giáo viên</th>
                        <th>Lớp</th>
                        <th>Môn</th>
                        <th>Bài dạy</th>
                        <th>Thiết bị</th>
                    </tr>
                </thead>
                <tbody>
        `;

        const currentPeriod = getCurrentTeachingPeriod();

        regsSnapshot.forEach(doc => {
            const reg = doc.data();
            const teacherName = teacherMap.get(reg.teacherId) || 'Không xác định';
            const session = reg.period <= 5 ? 'Sáng' : 'Chiều';
            const displayPeriod = reg.period <= 5 ? reg.period : reg.period - 5;

            // Thêm class 'current-period' nếu tiết học đang diễn ra
            const rowClass = reg.period === currentPeriod ? 'class="current-period"' : '';

            tableHTML += `
                <tr ${rowClass}>
                    <td class="period-cell">
                        <strong>${displayPeriod}</strong>
                        <small>(${session})</small>
                    </td>
                    <td>${teacherName}</td>
                    <td>${reg.className}</td>
                    <td>${reg.subject}</td>
                    <td>${reg.lessonName}</td>
                    <td>${Array.isArray(reg.equipment) ? reg.equipment.join(', ') : ''}</td>
                </tr>
            `;
        });

        tableHTML += `</tbody></table></div>`;
        todayRegsContainer.innerHTML = tableHTML;
    };

    // Chạy hàm chính
    loadDashboardData();
});