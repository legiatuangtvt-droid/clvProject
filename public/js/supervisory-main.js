import {
    collection,
    getDocs,
    query,
    orderBy,
    where,
    limit,
    getDoc
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
    let classTimings = null; // State để lưu thời gian tiết học

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

            await loadClassTimings(currentSchoolYear); // Tải thời gian tiết học
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

    const loadClassTimings = async (schoolYear) => {
        const q = query(collection(firestore, 'schoolYears'), where('schoolYear', '==', schoolYear), limit(1));
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            const schoolYearData = snapshot.docs[0].data();
            if (schoolYearData.classTimings) {
                classTimings = schoolYearData.classTimings;
            }
        }
    };

    // Hàm xác định tiết học hiện tại dựa trên thời gian thực
    const getCurrentTeachingPeriod = async () => {
        if (!classTimings) return null;

        const now = new Date();
        const currentTime = now.toTimeString().substring(0, 5); // "HH:MM"
        const isSummer = classTimings.activeSeason === 'summer';
        const schedule = isSummer ? classTimings.summer : classTimings.winter;

        if (!schedule) return null;

        const periods = schedule.filter(item => item.type === 'period');
        for (let i = 0; i < periods.length; i++) {
            const periodData = periods[i];
            if (currentTime >= periodData.startTime && currentTime < periodData.endTime) {
                return i + 1;
            }
        }
        return null; // Ngoài giờ dạy
    };

    // Hàm hiển thị danh sách đăng ký của ngày hôm nay
    const renderTodayRegistrations = async (regsSnapshot, teachersSnapshot) => {
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
                        <th>Phương pháp dạy học</th>
                        <th>Thiết bị</th>
                    </tr>
                </thead>
                <tbody>
        `;

        const currentPeriod = await getCurrentTeachingPeriod();

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
                    <td class="align-left">${reg.lessonName}</td>
                    <td>${reg.teachingMethod?.join(', ') || ''}</td>
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