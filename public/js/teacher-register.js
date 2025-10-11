import {
    collection,
    onSnapshot,
    getDocs,
    getDoc,
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
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { auth, firestore } from "./firebase-config.js";
import { formatDate, getDevicesRecursive } from "./utils.js";
import { showToast } from "./toast.js";

const initializeTeacherRegisterPage = (user) => {
    if (!document.getElementById('schedule-container')) return;

    const weekSelectorWrapper = document.getElementById('week-selector-wrapper');
    const weekDisplayText = document.getElementById('week-display-text');
    const weekDateRange = document.getElementById('week-date-range');
    const weekDropdown = document.getElementById('week-dropdown');
    const scheduleContainer = document.getElementById('schedule-container');
    const confirmDeleteModal = document.getElementById('confirm-delete-modal');
    const conflictWarningModal = document.getElementById('conflict-warning-modal');
    const registerModal = document.getElementById('register-modal');
    const registerForm = document.getElementById('register-form');
    // NEW: Equipment Search Modal Elements
    const equipmentSearchModal = document.getElementById('equipment-search-modal');
    const openEquipmentSearchModalBtn = document.getElementById('open-equipment-search-modal-btn');
    const cancelEquipmentSearchBtn = document.getElementById('cancel-equipment-search-btn');
    const confirmEquipmentSelectionBtn = document.getElementById('confirm-equipment-selection-btn');
    const equipmentSearchInput = document.getElementById('equipment-search-input');


    let currentSchoolYear = null;
    let currentUserInfo = null; // Lưu thông tin giáo viên (id, name, group_id, group_name)
    let teachersInGroup = []; // Lưu danh sách giáo viên trong cùng tổ
    let timePlan = []; // Lưu trữ thông tin các tuần
    let allRegistrations = []; // Lưu đăng ký của ngày được chọn
    let deleteFunction = null; // To hold the function to execute on confirm
    let currentEditingRegId = null;
    let lastUsedSubject = null; // Lưu môn học từ lần đăng ký cuối
    let registrationRule = 'none'; // Quy tắc đăng ký, mặc định là không giới hạn
    let selectedWeekNumber = null;
    let allDeviceItemsCache = []; // NEW: Cache for all device/category items
    let tempEquipmentSelection = new Map(); // Tạm thời lưu trữ lựa chọn thiết bị trong modal


    const loadRegistrationRule = async () => {
        try {
            // Lấy quy tắc từ document của năm học hiện tại
            const q = query(collection(firestore, 'schoolYears'), where('schoolYear', '==', currentSchoolYear), limit(1));
            const snapshot = await getDocs(q);
            if (!snapshot.empty) {
                const schoolYearData = snapshot.docs[0].data();
                registrationRule = schoolYearData.registrationRule || 'none';
            } else {
                registrationRule = 'none'; // Mặc định nếu không tìm thấy
            }
        } catch (error) {
            console.warn("Không thể tải quy tắc đăng ký, sử dụng mặc định.", error);
        }
    };
    const loadTimePlan = async (user) => {
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

        timePlan = [];
        weeksSnapshot.forEach(doc => {
            const weekData = { id: doc.id, ...doc.data() };
            timePlan.push(weekData);
        });

        // Tìm và đặt tuần hiện tại làm giá trị mặc định
        const today = new Date().toISOString().split('T')[0];
        let actualCurrentWeekNumber = null;

        // Tìm tuần cuối cùng đã bắt đầu so với ngày hôm nay
        for (const week of timePlan) {
            if (week.startDate <= today) {
                actualCurrentWeekNumber = week.weekNumber;
            } else {
                // Vì các tuần đã được sắp xếp, có thể dừng tìm kiếm sớm
                break;
            }
        }

        // Populate dropdown
        timePlan.forEach(week => {
            const option = document.createElement('div');
            option.className = 'week-option';
            option.dataset.week = week.weekNumber;
            option.textContent = `Tuần ${week.weekNumber} (${formatDate(week.startDate)} - ${formatDate(week.endDate)})`;
            if (week.weekNumber === actualCurrentWeekNumber) {
                option.classList.add('highlight');
            }
            weekDropdown.appendChild(option);
        });

        // Đặt tuần hiện tại làm tuần được chọn ban đầu
        const initialWeek = actualCurrentWeekNumber || (timePlan.length > 0 ? timePlan[0].weekNumber : null);
        updateSelectedWeek(initialWeek, user);
    };

    const loadCurrentUserInfo = async (user) => {
        if (!user) return; // Thêm kiểm tra để đảm bảo user tồn tại

        const teacherQuery = query(
            collection(firestore, 'teachers'), 
            where('uid', '==', user.uid),
            where('status', '==', 'active'), // CHỈ LẤY GV ĐANG HOẠT ĐỘNG
            limit(1));
        const teacherSnapshot = await getDocs(teacherQuery);

        if (teacherSnapshot.empty) {
            scheduleContainer.innerHTML = '<p>Không tìm thấy thông tin giáo viên của bạn.</p>';
            return;
        }
        const teacherData = teacherSnapshot.docs[0].data();
        const groupQuery = query(collection(firestore, 'groups'), where('group_id', '==', teacherData.group_id), limit(1));
        const groupSnapshot = await getDocs(groupQuery);
        const groupName = groupSnapshot.empty ? 'Không xác định' : groupSnapshot.docs[0].data().group_name;
        const groupSubjects = groupSnapshot.empty ? [] : (groupSnapshot.docs[0].data().subjects || []);

        currentUserInfo = {
            id: teacherSnapshot.docs[0].id,
            name: teacherData.teacher_name,
            group_id: teacherData.group_id,
            group_name: groupName,
            group_subjects: groupSubjects, // Lưu danh sách môn học của tổ
            subject: teacherData.subject // Thêm môn học chính của giáo viên
        };
        document.getElementById('register-header').textContent = `Đăng ký TBDH - Tổ ${groupName}`;
    };

    const loadTeachersInGroup = async () => {
        if (!currentUserInfo?.group_id) return;
        const teachersQuery = query(
            collection(firestore, 'teachers'), 
            where('group_id', '==', currentUserInfo.group_id),
            where('status', '==', 'active') // CHỈ LẤY GV ĐANG HOẠT ĐỘNG
        );
        const teachersSnapshot = await getDocs(teachersQuery);
        teachersInGroup = teachersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    };

    const loadLastUsedSubject = async (user) => {
        if (!user) return;
    
        try {
            const q = query(
                collection(firestore, 'registrations'),
                where('teacherId', '==', user.uid),
                orderBy('createdAt', 'desc'),
                limit(1)
            );
            const snapshot = await getDocs(q);
            if (!snapshot.empty) {
                lastUsedSubject = snapshot.docs[0].data().subject;
            }
        } catch (error) {
            console.warn("Không thể tải môn học sử dụng lần cuối:", error);
        }
    };

    // --- NEW: Load all items from 'devices' collection ---
    const loadAllDeviceData = async () => {
        try {
            const q = query(collection(firestore, 'devices'), orderBy('order'));
            const snapshot = await getDocs(q);
            allDeviceItemsCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (error) {
            console.error("Lỗi khi tải danh mục thiết bị:", error);
            showToast('Không thể tải danh mục thiết bị.', 'error');
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

    const populateModalSelectors = async () => {
        const subjectSelect = document.getElementById('reg-subject');
        subjectSelect.innerHTML = '<option value="">-- Chọn môn học --</option>';
    
        if (!currentUserInfo || !currentUserInfo.subject) {
            showToast('Tài khoản của bạn chưa được gán môn học chính.', 'error');
            return;
        }
    
        const allowedSubjects = new Set();
    
        // 1. Thêm môn học chính của giáo viên
        allowedSubjects.add(currentUserInfo.subject);
    
        // 2. Lấy các môn học phụ đã được phân công cho môn chính
        const mainSubjectQuery = query(
            collection(firestore, 'subjects'),
            where('schoolYear', '==', currentSchoolYear),
            where('name', '==', currentUserInfo.subject),
            limit(1)
        );
        const mainSubjectSnapshot = await getDocs(mainSubjectQuery);
        if (!mainSubjectSnapshot.empty) {
            const mainSubjectData = mainSubjectSnapshot.docs[0].data();
            if (mainSubjectData.allowedSubSubjects && Array.isArray(mainSubjectData.allowedSubSubjects)) {
                mainSubjectData.allowedSubSubjects.forEach(sub => allowedSubjects.add(sub));
            }
        }
    
        // 3. Lấy các môn học đặc biệt (ví dụ: HĐTN, GDĐP)
        const specialSubjectsQuery = query(
            collection(firestore, 'subjects'),
            where('schoolYear', '==', currentSchoolYear),
            where('type', '==', 'special'),
            where('status', '==', 'active') // CHỈ LẤY MÔN HỌC ĐANG HOẠT ĐỘNG
        );
        const specialSubjectsSnapshot = await getDocs(specialSubjectsQuery);
        specialSubjectsSnapshot.forEach(doc => allowedSubjects.add(doc.data().name));
    
        // 4. Populate danh sách môn học vào select
        [...allowedSubjects].sort().forEach(subject => {
            subjectSelect.innerHTML += `<option value="${subject}">${subject}</option>`;
        });
    
        const methodsQuery = query(collection(firestore, 'teachingMethods'), where('schoolYear', '==', currentSchoolYear), orderBy('method'));
        const methodsSnapshot = await getDocs(methodsQuery);
        const methodContainer = document.getElementById('reg-method-container');
        methodContainer.innerHTML = ''; // Xóa nội dung cũ

        if (methodsSnapshot.empty) {
            methodContainer.innerHTML = '<p>Không có PPDH nào được cấu hình.</p>';
        } else {
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
        }
    
        // 5. Tự động chọn môn học chính của giáo viên nếu có, hoặc môn học đã dùng lần cuối
        const subjectToSelect = currentUserInfo.subject || lastUsedSubject;
        if (subjectToSelect && allowedSubjects.has(subjectToSelect)) {
            subjectSelect.value = subjectToSelect;
        }
    };

    // --- TẢI VÀ RENDER LỊCH ---
    const loadAndRenderSchedule = async (user) => {
        const selectedWeek = timePlan.find(w => w.weekNumber === selectedWeekNumber);
        if (!selectedWeek || teachersInGroup.length === 0) {
            scheduleContainer.innerHTML = '<p>Không có dữ liệu để hiển thị.</p>';
            return;
        }

        scheduleContainer.innerHTML = '<p>Đang tải lịch của tổ...</p>';
        try {
            if (!user) {
                scheduleContainer.innerHTML = '<p>Không thể xác thực người dùng.</p>';
                return;
            }

            const regsQuery = query(
                collection(firestore, 'registrations'),
                where('schoolYear', '==', currentSchoolYear), // Thêm schoolYear để thu hẹp phạm vi
                where('teacherId', '==', user.uid), // Sử dụng user được truyền vào
                where('weekNumber', '==', selectedWeekNumber) // <-- THAY ĐỔI CHÍNH
            );
            const regsSnapshot = await getDocs(regsQuery);
            allRegistrations = [];
            regsSnapshot.forEach(doc => allRegistrations.push({ id: doc.id, ...doc.data() }));
            renderWeeklySchedule(selectedWeek, user);
        } catch (error) {
            // Bắt lỗi thiếu index của Firestore
            console.error("Lỗi tải lịch đăng ký:", error);
            scheduleContainer.innerHTML = '<p class="error-message">Không thể tải lịch đăng ký của tổ.</p>';
        }
    };

    const renderWeeklySchedule = (week, user) => {
        const daysOfWeek = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
        const weekDates = [];
        let currentDate = new Date(week.startDate);
        for (let i = 0; i < 6; i++) {
            weekDates.push(currentDate.toISOString().split('T')[0]);
            currentDate.setDate(currentDate.getDate() + 1);
        }

        let tableHTML = `<div class="desktop-schedule"><table class="weekly-schedule-table"><thead><tr><th>Buổi</th><th>Tiết</th>`;
        daysOfWeek.forEach((day, index) => {
            tableHTML += `<th>${day}<br>${formatDate(weekDates[index])}</th>`;
        });
        tableHTML += `</tr></thead><tbody>`;

        // Buổi Sáng
        for (let period = 1; period <= 5; period++) {
            tableHTML += `<tr>`;
            if (period === 1) {
                tableHTML += `<td class="session-header" rowspan="5">Sáng</td>`;
            }
            tableHTML += `<td class="period-header">${period}</td>`;
            weekDates.forEach(date => {
                const reg = allRegistrations.find(r => r.date === date && r.period === period);
                if (reg) {
                    const editable = isSlotEditable(date);
                    tableHTML += `<td class="${editable ? '' : 'disabled-slot'}" title="${editable ? '' : 'Đã hết hạn đăng ký/chỉnh sửa'}">`;
                    // Tạo tooltip chi tiết
                    const tooltipText = [
                        `Môn: ${reg.subject}`,
                        `Lớp: ${reg.className}`,
                        `Bài dạy: ${reg.lessonName}`,
                        `Thiết bị: ${reg.equipment.join(', ')}`,
                        `PPDH: ${reg.teachingMethod.join(', ')}`
                    ].filter(part => part).join('\n');

                    tableHTML += `
                        <div class="registration-info" data-reg-id="${reg.id}" title="${tooltipText}">
                            <p><i class="fas fa-chalkboard"></i> Lớp ${reg.className}: ${reg.lessonName}</p>
                        </div>`;
                } else {
                    // Ô trống, kiểm tra xem có được phép đăng ký không
                    const editable = isSlotEditable(date);
                    tableHTML += `<td class="${editable ? 'empty-slot' : 'disabled-slot'}" data-date="${date}" data-period="${period}" title="${editable ? '' : 'Đã hết hạn đăng ký'}">`;
                }
                tableHTML += `</td>`;
            });
            tableHTML += `</tr>`;
        }

        // Hàng phân cách
        tableHTML += `<tr class="session-separator"><td colspan="8"></td></tr>`;

        // Buổi Chiều
        for (let period = 6; period <= 10; period++) {
            tableHTML += `<tr>`;
            if (period === 6) {
                tableHTML += `<td class="session-header" rowspan="5">Chiều</td>`;
            }
            tableHTML += `<td class="period-header">${period - 5}</td>`;
            weekDates.forEach(date => {
                const reg = allRegistrations.find(r => r.date === date && r.period === period);
                if (reg) {
                    // Ô đã có đăng ký, vẫn cho phép click để sửa nếu quy tắc cho phép
                    const editable = isSlotEditable(date);
                    tableHTML += `<td class="${editable ? '' : 'disabled-slot'}" title="${editable ? '' : 'Đã hết hạn đăng ký/chỉnh sửa'}">`;
                    // Tạo tooltip chi tiết
                    const tooltipText = [
                        `Môn: ${reg.subject}`,
                        `Lớp: ${reg.className}`,
                        `Bài dạy: ${reg.lessonName}`,
                        `Thiết bị: ${reg.equipment.join(', ')}`,
                        `PPDH: ${reg.teachingMethod.join(', ')}`
                    ].filter(part => part).join('\n');

                    tableHTML += `
                        <div class="registration-info" data-reg-id="${reg.id}" title="${tooltipText}">
                            <p><i class="fas fa-chalkboard"></i> Lớp ${reg.className}: ${reg.lessonName}</p>
                        </div>`;
                } else {
                    const editable = isSlotEditable(date);
                    tableHTML += `<td class="empty-slot" data-date="${date}" data-period="${period}" title="${editable ? '' : 'Đã hết hạn đăng ký'}">`;
                }
                tableHTML += `</td>`;
            });
            tableHTML += `</tr>`;
        }

        tableHTML += `</tbody></table>`;
        tableHTML += `</div>`; // Đóng .desktop-schedule

        // Thêm giao diện cho mobile
        tableHTML += renderMobileSchedule(week, daysOfWeek, weekDates);

        scheduleContainer.innerHTML = tableHTML;
    };

    const isSlotEditable = (dateString) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Set to midnight for accurate date comparison
        const slotDate = new Date(dateString.replace(/-/g, '/'));

        switch (registrationRule) {
            case 'none':
                return true; // No restrictions

            case 'no-past-dates':
                return slotDate >= today; // Can't register for past dates

            case 'current-month-before-report':
                // This rule is complex and better enforced on the manager/report side.
                // For the teacher's view, we'll allow it if it's not in the past.
                return slotDate >= today;

            case 'next-week-only':
                // Find the current week based on today's date
                const currentWeek = timePlan.slice().reverse().find(w => new Date(w.startDate.replace(/-/g, '/')) <= today);
                if (!currentWeek) return false; // Can't determine current week

                // Find the next week
                const nextWeek = timePlan.find(w => w.weekNumber === currentWeek.weekNumber + 1);
                if (!nextWeek) return false; // No next week defined

                // Check if the slot date is within the next week's range
                return slotDate >= new Date(nextWeek.startDate.replace(/-/g, '/')) && slotDate <= new Date(nextWeek.endDate.replace(/-/g, '/'));

            default:
                return true; // Default to allowing edits if rule is unknown
        }
    };

    const renderMobileSchedule = (week, daysOfWeek, weekDates) => {
        let mobileHTML = `<div class="mobile-schedule">`;

        weekDates.forEach((date, dayIndex) => {
            const isDayEditable = isSlotEditable(date);
            mobileHTML += `
                <div class="mobile-day-card">
                    <div class="mobile-day-header">
                        ${daysOfWeek[dayIndex]} - ${formatDate(date)}
                    </div>
                    <div class="mobile-day-body">
            `;

            let hasContent = false;
            // Lặp qua 10 tiết
            for (let period = 1; period <= 10; period++) {
                const reg = allRegistrations.find(r => r.date === date && r.period === period);
                if (reg) {
                    hasContent = true;
                    const session = period <= 5 ? 'Sáng' : 'Chiều';
                    const displayPeriod = period <= 5 ? period : period - 5;

                    const tooltipText = [
                        `Môn: ${reg.subject}`,
                        `Lớp: ${reg.className}`,
                        `Bài dạy: ${reg.lessonName}`,
                        `Thiết bị: ${reg.equipment.join(', ')}`,
                        `PPDH: ${reg.teachingMethod.join(', ')}`
                    ].filter(part => part).join('\n');

                    mobileHTML += `
                        <div class="mobile-slot">
                            <div class="mobile-period-info">Tiết ${displayPeriod}<br>(${session})</div>
                            <div class="registration-info" data-reg-id="${reg.id}" title="${tooltipText}">
                                <div class="reg-content">
                                    <p><i class="fas fa-chalkboard"></i> <strong>Lớp ${reg.className}:</strong> ${reg.lessonName}</p>
                                    <div class="reg-details-mobile">
                                        <p><i class="fas fa-book-open fa-fw"></i> Môn: ${reg.subject}</p>
                                        <p><i class="fas fa-microchip fa-fw"></i> TBDH: ${reg.equipment.join(', ')}</p>
                                    </div>
                                </div>
                                <button class="edit-registration-mobile-btn" data-reg-id="${reg.id}" title="Sửa đăng ký">
                                    <i class="fas fa-pencil-alt"></i>
                                </button>
                            </div>
                        </div>
                    `;
                }
            }

            if (!hasContent) {
                mobileHTML += `<div class="no-registrations-mobile">Không có tiết dạy nào.</div>`;
            }

            mobileHTML += `
                    </div>
                    <div class="mobile-day-footer" ${!isDayEditable ? 'style="display: none;"' : ''}>
                        <button class="add-registration-mobile-btn" data-date="${date}" ${!isDayEditable ? 'disabled' : ''}>
                            <i class="fas fa-plus"></i> Đăng ký cho ngày này
                        </button>
                    </div>
                </div>
            `;
        });

        mobileHTML += `</div>`; // Đóng .mobile-schedule
        return mobileHTML;
    };

    // --- XỬ LÝ MODAL & FORM ---
    const openRegisterModal = (user, regId = null, date = null, period = null) => {
        currentEditingRegId = regId;
        const deleteBtn = document.getElementById('delete-register-btn');
        const saveBtn = document.getElementById('save-register-btn');

        // --- FIX: Luôn đặt lại trạng thái nút "Lưu" khi mở modal ---
        saveBtn.disabled = false;
        saveBtn.innerHTML = 'Lưu';
        // -----------------------------------------------------------

        registerForm.reset();
        document.querySelectorAll('#reg-method-container input[type="checkbox"]').forEach(cb => cb.checked = false);

        document.getElementById('register-modal-title').textContent = regId ? 'Chỉnh sửa đăng ký' : 'Đăng ký sử dụng TBDH';
        
        if (regId) {
            deleteBtn.style.display = 'inline-block'; // Hiển thị nút Xóa
            const reg = allRegistrations.find(r => r.id === regId);
            document.getElementById('reg-day').value = reg.date;
            document.getElementById('reg-period').value = reg.period;
            document.getElementById('reg-subject').value = reg.subject;
            document.getElementById('reg-class').value = reg.className;
            document.getElementById('reg-lesson-name').value = reg.lessonName;
            
            if (reg.equipment && Array.isArray(reg.equipment)) {
                document.getElementById('reg-equipment-input').value = reg.equipment.join(', ');
            }

            // Đánh dấu các checkbox phương pháp đã chọn
            const selectedMethods = reg.teachingMethod || [];
            document.querySelectorAll('#reg-method-container input[type="checkbox"]').forEach(checkbox => {
                checkbox.checked = selectedMethods.includes(checkbox.value);
            });

            // Hiển thị và thiết lập bộ chọn tuần khi chỉnh sửa
            const weekContainer = document.getElementById('reg-week-container');
            const weekSelect = document.getElementById('reg-week');
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
            populateDayAndPeriodSelectors(reg.weekNumber, user);
            document.getElementById('reg-day').value = reg.date; // Đặt lại ngày sau khi populate
            document.getElementById('reg-period').value = reg.period; // Đặt lại tiết sau khi populate

            // Thêm sự kiện để cập nhật ngày khi đổi tuần
            weekSelect.onchange = (e) => {
                const daySelect = document.getElementById('reg-day');
                const periodSelect = document.getElementById('reg-period');
                const previousDayIndex = daySelect.selectedIndex; // Lưu lại thứ đang chọn
                const previousPeriodValue = periodSelect.value; // Lưu lại tiết đang chọn

                populateDayAndPeriodSelectors(parseInt(e.target.value), user);

                // Áp dụng lại thứ đã chọn cho tuần mới
                if (previousDayIndex !== -1) daySelect.selectedIndex = previousDayIndex;
                periodSelect.value = previousPeriodValue; // Áp dụng lại tiết đã chọn
            };

            // Mở khóa tất cả các trường thời gian khi chỉnh sửa
            weekSelect.disabled = false;
            document.getElementById('reg-day').disabled = false;
            document.getElementById('reg-period').disabled = false;
        } else {
            deleteBtn.style.display = 'none'; // Ẩn nút Xóa khi tạo mới
            document.getElementById('reg-week-container').style.display = 'none'; // Ẩn bộ chọn tuần khi tạo mới
            populateDayAndPeriodSelectors(selectedWeekNumber, user); // Populate ngày cho tuần hiện tại
            if (date) document.getElementById('reg-day').value = date;
            if (period) document.getElementById('reg-period').value = period;
            // Khóa các trường thời gian khi tạo mới từ bảng (để tránh nhầm lẫn)
            document.getElementById('reg-day').disabled = true;
            document.getElementById('reg-period').disabled = true;
            // Đặt môn học mặc định từ lần đăng ký trước
            const subjectToSelect = currentUserInfo.subject || lastUsedSubject;
            if (subjectToSelect) {
                document.getElementById('reg-subject').value = subjectToSelect;
            }
        }
        registerModal.style.display = 'flex';
    };

    const populateDayAndPeriodSelectors = (weekNum, user) => {
        const daySelect = document.getElementById('reg-day');
        const periodSelect = document.getElementById('reg-period');
        const selectedWeek = timePlan.find(w => w.weekNumber === weekNum);
        if (!selectedWeek) return;

        // Populate days
        daySelect.innerHTML = '';
        let currentDate = new Date(selectedWeek.startDate.replace(/-/g, '/'));
        const daysOfWeek = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
        const formatDateToYYYYMMDD = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        for (let i = 0; i < 6; i++) {
            const dateString = formatDateToYYYYMMDD(currentDate);
            daySelect.innerHTML += `<option value="${dateString}">${daysOfWeek[i]} - ${formatDate(dateString)}</option>`;
            currentDate.setDate(currentDate.getDate() + 1);
        }

        // Populate periods
        periodSelect.innerHTML = '<option value="">-- Chọn tiết --</option>';
        for (let i = 1; i <= 10; i++) {
            const session = i <= 5 ? 'Sáng' : 'Chiều';
            const displayPeriod = i <= 5 ? i : i - 5;
            periodSelect.innerHTML += `<option value="${i}">Tiết ${displayPeriod} (${session})</option>`;
        }
    };

    const saveRegistration = async (user) => {
        const equipmentValue = document.getElementById('reg-equipment-input').value.trim();
        const selectedEquipment = equipmentValue ? equipmentValue.split(';').map(item => item.trim()).filter(item => item) : [];
        const selectedMethods = Array.from(document.querySelectorAll('#reg-method-container input[type="checkbox"]:checked')).map(cb => cb.value);

        const date = document.getElementById('reg-day').value;
        const period = parseInt(document.getElementById('reg-period').value);
        const className = document.getElementById('reg-class').value.trim();

        // Thêm kiểm tra để đảm bảo người dùng đã chọn tiết
        if (isNaN(period)) {
            showToast('Vui lòng chọn một tiết học hợp lệ.', 'error');
            return;
        }

        // --- KIỂM TRA TRÙNG LỊCH ---
        try {
            const q = query(
                collection(firestore, 'registrations'),
                where('date', '==', date),
                where('period', '==', period),
                where('className', '==', className.toUpperCase())
            );
            const snapshot = await getDocs(q);
            let conflictDoc = null;

            if (!snapshot.empty) {
                // Nếu đang sửa, bỏ qua chính document đang sửa
                if (currentEditingRegId) {
                    const foundDoc = snapshot.docs.find(doc => doc.id !== currentEditingRegId);
                    if (foundDoc) conflictDoc = foundDoc;
                } else { // Nếu tạo mới, bất kỳ document nào tìm thấy đều là xung đột
                    conflictDoc = snapshot.docs[0];
                }
            }

            if (conflictDoc) {
                const conflictData = conflictDoc.data();
                let conflictingTeacherName = 'một giáo viên khác';

                // Truy vấn để lấy tên của giáo viên bị trùng lịch
                if (conflictData.teacherId) {
                    const teacherConflictQuery = query(collection(firestore, 'teachers'), where('uid', '==', conflictData.teacherId), limit(1));
                    const teacherConflictSnapshot = await getDocs(teacherConflictQuery);
                    if (!teacherConflictSnapshot.empty) {
                        conflictingTeacherName = teacherConflictSnapshot.docs[0].data().teacher_name;
                    }
                }

                const displayPeriod = conflictData.period > 5 ? conflictData.period - 5 : conflictData.period;
                conflictWarningModal.querySelector('#conflict-warning-title').textContent = `Cảnh báo: Lớp đã được đăng ký`;
                const conflictInfoContainer = conflictWarningModal.querySelector('.conflict-info-container');
                conflictInfoContainer.innerHTML = `
                    <p><strong>Giáo viên:</strong> ${conflictingTeacherName}</p>
                    <p><strong>Môn học:</strong> ${conflictData.subject}</p>
                    <p><strong>Lớp:</strong> ${conflictData.className} (Tiết ${displayPeriod}, ${formatDate(conflictData.date)})</p>
                `;
                conflictWarningModal.style.display = 'flex';
                return; // Dừng việc lưu
            }
        } catch (error) {
            console.error("Lỗi khi kiểm tra trùng lịch:", error);
            showToast('Không thể kiểm tra trùng lịch, vui lòng thử lại.', 'error');
            return;
        }

        // --- LOGIC MỚI: KIỂM TRA PHÒNG HỌC BỘ MÔN KHI ĐĂNG KÝ THỰC HÀNH ---
        let labUsage = null; // 'occupied' | 'in_class' | null
        const subject = document.getElementById('reg-subject').value;

        if (selectedMethods.includes('Thực hành')) {
            // 1. Kiểm tra xem có phòng thực hành cho môn này không
            const labsQuery = query(collection(firestore, 'labs'), where('schoolYear', '==', currentSchoolYear), where('subject', '==', subject), limit(1));
            const labsSnapshot = await getDocs(labsQuery);

            if (!labsSnapshot.empty) {
                const labData = { id: labsSnapshot.docs[0].id, ...labsSnapshot.docs[0].data() };

                // 2. Kiểm tra xem phòng đã bị chiếm dụng trong slot này chưa
                const occupiedQuery = query(
                    collection(firestore, 'registrations'),
                    where('date', '==', date),
                    where('period', '==', period),
                    where('labUsage.labId', '==', labData.id) // Kiểm tra xem có ai đã chiếm phòng này chưa
                );
                const occupiedSnapshot = await getDocs(occupiedQuery);

                let isOccupied = false;
                // Nếu đang sửa, bỏ qua chính đăng ký hiện tại
                if (currentEditingRegId) {
                    if (occupiedSnapshot.docs.some(doc => doc.id !== currentEditingRegId)) {
                        isOccupied = true;
                    }
                } else {
                    isOccupied = !occupiedSnapshot.empty;
                }

                if (isOccupied) {
                    labUsage = { status: 'in_class', reason: `Phòng thực hành ${labData.name} đã được sử dụng.` };
                } else {
                    labUsage = { status: 'occupied', labId: labData.id, labName: labData.name };
                }
            }
        }

        // Kiểm tra định dạng lớp: 10, 11, 12 + một chữ cái + một số. Ví dụ: 10A1, 12B4
        const classRegex = /^(10|11|12)[A-Z,a-z]\d{1,2}$/;
        if (!classRegex.test(className)) {
            showToast('Định dạng lớp không hợp lệ. Ví dụ đúng: 10A1, 12B4.', 'error');
            return;
        }

        if (equipmentValue === '') {
            showToast('Vui lòng nhập ít nhất một thiết bị.', 'error');
            return;
        }
                
        const weekSelect = document.getElementById('reg-week');
        const finalWeekNumber = currentEditingRegId ? parseInt(weekSelect.value) : selectedWeekNumber;

        const registrationData = {
            teacherId: user.uid,
            groupId: currentUserInfo.group_id, // Thêm groupId
            schoolYear: currentSchoolYear,
            weekNumber: finalWeekNumber, 
            date: date,
            period: period,
            subject: subject,
            className: className.toUpperCase(), // Lưu tên lớp ở dạng chữ hoa
            lessonName: document.getElementById('reg-lesson-name').value,
            labUsage: labUsage, // <-- DỮ LIỆU MỚI
            equipment: selectedEquipment,
            teachingMethod: selectedMethods,
            notes: '', // Giữ lại trường notes là rỗng để đảm bảo cấu trúc dữ liệu nhất quán
        };

        try {
            if (currentEditingRegId) { // Cập nhật
                const regRef = doc(firestore, 'registrations', currentEditingRegId);
                await updateDoc(regRef, registrationData);
                showToast('Cập nhật đăng ký thành công!', 'success');
            } else { // Tạo mới
                await addDoc(collection(firestore, 'registrations'), {
                    ...registrationData,
                    createdAt: serverTimestamp() // Thêm thời gian tạo
                }); 
                showToast('Đăng ký thành công!', 'success');

                // Hiển thị thông báo nếu thực hành trên lớp
                if (labUsage?.status === 'in_class') {
                    showToast(labUsage.reason + " Tiết của bạn được ghi nhận là 'Thực hành trên lớp'.", 'info', 8000);
                }
            }
            registerModal.style.display = 'none';
            loadAndRenderSchedule(user);
        } catch (error) {
            console.error("Lỗi khi lưu đăng ký:", error);
            showToast('Đã có lỗi xảy ra khi lưu.', 'error');
        }
    };

    const updateSelectedWeek = (weekNum, user) => {
        if (!weekNum) return;
        selectedWeekNumber = parseInt(weekNum);
        const weekData = timePlan.find(w => w.weekNumber === selectedWeekNumber);
        if (weekData) {
            const startDateObj = new Date(weekData.startDate.replace(/-/g, '/'));
            const endDateObj = new Date(weekData.endDate.replace(/-/g, '/'));
            weekDisplayText.textContent = `Tuần ${weekData.weekNumber}`;
            weekDateRange.textContent = `Từ ${formatDate(weekData.startDate)} đến ${formatDate(weekData.endDate)}`;
            loadAndRenderSchedule(user);
        }
    };

    document.getElementById('prev-week-btn').addEventListener('click', () => {
        if (selectedWeekNumber > 1) {
            updateSelectedWeek(selectedWeekNumber - 1, user);
        }
    });

    document.getElementById('next-week-btn').addEventListener('click', () => {
        if (selectedWeekNumber < timePlan.length) {
            updateSelectedWeek(selectedWeekNumber + 1, user);
        }
    });

    document.getElementById('week-display-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        weekDropdown.style.display = weekDropdown.style.display === 'none' ? 'block' : 'none';
    });

    weekDropdown.addEventListener('click', (e) => {
        if (e.target.classList.contains('week-option')) {
            const weekNum = e.target.dataset.week;
            updateSelectedWeek(weekNum, user);
            weekDropdown.style.display = 'none';
        }
    });
    
    // Tái cấu trúc event listener để xử lý đúng cho cả desktop và mobile
    scheduleContainer.addEventListener('click', (e) => {
        // 1. Xử lý cho nút "Đăng ký cho ngày này" trên mobile
        const addBtnMobile = e.target.closest('.add-registration-mobile-btn');
        if (addBtnMobile) {
            const date = addBtnMobile.dataset.date;
            openRegisterModal(user, null, date, null);
            document.getElementById('reg-day').disabled = false;
            document.getElementById('reg-period').disabled = false;
            return; // Đã xử lý, không cần làm gì thêm
        }

        // 2. Xử lý cho các ô trong bảng (desktop view)
        const targetCell = e.target.closest('td');
        if (targetCell) {
            // Xử lý click vào đăng ký đã có để sửa
            if (targetCell.querySelector('.registration-info')) {
                const regInfo = e.target.closest('.registration-info');
                if (regInfo) {
                    const regId = regInfo.dataset.regId;
                    const registration = allRegistrations.find(r => r.id === regId);
                    if (registration && registration.teacherId === user.uid) { // Chỉ cho phép sửa đăng ký của chính mình
                        openRegisterModal(user, regId);
                    }
                }
            } 
            // Xử lý click vào ô trống để đăng ký mới
            else if (targetCell.classList.contains('empty-slot')) {
                openRegisterModal(user, null, targetCell.dataset.date, targetCell.dataset.period);
            }
            
            // Ngăn không cho mở modal nếu ô bị vô hiệu hóa
            if (targetCell.classList.contains('disabled-slot')) {
                const title = targetCell.getAttribute('title');
                if (title) { // Chỉ hiển thị toast nếu có title
                    showToast(title, 'info');
                }
            }
        }
    });
    // Thêm event listener cho nút sửa trên mobile
    scheduleContainer.addEventListener('click', (e) => {
        const editBtnMobile = e.target.closest('.edit-registration-mobile-btn');
        if (editBtnMobile) {
            openRegisterModal(user, editBtnMobile.dataset.regId);
        }
    });

    document.getElementById('get-last-reg-btn').addEventListener('click', async () => {
        if (!user) {
            showToast('Không thể xác thực người dùng.', 'error');
            return;
        }
    
        try {
            const q = query(
                collection(firestore, 'registrations'),
                where('teacherId', '==', user.uid),
                orderBy('createdAt', 'desc'),
                limit(1)
            );
    
            const snapshot = await getDocs(q);
    
            if (snapshot.empty) {
                showToast('Không tìm thấy lần đăng ký nào trước đó.', 'info');
                return;
            }
    
            const lastReg = snapshot.docs[0].data();
    
            // Điền thông tin vào form
            document.getElementById('reg-subject').value = lastReg.subject || '';
            document.getElementById('reg-class').value = lastReg.className || '';
            document.getElementById('reg-lesson-name').value = lastReg.lessonName || '';
    
            if (lastReg.equipment && Array.isArray(lastReg.equipment)) {
                document.getElementById('reg-equipment-input').value = lastReg.equipment.join(', ');
            } else {
                document.getElementById('reg-equipment-input').value = '';
            }
    
            document.querySelectorAll('#reg-method-container input[type="checkbox"]').forEach(checkbox => {
                checkbox.checked = lastReg.teachingMethod && lastReg.teachingMethod.includes(checkbox.value);
            });
    
            showToast('Đã lấy thông tin thành công!', 'success');
    
        } catch (error) {
            console.error("Lỗi khi lấy thông tin đăng ký trước đó:", error);
            showToast('Không thể lấy thông tin. Vui lòng thử lại.', 'error');
        }
    });

    document.getElementById('delete-register-btn').addEventListener('click', () => {
        if (currentEditingRegId) {
            const confirmDeleteMessage = document.getElementById('confirm-delete-message');
            if(confirmDeleteMessage) {
                confirmDeleteMessage.textContent = 'Bạn có chắc chắn muốn xóa lượt đăng ký này?';
            }
    
            deleteFunction = async () => {
                try {
                    registerModal.style.display = 'none';
                    await deleteDoc(doc(firestore, 'registrations', currentEditingRegId));
                    showToast('Đã xóa đăng ký.', 'success'); 
                    await loadAndRenderSchedule(user);
                } catch (error) {
                    console.error("Lỗi khi xóa đăng ký:", error);
                    showToast('Lỗi khi xóa đăng ký.', 'error');
                }
            };
    
            if(confirmDeleteModal) {
                confirmDeleteModal.style.display = 'flex';
            }
        }
    });

    document.getElementById('save-register-btn').addEventListener('click', (e) => {
        e.preventDefault();
        if (!registerForm.checkValidity()) {
            registerForm.reportValidity();
            return;
        }

        const saveBtn = document.getElementById('save-register-btn');
        const originalBtnHTML = saveBtn.innerHTML;
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Đang ghi lại đăng ký...`;

        // Wrap saveRegistration in a new async function to handle finally block
        (async () => {
            try {
                await saveRegistration(user);
            } catch (error) {
                // Errors inside saveRegistration are already handled with toasts.
                // This catch is for any unexpected errors during the async operation.
                console.error("Lỗi không mong muốn trong quá trình lưu:", error);
                showToast('Đã có lỗi không mong muốn xảy ra.', 'error');
            } finally {
                // This block will run whether saveRegistration succeeds or fails (returns early).
                // A small delay to let the user see the success/error toast before the button resets.
                setTimeout(() => {
                    saveBtn.disabled = false;
                    saveBtn.innerHTML = originalBtnHTML;
                }, 300); // 300ms delay
            }
        })();
    });
    document.getElementById('cancel-register-modal').addEventListener('click', () => registerModal.style.display = 'none');

    document.getElementById('close-conflict-modal').addEventListener('click', () => {
        const labName = conflictWarningModal.dataset.labName;
        if (labName) {
            const equipmentInput = document.getElementById('reg-equipment-input');
            const currentEquipment = equipmentInput.value;
            const practiceText = `Thực hành tại ${labName}`;
            if (currentEquipment.includes(practiceText)) {
                equipmentInput.value = currentEquipment.replace(practiceText, 'Thực hành trên lớp');
            }
            delete conflictWarningModal.dataset.labName;
        }
        conflictWarningModal.style.display = 'none';
    });

    // Event listeners cho popup xác nhận xóa
    if (confirmDeleteModal) {
        document.getElementById('confirm-delete-btn').addEventListener('click', () => {
            if (typeof deleteFunction === 'function') {
                deleteFunction();
            }
            confirmDeleteModal.style.display = 'none';
            deleteFunction = null;
        });
    
        document.getElementById('cancel-delete-btn').addEventListener('click', () => {
            confirmDeleteModal.style.display = 'none';
            deleteFunction = null;
        });
    
        confirmDeleteModal.addEventListener('click', (e) => {
            if (e.target === confirmDeleteModal) {
                confirmDeleteModal.style.display = 'none';
                deleteFunction = null;
            }
        });
    }

    // Đóng dropdown tuần khi click ra ngoài
    document.addEventListener('click', (e) => {
        if (!weekSelectorWrapper.contains(e.target)) {
            weekDropdown.style.display = 'none';
        }
    });

    const handlePracticeCheckboxChange = async (isChecked) => {
        const equipmentInput = document.getElementById('reg-equipment-input');
        const subject = document.getElementById('reg-subject').value;
        let equipmentList = equipmentInput.value.trim() ? equipmentInput.value.split(',').map(item => item.trim()) : [];

        // Luôn xóa các mục liên quan đến thực hành cũ trước khi thêm mới
        equipmentList = equipmentList.filter(item => !item.startsWith('Thực hành tại') && item !== 'Thực hành trên lớp');

        if (isChecked) {
            // Bỏ qua việc thêm "Thực hành..." cho môn GDTC vì đây là môn đặc thù
            if (subject === 'Giáo dục thể chất') {
                equipmentInput.value = equipmentList.join(', ');
                return;
            }

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
                    equipmentList.push('Thực hành trên lớp');
                } else {
                    equipmentList.push(`Thực hành tại ${labData.name}`);
                }
            }
        }

        equipmentInput.value = equipmentList.join(', ');
    };

    const confirmEquipmentSelection = () => {
        const equipmentInput = document.getElementById('reg-equipment-input');
        const selectedFromModal = [];
        document.querySelectorAll('#equipment-search-list-container .equipment-item-row').forEach(row => {
            const quantityInput = row.querySelector('.equipment-quantity-input');
            const quantity = parseInt(quantityInput.value) || 0;
            if (quantity > 0) {
                const deviceName = row.dataset.deviceName;
                selectedFromModal.push(`${deviceName} (SL: ${quantity})`);
            }
        });
    
        // Lấy các thiết bị đã nhập thủ công (không có "(SL: ...)")
        const manuallyAdded = equipmentInput.value.split(';').map(item => item.trim()).filter(item => item && !/\(SL:\s*\d+\)/.test(item));
    
        // Kết hợp cả hai danh sách và cập nhật lại textarea
        const finalEquipmentList = [...manuallyAdded, ...selectedFromModal];
        equipmentInput.value = finalEquipmentList.join('; ');
        equipmentSearchModal.style.display = 'none';
    };

    const filterEquipmentInModal = () => {
        const filterText = equipmentSearchInput.value.toLowerCase();
        const allRows = document.querySelectorAll('#equipment-search-list-container .equipment-item-row');
        
        allRows.forEach(row => {
            const deviceName = row.dataset.deviceName.toLowerCase();
            if (deviceName.includes(filterText)) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });

        updateEquipmentSearchInfo();
    };

    const updateEquipmentSearchInfo = () => {
        const totalVisible = document.querySelectorAll('#equipment-search-list-container .equipment-item-row:not([style*="display: none"])').length;
        const searchInfo = document.getElementById('equipment-search-info');
        searchInfo.textContent = `Hiển thị ${totalVisible} thiết bị.`;
    };


    // Thêm sự kiện để tải gợi ý bài học khi thay đổi môn hoặc lớp
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

            // Lọc ra các giá trị rỗng có thể xuất hiện do dấu phẩy thừa
            equipmentList = equipmentList.filter(item => item);

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

        // NEW: Logic for "Thiết bị dạy học" checkbox
        if (e.target.type === 'checkbox' && e.target.value === 'Thiết bị dạy học') {
            const equipmentSearchBtn = document.getElementById('open-equipment-search-modal-btn');
            if (e.target.checked) {
                equipmentSearchBtn.style.display = 'inline-block';
            } else {
                equipmentSearchBtn.style.display = 'none';
                const equipmentInput = document.getElementById('reg-equipment-input');
                // Remove only items that look like they were added from a search modal (they have "(SL: ...)")
                let currentEquipment = equipmentInput.value.split(';').map(item => item.trim()).filter(Boolean);
                const itemsToKeep = currentEquipment.filter(item => !/\(SL:\s*\d+\)/.test(item));
                
                // Only show toast if something was actually removed
                if (itemsToKeep.length < currentEquipment.length) {
                    showToast('Đã xóa các thiết bị dạy học đã chọn.', 'info');
                }
                equipmentInput.value = itemsToKeep.join('; ');
            }
        }
    });

    // --- NEW: Functions for Equipment Search Modal ---
    const openEquipmentSearchModal = async () => {
        const container = document.getElementById('equipment-search-list-container');
        const date = document.getElementById('reg-day').value;
        const subjectName = document.getElementById('reg-subject').value;
        const period = parseInt(document.getElementById('reg-period').value);

        if (!date || isNaN(period)) {
            showToast('Vui lòng chọn ngày và tiết học trước khi chọn thiết bị.', 'error');
            return;
        }
        if (!subjectName) {
            showToast('Vui lòng chọn môn học trước khi chọn thiết bị.', 'error');
            equipmentSearchModal.style.display = 'flex';
            container.innerHTML = '<p class="form-note">Vui lòng chọn một môn học trong form đăng ký để xem danh sách thiết bị tương ứng.</p>';
            return;
        }

        container.innerHTML = '<p><i class="fas fa-spinner fa-spin"></i> Đang tải danh sách thiết bị...</p>';
        equipmentSearchModal.style.display = 'flex';
        equipmentSearchInput.value = ''; // Reset search

        // Parse the current textarea value to pre-fill the modal
        tempEquipmentSelection.clear();
        const currentEquipment = document.getElementById('reg-equipment-input').value.trim();
        if (currentEquipment) {
            currentEquipment.split(',').forEach(item => {
                const match = item.match(/(.+)\s\(SL:\s*(\d+)\)/);
                if (match) {
                    const [, name, quantity] = match;
                    tempEquipmentSelection.set(name.trim(), parseInt(quantity));
                }
            });
        }

        // Fetch real-time availability
        const registeredQuantities = await getRegisteredQuantitiesForSlot(date, period);

        const topCategory = allDeviceItemsCache.find(item =>
            item.type === 'category' &&
            !item.parentId &&
            item.subjects?.includes(subjectName)
        );

        let modalHTML = '';

        if (topCategory) {
            const devices = getDevicesRecursive(topCategory.id, allDeviceItemsCache);
            const lessonName = document.getElementById('reg-lesson-name').value.trim().toLowerCase();
            const lessonKeywords = lessonName ? lessonName.split(' ').filter(k => k.length > 2) : [];

            const devicesWithAvailability = devices.map(device => {
                const alreadyRegistered = registeredQuantities.get(device.name) || 0;
                const available = (device.quantity || 0) - (device.broken || 0) - alreadyRegistered;
                return { ...device, available };
            });

            devicesWithAvailability.sort((a, b) => {
                const aIsAvailable = a.available > 0;
                const bIsAvailable = b.available > 0;
                if (aIsAvailable !== bIsAvailable) return aIsAvailable ? -1 : 1;

                if (aIsAvailable && bIsAvailable && lessonKeywords.length > 0) {
                    const aName = a.name.toLowerCase();
                    const bName = b.name.toLowerCase();
                    const aIsRelevant = lessonKeywords.some(keyword => aName.includes(keyword));
                    const bIsRelevant = lessonKeywords.some(keyword => bName.includes(keyword));
                    if (aIsRelevant !== bIsRelevant) return aIsRelevant ? -1 : 1;
                }
                return String(a.order || '').localeCompare(String(b.order || ''));
            });

            if (devicesWithAvailability.length > 0) {
                modalHTML += `<div class="equipment-category-group-single">`;
                devicesWithAvailability.forEach(device => {
                    const isDisabled = device.available <= 0;
                    const preSelectedQuantity = tempEquipmentSelection.get(device.name) || 0;

                    modalHTML += `
                        <div class="equipment-item-row ${isDisabled ? 'disabled' : ''}" data-device-name="${device.name}">
                            <span class="equipment-name" title="${device.name}">${device.name}</span>
                            <span class="equipment-available">(Còn lại: ${device.available})</span>
                            <input type="number" class="equipment-quantity-input" min="0" max="${device.available + preSelectedQuantity}" value="${preSelectedQuantity}" ${isDisabled && preSelectedQuantity === 0 ? 'disabled' : ''}>
                        </div>
                    `;
                });
                modalHTML += `</div>`;
            }
        } else {
            modalHTML = `<p class="form-note">Môn học <strong>${subjectName}</strong> chưa được gán danh mục thiết bị nào.</p>`;
        }

        container.innerHTML = modalHTML || '<p class="form-note">Không có thiết bị nào trong danh mục.</p>';
        updateEquipmentSearchInfo();
    };

    const getRegisteredQuantitiesForSlot = async (date, period) => {
        const registeredQuantities = new Map();
        try {
            const q = query(
                collection(firestore, 'registrations'),
                where('date', '==', date),
                where('period', '==', period)
            );
            const snapshot = await getDocs(q);
            snapshot.forEach(doc => {
                if (doc.id === currentEditingRegId) return; // Skip the current registration being edited
                const reg = doc.data();
                (reg.equipment || []).forEach(item => {
                    const match = item.match(/(.+)\s\(SL:\s*(\d+)\)/);
                    if (match) {
                        const [, name, quantity] = match;
                        registeredQuantities.set(name.trim(), (registeredQuantities.get(name.trim()) || 0) + parseInt(quantity));
                    }
                });
            });
        } catch (error) {
            console.error("Lỗi khi tải số lượng thiết bị đã đăng ký:", error);
        }
        return registeredQuantities;
    };
    // --- KHỞI CHẠY LOGIC CHÍNH CỦA TRANG ---
    const start = async () => {
        try {
            // 1. Lấy năm học mới nhất
            const yearsQuery = query(collection(firestore, 'schoolYears'), orderBy('schoolYear', 'desc'), limit(1));
            const yearsSnapshot = await getDocs(yearsQuery);
            if (yearsSnapshot.empty) {
                scheduleContainer.innerHTML = '<p>Chưa có dữ liệu năm học.</p>';
                return;
            }
            currentSchoolYear = yearsSnapshot.docs[0].data().schoolYear;

            // Tải các dữ liệu cần thiết theo thứ tự
            await loadCurrentUserInfo(user);
            if (!currentUserInfo) return; // Dừng lại nếu không có thông tin GV

            await loadTeachersInGroup();
            await loadRegistrationRule(); // Tải quy tắc đăng ký
            await loadTimePlan(user); // Cần user để gọi updateSelectedWeek
            await populateModalSelectors(); // Không cần user nữa
            await loadAllDeviceData(); // NEW: Tải dữ liệu thiết bị
            await loadLastUsedSubject(user);

        } catch (error) {
            console.error("Lỗi khởi tạo trang:", error);
            scheduleContainer.innerHTML = '<p class="error-message">Không thể tải dữ liệu trang.</p>';
        }
    };

    // --- NEW: Event listeners for Equipment Search Modal ---
    if (openEquipmentSearchModalBtn) {
        openEquipmentSearchModalBtn.addEventListener('click', openEquipmentSearchModal);
        cancelEquipmentSearchBtn.addEventListener('click', () => equipmentSearchModal.style.display = 'none');
        confirmEquipmentSelectionBtn.addEventListener('click', confirmEquipmentSelection);
        equipmentSearchInput.addEventListener('input', filterEquipmentInModal);
    }

    start(); // Bắt đầu thực thi
};

document.addEventListener('DOMContentLoaded', () => {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            // Người dùng đã đăng nhập, khởi tạo trang
            initializeTeacherRegisterPage(user);
        }
    });
});