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

            const groupsQuery = query(collection(firestore, 'groups'), where('schoolYear', '==', currentSchoolYear));
            const teachersQuery = query(collection(firestore, 'teachers'));
            const todayRegsQuery = query(collection(firestore, 'registrations'), where('date', '==', todayString), orderBy('period'));

            const [groupsSnapshot, teachersSnapshot, todayRegsSnapshot] = await Promise.all([
                getDocs(groupsQuery),
                getDocs(teachersQuery),
                getDocs(todayRegsQuery)
            ]);

            // 3. Cập nhật các thẻ đếm
            groupCountEl.textContent = groupsSnapshot.size;
            teacherCountEl.textContent = teachersSnapshot.size;

            // 4. Hiển thị các lượt đăng ký hôm nay
            renderTodayRegistrations(todayRegsSnapshot, teachersSnapshot);

        } catch (error) {
            console.error("Lỗi khi tải dữ liệu tổng quan:", error);
            schoolYearEl.textContent = 'Lỗi tải dữ liệu';
            todayRegsContainer.innerHTML = '<p class="error-message">Không thể tải dữ liệu đăng ký hôm nay.</p>';
        }
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
            <table class="today-regs-table">
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

        regsSnapshot.forEach(doc => {
            const reg = doc.data();
            const teacherName = teacherMap.get(reg.teacherId) || 'Không xác định';
            const session = reg.period <= 5 ? 'Sáng' : 'Chiều';
            const displayPeriod = reg.period <= 5 ? reg.period : reg.period - 5;

            tableHTML += `
                <tr>
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

        tableHTML += `</tbody></table>`;
        todayRegsContainer.innerHTML = tableHTML;
    };

    // Chạy hàm chính
    loadDashboardData();
});