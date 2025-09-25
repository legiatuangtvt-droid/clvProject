import {
    collection,
    getDocs,
    getDoc,
    query,
    orderBy,
    where,
    limit,
    doc
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { auth, firestore } from "./firebase-config.js";

document.addEventListener('DOMContentLoaded', () => {
    // Thay đổi điều kiện kiểm tra sang một element cốt lõi của trang
    if (!document.getElementById('weekly-schedule-container')) return;

    // DOM Elements
    const schoolYearEl = document.getElementById('dashboard-school-year');
    const weeklyScheduleContainer = document.getElementById('weekly-schedule-container');
    const weekSelectorWrapper = document.getElementById('week-selector-wrapper');
    const weekDisplayText = document.getElementById('week-display-text');
    const weekDateRange = document.getElementById('week-date-range');
    const weekDropdown = document.getElementById('week-dropdown');
    const legendContainer = document.getElementById('color-legend-container');
    const filterTeacherSelect = document.getElementById('filter-teacher-select');
    const filterSubjectSelect = document.getElementById('filter-subject-select');
    const filterMethodSelect = document.getElementById('filter-method-select');

    // State variables
    let timePlan = [];
    let selectedWeekNumber = null;
    let teachersInGroup = [];
    let allMethods = new Set();
    let currentRegistrations = []; // Lưu các đăng ký của tuần hiện tại

    const getSubjectsFromGroupName = (groupName) => {
        const cleanedName = groupName.replace(/^Tổ\s*/, '').trim();
        // Tạm thời thay thế "Thể dục - QP" để không bị split sai
        const placeholder = 'TDQP_PLACEHOLDER';
        return cleanedName.replace('Thể dục - QP', placeholder)
                          .split(/\s*-\s*/)
                          .map(s => s.trim().replace(placeholder, 'Thể dục - QP'));
    };

    const loadDashboardData = async () => {
        try {
            // 1. Lấy năm học mới nhất
            const yearsQuery = query(collection(firestore, 'schoolYears'), orderBy('schoolYear', 'desc'), limit(1));
            const yearsSnapshot = await getDocs(yearsQuery);

            if (yearsSnapshot.empty) {
                schoolYearEl.textContent = 'Chưa có năm học';
                return;
            }

            const latestSchoolYear = yearsSnapshot.docs[0].data().schoolYear;
            schoolYearEl.textContent = `Năm học: ${latestSchoolYear}`;

            // Tải thông tin tổ và các giáo viên trong tổ
            await loadGroupInfo();
            await loadAllMethods(latestSchoolYear);

            // 2. Tải kế hoạch thời gian và thiết lập tuần ban đầu
            await loadTimePlan(latestSchoolYear);

            setupEventListeners();
            setupLegendHighlighting();
        } catch (error) {
            console.error("Lỗi khi tải dữ liệu tổng quan:", error);
            schoolYearEl.textContent = 'Lỗi tải dữ liệu';
        }
    };

    const loadGroupInfo = async () => {
        const user = auth.currentUser;
        if (!user) return;

        const teacherQuery = query(collection(firestore, 'teachers'), where('uid', '==', user.uid), limit(1));
        const teacherSnapshot = await getDocs(teacherQuery);

        if (teacherSnapshot.empty) return;

        const teacherData = teacherSnapshot.docs[0].data();
        if (!teacherData.group_id) return;

        // Lấy năm học hiện tại từ element đã được load trước đó
        const schoolYearText = schoolYearEl.textContent;
        const currentSchoolYear = schoolYearText.replace('Năm học: ', '');
        if (!currentSchoolYear || currentSchoolYear === 'Chưa có năm học') return;

        // Lấy tên tổ và cập nhật tiêu đề
        const groupQuery = query(collection(firestore, 'groups'), where('group_id', '==', teacherData.group_id), where('schoolYear', '==', currentSchoolYear), limit(1));
        const groupSnapshot = await getDocs(groupQuery);
        if (!groupSnapshot.empty) {
            const groupName = groupSnapshot.docs[0].data().group_name;
            document.getElementById('sidebar-group-name').textContent = `Tổ ${groupName}`;
        }

        // Lấy danh sách giáo viên trong tổ, cũng cần lọc theo năm học để đảm bảo tính nhất quán
        const teachersQuery = query(collection(firestore, 'teachers'), where('group_id', '==', teacherData.group_id)); // Giữ nguyên vì teacher không có schoolYear
        const teachersSnapshot = await getDocs(teachersQuery);
        teachersInGroup = teachersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Populate subject filter
        const subjects = new Set();
        const groupName = document.getElementById('sidebar-group-name').textContent.replace('Tổ ', '');
        getSubjectsFromGroupName(groupName).forEach(sub => subjects.add(sub.trim()));

        filterSubjectSelect.innerHTML = '<option value="all">Tất cả môn</option>';
        [...subjects].sort().forEach(subject => {
            const option = document.createElement('option');
            option.value = subject;
            option.textContent = subject;
            filterSubjectSelect.appendChild(option);
        });

        // Populate teacher filter
        filterTeacherSelect.innerHTML = '<option value="all">Tất cả GV</option>';
        teachersInGroup.sort((a, b) => a.teacher_name.localeCompare(b.teacher_name)).forEach(teacher => {
            if (teacher.uid) { // Only add teachers with an account
                const option = document.createElement('option');
                option.value = teacher.uid;
                option.textContent = teacher.teacher_name;
                filterTeacherSelect.appendChild(option);
            }
        });

        // Populate method filter
        filterMethodSelect.innerHTML = '<option value="all">Tất cả PPDH</option>';
        [...allMethods].sort().forEach(method => {
            const option = document.createElement('option');
            option.value = method;
            option.textContent = method;
            filterMethodSelect.appendChild(option);
        });
    };

    const updateTeacherFilter = () => {
        const selectedSubject = filterSubjectSelect.value;
        const currentTeacher = filterTeacherSelect.value;
    
        let teachersToShow = teachersInGroup;
    
        // Lọc giáo viên dựa trên môn học đã chọn
        if (selectedSubject !== 'all') {
            teachersToShow = teachersInGroup.filter(teacher => teacher.subject === selectedSubject);
        }
    
        filterTeacherSelect.innerHTML = '<option value="all">Tất cả GV</option>';
        teachersToShow.forEach(teacher => {
            filterTeacherSelect.innerHTML += `<option value="${teacher.uid}">${teacher.teacher_name}</option>`;
        });
    
        // Giữ lại lựa chọn giáo viên nếu vẫn tồn tại trong danh sách mới
        if (teachersToShow.some(t => t.uid === currentTeacher)) {
            filterTeacherSelect.value = currentTeacher;
        }
    };

    const loadAllMethods = async (schoolYear) => {
        const methodsQuery = query(collection(firestore, 'teachingMethods'), where('schoolYear', '==', schoolYear), orderBy('method'));
        const methodsSnapshot = await getDocs(methodsQuery);
        allMethods.clear();
        methodsSnapshot.forEach(doc => {
            allMethods.add(doc.data().method);
        });
    };


    const loadTimePlan = async (schoolYear) => {
        const planQuery = query(collection(firestore, 'timePlans'), where("schoolYear", "==", schoolYear), limit(1));
        const planSnapshot = await getDocs(planQuery);
        weekDropdown.innerHTML = '';

        if (planSnapshot.empty) {
            weekDisplayText.textContent = 'Chưa có kế hoạch';
            return;
        }

        const planDocId = planSnapshot.docs[0].id;
        const weeksQuery = query(collection(firestore, 'timePlans', planDocId, 'weeks'), orderBy("weekNumber"));
        const weeksSnapshot = await getDocs(weeksQuery);

        timePlan = weeksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Tìm tuần hiện tại
        const today = new Date().toISOString().split('T')[0];
        const currentWeek = timePlan.slice().reverse().find(w => w.startDate <= today);
        const initialWeekNumber = currentWeek ? currentWeek.weekNumber : (timePlan.length > 0 ? timePlan[0].weekNumber : null);

        // Populate dropdown
        timePlan.forEach(week => {
            const option = document.createElement('div');
            option.className = 'week-option';
            option.dataset.week = week.weekNumber;
            option.textContent = `Tuần ${week.weekNumber} (${formatDate(week.startDate)} - ${formatDate(week.endDate)})`;
            weekDropdown.appendChild(option);
        });

        // Đặt tuần được chọn ban đầu
        updateSelectedWeek(initialWeekNumber);
    };

    const loadAndRenderSchedule = async () => {
        const week = timePlan.find(w => w.weekNumber === selectedWeekNumber);
        if (!week) {
            weeklyScheduleContainer.innerHTML = '<p>Không có dữ liệu tuần để hiển thị.</p>';
            return;
        }

        const currentUser = auth.currentUser;
        if (!currentUser || teachersInGroup.length === 0) {
            weeklyScheduleContainer.innerHTML = '<p>Không có thông tin tổ để hiển thị lịch.</p>';
            return;
        }

        weeklyScheduleContainer.innerHTML = '<p>Đang tải lịch...</p>';
        try {
            const teacherUids = teachersInGroup.map(t => t.uid).filter(uid => uid);
            if (teacherUids.length === 0) {
                weeklyScheduleContainer.innerHTML = '<p>Tổ của bạn chưa có giáo viên nào được gán tài khoản.</p>';
                return;
            }

            const scheduleQuery = query(
                collection(firestore, 'registrations'),
                where('teacherId', 'in', teacherUids),
                where('date', '>=', week.startDate),
                where('date', '<=', week.endDate)
            );
            const snapshot = await getDocs(scheduleQuery);

            if (snapshot.empty) {
                weeklyScheduleContainer.innerHTML = '<p>Tổ của bạn chưa có tiết dạy nào được đăng ký trong tuần này.</p>';
                return;
            }

            currentRegistrations = [];
            snapshot.forEach(doc => {
                currentRegistrations.push({ id: doc.id, ...doc.data() });
            });

            // Cập nhật bộ lọc giáo viên sau khi có dữ liệu đăng ký
            updateTeacherFilter();

            renderWeeklySchedule(week, currentRegistrations);

        } catch (error) {
            console.error("Lỗi khi tải lịch dạy:", error);
            weeklyScheduleContainer.innerHTML = '<p class="error-message">Không thể tải lịch dạy của tổ.</p>';
        }
    };

    const colorMap = new Map();
    const generateColor = (str) => {
        if (colorMap.has(str)) {
            return colorMap.get(str);
        }
        // Cải tiến thuật toán sinh màu để các màu khác biệt hơn
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
            hash = hash & hash; // Đảm bảo hash là số nguyên 32-bit
        }

        // Sử dụng "góc vàng" để tạo ra các màu sắc phân bổ đều và khác biệt hơn
        const hue = Math.abs(hash * 137.508) % 360;
        const color = `hsl(${hue}, 70%, 92%)`; // Màu nền nhạt hơn
        const borderColor = `hsl(${hue}, 60%, 60%)`;
        const result = { bg: color, border: borderColor };
        colorMap.set(str, result);
        return result;
    };

    const getFilteredRegistrations = () => {
        const selectedSubject = filterSubjectSelect.value;
        const selectedTeacher = filterTeacherSelect.value;
        const selectedMethod = filterMethodSelect.value;

        return currentRegistrations.filter(reg => {
            const subjectMatch = selectedSubject === 'all' || reg.subject === selectedSubject;
            const teacherMatch = selectedTeacher === 'all' || reg.teacherId === selectedTeacher;
            const methodMatch = selectedMethod === 'all' || (Array.isArray(reg.teachingMethod) && reg.teachingMethod.includes(selectedMethod));
            return subjectMatch && teacherMatch && methodMatch;
        });
    };

    const renderLegend = (registrations) => {
        legendContainer.innerHTML = '<h4>Chú thích</h4>';

        const teacherNames = [...new Set(registrations.map(reg => reg.teacherName))].sort();
        const subjects = [...new Set(registrations.map(reg => reg.subject))].sort();

        const createSection = (title, items, colorProperty, dataType) => {
            if (items.length === 0) return;
            // Implementation similar to manager-synthetic.js
            // ... (This part is omitted for brevity but would be here)
        };

        // For simplicity, we'll just show teacher colors for now
    };

    const renderWeeklySchedule = (week, allRegistrations) => {
        const currentUser = auth.currentUser;
        // Create a map for easy lookup: uid -> name
        const teacherNameMap = new Map();
        teachersInGroup.forEach(teacher => {
            if (teacher.uid && teacher.teacher_name) {
                teacherNameMap.set(teacher.uid, teacher.teacher_name);
            }
        });

        // Lấy danh sách đăng ký đã được lọc theo môn học
        const filteredRegistrations = getFilteredRegistrations();

        const daysOfWeek = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
        const weekDates = [];
        let currentDate = new Date(week.startDate.replace(/-/g, '/'));
        const formatDateToYYYYMMDD = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        for (let i = 0; i < 6; i++) {
            weekDates.push(formatDateToYYYYMMDD(currentDate));
            currentDate.setDate(currentDate.getDate() + 1);
        }

        // Sử dụng lại giao diện bảng từ trang đăng ký
        let desktopHTML = `<div class="desktop-schedule"><table class="weekly-schedule-table"><thead><tr><th>Buổi</th><th>Tiết</th>`;
        daysOfWeek.forEach((day, index) => {
            desktopHTML += `<th>${day}<br>${formatDate(weekDates[index])}</th>`;
        });
        desktopHTML += `</tr></thead><tbody>`;

        // Buổi Sáng
        for (let period = 1; period <= 5; period++) {
            desktopHTML += `<tr>`;
            if (period === 1) {
                desktopHTML += `<td class="session-header" rowspan="5">Sáng</td>`;
            }
            desktopHTML += `<td class="period-header">${period}</td>`;
            weekDates.forEach(date => {
                const regsInSlot = filteredRegistrations.filter(r => r.date === date && r.period === period);
                desktopHTML += `<td>`;
                regsInSlot.forEach(reg => {
                    const subjectColor = generateColor(reg.subject);
                    const firstMethod = Array.isArray(reg.teachingMethod) && reg.teachingMethod.length > 0 ? reg.teachingMethod[0] : 'Không có PPDH';
                    const methodColor = generateColor(firstMethod);
                    const teacherName = teacherNameMap.get(reg.teacherId) || 'GV không xác định';
                    const teacherColor = generateColor(teacherName);
                    const isMyRegistration = currentUser && reg.teacherId === currentUser.uid;

                    // Tạo tooltip chi tiết khi hover
                    const tooltipText = [
                        `Giáo viên: ${teacherName}`,
                        `Tổ: ${document.getElementById('sidebar-group-name').textContent.replace('Tổ ', '')}`,
                        `Lớp: ${reg.className}`,
                        `Môn: ${reg.subject}`,
                        `Bài dạy: ${reg.lessonName}`,
                        `Thiết bị: ${Array.isArray(reg.equipment) ? reg.equipment.join(', ') : ''}`,
                        `PPDH: ${Array.isArray(reg.teachingMethod) ? reg.teachingMethod.join(', ') : ''}`,
                        reg.notes ? `Ghi chú: ${reg.notes}` : ''
                    ].filter(part => part).join('\n');

                    desktopHTML += `
                        <div class="registration-info ${isMyRegistration ? 'my-registration' : 'other-teacher'}" 
                             data-reg-id="${reg.id}"
                             data-method="${firstMethod}"
                             data-subject="${reg.subject}"
                             data-teacher-id="${reg.teacherId}"
                             style="cursor: default; background-color: ${methodColor.bg}; border-left-color: ${subjectColor.border};" 
                             title="${tooltipText}">
                            <p><i class="fas ${isMyRegistration ? 'fa-chalkboard-teacher' : 'fa-user'}" style="color: ${teacherColor.border};"></i> ${isMyRegistration ? `Lớp ${reg.className}: ${reg.lessonName}` : `${teacherName} - Lớp ${reg.className}`}</p>
                        </div>`;
                });
                desktopHTML += `</td>`;
            });
            desktopHTML += `</tr>`;
        }

        // Hàng phân cách
        desktopHTML += `<tr class="session-separator"><td colspan="8"></td></tr>`;

        // Buổi Chiều
        for (let period = 6; period <= 10; period++) {
            desktopHTML += `<tr>`;
            if (period === 6) {
                desktopHTML += `<td class="session-header" rowspan="5">Chiều</td>`;
            }
            desktopHTML += `<td class="period-header">${period - 5}</td>`;
            weekDates.forEach(date => {
                const regsInSlot = filteredRegistrations.filter(r => r.date === date && r.period === period);
                desktopHTML += `<td>`;
                regsInSlot.forEach(reg => {
                    const subjectColor = generateColor(reg.subject);
                    const firstMethod = Array.isArray(reg.teachingMethod) && reg.teachingMethod.length > 0 ? reg.teachingMethod[0] : 'Không có PPDH';
                    const methodColor = generateColor(firstMethod);
                    const teacherName = teacherNameMap.get(reg.teacherId) || 'GV không xác định';
                    const teacherColor = generateColor(teacherName);
                    const isMyRegistration = currentUser && reg.teacherId === currentUser.uid;

                    // Tạo tooltip chi tiết khi hover
                    const tooltipText = [
                        `Giáo viên: ${teacherName}`,
                        `Tổ: ${document.getElementById('sidebar-group-name').textContent.replace('Tổ ', '')}`,
                        `Lớp: ${reg.className}`,
                        `Môn: ${reg.subject}`,
                        `Bài dạy: ${reg.lessonName}`,
                        `Thiết bị: ${Array.isArray(reg.equipment) ? reg.equipment.join(', ') : ''}`,
                        `PPDH: ${Array.isArray(reg.teachingMethod) ? reg.teachingMethod.join(', ') : ''}`,
                        reg.notes ? `Ghi chú: ${reg.notes}` : ''
                    ].filter(part => part).join('\n');

                    desktopHTML += `
                        <div class="registration-info ${isMyRegistration ? 'my-registration' : 'other-teacher'}" 
                             data-reg-id="${reg.id}"
                             data-method="${firstMethod}"
                             data-subject="${reg.subject}"
                             data-teacher-id="${reg.teacherId}"
                             style="cursor: default; background-color: ${methodColor.bg}; border-left-color: ${subjectColor.border};" 
                             title="${tooltipText}">
                            <p><i class="fas ${isMyRegistration ? 'fa-chalkboard-teacher' : 'fa-user'}" style="color: ${teacherColor.border};"></i> ${isMyRegistration ? `Lớp ${reg.className}: ${reg.lessonName}` : `${teacherName} - Lớp ${reg.className}`}</p>
                        </div>`;
                });
                desktopHTML += `</td>`;
            });
            desktopHTML += `</tr>`;
        }

        desktopHTML += `</tbody></table></div>`;

        // Render giao diện mobile
        const mobileHTML = renderMobileSchedule(week, filteredRegistrations, daysOfWeek, weekDates, teacherNameMap);

        weeklyScheduleContainer.innerHTML = desktopHTML + mobileHTML;

        // Render legend after rendering schedule
        renderFullLegend(filteredRegistrations);
    };

    const renderFullLegend = (registrations) => {
        legendContainer.innerHTML = '<h4>Chú thích</h4>';

        const createLegendSection = (title, items, colorProperty, dataType, valueAccessor = item => item, displayAccessor = item => item) => {
            const section = document.createElement('div');
            section.className = 'legend-section';
            section.innerHTML = `<h5>${title}</h5>`;

            const itemsWrapper = document.createElement('div');
            itemsWrapper.className = 'legend-items-wrapper'; // Class mới để style

            const uniqueItems = [...new Set(items)].sort();

            uniqueItems.forEach(item => {
                if (!item) return;

                const value = valueAccessor(item);
                const displayName = displayAccessor(item);

                if (!displayName || displayName === 'N/A') return;

                const colors = generateColor(displayName); // Màu được tạo dựa trên tên hiển thị
                const legendItem = document.createElement('div');
                legendItem.className = 'legend-item';
                legendItem.dataset.type = dataType;
                legendItem.dataset.value = value;
                legendItem.innerHTML = `<div class="legend-color-box" style="background-color: ${colors[colorProperty]}; border: 1px solid ${colors.border};"></div><span>${displayName}</span>`;
                itemsWrapper.appendChild(legendItem);
            });

            if (itemsWrapper.children.length > 0) {
                section.appendChild(itemsWrapper);
                legendContainer.appendChild(section);
            }
        };

        // Tạo map giáo viên để tra cứu tên từ uid, đưa ra ngoài để closure có thể truy cập
        const teacherNameMap = new Map(teachersInGroup.map(t => [t.uid, t.teacher_name]));

        // Lấy tất cả môn học từ tên tổ
        const groupName = document.getElementById('sidebar-group-name').textContent.replace('Tổ ', '');
        const allSubjectsInGroup = getSubjectsFromGroupName(groupName);

        // Lấy tất cả giáo viên trong tổ
        const allTeachersInGroup = teachersInGroup.map(t => t.uid).filter(Boolean);

        // Lấy tất cả PPDH
        const allAvailableMethods = [...allMethods];

        createLegendSection('PPDH (Màu nền)', allAvailableMethods, 'bg', 'method');
        createLegendSection('Môn học (Viền)', allSubjectsInGroup, 'border', 'subject');
        createLegendSection('Giáo viên (Icon)', allTeachersInGroup, 'border', 'teacher', uid => uid, uid => teacherNameMap.get(uid) || 'N/A');
    };

    const renderMobileSchedule = (week, allRegistrations, daysOfWeek, weekDates, teacherNameMap) => {
        const currentUser = auth.currentUser;
        let mobileHTML = `<div class="mobile-schedule">`;

        weekDates.forEach((date, dayIndex) => {
            const regsForDay = allRegistrations.filter(r => r.date === date).sort((a, b) => a.period - b.period);

            mobileHTML += `
                <div class="mobile-day-card">
                    <div class="mobile-day-header">
                        ${daysOfWeek[dayIndex]} - ${formatDate(date)}
                    </div>
                    <div class="mobile-day-body">
            `;

            if (regsForDay.length > 0) {
                regsForDay.forEach(reg => {
                    const session = reg.period <= 5 ? 'Sáng' : 'Chiều';
                    const displayPeriod = reg.period <= 5 ? reg.period : reg.period - 5;
                    const teacherName = teacherNameMap.get(reg.teacherId) || 'GV không xác định';
                    const isMyRegistration = currentUser && reg.teacherId === currentUser.uid;

                    mobileHTML += `
                        <div class="mobile-slot">
                            <div class="mobile-period-info">
                                <span>Tiết ${displayPeriod}</span>
                                <small>(${session})</small>
                            </div>
                            <div class="registration-info ${isMyRegistration ? 'my-registration' : 'other-teacher'}" style="cursor: default;" data-reg-id="${reg.id}">
                                <p><i class="fas fa-user fa-fw"></i> ${teacherName}</p>
                                <p><i class="fas fa-chalkboard fa-fw"></i> Lớp ${reg.className}</p>
                                <p><i class="fas fa-book-open fa-fw"></i> ${reg.lessonName}</p>
                            </div>
                        </div>
                    `;
                });
            } else {
                mobileHTML += `<div class="no-registrations-mobile">Không có tiết dạy nào.</div>`;
            }

            mobileHTML += `</div></div>`;
        });

        mobileHTML += `</div>`;
        return mobileHTML;
    };

    const setupEventListeners = () => {
        // Week navigation
        document.getElementById('prev-week-btn').addEventListener('click', () => {
            if (selectedWeekNumber > 1) updateSelectedWeek(selectedWeekNumber - 1);
        });
        document.getElementById('next-week-btn').addEventListener('click', () => {
            if (selectedWeekNumber < timePlan.length) updateSelectedWeek(selectedWeekNumber + 1);
        });
        document.getElementById('week-display-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            weekDropdown.style.display = weekDropdown.style.display === 'none' ? 'block' : 'none';
        });
        weekDropdown.addEventListener('click', (e) => {
            if (e.target.classList.contains('week-option')) {
                updateSelectedWeek(parseInt(e.target.dataset.week));
                weekDropdown.style.display = 'none';
            }
        });
        document.addEventListener('click', (e) => {
            if (!weekSelectorWrapper.contains(e.target)) weekDropdown.style.display = 'none';
        });

        // Filter listener
        filterSubjectSelect.addEventListener('change', () => {
            // Khi môn học thay đổi, cập nhật lại danh sách giáo viên và vẽ lại lịch
            updateTeacherFilter();
            renderWeeklySchedule(timePlan.find(w => w.weekNumber === selectedWeekNumber), currentRegistrations);
        });

        // Gộp listener cho teacher và method
        [filterTeacherSelect, filterMethodSelect].forEach(select => {
            select.addEventListener('change', () => {
                renderWeeklySchedule(timePlan.find(w => w.weekNumber === selectedWeekNumber), currentRegistrations);
            });
        });
        /* filterTeacherSelect.addEventListener('change', () => {
            renderWeeklySchedule(timePlan.find(w => w.weekNumber === selectedWeekNumber), currentRegistrations);
        }); */
    };

    const setupLegendHighlighting = () => {
        legendContainer.addEventListener('mouseover', (e) => {
            const legendItem = e.target.closest('.legend-item');
            if (!legendItem) return;

            const type = legendItem.dataset.type;
            const value = legendItem.dataset.value;
            if (!type || !value) return;

            // Làm chìm cả giao diện desktop và mobile
            const mobileScheduleContainer = document.querySelector('.mobile-schedule');
            weeklyScheduleContainer.classList.add('dimmed');
            if (mobileScheduleContainer) mobileScheduleContainer.classList.add('dimmed');

            // Tìm và làm nổi bật các mục khớp
            const selector = `.registration-info[data-${type}*="${value}"]`;
            document.querySelectorAll(selector).forEach(el => el.classList.add('highlighted'));
        });

        legendContainer.addEventListener('mouseout', () => {
            const mobileScheduleContainer = document.querySelector('.mobile-schedule');
            weeklyScheduleContainer.classList.remove('dimmed');
            if (mobileScheduleContainer) mobileScheduleContainer.classList.remove('dimmed');
            document.querySelectorAll('.registration-info.highlighted').forEach(el => el.classList.remove('highlighted'));
        });
    };

    const updateSelectedWeek = (weekNum) => {
        if (!weekNum) return;
        selectedWeekNumber = parseInt(weekNum);
        const weekData = timePlan.find(w => w.weekNumber === selectedWeekNumber);
        if (weekData) {
            weekDisplayText.textContent = `Tuần ${weekData.weekNumber}`;
            weekDateRange.textContent = `Từ ${formatDate(weekData.startDate)} đến ${formatDate(weekData.endDate)}`;

            document.querySelectorAll('.week-option').forEach(opt => {
                opt.classList.toggle('highlight', opt.dataset.week == selectedWeekNumber);
            });

            loadAndRenderSchedule();
        }
    };

    const formatDate = (dateString) => {
        if (!dateString) return '';
        const [year, month, day] = dateString.split('-');
        return `${day}/${month}/${year}`;
    };

    const findRegistrationByElement = (element) => {
        // Hàm này tìm đăng ký dựa trên nội dung của phần tử, dùng cho giao diện mobile
        const teacherNameEl = element.querySelector('p:nth-child(1)');
        const classLessonEl = element.querySelector('p:nth-child(2)');
        if (!teacherNameEl || !classLessonEl) return null;
    
        const teacherName = teacherNameEl.textContent.trim().replace('GV: ', '');
        const classLessonText = classLessonEl.textContent.trim();
        const classMatch = classLessonText.match(/Lớp (.*?):/);
        const className = classMatch ? classMatch[1] : null;
    
        return currentRegistrations.find(r => (teacherNameMap.get(r.teacherId) === teacherName) && r.className === className);
    };

    loadDashboardData();
});