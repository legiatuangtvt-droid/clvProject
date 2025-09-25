import {
    collection,
    getDocs,
    query,
    orderBy,
    where,
    limit,
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { firestore } from "./firebase-config.js";
import { showToast } from "./toast.js";

document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('schedule-container')) return;

    // DOM Elements
    const weekSelectorWrapper = document.getElementById('week-selector-wrapper');
    const weekDisplayText = document.getElementById('week-display-text');
    const weekDateRange = document.getElementById('week-date-range');
    const weekDropdown = document.getElementById('week-dropdown');
    const scheduleContainer = document.getElementById('schedule-container');
    const filterGroupSelect = document.getElementById('filter-group-select');
    const filterSubjectSelect = document.getElementById('filter-subject-select');
    const filterTeacherSelect = document.getElementById('filter-teacher-select');
    const filterMethodSelect = document.getElementById('filter-method-select');
    const legendContainer = document.getElementById('color-legend-container');
    const equipmentStatsBtn = document.getElementById('equipment-stats-btn');
    const equipmentStatsModal = document.getElementById('equipment-stats-modal');
    const closeEquipmentStatsModalBtn = document.getElementById('close-equipment-stats-modal');

    // State variables
    let currentSchoolYear = null;
    let allTeachers = [];
    let teacherMap = new Map();
    let allGroups = [];
    let groupMap = new Map();
    let timePlan = [];
    let allSubjects = new Set();
    let allMethods = new Set();
    let allRegistrations = [];
    let selectedWeekNumber = null;

    // --- INITIALIZATION ---
    const initializePage = async () => {
        try {
            const yearsQuery = query(collection(firestore, 'schoolYears'), orderBy('schoolYear', 'desc'), limit(1));
            const yearsSnapshot = await getDocs(yearsQuery);
            if (yearsSnapshot.empty) {
                scheduleContainer.innerHTML = '<p>Chưa có dữ liệu năm học.</p>';
                return;
            }
            currentSchoolYear = yearsSnapshot.docs[0].data().schoolYear;

            await Promise.all([
                loadAllTeachers(),
                loadAllGroups(),
                loadAllMethods(),
                loadTimePlan(),
            ]);

            await populateFilterSelectors();

            const today = new Date().toISOString().split('T')[0];
            const currentWeek = timePlan.slice().reverse().find(w => w.startDate <= today);
            const initialWeek = currentWeek ? currentWeek.weekNumber : (timePlan.length > 0 ? timePlan[0].weekNumber : null);
            updateSelectedWeek(initialWeek);

        } catch (error) {
            console.error("Lỗi khởi tạo trang:", error);
            scheduleContainer.innerHTML = '<p class="error-message">Không thể tải dữ liệu trang.</p>';
        }
    };

    // --- DATA LOADING ---
    const loadAllTeachers = async () => {
        const teachersQuery = query(collection(firestore, 'teachers'), orderBy('teacher_name'));
        const teachersSnapshot = await getDocs(teachersQuery);
        allTeachers = teachersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        teacherMap.clear();
        allTeachers.forEach(teacher => {
            if (teacher.uid) {
                teacherMap.set(teacher.uid, teacher);
            }
        });
    };

    const loadAllGroups = async () => {
        const groupsQuery = query(collection(firestore, 'groups'), where('schoolYear', '==', currentSchoolYear), orderBy('group_name'));
        const groupsSnapshot = await getDocs(groupsQuery);
        allGroups = groupsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        groupMap.clear();
        allGroups.forEach(group => {
            groupMap.set(group.group_id, group);
        });
    };

    const loadAllMethods = async () => {
        const methodsQuery = query(collection(firestore, 'teachingMethods'), where('schoolYear', '==', currentSchoolYear), orderBy('method'));
        const methodsSnapshot = await getDocs(methodsQuery);
        allMethods.clear();
        methodsSnapshot.forEach(doc => {
            allMethods.add(doc.data().method);
        });
    };

    const loadTimePlan = async () => {
        const planQuery = query(collection(firestore, 'timePlans'), where("schoolYear", "==", currentSchoolYear));
        const planSnapshot = await getDocs(planQuery);
        weekDropdown.innerHTML = '';
        if (planSnapshot.empty) {
            weekDisplayText.textContent = 'Chưa có kế hoạch';
            return;
        }
        const planDocId = planSnapshot.docs[0].id;
        const weeksQuery = query(collection(firestore, 'timePlans', planDocId, 'weeks'), orderBy('weekNumber'));
        const weeksSnapshot = await getDocs(weeksQuery);
        timePlan = weeksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        timePlan.forEach(week => {
            const option = document.createElement('div');
            option.className = 'week-option';
            option.dataset.week = week.weekNumber;
            option.textContent = `Tuần ${week.weekNumber} (${formatDate(week.startDate)} - ${formatDate(week.endDate)})`;
            weekDropdown.appendChild(option);
       });
    };

    const populateFilterSelectors = async () => {
        const groupsQuery = query(collection(firestore, 'groups'), where('schoolYear', '==', currentSchoolYear));
        const groupsSnapshot = await getDocs(groupsQuery);
        allSubjects.clear();
        groupsSnapshot.forEach(doc => {
            const groupName = doc.data().group_name;
            groupName.replace(/^Tổ\s*/, '').split(/\s*-\s*/).forEach(sub => allSubjects.add(sub.trim()));
        });

        allGroups.forEach(group => {
            filterGroupSelect.innerHTML += `<option value="${group.group_id}">${group.group_name}</option>`;
        });
        filterSubjectSelect.innerHTML = '<option value="all">Tất cả</option>';
        [...allSubjects].sort().forEach(subject => {
            filterSubjectSelect.innerHTML += `<option value="${subject}">${subject}</option>`;
        });
        filterMethodSelect.innerHTML = '<option value="all">Tất cả</option>';
        [...allMethods].sort().forEach(method => {
            filterMethodSelect.innerHTML += `<option value="${method}">${method}</option>`;
        });
    };

    const updateDependentFilters = () => {
        const selectedGroupId = filterGroupSelect.value;
        const currentSubject = filterSubjectSelect.value;
        const currentTeacher = filterTeacherSelect.value;

        const subjectSelect = filterSubjectSelect;
        subjectSelect.innerHTML = '<option value="all">Tất cả</option>';
        let availableSubjects = new Set();

        if (selectedGroupId === 'all') {
            availableSubjects = allSubjects;
        } else {
            const selectedGroup = allGroups.find(g => g.group_id === selectedGroupId);
            if (selectedGroup) {
                selectedGroup.group_name.replace(/^Tổ\s*/, '').split(/\s*-\s*/).forEach(sub => availableSubjects.add(sub.trim()));
            }
        }
        [...availableSubjects].sort().forEach(subject => {
            subjectSelect.innerHTML += `<option value="${subject}">${subject}</option>`;
        });
        if (availableSubjects.has(currentSubject)) {
            subjectSelect.value = currentSubject;
        }

        const teacherSelect = filterTeacherSelect;
        const finalSelectedSubject = subjectSelect.value; // Lấy giá trị môn học mới nhất
        teacherSelect.innerHTML = '<option value="all">Tất cả</option>';
        let teachersToShow = [];

        if (selectedGroupId === 'all') {
            teachersToShow = allTeachers;
        } else {
            teachersToShow = allTeachers.filter(t => t.group_id === selectedGroupId);
        }

        // Lọc thêm theo môn học
        if (finalSelectedSubject !== 'all') {
            teachersToShow = teachersToShow.filter(t => t.subject === finalSelectedSubject);
        }

        teachersToShow.forEach(teacher => {
            const option = document.createElement('option');
            option.value = teacher.uid;
            option.textContent = teacher.teacher_name;
            teacherSelect.appendChild(option);
        });
        if (teachersToShow.some(t => t.uid === currentTeacher)) {
            teacherSelect.value = currentTeacher;
        }
    };

    // --- SCHEDULE RENDERING ---
    const loadAndRenderSchedule = async () => {
        const selectedWeek = timePlan.find(w => w.weekNumber === selectedWeekNumber);
        if (!selectedWeek) {
            scheduleContainer.innerHTML = '<p>Không có dữ liệu tuần để hiển thị.</p>';
            return;
        }

        scheduleContainer.innerHTML = '<p>Đang tải lịch...</p>';
        try {
            const regsQuery = query(
                collection(firestore, 'registrations'),
                where('date', '>=', selectedWeek.startDate),
                where('date', '<=', selectedWeek.endDate)
            );
            const regsSnapshot = await getDocs(regsQuery);
            allRegistrations = regsSnapshot.docs.map(doc => {
                const data = doc.data();
                const groupId = data.groupId || teacherMap.get(data.teacherId)?.group_id || null;
                return {
                    id: doc.id,
                    ...data,
                    groupId: groupId,
                    groupName: groupMap.get(groupId)?.group_name || 'Không xác định'
                };
            });
            updateDependentFilters();
            renderWeeklySchedule(selectedWeek);
        } catch (error) {
            console.error("Lỗi tải lịch đăng ký:", error);
            scheduleContainer.innerHTML = '<p class="error-message">Không thể tải lịch đăng ký. Vui lòng kiểm tra cấu hình Firestore Index.</p>';
        }
    };

    const getFilteredRegistrations = () => {
        const selectedGroup = filterGroupSelect.value;
        const selectedSubject = filterSubjectSelect.value;
        const selectedTeacher = filterTeacherSelect.value;
        const selectedMethod = filterMethodSelect.value;

        return allRegistrations.filter(reg => {
            const groupMatch = selectedGroup === 'all' || reg.groupId === selectedGroup;
            const subjectMatch = selectedSubject === 'all' || reg.subject === selectedSubject;
            const teacherMatch = selectedTeacher === 'all' || reg.teacherId === selectedTeacher;
            const methodMatch = selectedMethod === 'all' || (Array.isArray(reg.teachingMethod) && reg.teachingMethod.includes(selectedMethod));
            return groupMatch && subjectMatch && teacherMatch && methodMatch;
        });
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
        const hue = Math.abs(hash * 137.508) % 360;
        const color = `hsl(${hue}, 70%, 92%)`; // Màu nền nhạt hơn
        const borderColor = `hsl(${hue}, 60%, 60%)`; // Giữ nguyên màu viền
        const result = { bg: color, border: borderColor };
        colorMap.set(str, result);
        return result;
    };

    const renderWeeklySchedule = (week) => {
        const daysOfWeek = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
        const weekDates = [];
        let currentDate = new Date(week.startDate.replace(/-/g, '/'));
        const formatDateToYYYYMMDD = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        for (let i = 0; i < 6; i++) {
            weekDates.push(formatDateToYYYYMMDD(currentDate));
            currentDate.setDate(currentDate.getDate() + 1);
        }

        let desktopHTML = `<div class="desktop-schedule"><table class="weekly-schedule-table"><thead><tr><th>Buổi</th><th>Tiết</th>`;
        daysOfWeek.forEach((day, index) => {
            desktopHTML += `<th>${day}<br>${formatDate(weekDates[index])}</th>`;
        });
        desktopHTML += `</tr></thead><tbody>`;

        const filteredRegistrations = getFilteredRegistrations();

        const renderSlot = (reg) => {
            const teacherName = teacherMap.get(reg.teacherId)?.teacher_name || reg.teacherName || 'N/A';
            const groupColor = generateColor(reg.groupName);
            const subjectColor = generateColor(reg.subject);
            const teacherColor = generateColor(teacherName);
            const firstMethod = Array.isArray(reg.teachingMethod) && reg.teachingMethod.length > 0 ? reg.teachingMethod[0] : 'Không có PPDH';
            const methodColor = generateColor(firstMethod);

            const tooltipText = `Giáo viên: ${teacherName}\nLớp: ${reg.className}\nMôn: ${reg.subject}\nBài dạy: ${reg.lessonName}\nThiết bị: ${Array.isArray(reg.equipment) ? reg.equipment.join(', ') : ''}\nPPDH: ${Array.isArray(reg.teachingMethod) ? reg.teachingMethod.join(', ') : ''}`.trim();

            return `
                <div class="registration-info" 
                     data-reg-id="${reg.id}" 
                     data-group-name="${reg.groupName}"
                     data-subject="${reg.subject}"
                     data-teacher-name="${teacherName}"
                     data-method="${firstMethod}"
                     title="${tooltipText}" 
                     style="background-color: ${methodColor.bg}; border-left-color: ${subjectColor.border}; border-right-color: ${groupColor.border}; cursor: help;">
                    <p><i class="fas fa-user" style="color: ${teacherColor.border};"></i> ${teacherName} - Lớp ${reg.className}</p>
                </div>`;
        };

        ['Sáng', 'Chiều'].forEach((session, sessionIndex) => {
            const startPeriod = sessionIndex * 5 + 1;
            const endPeriod = startPeriod + 4;

            for (let period = startPeriod; period <= endPeriod; period++) {
                desktopHTML += `<tr>`;
                if (period === startPeriod) {
                    desktopHTML += `<td class="session-header" rowspan="5">${session}</td>`;
                }
                desktopHTML += `<td class="period-header">${period > 5 ? period - 5 : period}</td>`;
                weekDates.forEach(date => {
                    const regsInSlot = filteredRegistrations.filter(r => r.date === date && r.period === period);
                    desktopHTML += `<td class="slot" data-date="${date}" data-period="${period}">`;
                    regsInSlot.forEach(reg => {
                        desktopHTML += renderSlot(reg);
                    });
                    desktopHTML += `</td>`;
                });
                desktopHTML += `</tr>`;
            }
            if (session === 'Sáng') {
                desktopHTML += `<tr class="session-separator"><td colspan="8"></td></tr>`;
            }
        });

        desktopHTML += `</tbody></table></div>`;
        scheduleContainer.innerHTML = desktopHTML;
        renderLegend(filteredRegistrations);
    };

    const renderLegend = (filteredRegs) => {
        legendContainer.innerHTML = '<h4>Chú thích</h4>';
        const createLegendSection = (title, getValue, colorProperty, dataType) => {
            const section = document.createElement('div');
            section.className = 'legend-section';
            section.innerHTML = `<h5>${title}</h5>`;
            const itemsWrapper = document.createElement('div');
            itemsWrapper.className = 'legend-items-wrapper';
            const uniqueValues = [...new Set(filteredRegs.map(getValue))].sort();
            uniqueValues.forEach(value => {
                if (!value || value === 'Không xác định') return;
                const colors = generateColor(value);
                const legendItem = document.createElement('div');
                legendItem.className = 'legend-item';
                legendItem.dataset.type = dataType;
                legendItem.dataset.value = value;
                legendItem.innerHTML = `
                    <div class="legend-color-box" style="background-color: ${colors[colorProperty]};"></div>
                    <span>${value}</span>
                `;
                itemsWrapper.appendChild(legendItem);
            });
            if (itemsWrapper.children.length > 0) {
                section.appendChild(itemsWrapper);
                legendContainer.appendChild(section);
            }
        };
        const getFirstMethod = reg => Array.isArray(reg.teachingMethod) && reg.teachingMethod.length > 0 ? reg.teachingMethod[0] : 'Không có PPDH';
        createLegendSection('PPDH (Màu nền)', getFirstMethod, 'bg', 'method');
        createLegendSection('Môn học (Viền trái)', reg => reg.subject, 'border', 'subject');
        createLegendSection('Tổ chuyên môn (Viền phải)', reg => reg.groupName, 'border', 'group');
        createLegendSection('Giáo viên (Icon)', reg => teacherMap.get(reg.teacherId)?.teacher_name, 'border', 'teacher');
    };

    // --- EVENT LISTENERS ---
    const setupEventListeners = () => {
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
                updateSelectedWeek(e.target.dataset.week);
                weekDropdown.style.display = 'none';
            }
        });
        document.addEventListener('click', (e) => {
            if (!weekSelectorWrapper.contains(e.target)) weekDropdown.style.display = 'none';
        });

        [filterGroupSelect, filterSubjectSelect, filterMethodSelect].forEach(select => {
            select.addEventListener('change', () => {
                updateDependentFilters();
                renderWeeklySchedule(timePlan.find(w => w.weekNumber === selectedWeekNumber));
            });
        });

        filterTeacherSelect.addEventListener('change', () => {
            renderWeeklySchedule(timePlan.find(w => w.weekNumber === selectedWeekNumber));
        });
    };
    
    const showEquipmentStats = () => {
         const selectedWeek = timePlan.find(w => w.weekNumber === selectedWeekNumber);
        if (!selectedWeek) {
            showToast('Vui lòng chọn một tuần để xem thống kê.', 'info');
            return;
        }

        const filteredRegistrations = getFilteredRegistrations();
        const teacherStats = new Map();

        filteredRegistrations.forEach(reg => {
            const teacherId = reg.teacherId;
            if (!teacherId) return;

            if (!teacherStats.has(teacherId)) {
                const teacherInfo = teacherMap.get(teacherId);
                const groupInfo = teacherInfo ? groupMap.get(teacherInfo.group_id) : null;
                teacherStats.set(teacherId, {
                    name: teacherInfo ? teacherInfo.teacher_name : 'Không xác định',
                    groupName: groupInfo ? groupInfo.group_name : 'Không xác định',
                    cnttCount: 0,
                    tbCount: 0,
                    thCount: 0,
                });
            }

            const currentTeacher = teacherStats.get(teacherId);
            if (reg.teachingMethod && Array.isArray(reg.teachingMethod)) {
                reg.teachingMethod.forEach(method => {
                    if (method === 'Công nghệ thông tin') currentTeacher.cnttCount++;
                    else if (method === 'Thiết bị dạy học') currentTeacher.tbCount++;
                    else if (method === 'Thực hành') currentTeacher.thCount++;
                });
            }
        });

        const statsContainer = document.getElementById('equipment-stats-container');
        document.getElementById('equipment-stats-week-info').textContent = `Tuần ${selectedWeek.weekNumber} (Từ ${formatDate(selectedWeek.startDate)} đến ${formatDate(selectedWeek.endDate)})`;

        if (teacherStats.size === 0) {
            statsContainer.innerHTML = '<p>Không có dữ liệu thống kê cho giáo viên theo bộ lọc hiện tại.</p>';
        } else {
            const sortedTeachers = [...teacherStats.values()].sort((a, b) => (b.cnttCount + b.tbCount + b.thCount) - (a.cnttCount + a.tbCount + a.thCount));
            let tableHTML = `<table class="weekly-plan-table">
                <thead>
                    <tr>
                        <th rowspan="2">STT</th><th rowspan="2">Giáo viên</th><th rowspan="2">Tổ chuyên môn</th>
                        <th colspan="3">PPDH</th><th rowspan="2">Tổng</th>
                    </tr>
                    <tr><th>CNTT</th><th>TBDH</th><th>TH</th></tr>
                </thead><tbody>`;

            let totalCntt = 0, totalTb = 0, totalTh = 0;

            sortedTeachers.forEach((stats, index) => {
                const total = stats.cnttCount + stats.tbCount + stats.thCount;
                totalCntt += stats.cnttCount;
                totalTb += stats.tbCount;
                totalTh += stats.thCount;
                tableHTML += `<tr><td>${index + 1}</td><td>${stats.name}</td><td>${stats.groupName}</td><td>${stats.cnttCount}</td><td>${stats.tbCount}</td><td>${stats.thCount}</td><td>${total}</td></tr>`;
            });

            const grandTotal = totalCntt + totalTb + totalTh;
            tableHTML += `<tr class="total-row" style="font-weight: bold;"><td colspan="3" style="text-align: center;">Tổng cộng</td><td>${totalCntt}</td><td>${totalTb}</td><td>${totalTh}</td><td>${grandTotal}</td></tr>`;
            tableHTML += `</tbody></table>`;
            statsContainer.innerHTML = tableHTML;
        }

        equipmentStatsModal.style.display = 'flex';
    };

    const setupStatsModalListeners = () => {
        equipmentStatsBtn.addEventListener('click', showEquipmentStats);
        closeEquipmentStatsModalBtn.addEventListener('click', () => {
            equipmentStatsModal.style.display = 'none';
        });
        equipmentStatsModal.addEventListener('click', (e) => {
            if (e.target === equipmentStatsModal) equipmentStatsModal.style.display = 'none';
        });
    };
    
    const setupLegendHighlighting = () => { // Tối ưu hóa
        legendContainer.addEventListener('mouseover', (e) => {
            const legendItem = e.target.closest('.legend-item');
            if (!legendItem) return;

            const type = legendItem.dataset.type;
            const value = legendItem.dataset.value;
            if (!type || !value) return;

            scheduleContainer.classList.add('dimmed');
            document.querySelectorAll(`.registration-info[data-${type}*="${value}"]`).forEach(el => el.classList.add('highlighted'));
        });

        legendContainer.addEventListener('mouseout', () => {
            scheduleContainer.classList.remove('dimmed');
            document.querySelectorAll('.registration-info.highlighted').forEach(el => el.classList.remove('highlighted'));
        });
    };

    // --- HELPERS ---
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

    // --- RUN ---
    initializePage();
    setupEventListeners();
    setupStatsModalListeners();
    setupLegendHighlighting();
});
