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

    const getSubjectsFromGroupName = (groupName) => {
        const cleanedName = groupName.replace(/^Tổ\s*/, '').trim();
        // Tạm thời thay thế "Thể dục - QP" để không bị split sai
        const placeholder = 'TDQP_PLACEHOLDER';
        return cleanedName.replace('Thể dục - QP', placeholder)
                          .split(/\s*-\s*/)
                          .map(s => s.trim().replace(placeholder, 'Thể dục - QP'));
    };

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

        const teacherQuery = query(collection(firestore, 'teachers'), where('uid', '==', user.uid), limit(1));
        const teacherSnapshot = await getDocs(teacherQuery);

        if (teacherSnapshot.empty) {
            scheduleContainer.innerHTML = '<p>Không tìm thấy thông tin giáo viên của bạn.</p>';
            return;
        }
        const teacherData = teacherSnapshot.docs[0].data();
        const groupQuery = query(collection(firestore, 'groups'), where('group_id', '==', teacherData.group_id), limit(1));
        const groupSnapshot = await getDocs(groupQuery);
        const groupName = groupSnapshot.empty ? 'Không xác định' : groupSnapshot.docs[0].data().group_name;

        currentUserInfo = {
            id: teacherSnapshot.docs[0].id,
            name: teacherData.teacher_name,
            group_id: teacherData.group_id,
            group_name: groupName,
            subject: teacherData.subject // Thêm môn học chính của giáo viên
        };
        document.getElementById('register-header').textContent = `Đăng ký TBDH - Tổ ${groupName}`;
    };

    const loadTeachersInGroup = async () => {
        if (!currentUserInfo?.group_id) return;
        const teachersQuery = query(collection(firestore, 'teachers'), where('group_id', '==', currentUserInfo.group_id));
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

    const populateModalSelectors = async (user) => {
        // Tải PPDH
        const subjectSelect = document.getElementById('reg-subject');
        subjectSelect.innerHTML = '<option value="">-- Chọn môn học --</option>';
        if (currentUserInfo && currentUserInfo.group_name) {
            // Ưu tiên môn học chính đã được phân công cho giáo viên
            if (currentUserInfo.subject) {
                subjectSelect.innerHTML += `<option value="${currentUserInfo.subject}" selected>${currentUserInfo.subject}</option>`;
            } else { // Nếu chưa được phân công, hiển thị tất cả các môn trong tổ
                const subjects = getSubjectsFromGroupName(currentUserInfo.group_name);
                subjects.forEach(subject => {
                    subjectSelect.innerHTML += `<option value="${subject}">${subject}</option>`;
                });
            }
        }

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
            if (lastUsedSubject) {
                document.getElementById('reg-subject').value = lastUsedSubject;
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
        const selectedEquipment = equipmentValue ? equipmentValue.split(',').map(item => item.trim()).filter(item => item) : [];
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
                const conflictInfoContainer = conflictWarningModal.querySelector('.conflict-info-container');
                conflictInfoContainer.innerHTML = `
                    <p>Lớp <strong>${conflictData.className}</strong> đã được đăng ký vào tiết này bởi giáo viên có ID: <strong>${conflictData.teacherId}</strong>.</p>
                    <p>Vui lòng kiểm tra lại trên lịch tổng hợp.</p>
                    <p><strong>Môn học:</strong> ${conflictData.subject}</p>
                    <p><strong>Bài dạy:</strong> ${conflictData.lessonName}</p>
                `;
                conflictWarningModal.style.display = 'flex';
                return; // Dừng việc lưu
            }
        } catch (error) {
            console.error("Lỗi khi kiểm tra trùng lịch:", error);
            showToast('Không thể kiểm tra trùng lịch, vui lòng thử lại.', 'error');
            return;
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
            subject: document.getElementById('reg-subject').value,
            className: className.toUpperCase(), // Lưu tên lớp ở dạng chữ hoa
            lessonName: document.getElementById('reg-lesson-name').value,
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
    
    scheduleContainer.addEventListener('click', (e) => {
        const targetCell = e.target.closest('td');
        if (!targetCell) return;

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
            showToast(title || 'Không thể thao tác trên ô này.', 'info');
            return;
        }

        // Xử lý click nút "Đăng ký cho ngày này" trên mobile
        const addBtnMobile = e.target.closest('.add-registration-mobile-btn');
        if (addBtnMobile) {
            const date = addBtnMobile.dataset.date;
            // Mở modal, nhưng không chọn sẵn tiết nào
            openRegisterModal(user, null, date, null);
            // Mở khóa selector ngày và tiết để người dùng tự chọn
            document.getElementById('reg-day').disabled = false;
            document.getElementById('reg-period').disabled = false;
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
        if (registerForm.checkValidity()) {
            saveRegistration(user);
        } else {
            registerForm.reportValidity();
        }
    });
    document.getElementById('cancel-register-modal').addEventListener('click', () => registerModal.style.display = 'none');
    // registerModal.addEventListener('click', (e) => {
    //     if (e.target === registerModal) registerModal.style.display = 'none';
    // });

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

    // Tự động thêm 'Tivi' vào thiết bị khi chọn môn 'Tin' hoặc 'Công nghệ thông tin'
    document.getElementById('reg-subject').addEventListener('change', (e) => {
        const selectedSubject = e.target.value;
        const equipmentInput = document.getElementById('reg-equipment-input');
        const equipmentValue = equipmentInput.value.trim();
        
        if (selectedSubject === 'Tin' || selectedSubject === 'Công nghệ thông tin') {
            // Tách các thiết bị đã có thành một mảng
            const equipmentList = equipmentValue ? equipmentValue.split(',').map(item => item.trim()) : [];
            // Kiểm tra xem 'Tivi' đã tồn tại chưa (không phân biệt hoa thường)
            if (!equipmentList.some(item => item.toLowerCase() === 'tivi')) {
                equipmentList.push('Tivi');
                equipmentInput.value = equipmentList.join(', ');
            }
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
    });

    // --- HELPERS ---
    const formatDate = (dateString) => {
        if (!dateString) return '';
        const [year, month, day] = dateString.split('-');
        return `${day}/${month}/${year}`;
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
            await loadTimePlan(user);
            await populateModalSelectors(user);
            await loadLastUsedSubject(user);

        } catch (error) {
            console.error("Lỗi khởi tạo trang:", error);
            scheduleContainer.innerHTML = '<p class="error-message">Không thể tải dữ liệu trang.</p>';
        }
    };

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