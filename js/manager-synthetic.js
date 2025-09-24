import {
    collection,
    getDocs,
    writeBatch,
    serverTimestamp,
    query,
    orderBy,
    where,
    limit,
    doc,
    addDoc,
    updateDoc,
    deleteDoc
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { auth, firestore } from "./firebase-config.js";
import { showToast } from "./toast.js";

document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('schedule-container')) return;

    // DOM Elements
    const weekSelectorWrapper = document.getElementById('week-selector-wrapper');
    const weekDisplayText = document.getElementById('week-display-text');
    const weekDateRange = document.getElementById('week-date-range');
    const weekDropdown = document.getElementById('week-dropdown');
    const scheduleContainer = document.getElementById('schedule-container');
    const registerModal = document.getElementById('register-modal');
    const registerForm = document.getElementById('register-form');
    const confirmDeleteModal = document.getElementById('confirm-delete-modal');
    const conflictWarningModal = document.getElementById('conflict-warning-modal');
    const filterGroupSelect = document.getElementById('filter-group-select');
    const filterSubjectSelect = document.getElementById('filter-subject-select');
    const filterTeacherSelect = document.getElementById('filter-teacher-select');
    const bulkImportModal = document.getElementById('bulk-import-modal');
    const bulkImportBtn = document.getElementById('bulk-import-btn');
    const processBulkImportBtn = document.getElementById('process-bulk-import-btn');
    const cancelBulkImportBtn = document.getElementById('cancel-bulk-import-modal');
    const bulkImportDaySelect = document.getElementById('bulk-import-day');
    const bulkImportPreviewModal = document.getElementById('bulk-import-preview-modal');
    const closeBulkPreviewModalBtn = document.getElementById('close-bulk-preview-modal');
    const confirmBulkImportBtn = document.getElementById('confirm-bulk-import-btn');
    const recheckBulkImportBtn = document.getElementById('recheck-bulk-import-btn');
    const legendContainer = document.getElementById('color-legend-container');
    const equipmentStatsBtn = document.getElementById('equipment-stats-btn');
    const equipmentStatsModal = document.getElementById('equipment-stats-modal');
    const closeEquipmentStatsModalBtn = document.getElementById('close-equipment-stats-modal');

    // State variables
    let currentSchoolYear = null;
    let allTeachers = []; // Lưu tất cả giáo viên
    let teacherMap = new Map(); // Map: uid -> teacher data
    let allGroups = [];
    let groupMap = new Map(); // Map: group_id -> group data
    let timePlan = [];
    let allSubjects = new Set();
    let allRegistrations = [];
    let selectedWeekNumber = null;
    let currentEditingRegId = null;
    let deleteFunction = null;
    let validRegistrationsToCreate = []; // Lưu các đăng ký hợp lệ để chờ xác nhận

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
                loadTimePlan(),
                populateModalSelectors()
            ]);

            // Populate filters after all data is loaded
            populateFilterSelectors();

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
        const teacherSelect = document.getElementById('reg-teacher');
        teacherSelect.innerHTML = '<option value="">-- Chọn giáo viên --</option>';
        allTeachers.forEach(teacher => {
            if (teacher.uid) {
                teacherMap.set(teacher.uid, teacher);
            }
            const option = document.createElement('option');
            option.value = teacher.uid;
            option.textContent = teacher.teacher_name;
            option.dataset.groupId = teacher.group_id;
            teacherSelect.appendChild(option);
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

    const populateModalSelectors = async () => {
        // Populate PPDH
        const methodsQuery = query(collection(firestore, 'teachingMethods'), where('schoolYear', '==', currentSchoolYear), orderBy('method'));
        const methodsSnapshot = await getDocs(methodsQuery);
        const methodContainer = document.getElementById('reg-method-container');
        methodContainer.innerHTML = '';
        methodsSnapshot.forEach(doc => {
            const method = doc.data().method;
            const checkboxId = `method-${doc.id}`;
            methodContainer.innerHTML += `
                <div class="checkbox-item">
                    <input type="checkbox" id="${checkboxId}" name="teachingMethod" value="${method}">
                    <label for="${checkboxId}">${method}</label>
                </div>
            `;
        });

        // Populate Subjects from all groups
        const groupsQuery = query(collection(firestore, 'groups'), where('schoolYear', '==', currentSchoolYear));
        const groupsSnapshot = await getDocs(groupsQuery);
        const subjectSelect = document.getElementById('reg-subject');
        allSubjects.clear();
        groupsSnapshot.forEach(doc => {
            const groupName = doc.data().group_name;
            groupName.replace(/^Tổ\s*/, '').split(/\s*-\s*/).forEach(sub => allSubjects.add(sub.trim()));
        });

        subjectSelect.innerHTML = '<option value="">-- Chọn môn học --</option>';
        [...allSubjects].sort().forEach(subject => {
            subjectSelect.innerHTML += `<option value="${subject}">${subject}</option>`;
        });
    };

    const populateFilterSelectors = () => {
        allGroups.forEach(group => {
            filterGroupSelect.innerHTML += `<option value="${group.group_id}">${group.group_name}</option>`;
        });
        filterSubjectSelect.innerHTML = '<option value="all">Tất cả</option>';
        [...allSubjects].sort().forEach(subject => {
            filterSubjectSelect.innerHTML += `<option value="${subject}">${subject}</option>`;
        });
    };

    const updateDependentFilters = () => {
        const selectedGroupId = filterGroupSelect.value;
        const currentSubject = filterSubjectSelect.value;
        const currentTeacher = filterTeacherSelect.value;

        // 1. Cập nhật danh sách Môn học dựa trên Tổ đã chọn
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

        // Giữ lại lựa chọn môn học nếu vẫn tồn tại
        if (availableSubjects.has(currentSubject)) {
            subjectSelect.value = currentSubject;
        }

        // 2. Cập nhật danh sách Giáo viên dựa trên Tổ và Môn đã chọn
        const teacherSelect = filterTeacherSelect;
        const selectedSubject = subjectSelect.value; // Lấy giá trị môn học mới nhất
        teacherSelect.innerHTML = '<option value="all">Tất cả</option>';
        let teachersToShow = [];
    
        if (selectedGroupId === 'all') {
            teachersToShow = allTeachers;
        } else {
            teachersToShow = allTeachers.filter(t => t.group_id === selectedGroupId);
        }
    
        teachersToShow.forEach(teacher => {
            const option = document.createElement('option');
            option.value = teacher.uid;
            option.textContent = teacher.teacher_name;
            teacherSelect.appendChild(option);
        });
    
        // Giữ lại lựa chọn giáo viên nếu vẫn tồn tại
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
                where('schoolYear', '==', currentSchoolYear),
                where('weekNumber', '==', selectedWeekNumber)
            );
            const regsSnapshot = await getDocs(regsQuery);
            allRegistrations = regsSnapshot.docs.map(doc => {
                const data = doc.data();
                // Ưu tiên groupId từ chính registration, nếu không có thì mới suy ra từ teacherMap
                const groupId = data.groupId || teacherMap.get(data.teacherId)?.group_id || null;
                return {
                    id: doc.id,
                    ...data,
                    groupId: groupId,
                    groupName: groupMap.get(groupId)?.group_name || 'Không xác định'
                };
            });
            updateDependentFilters(); // Cập nhật bộ lọc sau khi có dữ liệu đăng ký mới
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

        return allRegistrations.filter(reg => {
            const groupMatch = selectedGroup === 'all' || reg.groupId === selectedGroup;
            const subjectMatch = selectedSubject === 'all' || reg.subject === selectedSubject;
            const teacherMatch = selectedTeacher === 'all' || reg.teacherId === selectedTeacher;
            return groupMatch && subjectMatch && teacherMatch;
        });
    };

    const colorMap = new Map();
    const generateColor = (str) => {
        if (colorMap.has(str)) {
            return colorMap.get(str);
        }
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        const h = hash % 360;
        const color = `hsl(${h}, 70%, 85%)`; // Pastel colors
        const borderColor = `hsl(${h}, 60%, 60%)`;
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
            // LUÔN tra cứu tên từ teacherMap
            const teacherName = teacherMap.get(reg.teacherId)?.teacher_name || 'GV không xác định';
            const groupColor = generateColor(reg.groupName);
            const subjectColor = generateColor(reg.subject);
            const teacherColor = generateColor(teacherName);

            const tooltipText = [
                `Giáo viên: ${teacherName}`, `Lớp: ${reg.className}`, `Môn: ${reg.subject}`, `Bài dạy: ${reg.lessonName}`,
                `Thiết bị: ${Array.isArray(reg.equipment) ? reg.equipment.join(', ') : ''}`,
                `PPDH: ${Array.isArray(reg.teachingMethod) ? reg.teachingMethod.join(', ') : ''}`
            ].filter(Boolean).join('\n');

            return `
                <div class="registration-info" data-reg-id="${reg.id}" title="${tooltipText}" 
                     style="background-color: ${groupColor.bg}; border-left-color: ${subjectColor.border};">
                    <p><i class="fas fa-user" style="color: ${teacherColor.border};"></i> ${teacherName} - Lớp ${reg.className}</p>
                </div>`;
        };

        // Morning & Afternoon sessions
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
        // Mobile view can be added here if needed, similar to teacher-main.js

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

            if (itemsWrapper.children.length > 0) { // Only append if there are items
                section.appendChild(itemsWrapper);
                legendContainer.appendChild(section);
            }
        };

        createLegendSection('Tổ chuyên môn (Màu nền)', reg => reg.groupName, 'bg', 'group');
        createLegendSection('Môn học (Viền trái)', reg => reg.subject, 'border', 'subject');
        // Thay đổi getValue để lấy teacherName từ teacherMap
        createLegendSection('Giáo viên (Icon)', reg => teacherMap.get(reg.teacherId)?.teacher_name, 'border', 'teacher');
    };

    // --- MODAL & FORM HANDLING ---
    const openRegisterModal = (regId = null, date = null, period = null) => {
        currentEditingRegId = regId;
        registerForm.reset();
        document.querySelectorAll('#reg-method-container input[type="checkbox"]').forEach(cb => cb.checked = false);
        document.getElementById('delete-register-btn').style.display = regId ? 'inline-block' : 'none';
        document.getElementById('register-modal-title').textContent = regId ? 'Chỉnh sửa đăng ký' : 'Thêm đăng ký mới';

        const modalTeacherSelect = document.getElementById('reg-teacher');
        const filterTeacherSelect = document.getElementById('filter-teacher-select');

        // Đồng bộ hóa danh sách giáo viên từ bộ lọc bên ngoài vào modal
        modalTeacherSelect.innerHTML = '<option value="">-- Chọn giáo viên --</option>';
        // Bỏ qua option "Tất cả" đầu tiên của bộ lọc
        for (let i = 1; i < filterTeacherSelect.options.length; i++) {
            const filterOption = filterTeacherSelect.options[i];
            const newOption = document.createElement('option');
            newOption.value = filterOption.value;
            newOption.textContent = filterOption.textContent;
            // Sao chép lại các dataset cần thiết nếu có
            Object.assign(newOption.dataset, filterOption.dataset);
            modalTeacherSelect.add(newOption);
        }

        const modalSubjectSelect = document.getElementById('reg-subject');
        const filterSubjectSelect = document.getElementById('filter-subject-select');

        // Đồng bộ hóa danh sách môn học từ bộ lọc bên ngoài vào modal
        modalSubjectSelect.innerHTML = '<option value="">-- Chọn môn học --</option>';
        for (let i = 1; i < filterSubjectSelect.options.length; i++) {
            modalSubjectSelect.add(filterSubjectSelect.options[i].cloneNode(true));
        }

        const weekContainer = document.getElementById('reg-week-container');
        const weekSelect = document.getElementById('reg-week');
        const daySelect = document.getElementById('reg-day');
        const periodSelect = document.getElementById('reg-period');

        if (regId) {
            const reg = allRegistrations.find(r => r.id === regId); // Use allRegistrations to find it
            modalTeacherSelect.value = reg.teacherId;
            daySelect.value = reg.date;
            periodSelect.value = reg.period;
            modalSubjectSelect.value = reg.subject;
            document.getElementById('reg-class').value = reg.className;
            document.getElementById('reg-lesson-name').value = reg.lessonName;
            document.getElementById('reg-equipment-input').value = reg.equipment?.join(', ') || '';
            reg.teachingMethod?.forEach(method => {
                const checkbox = document.querySelector(`#reg-method-container input[value="${method}"]`);
                if (checkbox) checkbox.checked = true;
            });

            // Hiển thị và thiết lập bộ chọn tuần khi chỉnh sửa
            weekContainer.style.display = 'block';
            weekSelect.innerHTML = '';
            timePlan.forEach(week => {
                const option = document.createElement('option');
                option.value = week.weekNumber;
                option.textContent = `Tuần ${week.weekNumber} (${formatDate(week.startDate)} - ${formatDate(week.endDate)})`;
                weekSelect.appendChild(option);
            });
            weekSelect.value = reg.weekNumber;

            // Cập nhật danh sách ngày dựa trên tuần đã chọn
            populateDayAndPeriodSelectors(reg.weekNumber);
            daySelect.value = reg.date; // Đặt lại ngày sau khi populate
            periodSelect.value = reg.period; // Đặt lại tiết sau khi populate

            // Thêm sự kiện để cập nhật ngày khi đổi tuần
            weekSelect.onchange = (e) => {
                const daySelect = document.getElementById('reg-day');
                const periodSelect = document.getElementById('reg-period');
                const previousDayIndex = daySelect.selectedIndex; // Lưu lại thứ đang chọn
                const previousPeriodValue = periodSelect.value; // Lưu lại tiết đang chọn

                populateDayAndPeriodSelectors(parseInt(e.target.value));

                // Áp dụng lại thứ đã chọn cho tuần mới
                if (previousDayIndex !== -1) daySelect.selectedIndex = previousDayIndex;
                periodSelect.value = previousPeriodValue; // Áp dụng lại tiết đã chọn
            };

            // Mở khóa tất cả các trường thời gian khi chỉnh sửa
            weekSelect.disabled = false;
            daySelect.disabled = false;
            periodSelect.disabled = false;
        } else {
            weekContainer.style.display = 'none'; // Ẩn bộ chọn tuần khi tạo mới
            populateDayAndPeriodSelectors(selectedWeekNumber); // Populate ngày cho tuần hiện tại
            if (date) daySelect.value = date;
            if (period) periodSelect.value = period;
            // Khóa các trường thời gian khi tạo mới từ bảng
            daySelect.disabled = true;
            periodSelect.disabled = true;
        }
        registerModal.style.display = 'flex';
    };

    const populateDayAndPeriodSelectors = (weekNum) => {
        const daySelect = document.getElementById('reg-day');
        const periodSelect = document.getElementById('reg-period');
        const selectedWeek = timePlan.find(w => w.weekNumber === weekNum);
        if (!selectedWeek) return;

        daySelect.innerHTML = '';
        let currentDate = new Date(selectedWeek.startDate.replace(/-/g, '/'));
        const daysOfWeek = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
        const formatDateToYYYYMMDD = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        for (let i = 0; i < 6; i++) {
            const dateString = formatDateToYYYYMMDD(currentDate);
            daySelect.innerHTML += `<option value="${dateString}">${daysOfWeek[i]} - ${formatDate(dateString)}</option>`;
            currentDate.setDate(currentDate.getDate() + 1);
        }

        periodSelect.innerHTML = '<option value="">-- Chọn tiết --</option>';
        for (let i = 1; i <= 10; i++) {
            const session = i <= 5 ? 'Sáng' : 'Chiều';
            const displayPeriod = i <= 5 ? i : i - 5;
            periodSelect.innerHTML += `<option value="${i}">Tiết ${displayPeriod} (${session})</option>`;
        }
    };

    const saveRegistration = async () => {
        const teacherId = document.getElementById('reg-teacher').value;
        const teacherData = teacherMap.get(teacherId);
        if (!teacherData) {
            showToast('Vui lòng chọn một giáo viên.', 'error');
            return;
        }

        const equipmentValue = document.getElementById('reg-equipment-input').value.trim();
        const className = document.getElementById('reg-class').value.trim();
        const date = document.getElementById('reg-day').value;
        const period = parseInt(document.getElementById('reg-period').value);

        // Thêm kiểm tra để đảm bảo người dùng đã chọn tiết
        if (isNaN(period)) {
            showToast('Vui lòng chọn một tiết học hợp lệ.', 'error');
            return;
        }

        // Validate required fields
        if (!teacherId || !date || !period || !className || !document.getElementById('reg-subject').value || !document.getElementById('reg-lesson-name').value || !equipmentValue) {
            showToast('Vui lòng điền đầy đủ các trường bắt buộc (*).', 'error');
            registerForm.reportValidity();
            return;
        }

        // Check for conflicts
        const q = query(collection(firestore, 'registrations'), where('date', '==', date), where('period', '==', period), where('className', '==', className.toUpperCase()));
        const snapshot = await getDocs(q);
        let conflictDoc = snapshot.docs.find(doc => doc.id !== currentEditingRegId);

        if (conflictDoc) {
            const conflictData = conflictDoc.data();
            document.getElementById('conflict-info-container').innerHTML = `
                <p>Lớp <strong>${conflictData.className}</strong> đã được đăng ký vào tiết này bởi:</p>
                <p><strong>Giáo viên:</strong> ${teacherMap.get(conflictData.teacherId)?.teacher_name || 'N/A'}</p>
                <p><strong>Môn học:</strong> ${conflictData.subject}</p>`;
            conflictWarningModal.style.display = 'flex';
            return;
        }

        const weekSelect = document.getElementById('reg-week');
        const finalWeekNumber = currentEditingRegId ? parseInt(weekSelect.value) : selectedWeekNumber;

        const registrationData = {
            teacherId: teacherId,
            // Không lưu teacherName nữa
            groupId: teacherData.group_id, // Add groupId
            schoolYear: currentSchoolYear,
            weekNumber: finalWeekNumber,
            date: date,
            period: period,
            subject: document.getElementById('reg-subject').value,
            className: className.toUpperCase(),
            lessonName: document.getElementById('reg-lesson-name').value,
            equipment: equipmentValue.split(',').map(item => item.trim()).filter(Boolean),
            teachingMethod: Array.from(document.querySelectorAll('#reg-method-container input:checked')).map(cb => cb.value)
        };

        try {
            if (currentEditingRegId) {
                await updateDoc(doc(firestore, 'registrations', currentEditingRegId), registrationData);
                showToast('Cập nhật đăng ký thành công!', 'success');
            } else {
                await addDoc(collection(firestore, 'registrations'), { ...registrationData, createdAt: serverTimestamp() });
                showToast('Đăng ký thành công!', 'success');
            }
            registerModal.style.display = 'none';
            loadAndRenderSchedule();
        } catch (error) {
            console.error("Lỗi khi lưu đăng ký:", error);
            showToast('Đã có lỗi xảy ra khi lưu.', 'error');
        }
    };

    const deleteRegistration = (regId) => {
        document.getElementById('confirm-delete-message').textContent = 'Bạn có chắc chắn muốn xóa lượt đăng ký này?';
        deleteFunction = async () => {
            try {
                await deleteDoc(doc(firestore, 'registrations', regId));
                showToast('Đã xóa đăng ký.', 'success');
                registerModal.style.display = 'none';
                loadAndRenderSchedule();
            } catch (error) {
                console.error("Lỗi khi xóa đăng ký:", error);
                showToast('Lỗi khi xóa đăng ký.', 'error');
            }
        };
        confirmDeleteModal.style.display = 'flex';
    };

    const populateBulkImportDaySelector = (weekNum) => {
        bulkImportDaySelect.innerHTML = '';
        const week = timePlan.find(w => w.weekNumber === parseInt(weekNum));
        if (!week) return;

        const daysOfWeek = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
        let currentDate = new Date(week.startDate.replace(/-/g, '/'));

        for (let i = 0; i < 6; i++) {
            const formatDateToYYYYMMDD = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            const dateString = formatDateToYYYYMMDD(currentDate);
            const dayIndex = currentDate.getDay();
            const option = document.createElement('option');
            option.value = dateString;
            option.textContent = `Tuần ${weekNum} - ${daysOfWeek[dayIndex]} - ${formatDate(dateString)}`;
            bulkImportDaySelect.appendChild(option);
            currentDate.setDate(currentDate.getDate() + 1);
        }
    };

    // Hàm xử lý chuỗi lớp học viết tắt, ví dụ: "11b8,6,9" -> ["11B8", "11B6", "11B9"]
    const expandClassNames = (classNamesStr) => {
        const parts = classNamesStr.split(/[,;]/).map(p => p.trim().toUpperCase()).filter(Boolean);
        if (parts.length <= 1) return parts;

        let lastPrefix = '';
        const expanded = parts.map(part => {
            const match = part.match(/^(\d+[A-Z])/); // Tìm tiền tố như "11B"
            if (match) {
                lastPrefix = match[0];
                return part;
            }
            return lastPrefix + part; // Ghép tiền tố đã lưu với phần còn lại, ví dụ "11B" + "6" -> "11B6"
        });
        return expanded;
    };

    // Hàm tính khoảng cách Levenshtein để so sánh chuỗi
    const levenshteinDistance = (s1, s2) => {
        s1 = s1.toLowerCase();
        s2 = s2.toLowerCase();
        const costs = [];
        for (let i = 0; i <= s1.length; i++) {
            let lastValue = i;
            for (let j = 0; j <= s2.length; j++) {
                if (i === 0) costs[j] = j;
                else {
                    if (j > 0) {
                        let newValue = costs[j - 1];
                        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                        costs[j - 1] = lastValue;
                        lastValue = newValue;
                    }
                }
            }
            if (i > 0) costs[s2.length] = lastValue;
        }
        return costs[s2.length];
    };

    const validateAndPreviewData = async (dataLines) => {
        const importDate = bulkImportDaySelect.value;
        if (!importDate || dataLines.length === 0) {
            showToast('Không có dữ liệu để xử lý.', 'info');
            return;
        }
        validRegistrationsToCreate = []; // Reset mảng đăng ký hợp lệ
        const selectedSession = document.getElementById('bulk-import-session').value;

        const existingRegsQuery = query(collection(firestore, 'registrations'), where('date', '==', importDate));
        const existingRegsSnapshot = await getDocs(existingRegsQuery);
        const existingRegsOnDate = existingRegsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        const previewRegistrations = []; // Mảng mới để lưu các đăng ký riêng lẻ cho việc xem trước
        const errors = [];
        const conflicts = [];

        const selectedWeek = timePlan.find(w => importDate >= w.startDate && importDate <= w.endDate);
        if (!selectedWeek) {
            showToast('Ngày được chọn không nằm trong tuần nào của kế hoạch năm học.', 'error');
            return;
        }

        for (let i = 0; i < dataLines.length; i++) {
            const parts = dataLines[i];
            const originalLineNumber = i + 1;
            let lineIssues = [];

            if (parts.length < 5) {
                lineIssues.push(`Không đủ thông tin (cần ít nhất 5 cột).`);
                previewRegistrations.push({ lineNumber: originalLineNumber, data: parts, issues: lineIssues, isInvalid: true });
                continue;
            }
            const [teacherName, classNamesStr, periodsStr, lessonName, equipmentStr, teachingMethodStr = ''] = parts.map(p => p.trim());
            const teacher = allTeachers.find(t => t.teacher_name.toLowerCase() === teacherName.toLowerCase());

            const rawPeriods = periodsStr.split(/[,;]/).map(p => parseInt(p.trim())).filter(p => !isNaN(p) && p > 0 && p <= 10);
            const rawClassNames = expandClassNames(classNamesStr);
            // Sửa lỗi: Tên bài dạy có thể chứa dấu phẩy, không nên tách ra.
            // Chỉ coi là nhiều bài dạy nếu có dấu chấm phẩy ";".
            const rawLessonNames = lessonName.split(';').map(l => l.trim()).filter(Boolean);

            let lessonPeriodClassMap = [];

            // Logic "zip" các mảng
            if (rawPeriods.length > 0 && rawClassNames.length > 0 && rawLessonNames.length > 0) {
                // Logic mới: Phân phối các tiết cho các lớp
                // Ví dụ: Lớp: 12B5, 12B10; Tiết: 1,2,4,5 -> 12B5 dạy tiết 1,2 và 12B10 dạy tiết 4,5
                const numClasses = rawClassNames.length;
                const numPeriods = rawPeriods.length;
                const periodsPerClass = Math.ceil(numPeriods / numClasses); // Số tiết trung bình cho mỗi lớp

                for (let i = 0; i < numClasses; i++) {
                    const className = rawClassNames[i];
                    // Xác định các tiết cho lớp hiện tại
                    const startPeriodIndex = i * periodsPerClass;
                    const endPeriodIndex = Math.min(startPeriodIndex + periodsPerClass, numPeriods);
                    const periodsForThisClass = rawPeriods.slice(startPeriodIndex, endPeriodIndex);

                    periodsForThisClass.forEach((period, periodIndex) => {
                        const lesson = rawLessonNames[i] ?? rawLessonNames[rawLessonNames.length - 1];
                        lessonPeriodClassMap.push({ className, period, lesson });
                    });
                }
            }

            if (!teacher || !teacher.uid) {
                lineIssues.push(`Không tìm thấy giáo viên "${teacherName}" hoặc giáo viên chưa có tài khoản.`);
                // Nếu không tìm thấy giáo viên, không cần xử lý thêm, báo lỗi và chuyển sang dòng tiếp theo
                previewRegistrations.push({ lineNumber: originalLineNumber, data: parts, issues: lineIssues, isInvalid: true });
                continue;
            }

            for (const item of lessonPeriodClassMap) {
                const { className, period, lesson } = item;
                
                // Điều chỉnh lại số tiết nếu người dùng chọn buổi chiều
                const finalPeriod = selectedSession === 'afternoon' ? period + 5 : period;

                // Ưu tiên lấy môn học đã gán cho giáo viên, nếu không có thì mới suy luận từ tên tổ
                const subject = teacher.subject || 
                                (groupMap.get(teacher.group_id)?.group_name.replace(/^Tổ\s*/, '').split(/\s*-\s*/)[0].trim()) || 
                                'Chưa xác định';
                const newRegData = { teacherId: teacher.uid, teacherName: teacher.teacher_name, groupId: teacher.group_id, schoolYear: currentSchoolYear, weekNumber: selectedWeek.weekNumber, date: importDate, period: finalPeriod, subject: subject, className: className, lessonName: lesson, equipment: equipmentStr.split(/[,+]/).map(item => item.trim()).filter(Boolean), teachingMethod: teachingMethodStr.split(/[&,;]/).map(item => item.trim()).filter(Boolean), createdAt: serverTimestamp() };

                // Xử lý thông minh cho PPDH và thiết bị
                const ppdhMapping = {
                    'CNTT': 'Công nghệ thông tin',
                    'TBDH': 'Thiết bị dạy học',
                    'TH': 'Thực hành'
                };
                const validPpdhValues = Object.values(ppdhMapping);
                const finalPpdh = new Set();
                newRegData.teachingMethod.forEach(method => {
                    const upperMethod = method.toUpperCase();
                    if (ppdhMapping[upperMethod]) {
                        finalPpdh.add(ppdhMapping[upperMethod]);
                    } else if (!validPpdhValues.includes(method)) {
                        // Đề xuất sửa lỗi chính tả cho PPDH
                        let bestMatch = '';
                        let minDistance = 3; // Chỉ xem xét nếu khoảng cách nhỏ
                        for (const key in ppdhMapping) {
                            const distance = levenshteinDistance(upperMethod, key);
                            if (distance < minDistance) {
                                minDistance = distance;
                                bestMatch = ppdhMapping[key];
                            }
                        }
                        if (bestMatch) finalPpdh.add(bestMatch);
                    }
                });
                newRegData.teachingMethod = [...finalPpdh];

                // Tự động xử lý thiết bị nếu PPDH là CNTT
                if (newRegData.teachingMethod.includes('Công nghệ thông tin')) {
                    // Nếu cột thiết bị trống, tự động điền 'Tivi'
                    if (newRegData.equipment.length === 0) {
                        newRegData.equipment.push('Tivi');
                    } else {
                        // Nếu không trống, sửa các từ viết tắt như 'TV' thành 'Tivi'
                        newRegData.equipment = newRegData.equipment.map(eq => {
                            const lowerEq = eq.toLowerCase();
                            if (lowerEq === 'tv' || lowerEq === 'tiv') return 'Tivi';
                            return eq;
                        });
                    }
                }

                // Bỏ qua các tiết không thuộc buổi đã chọn
                if ((selectedSession === 'morning' && newRegData.period > 5) || (selectedSession === 'afternoon' && newRegData.period < 6)) {
                    continue;
                }

                const existingConflict = existingRegsOnDate.find(reg => reg.period === finalPeriod && (reg.teacherId === teacher.uid || reg.className === className));
                const internalConflict = validRegistrationsToCreate.find(reg => reg.period === finalPeriod && (reg.teacherId === teacher.uid || reg.className === className));
                
                let currentRegIssues = [...lineIssues]; 
                if (existingConflict) {
                    const existingTeacherName = teacherMap.get(existingConflict.teacherId)?.teacher_name || 'N/A';
                    currentRegIssues.push(`Trùng lịch với đăng ký đã có (Lớp ${className}, Tiết ${finalPeriod}, GV ${existingTeacherName}).`);
                }
                if (existingConflict) currentRegIssues.push(`Trùng lịch với đăng ký đã có (Lớp ${className}, Tiết ${finalPeriod}, GV ${existingConflict.teacherName}).`);
                if (internalConflict) currentRegIssues.push(`Trùng lịch với dòng khác trong file (Lớp ${className}, Tiết ${finalPeriod}).`);

                const hasConflict = !!existingConflict || !!internalConflict;
                const isInvalid = lineIssues.length > 0 || hasConflict;

                previewRegistrations.push({
                    lineNumber: originalLineNumber,
                    data: [teacherName, className, period, lesson, newRegData.equipment.join(', '), newRegData.teachingMethod.join(', ')],
                    issues: currentRegIssues,
                    isInvalid: isInvalid
                });

                if (!isInvalid) {
                    validRegistrationsToCreate.push(newRegData);
                }
            }
        }

        // Always show the preview modal, regardless of errors.
        const errorListContainer = document.getElementById('bulk-import-error-section'); // Sửa lại ID cho đúng
        const previewContainer = document.getElementById('bulk-import-preview-container');
        const confirmBtn = document.getElementById('confirm-bulk-import-btn');
        // const errorSection = document.getElementById('bulk-import-error-section'); // Biến này bị trùng lặp, có thể bỏ

        const allIssues = previewRegistrations.flatMap(reg => reg.issues.map(issue => `Dòng ${reg.lineNumber}: ${issue}`));
        const hasErrors = allIssues.length > 0;

        if (hasErrors) {
            // Tạo một list ul bên trong div error
            errorListContainer.innerHTML = `<h4>Danh sách lỗi:</h4><ul>${[...new Set(allIssues)].map(issue => `<li>${issue}</li>`).join('')}</ul>`;
            errorListContainer.style.display = 'block';
            confirmBtn.style.display = 'none'; // Hide confirm button if there are errors
        } else {
            errorListContainer.style.display = 'none'; // Hide error section if no errors
            confirmBtn.style.display = 'inline-block'; // Show confirm button
        }

        let tableHTML = `<table class="preview-table"><thead><tr><th>Dòng gốc</th><th>Tên GV</th><th>Lớp</th><th>Tiết</th><th>Bài dạy</th><th>Thiết bị</th><th>PPDH</th></tr></thead><tbody>`;
        previewRegistrations.forEach(reg => {
            const rowClass = reg.isInvalid ? 'class="has-error"' : 'class="is-valid"';
            const cellsHTML = reg.data.map(cell => `<td contenteditable="false">${cell}</td>`).join('');
            tableHTML += `<tr ${rowClass} data-line-number="${reg.lineNumber}"><td>${reg.lineNumber}</td>${cellsHTML}</tr>`;
        });
        tableHTML += `</tbody></table>`;
        previewContainer.innerHTML = tableHTML;

        bulkImportModal.style.display = 'none'; // Hide the initial import modal
        bulkImportPreviewModal.style.display = 'flex'; // Show the preview modal
    };

    const processBulkImport = async () => {
        const importText = document.getElementById('bulk-import-input').value.trim();
        if (!importText) {
            showToast('Vui lòng nhập dữ liệu để xử lý.', 'error');
        }
        // Lưu các lựa chọn vào localStorage
        const selectedDay = bulkImportDaySelect.value;
        const selectedSession = document.getElementById('bulk-import-session').value;
        localStorage.setItem('bulkImport_lastDay', selectedDay);
        localStorage.setItem('bulkImport_lastSession', selectedSession);
        const lines = importText.split('\n').filter(line => line.trim() !== '').map(line => line.split('\t'));
        await validateAndPreviewData(lines);
    };

    const commitBulkImport = async () => {
        if (validRegistrationsToCreate.length === 0) {
            showToast('Không có dữ liệu hợp lệ để nhập.', 'info');
            return;
        }
        try {
            const batch = writeBatch(firestore);
            validRegistrationsToCreate.forEach(regData => {
                const newRegRef = doc(collection(firestore, 'registrations'));
                batch.set(newRegRef, regData);
            });
            await batch.commit();
            showToast(`Nhập thành công ${validRegistrationsToCreate.length} lượt đăng ký!`, 'success');
            bulkImportPreviewModal.style.display = 'none';
            loadAndRenderSchedule();
        } catch (error) {
            console.error("Lỗi khi ghi dữ liệu hàng loạt:", error);
            showToast('Đã có lỗi xảy ra khi lưu dữ liệu vào cơ sở dữ liệu.', 'error');
        }
    };

    // --- EVENT LISTENERS ---
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
                updateSelectedWeek(e.target.dataset.week);
                weekDropdown.style.display = 'none';
            }
        });
        document.addEventListener('click', (e) => {
            if (!weekSelectorWrapper.contains(e.target)) weekDropdown.style.display = 'none';
        });

        // Filter listeners
        [filterGroupSelect, filterSubjectSelect].forEach(select => {
            select.addEventListener('change', () => {
                updateDependentFilters();
                renderWeeklySchedule(timePlan.find(w => w.weekNumber === selectedWeekNumber)); // Vẽ lại lịch với bộ lọc mới
            });
        });

        // Listener riêng cho bộ lọc giáo viên để không trigger vòng lặp
        filterTeacherSelect.addEventListener('change', () => {
            renderWeeklySchedule(timePlan.find(w => w.weekNumber === selectedWeekNumber));
        });

        // Schedule clicks
        scheduleContainer.addEventListener('click', (e) => {
            const regInfo = e.target.closest('.registration-info');
            const slot = e.target.closest('.slot');

            if (regInfo) { // Click on an existing registration to edit
                openRegisterModal(regInfo.dataset.regId);
            } else if (slot) { // Click on an empty part of a slot to add
                openRegisterModal(null, slot.dataset.date, slot.dataset.period);
            }
        });

        // Bulk import modal
        bulkImportBtn.addEventListener('click', () => {
            document.getElementById('bulk-import-input').value = '';

            const lastDay = localStorage.getItem('bulkImport_lastDay');
            const lastSession = localStorage.getItem('bulkImport_lastSession');

            // Luôn sử dụng tuần đang được chọn ở giao diện chính
            if (selectedWeekNumber) {
                populateBulkImportDaySelector(selectedWeekNumber);
            }

            // Nếu chưa có lựa chọn nào được lưu, đặt lại về mặc định
            if (!lastDay || !lastSession) {
                bulkImportDaySelect.selectedIndex = 0; // Mặc định là Thứ 2
                document.getElementById('bulk-import-session').value = 'morning'; // Mặc định là Sáng
            } else { // Nếu không, giữ lại lựa chọn cũ
                bulkImportDaySelect.value = lastDay;
                document.getElementById('bulk-import-session').value = lastSession;
            }
            bulkImportModal.style.display = 'flex';
        });
        cancelBulkImportBtn.addEventListener('click', () => bulkImportModal.style.display = 'none');

        // Thêm sự kiện cho nút điều hướng ngày
        document.getElementById('prev-day-bulk-import').addEventListener('click', () => {
            const currentIndex = bulkImportDaySelect.selectedIndex;
            if (currentIndex > 0) {
                bulkImportDaySelect.selectedIndex = currentIndex - 1;
            }
        });
        document.getElementById('next-day-bulk-import').addEventListener('click', () => {
            const currentIndex = bulkImportDaySelect.selectedIndex;
            if (currentIndex < bulkImportDaySelect.options.length - 1) {
                bulkImportDaySelect.selectedIndex = currentIndex + 1;
            }
        });
        processBulkImportBtn.addEventListener('click', processBulkImport);

        // Bulk Import Preview/Error Modal
        closeBulkPreviewModalBtn.addEventListener('click', () => {
            bulkImportPreviewModal.style.display = 'none'; // Ẩn modal xem trước
            bulkImportModal.style.display = 'flex'; // Hiển thị lại modal nhập liệu
        });

        // Chức năng sửa trực tiếp đã bị loại bỏ, nên vô hiệu hóa nút này để tránh nhầm lẫn
        recheckBulkImportBtn.disabled = true;
        recheckBulkImportBtn.title = 'Chức năng này không còn được hỗ trợ. Vui lòng hủy và nhập lại từ đầu.';

        confirmBulkImportBtn.addEventListener('click', commitBulkImport);

        // Register Modal buttons
        document.getElementById('save-register-btn').addEventListener('click', (e) => {
            e.preventDefault();
            saveRegistration();
        });
        document.getElementById('delete-register-btn').addEventListener('click', () => {
            if (currentEditingRegId) deleteRegistration(currentEditingRegId);
        });
        document.getElementById('cancel-register-modal').addEventListener('click', () => registerModal.style.display = 'none');
        // registerModal.addEventListener('click', (e) => {
        //     if (e.target === registerModal) registerModal.style.display = 'none';
        // });

        // Confirm delete modal
        document.getElementById('confirm-delete-btn').addEventListener('click', () => {
            if (typeof deleteFunction === 'function') deleteFunction();
            confirmDeleteModal.style.display = 'none';
            deleteFunction = null;
        });
        document.getElementById('cancel-delete-btn').addEventListener('click', () => {
            confirmDeleteModal.style.display = 'none';
            deleteFunction = null;
        });

        // Conflict modal
        document.getElementById('close-conflict-modal').addEventListener('click', () => {
            conflictWarningModal.style.display = 'none';
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
                    if (method === 'Công nghệ thông tin') {
                        currentTeacher.cnttCount++;
                    } else if (method === 'Thiết bị dạy học') {
                        currentTeacher.tbCount++;
                    } else if (method === 'Thực hành') {
                        currentTeacher.thCount++;
                    }
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
                        <th rowspan="2">STT</th>
                        <th rowspan="2">Giáo viên</th>
                        <th rowspan="2">Tổ chuyên môn</th>
                        <th colspan="3">PPDH</th>
                        <th rowspan="2">Tổng</th>
                    </tr>
                    <tr>
                        <th>CNTT</th>
                        <th>TBDH</th>
                        <th>TH</th>
                    </tr>
                </thead>
                <tbody>`;

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
    
    const setupLegendHighlighting = () => {
        legendContainer.addEventListener('mouseover', (e) => {
            const legendItem = e.target.closest('.legend-item');
            if (!legendItem) return;

            const type = legendItem.dataset.type;
            const value = legendItem.dataset.value;

            if (!type || !value) return;

            scheduleContainer.classList.add('dimmed');

            document.querySelectorAll('.registration-info').forEach(regEl => {
                const regId = regEl.dataset.regId;
                const registration = allRegistrations.find(r => r.id === regId);
                if (!registration) return;

                let match = false;
                switch (type) {
                    case 'group':   match = registration.groupName === value; break;
                    case 'subject': match = registration.subject === value; break;
                    // Luôn tra cứu tên từ teacherMap để so sánh
                    case 'teacher': match = (teacherMap.get(registration.teacherId)?.teacher_name || '') === value; break;
                }

                if (match) {
                    regEl.classList.add('highlighted');
                }
            });
        });

        legendContainer.addEventListener('mouseout', () => {
            scheduleContainer.classList.remove('dimmed');
            document.querySelectorAll('.registration-info.highlighted').forEach(regEl => {
                regEl.classList.remove('highlighted');
            });
        });
    };

    const setupExtraModalFeatures = () => {
        const getLastRegBtn = document.getElementById('get-last-reg-btn');
        getLastRegBtn.addEventListener('click', async () => {
            const selectedTeacherId = document.getElementById('reg-teacher').value;
            if (!selectedTeacherId) {
                showToast('Vui lòng chọn một giáo viên trước.', 'info');
                return;
            }

            try {
                const q = query(
                    collection(firestore, 'registrations'),
                    where('teacherId', '==', selectedTeacherId),
                    orderBy('createdAt', 'desc'),
                    limit(1)
                );
                const snapshot = await getDocs(q);

                if (snapshot.empty) {
                    showToast('Không tìm thấy lần đăng ký nào trước đó cho giáo viên này.', 'info');
                    return;
                }

                const lastReg = snapshot.docs[0].data();

                // Điền thông tin vào form, không điền ngày và tiết
                document.getElementById('reg-subject').value = lastReg.subject || '';
                document.getElementById('reg-class').value = lastReg.className || '';
                document.getElementById('reg-lesson-name').value = lastReg.lessonName || '';
                document.getElementById('reg-equipment-input').value = lastReg.equipment?.join(', ') || '';

                document.querySelectorAll('#reg-method-container input[type="checkbox"]').forEach(checkbox => {
                    checkbox.checked = lastReg.teachingMethod && lastReg.teachingMethod.includes(checkbox.value);
                });

                showToast('Đã lấy thông tin thành công!', 'success');
            } catch (error) {
                console.error("Lỗi khi lấy thông tin đăng ký trước đó:", error);
                showToast('Không thể lấy thông tin. Vui lòng thử lại.', 'error');
            }
        });

        // Tự động thêm/xóa 'Tivi' khi chọn PPDH 'Công nghệ thông tin'
        const methodContainer = document.getElementById('reg-method-container');
        methodContainer.addEventListener('change', (e) => {
            if (e.target.type === 'checkbox' && e.target.value === 'Công nghệ thông tin') {
                const equipmentInput = document.getElementById('reg-equipment-input');
                let equipmentList = equipmentInput.value.trim()
                    ? equipmentInput.value.split(',').map(item => item.trim())
                    : [];

                const tiviExists = equipmentList.some(item => item.toLowerCase() === 'tivi');

                if (e.target.checked) {
                    // Nếu được check và 'Tivi' chưa có, thêm vào
                    if (!tiviExists) {
                        equipmentList.push('Tivi');
                    }
                } else {
                    // Nếu bỏ check, xóa 'Tivi'
                    equipmentList = equipmentList.filter(item => item.toLowerCase() !== 'tivi');
                }
                equipmentInput.value = equipmentList.join(', ');
            }
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

            // Highlight selected week in dropdown
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
    setupExtraModalFeatures();
});