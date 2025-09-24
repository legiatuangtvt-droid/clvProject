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
    // Chỉ thực thi code nếu element chính tồn tại
    if (!document.getElementById('dashboard-container')) return;

    const schoolYearEl = document.getElementById('dashboard-school-year');
    const groupCountEl = document.getElementById('group-count');
    const teacherCountEl = document.getElementById('teacher-count');
    const todayDateEl = document.getElementById('today-date');
    const todayRegsContainer = document.getElementById('today-registrations-container');

    // State
    let groupMap = new Map();

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

            const latestSchoolYear = yearsSnapshot.docs[0].data().schoolYear;
            schoolYearEl.textContent = `Năm học: ${latestSchoolYear}`;

            // 2. Lấy số lượng tổ và giáo viên cho năm học đó
            await Promise.all([
                getGroupCount(latestSchoolYear),
                loadAllGroups(latestSchoolYear), // Tải thông tin các tổ
                getTeacherCount(latestSchoolYear),
                loadTodayRegistrations() // Tải dữ liệu đăng ký hôm nay
            ]);

        } catch (error) {
            console.error("Lỗi khi tải dữ liệu tổng quan:", error);
            schoolYearEl.textContent = 'Lỗi tải dữ liệu';
            groupCountEl.textContent = 'N/A';
            teacherCountEl.textContent = 'N/A';
        }
    };

    const getCurrentTeachingPeriod = () => {
        const now = new Date();
        const hour = now.getHours();
        const minute = now.getMinutes();
        const currentTime = hour + minute / 60;

        // Giả định thời gian các tiết học
        if (currentTime >= 7.0 && currentTime < 7.75) return 1; // 7:00 - 7:45
        if (currentTime >= 7.83 && currentTime < 8.58) return 2; // 7:50 - 8:35
        if (currentTime >= 8.67 && currentTime < 9.42) return 3; // 8:40 - 9:25
        if (currentTime >= 9.67 && currentTime < 10.42) return 4; // 9:40 - 10:25
        if (currentTime >= 10.5 && currentTime < 11.25) return 5; // 10:30 - 11:15
        if (currentTime >= 13.5 && currentTime < 14.25) return 6; // 13:30 - 14:15
        if (currentTime >= 14.33 && currentTime < 15.08) return 7; // 14:20 - 15:05
        if (currentTime >= 15.17 && currentTime < 15.92) return 8; // 15:10 - 15:55
        if (currentTime >= 16.0 && currentTime < 16.75) return 9; // 16:00 - 16:45
        if (currentTime >= 16.83 && currentTime < 17.58) return 10; // 16:50 - 17:35

        return null; // Ngoài giờ dạy
    };

    const loadTodayRegistrations = async () => {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const todayString = `${yyyy}-${mm}-${dd}`;
        const displayDate = `${dd}/${mm}/${yyyy}`;

        if (todayDateEl) {
            todayDateEl.textContent = displayDate;
        }

        try {
            const regsQuery = query(
                collection(firestore, 'registrations'),
                where('date', '==', todayString),
                orderBy('period')
            );
            const snapshot = await getDocs(regsQuery);

            if (snapshot.empty) {
                todayRegsContainer.innerHTML = '<p>Không có lượt đăng ký nào cho hôm nay.</p>';
                return;
            }

            // Gom nhóm các đăng ký theo tiết
            const regsByPeriod = new Map();
            snapshot.forEach(doc => {
                const reg = doc.data();
                if (!regsByPeriod.has(reg.period)) regsByPeriod.set(reg.period, []);
                regsByPeriod.get(reg.period).push(reg);
            });

            let tableHTML = `<div class="table-responsive"><table class="today-reg-table">
                <thead>
                    <tr>
                        <th>Buổi</th>
                        <th>Tiết</th>
                        <th>Tổ chuyên môn</th>
                        <th>Môn học</th>
                        <th>Giáo viên</th>
                        <th>Lớp</th>
                        <th>Tên bài học</th>
                        <th>PPDH</th>
                        <th>Thiết bị</th>
                    </tr>
                </thead>
                <tbody>`;

            const currentPeriod = getCurrentTeachingPeriod();
            const nextPeriod = currentPeriod ? currentPeriod + 1 : null;

            // Sắp xếp các tiết và render
            const sortedPeriods = [...regsByPeriod.keys()].sort((a, b) => a - b);

            sortedPeriods.forEach(period => {
                const regsInPeriod = regsByPeriod.get(period);
                const rowspan = regsInPeriod.length;

                regsInPeriod.forEach((reg, index) => {
                    let rowClass = '';
                    if (period === currentPeriod) rowClass = 'current-period';
                    if (period === nextPeriod) rowClass = 'next-period';

                    tableHTML += `<tr class="${rowClass}">`;
                    if (index === 0) { // Chỉ render cột Buổi và Tiết cho dòng đầu tiên của nhóm
                        tableHTML += `<td class="col-session" rowspan="${rowspan}">${reg.period <= 5 ? 'Sáng' : 'Chiều'}</td>`;
                        tableHTML += `<td class="col-period" rowspan="${rowspan}">${reg.period > 5 ? reg.period - 5 : reg.period}</td>`;
                    }
                    const groupName = groupMap.get(reg.groupId)?.group_name || 'N/A';
                    tableHTML += `
                        <td class="col-group">${groupName}</td>
                        <td class="col-subject">${reg.subject || ''}</td>
                        <td class="col-teacher">${reg.teacherName || ''}</td>
                        <td class="col-class">${reg.className || ''}</td>
                        <td class="col-lesson">${reg.lessonName || ''}</td>
                        <td class="col-ppdh">${reg.teachingMethod?.join(', ') || ''}</td>
                        <td class="col-equipment">${reg.equipment?.join(', ') || ''}</td>
                    </tr>`;
                });
            });

            tableHTML += '</tbody></table></div>';
            todayRegsContainer.innerHTML = tableHTML;
        } catch (error) {
            console.error("Lỗi khi tải đăng ký hôm nay:", error);
            todayRegsContainer.innerHTML = '<p class="error-message">Không thể tải dữ liệu đăng ký hôm nay.</p>';
        }
    };

    const getGroupCount = async (schoolYear) => {
        const groupsQuery = query(collection(firestore, 'groups'), where("schoolYear", "==", schoolYear));
        const groupsSnapshot = await getDocs(groupsQuery);
        groupCountEl.textContent = groupsSnapshot.size;
        return groupsSnapshot.docs.map(doc => doc.data().group_id); // Trả về mảng group_id để dùng cho việc đếm giáo viên
    };

    const loadAllGroups = async (schoolYear) => {
        const groupsQuery = query(collection(firestore, 'groups'), where('schoolYear', '==', schoolYear));
        const groupsSnapshot = await getDocs(groupsQuery);
        groupMap.clear();
        groupsSnapshot.forEach(doc => {
            const group = doc.data();
            groupMap.set(group.group_id, group);
        });
    };

    const getTeacherCount = async (schoolYear) => {
        // Vì giáo viên không có trường schoolYear, ta phải đếm qua các tổ
        const groupsQuery = query(collection(firestore, 'groups'), where("schoolYear", "==", schoolYear));
        const groupsSnapshot = await getDocs(groupsQuery);

        if (groupsSnapshot.empty) {
            teacherCountEl.textContent = '0';
            return;
        }

        const groupIds = groupsSnapshot.docs.map(doc => doc.data().group_id);

        // Firestore `in` query chỉ hỗ trợ tối đa 30 phần tử trong mảng
        // Nếu có nhiều hơn 30 tổ, cần chia nhỏ query. Tuy nhiên, với quy mô trường học, 30 là đủ.
        const teachersQuery = query(collection(firestore, 'teachers'), where('group_id', 'in', groupIds));
        const teachersSnapshot = await getDocs(teachersQuery);
        teacherCountEl.textContent = teachersSnapshot.size;
    };

    loadDashboardData();
});