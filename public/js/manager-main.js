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
import { showToast } from "./toast.js";

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
    let notificationInterval = null; // Để lưu trữ interval kiểm tra thông báo
    let notifiedPeriods = new Set(); // Để tránh thông báo lặp lại cho cùng một tiết
    const NOTIFICATION_LEAD_TIME = 15; // Thông báo trước 15 phút
    // Chuẩn bị các file âm thanh cho từng mức độ ưu tiên
    const practiceNotificationAudio = new Audio('sounds/mixkit-happy-bells-notification-937.wav'); // Ưu tiên 1 (Thực hành)
    const equipmentNotificationAudio = new Audio('sounds/mixkit-bell-notification-933.wav'); // Ưu tiên 2 (TBDH)

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

            // Bắt đầu kiểm tra thông báo sau khi đã tải xong dữ liệu
            startNotificationChecker();
            requestNotificationPermission();

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

        // Dừng kiểm tra thông báo khi người dùng rời khỏi trang
        window.addEventListener('beforeunload', () => {
            if (notificationInterval) clearInterval(notificationInterval);
        });
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

        // --- FIX: Xử lý lỗi 400 Bad Request khi groupIds rỗng hoặc quá 30 ---
        if (groupIds.length === 0) {
            teacherCountEl.textContent = '0';
            return;
        }

        // Chia mảng groupIds thành các chunk nhỏ hơn (tối đa 30 phần tử mỗi chunk)
        const CHUNK_SIZE = 30;
        const chunks = [];
        for (let i = 0; i < groupIds.length; i += CHUNK_SIZE) {
            chunks.push(groupIds.slice(i, i + CHUNK_SIZE));
        }

        // Thực hiện các truy vấn song song cho từng chunk
        const queryPromises = chunks.map(chunk => {
            const teachersQuery = query(collection(firestore, 'teachers'), where('group_id', 'in', chunk));
            return getDocs(teachersQuery);
        });

        const snapshots = await Promise.all(queryPromises);

        // Cộng dồn kết quả từ tất cả các snapshot
        const totalTeachers = snapshots.reduce((acc, snapshot) => acc + snapshot.size, 0);
        teacherCountEl.textContent = totalTeachers;
    };

    loadDashboardData();

    // --- NOTIFICATION LOGIC ---

    function requestNotificationPermission() {
        if (!('Notification' in window)) {
            console.warn('Trình duyệt này không hỗ trợ Thông báo Desktop.');
            return;
        }

        switch (Notification.permission) {
            case 'granted':
                // Quyền đã được cấp, không cần làm gì thêm.
                break;
            case 'denied':
                // Quyền đã bị từ chối. Hướng dẫn người dùng bật lại.
                showToast(
                    'Thông báo đã bị chặn. Vui lòng nhấn vào biểu tượng 🔒 hoặc 🎶 trên thanh địa chỉ để bật lại.',
                    'warning',
                    10000 // Hiển thị trong 10 giây
                );
                break;
            case 'default':
                // Yêu cầu quyền từ người dùng.
                Notification.requestPermission().then(permission => {
                    if (permission === 'granted') {
                        new Notification('CLV-TBDH', { body: 'Đã bật thông báo cho các tiết học sắp tới.', icon: 'images/lab-natural.png' });
                    }
                });
                break;
        }
    }

    function startNotificationChecker() {
        if (notificationInterval) clearInterval(notificationInterval);

        // Reset lại danh sách đã thông báo mỗi khi bắt đầu kiểm tra (ví dụ khi tải lại trang)
        notifiedPeriods.clear();

        notificationInterval = setInterval(async () => {
            if (!classTimings || !classTimings.activeSeason) return;

            const now = new Date();
            const schedule = classTimings.activeSeason === 'summer' ? classTimings.summer : classTimings.winter;
            if (!schedule) return;

            const periods = schedule.filter(item => item.type === 'period');

            for (let i = 0; i < periods.length; i++) {
                const periodNumber = i + 1;
                const periodStartTimeStr = periods[i].startTime; // "HH:MM"
                const [hours, minutes] = periodStartTimeStr.split(':');

                const periodStartDate = new Date(now);
                periodStartDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);

                const timeDiffMinutes = (periodStartDate.getTime() - now.getTime()) / 1000 / 60;

                // Kiểm tra nếu tiết học sắp diễn ra trong khoảng thời gian định trước VÀ chưa được thông báo
                if (timeDiffMinutes > 0 && timeDiffMinutes <= NOTIFICATION_LEAD_TIME) {
                    if (!notifiedPeriods.has(periodNumber)) {
                        notifiedPeriods.add(periodNumber); // Đánh dấu đã thông báo
                        await triggerNotificationForPeriod(periodNumber);
                    }
                }
            }
        }, 60000); // Kiểm tra mỗi phút
    }

    async function triggerNotificationForPeriod(periodNumber) {
        const todayString = new Date().toISOString().split('T')[0];
        const regsQuery = query(
            collection(firestore, 'registrations'),
            where('date', '==', todayString),
            where('period', '==', periodNumber)
        );
        const snapshot = await getDocs(regsQuery);
        if (snapshot.empty) return; // Không có đăng ký cho tiết này

        let highestPriority = 0; // 2: Thực hành, 1: TBDH, 0: Khác
        let notificationBody = '';
        const regsToNotify = [];

        snapshot.forEach(doc => {
            const reg = doc.data();
            regsToNotify.push(`- ${reg.teacherName} (Lớp ${reg.className}, Môn ${reg.subject})`);

            if (reg.teachingMethod?.includes('Thực hành')) {
                highestPriority = Math.max(highestPriority, 2);
            } else if (reg.teachingMethod?.includes('Thiết bị dạy học')) {
                highestPriority = Math.max(highestPriority, 1);
            }
        });

        if (highestPriority === 0) return; // Chỉ thông báo cho "Thực hành" và "TBDH"

        let title = '';
        let iconPath = '';
        let audioToPlay = null;

        if (highestPriority === 2) {
            title = '⚠️ CHUẨN BỊ PHÒNG THỰC HÀNH!';
            iconPath = 'images/flask.png'; // Icon ưu tiên 1
            audioToPlay = practiceNotificationAudio; // Âm thanh ưu tiên 1
        } else {
            title = '🔔 Chuẩn bị thiết bị dạy học!';
            iconPath = 'images/learning.png'; // Icon ưu tiên 2
            audioToPlay = equipmentNotificationAudio; // Âm thanh ưu tiên 2
        }

        notificationBody = `Tiết ${periodNumber > 5 ? periodNumber - 5 : periodNumber} sắp bắt đầu sau ${NOTIFICATION_LEAD_TIME} phút:\n` + regsToNotify.join('\n');

        // 1. Gửi thông báo Desktop
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, {
                body: notificationBody,
                icon: iconPath,
                tag: `period-${periodNumber}` // Để gom nhóm thông báo nếu cần
            });
        }

        // 2. Phát âm thanh
        if (audioToPlay) {
            audioToPlay.loop = true; // Lặp lại âm thanh
            audioToPlay.play().catch(e => console.warn("Không thể tự động phát âm thanh:", e));
        }

        // 3. Thay đổi tiêu đề trang
        blinkPageTitle(title, 10); // Nhấp nháy 10 lần

        // Dừng âm thanh và title sau 10 giây hoặc khi người dùng tương tác
        const stopAlerts = () => {
            notificationAudio.pause();
            if (audioToPlay) {
                audioToPlay.pause();
                audioToPlay.currentTime = 0;
            }
            window.removeEventListener('click', stopAlerts);
            window.removeEventListener('keydown', stopAlerts);
        };
        setTimeout(stopAlerts, 10000); // Tự động dừng sau 10 giây
        window.addEventListener('click', stopAlerts, { once: true });
        window.addEventListener('keydown', stopAlerts, { once: true });
    }

    function blinkPageTitle(newTitle, count) {
        if (count <= 0) {
            document.title = "Bảng điều khiển - Quản lý"; // Khôi phục tiêu đề gốc
            return;
        }
        const originalTitle = "Bảng điều khiển - Quản lý";
        document.title = (document.title === originalTitle) ? newTitle : originalTitle;

        setTimeout(() => blinkPageTitle(newTitle, count - 1), 1000); // Chuyển đổi mỗi giây
    }
});