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
    const filterMethodSelect = document.getElementById('filter-method-select');
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
    let allMethods = new Set();
    let allSubjects = new Set();
    let allRegistrations = [];
    let selectedWeekNumber = null;
    let currentEditingRegId = null;
    let deleteFunction = null;

    const slotDetailModal = document.getElementById('slot-detail-modal');

    const getSubjectsFromGroupName = (groupName) => {
        if (!groupName) return [];
        const cleanedName = groupName.replace(/^Tổ\s*/, '').trim();
        // Tạm thời thay thế "Giáo dục thể chất - QP" để không bị split sai
        const placeholder = 'TDQP_PLACEHOLDER';
        return cleanedName.replace('Giáo dục thể chất - QP', placeholder)
                          .split(/\s*-\s*/)
                          .map(s => s.trim().replace(placeholder, 'Giáo dục thể chất - QP'));
    };

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

    const populateModalSelectors = async () => {
        // --- NEW LOGIC: Load all subjects from the 'subjects' collection ---
        const subjectsQuery = query(collection(firestore, 'subjects'), where('schoolYear', '==', currentSchoolYear), orderBy('name'));
        const subjectsSnapshot = await getDocs(subjectsQuery);
        allSubjects.clear();
        subjectsSnapshot.forEach(doc => allSubjects.add(doc.data().name));

        // Populate PPDH (no change needed here)
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

        const subjectSelect = document.getElementById('reg-subject');
        // Populate subjects from the new `allSubjects` set
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
        filterMethodSelect.innerHTML = '<option value="all">Tất cả</option>';
        [...allMethods].sort().forEach(method => {
            filterMethodSelect.innerHTML += `<option value="${method}">${method}</option>`;
        });

        // NEW: Populate teacher filter initially with all teachers
        filterTeacherSelect.innerHTML = '<option value="all">Tất cả</option>';
        allTeachers.forEach(teacher => {
            const option = document.createElement('option');
            option.value = teacher.uid;
            option.textContent = teacher.teacher_name;
            filterTeacherSelect.appendChild(option);
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
                // Lọc các môn học trong `allSubjects` dựa trên tên tổ
                const subjectsInGroup = getSubjectsFromGroupName(selectedGroup.group_name);
                allSubjects.forEach(sub => {
                    if (subjectsInGroup.includes(sub)) availableSubjects.add(sub);
                });
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
        const finalSelectedSubject = subjectSelect.value; // Lấy giá trị môn học mới nhất
        teacherSelect.innerHTML = '<option value="all">Tất cả</option>';
        let teachersToShow = allTeachers; // Bắt đầu với tất cả giáo viên

        // Lọc theo Tổ chuyên môn nếu một tổ cụ thể được chọn
        if (selectedGroupId !== 'all') {
            teachersToShow = teachersToShow.filter(t => t.group_id === selectedGroupId);
        }

        // Lọc theo Môn học nếu một môn cụ thể được chọn
        // Điều này sẽ hoạt động đúng ngay cả khi Tổ là "Tất cả"
        if (finalSelectedSubject !== 'all') { 
            teachersToShow = teachersToShow.filter(t => t.subject === finalSelectedSubject);
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
        // SỬA LỖI: Nếu giáo viên đã chọn không còn trong danh sách, đặt lại bộ lọc về "Tất cả"
        else {
            teacherSelect.value = 'all';
        }
    };

    const loadLessonSuggestions = async () => {
        const subject = document.getElementById('reg-subject').value;
        const className = document.getElementById('reg-class').value;
        const suggestionsDatalist = document.getElementById('lesson-suggestions');
        if (!suggestionsDatalist) return;

        suggestionsDatalist.innerHTML = ''; // Xóa gợi ý cũ

        if (!subject || !className || !currentSchoolYear) return;

        const gradeMatch = className.match(/^(10|11|12)/);
        if (!gradeMatch) return;
        const grade = parseInt(gradeMatch[0]);

        try {
            const q = query(collection(firestore, 'syllabuses'),
                where('schoolYear', '==', currentSchoolYear),
                where('subject', '==', subject),
                where('grade', '==', grade)
            );
            const snapshot = await getDocs(q);
            snapshot.forEach(doc => {
                const syllabus = doc.data();
                syllabus.lessons?.forEach(lesson => {
                    suggestionsDatalist.innerHTML += `<option value="${lesson.lessonName}"></option>`;
                });
            });
        } catch (error) { console.warn("Không thể tải gợi ý bài học:", error); }
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
            // Lấy giá trị từ các bộ lọc
            const selectedGroupId = filterGroupSelect.value;
            const selectedSubjectId = filterSubjectSelect.value;
            const selectedTeacherId = filterTeacherSelect.value;
            const selectedMethod = filterMethodSelect.value;

            // Bắt đầu xây dựng truy vấn động
            let regsQuery = query(
                collection(firestore, 'registrations'),
                where('schoolYear', '==', currentSchoolYear),
                where('weekNumber', '==', selectedWeekNumber)
            );

            // Thêm các điều kiện lọc vào truy vấn nếu chúng được chọn
            if (selectedGroupId !== 'all') {
                regsQuery = query(regsQuery, where('groupId', '==', selectedGroupId));
            }
            if (selectedSubjectId !== 'all') {
                regsQuery = query(regsQuery, where('subject', '==', selectedSubjectId));
            }
            if (selectedTeacherId !== 'all') {
                regsQuery = query(regsQuery, where('teacherId', '==', selectedTeacherId));
            }

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

            // Bộ lọc PPDH vẫn được áp dụng ở client do giới hạn của Firestore
            if (selectedMethod !== 'all') {
                allRegistrations = allRegistrations.filter(reg => 
                    Array.isArray(reg.teachingMethod) && reg.teachingMethod.includes(selectedMethod)
                );
            }
            renderWeeklySchedule(selectedWeek);
        } catch (error) {
            console.error("Lỗi tải lịch đăng ký:", error);
            scheduleContainer.innerHTML = '<p class="error-message">Không thể tải lịch đăng ký. Vui lòng kiểm tra cấu hình Firestore Index.</p>';
        }
    };

    const getFilteredRegistrations = () => {
        // Hàm này không còn cần thiết vì việc lọc đã được chuyển vào `loadAndRenderSchedule`
        return allRegistrations;
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

        // --- NEW: Render aggregated slot summary ---
        const renderSlotSummary = (regs) => {
            if (regs.length === 0) return '';
        
            const count = regs.length;
        
            // Đếm số lần xuất hiện của mỗi PPDH
            const methodCounts = regs.reduce((acc, reg) => {
                (reg.teachingMethod || []).forEach(method => {
                acc[method] = (acc[method] || 0) + 1;
                });
                return acc;
            }, {});
        
            // Lấy tối đa 3 PPDH phổ biến nhất
            const topMethods = Object.keys(methodCounts).sort((a, b) => methodCounts[b] - methodCounts[a]).slice(0, 3);
        
            const methodIcons = {
                'Công nghệ thông tin': '<i class="fas fa-desktop method-icon-summary icon-cntt" title="CNTT"></i>',
                'Thiết bị dạy học': '<i class="fas fa-microscope method-icon-summary icon-tbdh" title="TBDH"></i>',
                'Thực hành': {
                    default: '<i class="fas fa-flask method-icon-summary icon-th" title="Thực hành"></i>',
                    'Giáo dục thể chất - QP': '<i class="fas fa-futbol method-icon-summary icon-th" title="Thực hành GDTC-QP"></i>'
                }
            };
        
            const iconsHTML = topMethods.map(method => {
                if (method === 'Thực hành') {
                    // Kiểm tra xem có đăng ký nào là môn GDTC-QP trong slot này không
                    const hasQpReg = regs.some(r => r.subject === 'Giáo dục thể chất - QP' && r.teachingMethod?.includes('Thực hành'));
                    return hasQpReg ? methodIcons['Thực hành']['Giáo dục thể chất - QP'] : methodIcons['Thực hành'].default;
                }
                return methodIcons[method] || '';
            }).join('');
            
            return `
                <div class="slot-summary">
                    <div class="slot-summary-count">${count} lượt</div>
                    <div class="slot-summary-icons">${iconsHTML}</div>
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
                    const slotHasRegs = regsInSlot.length > 0;
                    desktopHTML += `<td class="slot ${slotHasRegs ? 'has-regs' : ''}" data-date="${date}" data-period="${period}">`;
                    desktopHTML += renderSlotSummary(regsInSlot);
                    desktopHTML += `</td>`;
                });
                desktopHTML += `</tr>`;
            }
            if (session === 'Sáng') {
                desktopHTML += `<tr class="session-separator"><td colspan="8"></td></tr>`;
            }
        });

        desktopHTML += `</tbody></table></div>`;

        // --- MOBILE VIEW ---
        const renderDaySummary = (regs) => {
            if (regs.length === 0) {
                return `<span class="day-summary-info">(0 lượt)</span>`;
            }
            const count = regs.length;
            const methodCounts = regs.reduce((acc, reg) => {
                (reg.teachingMethod || []).forEach(method => {
                    acc[method] = (acc[method] || 0) + 1;
                });
                return acc;
            }, {});
            const topMethods = Object.keys(methodCounts).sort((a, b) => methodCounts[b] - methodCounts[a]).slice(0, 3);
            const methodIcons = {
                'Công nghệ thông tin': '<i class="fas fa-desktop method-icon-summary icon-cntt" title="CNTT"></i>',
                'Thiết bị dạy học': '<i class="fas fa-microscope method-icon-summary icon-tbdh" title="TBDH"></i>',
                'Thực hành': {
                    default: '<i class="fas fa-flask method-icon-summary icon-th" title="Thực hành"></i>',
                    'Giáo dục thể chất - QP': '<i class="fas fa-futbol method-icon-summary icon-th" title="Thực hành GDTC-QP"></i>'
                }
            };
            const iconsHTML = topMethods.map(method => {
                if (method === 'Thực hành') {
                    const hasQpReg = regs.some(r => r.subject === 'Giáo dục thể chất - QP' && r.teachingMethod?.includes('Thực hành'));
                    return hasQpReg ? methodIcons['Thực hành']['Giáo dục thể chất - QP'] : methodIcons['Thực hành'].default;
                }
                return methodIcons[method] || '';
            }).join('');
            return `<div class="day-summary-container"><span class="day-summary-count">${count} lượt</span><div class="day-summary-icons">${iconsHTML}</div></div>`;
        };

        let mobileHTML = `<div class="mobile-schedule">`;
        weekDates.forEach((date, index) => {
            const regsForDay = filteredRegistrations.filter(r => r.date === date);

            mobileHTML += `
                <details class="mobile-day-card">
                    <summary class="mobile-day-header">
                        <span class="day-name">${daysOfWeek[index]} - ${formatDate(date)}</span>
                        ${renderDaySummary(regsForDay)}
                    </summary>
                    <div class="mobile-day-body">`;
            
            let hasRegsThisDay = false;
            for (let period = 1; period <= 10; period++) {
                const regsInSlot = regsForDay.filter(r => r.period === period);
                if (regsInSlot.length > 0) {
                    hasRegsThisDay = true;
                    const session = period <= 5 ? 'Sáng' : 'Chiều';
                    const displayPeriod = period <= 5 ? period : period - 5;

                    mobileHTML += `<div class="mobile-slot" data-date="${date}" data-period="${period}">`;
                    mobileHTML += `<div class="mobile-period-info">Tiết ${displayPeriod}<br/>(${session})</div>`;
                    // Tái sử dụng hàm renderSlotSummary cho giao diện mobile
                    mobileHTML += `<div class="mobile-slot-summary-container">`;
                    mobileHTML += renderSlotSummary(regsInSlot);
                    mobileHTML += `</div></div>`;
                }
            }

            if (!hasRegsThisDay) {
                mobileHTML += `<p class="no-registrations-mobile">Không có lượt đăng ký nào.</p>`;
            }

            mobileHTML += `</div></details>`;
        });
        mobileHTML += `</div>`;

        // Combine both views into the container
        scheduleContainer.innerHTML = desktopHTML + mobileHTML;
    };

    // --- NEW: Slot Detail Modal ---
    const openSlotDetailModal = (date, period) => {
        // Lấy danh sách đăng ký đã được lọc theo các filter đang chọn
        const filteredRegistrations = getFilteredRegistrations();
        // Sau đó mới lọc các đăng ký trong tiết học cụ thể từ danh sách đã lọc đó
        const regsInSlot = filteredRegistrations.filter(r => r.date === date && r.period === parseInt(period));
        const modalTitle = document.getElementById('slot-detail-title');
        const modalBody = document.getElementById('slot-detail-body');
        const displayPeriod = period > 5 ? period - 5 : period;
        const session = period > 5 ? 'Chiều' : 'Sáng';

        modalTitle.textContent = `Chi tiết Tiết ${displayPeriod} (${session}) - Ngày ${formatDate(date)}`;

        if (regsInSlot.length === 0) {
            modalBody.innerHTML = '<p class="no-regs-in-slot">Chưa có lượt đăng ký nào cho tiết học này.</p>';
        } else {
            let tableHTML = `<table class="slot-detail-table">
                <thead>
                    <tr>
                        <th>GV</th>
                        <th>Môn</th>
                        <th>Lớp</th>
                        <th>Bài dạy</th>
                        <th>Thiết bị</th>
                        <th>PPDH</th>
                        <th>Hành động</th>
                    </tr>
                </thead>
                <tbody>`;
            
            regsInSlot.forEach(reg => {
                const teacherName = teacherMap.get(reg.teacherId)?.teacher_name || 'N/A';
                tableHTML += `
                    <tr data-reg-id="${reg.id}">
                        <td>${teacherName}</td>
                        <td>${reg.subject}</td>
                        <td>${reg.className}</td>
                        <td>${reg.lessonName}</td>
                        <td>${reg.equipment?.join(', ') || ''}</td>
                        <td>${reg.teachingMethod?.join(', ') || ''}</td>
                        <td class="item-actions">
                            <button class="icon-button edit-reg-in-modal" title="Sửa"><i class="fas fa-pencil-alt"></i></button>
                            <button class="icon-button delete-reg-in-modal" title="Xóa"><i class="fas fa-trash-alt"></i></button>
                        </td>
                    </tr>
                `;
            });

            tableHTML += `</tbody></table>`;
            modalBody.innerHTML = tableHTML;
        }

        // Cập nhật lại data-attribute cho nút "Thêm mới" để biết đang thêm cho slot nào
        const addNewBtn = document.getElementById('add-new-in-slot-modal-btn');
        addNewBtn.dataset.date = date;
        addNewBtn.dataset.period = period;

        slotDetailModal.style.display = 'flex';
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
            conflictWarningModal.querySelector('#conflict-warning-title').textContent = `Cảnh báo: Lớp đã được đăng ký`;
            conflictWarningModal.querySelector('.conflict-info-container').innerHTML = `
                <p><strong>Giáo viên:</strong> ${teacherMap.get(conflictData.teacherId)?.teacher_name || 'N/A'}</p>
                <p><strong>Môn học:</strong> ${conflictData.subject}</p>
                <p><strong>Lớp:</strong> ${conflictData.className} (Tiết ${conflictData.period > 5 ? conflictData.period - 5 : conflictData.period}, ${formatDate(conflictData.date)})</p>`;
            conflictWarningModal.style.display = 'flex';
            return;
        }

        // --- LOGIC MỚI: KIỂM TRA PHÒNG HỌC BỘ MÔN KHI ĐĂNG KÝ THỰC HÀNH ---
        const selectedMethods = Array.from(document.querySelectorAll('#reg-method-container input:checked')).map(cb => cb.value);
        const subject = document.getElementById('reg-subject').value;
        let labUsage = null;

        if (selectedMethods.includes('Thực hành')) {
            const labsQuery = query(collection(firestore, 'labs'), where('schoolYear', '==', currentSchoolYear), where('subject', '==', subject), limit(1));
            const labsSnapshot = await getDocs(labsQuery);

            if (!labsSnapshot.empty) {
                const labData = { id: labsSnapshot.docs[0].id, ...labsSnapshot.docs[0].data() };

                const occupiedQuery = query(
                    collection(firestore, 'registrations'),
                    where('date', '==', date),
                    where('period', '==', period),
                    where('labUsage.labId', '==', labData.id)
                );
                const occupiedSnapshot = await getDocs(occupiedQuery);

                const conflictLabDoc = occupiedSnapshot.docs.find(doc => doc.id !== currentEditingRegId);

                // THAY ĐỔI LOGIC: Không chặn lưu mà tự động chuyển thành "Thực hành trên lớp"
                if (conflictLabDoc) {
                    labUsage = { status: 'in_class', reason: `Phòng thực hành ${labData.name} đã được sử dụng.` };
                } else {
                    labUsage = { status: 'occupied', labId: labData.id, labName: labData.name };
                }
            } else {
                // Môn học không có phòng thực hành
                labUsage = { status: 'in_class', reason: 'Môn học không có phòng thực hành riêng.' };
            }
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
            labUsage: labUsage, // <-- DỮ LIỆU MỚI
            equipment: equipmentValue.split(',').map(item => item.trim()).filter(Boolean),
            teachingMethod: selectedMethods
        };

        try {
            if (currentEditingRegId) {
                await updateDoc(doc(firestore, 'registrations', currentEditingRegId), registrationData);
                showToast('Cập nhật đăng ký thành công!', 'success');

                // Hiển thị thông báo nếu thực hành trên lớp do phòng đã có người dùng
                if (labUsage?.status === 'in_class' && labUsage.reason && labUsage.reason.includes('đã được sử dụng')) {
                    showToast(labUsage.reason + " Tiết học được ghi nhận là 'Thực hành trên lớp'.", 'info', 8000);
                }
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
            // Tìm tiền tố dạng "10A", "12B"
            const match = part.match(/^(\d+[A-Z])/);
            if (match) {
                lastPrefix = match[0];
                return part;
            }
            return lastPrefix + part; // Ghép tiền tố đã lưu với phần còn lại, ví dụ "11B" + "6" -> "11B6"
        });
        return expanded;
    };

    const validateAndPreviewData = async (dataLines) => {
        // --- BƯỚC 1: Chuẩn bị dữ liệu ban đầu ---
        const importDate = bulkImportDaySelect.value;
        if (!importDate || dataLines.length === 0) {
            showToast('Không có dữ liệu để xử lý.', 'info');
            return; // Dừng hàm nếu không có dữ liệu
        }
        validRegistrationsToCreate = []; // Reset mảng đăng ký hợp lệ
        const sessionToggleButton = document.getElementById('session-toggle-btn');
        const selectedSession = sessionToggleButton ? sessionToggleButton.dataset.session : 'morning';

        // Tải các đăng ký đã có trong ngày để kiểm tra trùng lặp
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
            // --- BƯỚC 2: Xử lý từng dòng dữ liệu ---
            const parts = dataLines[i];
            const originalLineNumber = i + 1;
            const lineIssues = [];

            if (parts.length < 5) {
                lineIssues.push(`Không đủ thông tin (cần ít nhất 5 cột).`);
                previewRegistrations.push({ lineNumber: originalLineNumber, data: parts, issues: lineIssues, isInvalid: true });
                continue;
            }

            // Tách các cột từ dòng dữ liệu
            const [teacherName, classNamesStr, periodsStr, lessonName, equipmentStr, teachingMethodStr = ''] = parts.map(p => p.trim());
            let teacher = allTeachers.find(t => t.teacher_name.toLowerCase() === teacherName.toLowerCase());

            if (!teacher || !teacher.uid) {
                lineIssues.push(`Không tìm thấy giáo viên "${teacherName}".`);
                previewRegistrations.push({ lineNumber: originalLineNumber, data: parts, issues: lineIssues, isInvalid: true });
                continue;
            }

            // --- BƯỚC 3: Chuẩn hóa và tách dữ liệu từ các cột ---
            const displayTeacherName = teacher.teacher_name; // Luôn dùng tên chính xác từ DB
            const rawClassNames = expandClassNames(classNamesStr);
            const rawPeriods = periodsStr.split(/[,;]/).map(p => parseInt(p.trim())).filter(p => !isNaN(p) && p > 0 && p <= 5); // Chỉ cho phép tiết 1-5
            const rawLessonNames = lessonName.split(';').map(l => l.trim()).filter(Boolean);
            
            // --- BƯỚC 4: LOGIC ÁNH XẠ LỚP - TIẾT - BÀI DẠY THÔNG MINH ---
            const numClasses = rawClassNames.length;
            const numPeriods = rawPeriods.length;
            const numLessons = rawLessonNames.length;

            // Trường hợp 1: Số tiết là bội số của số lớp -> Chia đều
            if (numClasses > 0 && numPeriods > 0 && numPeriods % numClasses === 0) {
                const periodsPerClass = numPeriods / numClasses;
                for (let i = 0; i < numClasses; i++) {
                    const className = rawClassNames[i];
                    // Nếu số bài dạy bằng số lớp, gán tương ứng. Nếu không, dùng bài đầu tiên.
                    const lesson = (numLessons === numClasses) ? rawLessonNames[i] : rawLessonNames[0] || 'N/A';
                    const assignedPeriods = rawPeriods.slice(i * periodsPerClass, (i + 1) * periodsPerClass);

                    for (const period of assignedPeriods) {
                        const finalPeriod = selectedSession === 'afternoon' ? period + 5 : period;
                        const newRegData = createRegistrationData(teacher, className, finalPeriod, lesson, equipmentStr, teachingMethodStr, selectedWeek);
                        previewAndValidateSingleReg(originalLineNumber, displayTeacherName, newRegData, period, previewRegistrations, existingRegsOnDate, lineIssues);
                    }
                }
            } 
            // Trường hợp 2: Logic cũ - lặp qua danh sách dài hơn
            else {
                const loopCount = Math.max(numClasses, numPeriods);
                for (let j = 0; j < loopCount; j++) {
                    // Lấy lớp và tiết tương ứng. Nếu một trong hai danh sách ngắn hơn, tái sử dụng phần tử cuối cùng.
                    const className = rawClassNames[j] || rawClassNames[rawClassNames.length - 1];
                    const period = rawPeriods[j] || rawPeriods[rawPeriods.length - 1];
                    // Tương tự cho tên bài dạy
                    const lesson = rawLessonNames[j] || rawLessonNames[rawLessonNames.length - 1] || rawLessonNames[0] || 'N/A';
                    
                    const finalPeriod = selectedSession === 'afternoon' ? period + 5 : period;
                    const newRegData = createRegistrationData(teacher, className, finalPeriod, lesson, equipmentStr, teachingMethodStr, selectedWeek);
                    previewAndValidateSingleReg(originalLineNumber, displayTeacherName, newRegData, period, previewRegistrations, existingRegsOnDate, lineIssues);
                }
            }
        }

        // --- BƯỚC 5: Hiển thị kết quả trong Modal Xem trước ---
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

        let tableHTML = `<table class="preview-table"><thead><tr><th>Dòng gốc</th><th>Tên GV</th><th>Môn học</th><th>Lớp</th><th>Tiết</th><th>Bài dạy</th><th>Thiết bị</th><th>PPDH</th></tr></thead><tbody>`;
        previewRegistrations.forEach(reg => {
            const rowClass = reg.isInvalid ? 'class="has-error"' : (reg.issues.length > 0 ? 'class="has-warning"' : 'class="is-valid"');
            const cellsHTML = reg.data.map(cell => `<td contenteditable="false">${cell}</td>`).join('');
            tableHTML += `<tr ${rowClass} data-line-number="${reg.lineNumber}"><td>${reg.lineNumber}</td>${cellsHTML}</tr>`;
        });
        tableHTML += `</tbody></table>`;
        previewContainer.innerHTML = tableHTML;

        bulkImportModal.style.display = 'none'; // Hide the initial import modal
        bulkImportPreviewModal.style.display = 'flex'; // Show the preview modal
    };

    const createRegistrationData = (teacher, className, period, lesson, equipmentStr, teachingMethodStr, week) => {
        const subject = teacher.subject ? teacher.subject : (getSubjectsFromGroupName(groupMap.get(teacher.group_id)?.group_name || '')[0] || 'Chưa xác định');
        
        // Mở rộng logic PPDH để nhận cả tên đầy đủ và viết tắt
        const ppdhMapping = {
            'CNTT': 'Công nghệ thông tin',
            'CÔNG NGHỆ THÔNG TIN': 'Công nghệ thông tin',
            'TBDH': 'Thiết bị dạy học',
            'THIẾT BỊ DẠY HỌC': 'Thiết bị dạy học',
            'TH': 'Thực hành',
            'THỰC HÀNH': 'Thực hành'
        };

        const finalPpdh = new Set();
        teachingMethodStr.split(/[&,;]/).map(item => item.trim()).filter(Boolean).forEach(method => { // Tách PPDH bằng &, ; hoặc ,
            const upperMethod = method.toUpperCase();
            // Chuẩn hóa PPDH về tên đầy đủ
            if (ppdhMapping[upperMethod]) {
                finalPpdh.add(ppdhMapping[upperMethod]);
            }
        });

        let equipment = equipmentStr.split(/[,+]/).map(item => item.trim()).filter(Boolean);
        if ([...finalPpdh].includes('Công nghệ thông tin') && !equipment.some(e => e.toLowerCase() === 'tivi')) {
            equipment.push('Tivi');
        }
        return { teacherId: teacher.uid, teacherName: teacher.teacher_name, groupId: teacher.group_id, schoolYear: currentSchoolYear, weekNumber: week.weekNumber, date: bulkImportDaySelect.value, period: period, subject: subject, className: className, lessonName: lesson, equipment: equipment, teachingMethod: [...finalPpdh], createdAt: serverTimestamp() };
    };

    const previewAndValidateSingleReg = (lineNumber, teacherName, regData, displayPeriod, previewRegistrations, existingRegsOnDate, lineIssues) => {
        const existingConflict = existingRegsOnDate.find(reg => reg.period === regData.period && (reg.teacherId === regData.teacherId || reg.className === regData.className));
        const internalConflict = validRegistrationsToCreate.find(reg => reg.period === regData.period && (reg.teacherId === regData.teacherId || reg.className === regData.className));
        
        let currentRegIssues = [...lineIssues];
        // Chuyển đổi tiết học để hiển thị đúng cho buổi chiều (1-5)
        const displayPeriodInError = regData.period > 5 ? regData.period - 5 : regData.period;

        if (existingConflict) {
            const existingTeacherName = teacherMap.get(existingConflict.teacherId)?.teacher_name || 'N/A';
            currentRegIssues.push(`Trùng lịch với đăng ký đã có (Lớp ${regData.className}, Tiết ${displayPeriodInError}, GV ${existingTeacherName}, Môn ${existingConflict.subject}).`);
        }
        if (internalConflict) currentRegIssues.push(`Trùng lịch với dòng khác trong file (Lớp ${regData.className}, Tiết ${displayPeriodInError}).`);

        const hasConflict = !!existingConflict || !!internalConflict;
        const isInvalid = lineIssues.length > 0 || hasConflict;

        previewRegistrations.push({ lineNumber, data: [teacherName, regData.subject, regData.className, displayPeriod, regData.lessonName, regData.equipment.join(', '), regData.teachingMethod.join(', ')], issues: currentRegIssues, isInvalid });
        if (!isInvalid) {
            validRegistrationsToCreate.push(regData);
        }
    };

    const processBulkImport = async () => {
        const importText = document.getElementById('bulk-import-input').value.trim();
        if (!importText) {
            showToast('Vui lòng nhập dữ liệu để xử lý.', 'error');
        }
        // Lấy các lựa chọn từ giao diện mới
        const selectedDay = bulkImportDaySelect.value;
        const sessionToggleButton = document.getElementById('session-toggle-btn');
        const selectedSession = sessionToggleButton ? sessionToggleButton.dataset.session : 'morning';

        // Không cần lưu vào localStorage nữa vì đã tự động chọn theo giờ
        const lines = importText.split('\n').filter(line => line.trim() !== '').map(line => line.split('\t'));
        await validateAndPreviewData(lines);
    };

    const commitBulkImport = async () => {
        if (validRegistrationsToCreate.length === 0) {
            showToast('Không có dữ liệu hợp lệ để nhập.', 'info');
            return;
        }

        const confirmBtn = document.getElementById('confirm-bulk-import-btn');
        const originalBtnHTML = confirmBtn.innerHTML;
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Đang ghi dữ liệu...`;

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
        } finally {
            // Luôn khôi phục lại trạng thái của nút sau khi hoàn tất
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = originalBtnHTML;
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
        [filterGroupSelect, filterSubjectSelect, filterMethodSelect].forEach(select => {
            select.addEventListener('change', () => {
                updateDependentFilters();
                loadAndRenderSchedule(); // Tải lại dữ liệu từ server với bộ lọc mới
            });
        });



        // Listener riêng cho bộ lọc giáo viên để không trigger vòng lặp
        filterTeacherSelect.addEventListener('change', () => {
            loadAndRenderSchedule(); // Tải lại dữ liệu từ server với bộ lọc mới
        });

        // Schedule clicks
        scheduleContainer.addEventListener('click', (e) => {
            const slot = e.target.closest('.slot');
            const mobileSlot = e.target.closest('.mobile-slot');
            if (slot || mobileSlot) { // Click on any slot on desktop or mobile
                openSlotDetailModal(slot.dataset.date, slot.dataset.period);
            } 
        });

        // Accordion behavior for mobile view
        scheduleContainer.addEventListener('toggle', (e) => {
            const detailsElement = e.target;
            // Ensure the event is from a <details> element and it was just opened
            if (detailsElement.tagName === 'DETAILS' && detailsElement.open) {
                // Find all <details> elements within the mobile schedule
                const allDetails = scheduleContainer.querySelectorAll('.mobile-schedule .mobile-day-card');
                allDetails.forEach(otherDetails => {
                    // Close any other <details> element that is not the one that was just opened
                    if (otherDetails !== detailsElement) {
                        otherDetails.open = false;
                    }
                });
            }
        }, true); // Use capture phase to ensure this runs before other potential listeners

        // --- NEW: Slot Detail Modal Listeners ---
        document.getElementById('close-slot-detail-modal').addEventListener('click', () => {
            slotDetailModal.style.display = 'none';
        });

        document.getElementById('add-new-in-slot-modal-btn').addEventListener('click', (e) => {
            const { date, period } = e.currentTarget.dataset;
            slotDetailModal.style.display = 'none'; // Ẩn modal chi tiết
            openRegisterModal(null, date, period); // Mở modal đăng ký mới
        });

        document.getElementById('slot-detail-body').addEventListener('click', (e) => {
            const editBtn = e.target.closest('.edit-reg-in-modal');
            const deleteBtn = e.target.closest('.delete-reg-in-modal');
            const regId = e.target.closest('tr')?.dataset.regId;

            if (editBtn && regId) {
                slotDetailModal.style.display = 'none';
                openRegisterModal(regId);
            }
            if (deleteBtn && regId) {
                deleteRegistration(regId); // Hàm này đã có sẵn và sẽ hiển thị modal xác nhận
            }
        });

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
            // --- LOGIC MỚI: TỰ ĐỘNG CẬP NHẬT TEXTAREA KHI ĐÓNG CẢNH BÁO TRÙNG PHÒNG HỌC ---
            const labName = conflictWarningModal.dataset.labName;
            if (labName) {
                const equipmentInput = document.getElementById('reg-equipment-input');
                const currentEquipment = equipmentInput.value;
                const practiceText = `Thực hành tại ${labName}`;
                if (currentEquipment.includes(practiceText)) {
                    equipmentInput.value = currentEquipment.replace(practiceText, 'Thực hành trên lớp');
                }
                // Xóa data attribute sau khi sử dụng
                delete conflictWarningModal.dataset.labName;
            }
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
    
    const updateSubjectSelectForTeacher = async (teacherId) => {
        const modalSubjectSelect = document.getElementById('reg-subject');
        modalSubjectSelect.innerHTML = '<option value="">-- Chọn môn học --</option>';
    
        if (!teacherId) {
            return;
        }
    
        const teacher = teacherMap.get(teacherId);
        if (!teacher) return;
    
        const allowedSubjects = new Set();
    
        // 1. Lấy các môn học từ tổ chuyên môn của giáo viên
        const group = groupMap.get(teacher.group_id);
        if (group) {
            getSubjectsFromGroupName(group.group_name).forEach(sub => allowedSubjects.add(sub));
        }
    
        // 2. Lấy các môn học đặc biệt từ collection 'subjects'
        const specialSubjectsQuery = query(
            collection(firestore, 'subjects'),
            where('schoolYear', '==', currentSchoolYear),
            where('type', '==', 'special')
        );
        const specialSubjectsSnapshot = await getDocs(specialSubjectsQuery);
        specialSubjectsSnapshot.forEach(doc => allowedSubjects.add(doc.data().name));
    
        // 3. Populate danh sách môn học vào select
        [...allowedSubjects].sort().forEach(subject => {
            modalSubjectSelect.innerHTML += `<option value="${subject}">${subject}</option>`;
        });
    
        // 4. Tự động chọn môn học chính của giáo viên nếu có
        if (teacher.subject && allowedSubjects.has(teacher.subject)) {
            modalSubjectSelect.value = teacher.subject;
        }
    };

    const handlePracticeCheckboxChange = async (isChecked) => {
        const equipmentInput = document.getElementById('reg-equipment-input');
        let equipmentList = equipmentInput.value.trim() ? equipmentInput.value.split(',').map(item => item.trim()) : [];
    
        // Luôn xóa các mục liên quan đến thực hành cũ trước khi thêm mới
        equipmentList = equipmentList.filter(item => !item.startsWith('Thực hành tại') && item !== 'Thực hành trên lớp');
    
        if (isChecked) {
            const subject = document.getElementById('reg-subject').value;
            const date = document.getElementById('reg-day').value;
            const period = parseInt(document.getElementById('reg-period').value);
    
            if (!subject || !date || isNaN(period)) {
                equipmentList.push('Thực hành trên lớp');
                equipmentInput.value = equipmentList.join(', ');
                return;
            }
    
            // 1. Kiểm tra xem có phòng thực hành cho môn này không
            const labsQuery = query(collection(firestore, 'labs'), where('schoolYear', '==', currentSchoolYear), where('subject', '==', subject), limit(1));
            const labsSnapshot = await getDocs(labsQuery);
    
            if (labsSnapshot.empty) {
                equipmentList.push('Thực hành trên lớp');
            } else {
                const labData = { id: labsSnapshot.docs[0].id, ...labsSnapshot.docs[0].data() };
    
                // 2. Kiểm tra xem phòng đã bị chiếm dụng trong slot này chưa
                const occupiedQuery = query(
                    collection(firestore, 'registrations'),
                    where('date', '==', date),
                    where('period', '==', period),
                    where('labUsage.labId', '==', labData.id)
                );
                const occupiedSnapshot = await getDocs(occupiedQuery);
    
                // Nếu đang sửa, bỏ qua chính đăng ký hiện tại
                const isOccupied = occupiedSnapshot.docs.some(doc => doc.id !== currentEditingRegId);
    
                if (isOccupied) {
                    // HIỂN THỊ POPUP CẢNH BÁO NGAY LẬP TỨC
                    const conflictRegData = occupiedSnapshot.docs.find(doc => doc.id !== currentEditingRegId).data();
                    const conflictingTeacherName = teacherMap.get(conflictRegData.teacherId)?.teacher_name || 'một giáo viên khác';

                    conflictWarningModal.querySelector('#conflict-warning-title').textContent = `Cảnh báo: ${labData.name} đã được đăng ký sử dụng bởi:`;
                    conflictWarningModal.querySelector('.conflict-info-container').innerHTML = `<p><strong>Giáo viên:</strong> ${conflictingTeacherName}</p>`;
                    conflictWarningModal.dataset.labName = labData.name; // Lưu tên phòng để xử lý khi đóng modal
                    conflictWarningModal.style.display = 'flex';

                    // Vẫn cập nhật textarea để người dùng biết kết quả
                    equipmentList.push('Thực hành trên lớp');
                } else {
                    equipmentList.push(`Thực hành tại ${labData.name}`);
                }
            }
        }
    
        equipmentInput.value = equipmentList.join(', ');
    };

    const setupExtraModalFeatures = () => {
        const getLastRegBtn = document.getElementById('get-last-reg-btn');
        const modalTeacherSelect = document.getElementById('reg-teacher');

        // Thêm sự kiện change cho selector giáo viên trong modal
        modalTeacherSelect.addEventListener('change', (e) => {
            updateSubjectSelectForTeacher(e.target.value);
        });

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

        // Thêm sự kiện để tải gợi ý bài học khi thay đổi môn hoặc lớp trong modal
        document.getElementById('reg-subject').addEventListener('change', loadLessonSuggestions);
        document.getElementById('reg-class').addEventListener('input', loadLessonSuggestions);

        // Tự động thêm/xóa 'Tivi' khi chọn PPDH 'Công nghệ thông tin'
        const methodContainer = document.getElementById('reg-method-container');
        methodContainer.addEventListener('change', (e) => {
            if (e.target.type === 'checkbox' && e.target.value === 'Thực hành') {
                handlePracticeCheckboxChange(e.target.checked);
                return; // Dừng lại để không chạy logic của 'Công nghệ thông tin' nếu không cần
            }

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
    setupExtraModalFeatures();
});