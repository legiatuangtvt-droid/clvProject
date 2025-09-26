import {
    collection,
    getDocs,
    query,
    orderBy,
    where,
    limit,
    doc,
    getDoc
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
    const todayMethodFilter = document.getElementById('today-method-filter'); // Thêm bộ lọc PPDH

    // State
    let groupMap = new Map();
    let classTimings = null; // State để lưu thời gian tiết học
    let allMethods = new Set(); // State để lưu các PPDH

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
                loadClassTimings(latestSchoolYear), // Tải thời gian tiết học
                loadAllMethods(latestSchoolYear), // Tải các PPDH
                getTeacherCount(latestSchoolYear),
                loadTodayRegistrations() // Tải dữ liệu đăng ký hôm nay
            ]);

        } catch (error) {
            console.error("Lỗi khi tải dữ liệu tổng quan:", error);
            schoolYearEl.textContent = 'Lỗi tải dữ liệu';
            groupCountEl.textContent = 'N/A';
            teacherCountEl.textContent = 'N/A';
        }

        // Thêm event listener cho bộ lọc PPDH
        if (todayMethodFilter) {
            todayMethodFilter.addEventListener('change', loadTodayRegistrations);
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
                // i là index (0-9), period là số thứ tự (1-10)
                return i + 1;
            }
        }

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

            // Lấy giá trị bộ lọc PPDH
            const selectedMethod = todayMethodFilter ? todayMethodFilter.value : 'all';


            if (snapshot.empty) {
                todayRegsContainer.innerHTML = '<p>Không có lượt đăng ký nào cho hôm nay.</p>';
                return;
            }

            // Gom nhóm các đăng ký theo tiết
            const regsByPeriod = new Map();
            snapshot.forEach(doc => {
                const reg = doc.data();
                // Lọc theo PPDH đã chọn
                const methodMatch = selectedMethod === 'all' || (Array.isArray(reg.teachingMethod) && reg.teachingMethod.includes(selectedMethod));

                if (methodMatch) {
                    if (!regsByPeriod.has(reg.period)) regsByPeriod.set(reg.period, []);
                    regsByPeriod.get(reg.period).push(reg);
                }
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

            const currentPeriod = await getCurrentTeachingPeriod();
            const nextPeriod = currentPeriod ? currentPeriod + 1 : null;

            // Sắp xếp các tiết và render
            const sortedPeriods = [...regsByPeriod.keys()].sort((a, b) => a - b);

            if (sortedPeriods.length === 0 && selectedMethod !== 'all') {
                todayRegsContainer.innerHTML = `<p>Không có lượt đăng ký nào cho PPDH "${selectedMethod}" trong hôm nay.</p>`;
                return;
            }

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

    const loadAllMethods = async (schoolYear) => {
        const methodsQuery = query(collection(firestore, 'teachingMethods'), where('schoolYear', '==', schoolYear), orderBy('method'));
        const methodsSnapshot = await getDocs(methodsQuery);
        allMethods.clear();
        methodsSnapshot.forEach(doc => {
            allMethods.add(doc.data().method);
        });

        // Populate the filter dropdown
        if (todayMethodFilter) {
            todayMethodFilter.innerHTML = '<option value="all">Tất cả PPDH</option>';
            // Ưu tiên "Thực hành" lên đầu nếu có
            if (allMethods.has('Thực hành')) {
                todayMethodFilter.innerHTML += `<option value="Thực hành">Thực hành</option>`;
            }
            [...allMethods].sort().forEach(method => {
                if (method !== 'Thực hành') // Tránh lặp lại
                    todayMethodFilter.innerHTML += `<option value="${method}">${method}</option>`;
            });
        }
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