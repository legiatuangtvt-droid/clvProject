import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy, writeBatch, where, getDoc, limit } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { firestore } from "./firebase-config.js";
import { showToast } from "./toast.js";

document.addEventListener('DOMContentLoaded', () => {
    // Chỉ thực thi code nếu element chính tồn tại
    if (!document.getElementById('setting-management-content')) return;

    // --- Biến toàn cục và DOM Elements ---
    const groupsContainer = document.getElementById('groups-container');
    const groupModal = document.getElementById('group-modal');
    const teacherModal = document.getElementById('teacher-modal');
    const confirmDeleteModal = document.getElementById('confirm-delete-modal');
    const schoolYearModal = document.getElementById('school-year-modal');
    const teacherSubjectGroup = document.getElementById('teacher-subject-group');
    const methodModal = document.getElementById('method-modal');
    const methodsContainer = document.getElementById('methods-container');
    const weekEditModal = document.getElementById('week-edit-modal');
    const schoolYearSelect = document.getElementById('school-year-select');
    const weeklyPlanContainer = document.getElementById('weekly-plan-container');

    const findOrphanedRegsBtn = document.getElementById('find-orphaned-regs-btn');
    const dataRepairContainer = document.getElementById('data-repair-results-container');
    // Thêm các element mới
    const findSubjectMismatchBtn = document.getElementById('find-subject-mismatch-btn');
    const subjectRepairContainer = document.getElementById('subject-repair-results-container');
    const findMissingGroupIdBtn = document.getElementById('find-missing-groupid-btn');
    const groupIdRepairContainer = document.getElementById('groupid-repair-results-container');
    const rulesContainer = document.getElementById('rules-container');
    const saveRulesBtn = document.getElementById('save-rules-btn');


    let currentSchoolYear = null; // Chuỗi năm học đang được chọn (VD: "2024-2025")
    let currentGroupId = null; // Dùng để biết đang thêm/sửa giáo viên cho tổ nào
    let currentEditingId = null; // Dùng để biết đang sửa tổ/giáo viên nào
    let currentEditingWeekId = null; // Dùng để biết đang sửa tuần nào
    let deleteFunction = null; // Hàm sẽ được gọi khi xác nhận xóa


    // --- Hàm trợ giúp ---
    const getSchoolYearDocRef = async (schoolYear) => {
        if (!schoolYear) return null;
        const q = query(collection(firestore, 'schoolYears'), where('schoolYear', '==', schoolYear), limit(1));
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            return null;
        }
        return snapshot.docs[0].ref;
    };

    const formatDate = (dateString) => {
        if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
            return dateString; // Trả về chuỗi gốc nếu không đúng định dạng yyyy-mm-dd
        }
        const [year, month, day] = dateString.split('-');
        return `${day}/${month}/${year}`;
    };

    const formatDateToYYYYMMDD = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const getSubjectsFromGroupName = (groupName) => {
        const cleanedName = groupName.replace(/^Tổ\s*/, '').trim();
        // Tạm thời thay thế "Thể dục - QP" để không bị split sai
        const placeholder = 'TDQP_PLACEHOLDER';
        return cleanedName.replace('Thể dục - QP', placeholder)
                          .split(/\s*-\s*/)
                          .map(s => s.trim().replace(placeholder, 'Thể dục - QP'));
    };
    // --- DATA REPAIR FUNCTIONS ---
    const findAndRepairOrphanedRegs = async () => {
        dataRepairContainer.innerHTML = `<p><i class="fas fa-spinner fa-spin"></i> Đang quét dữ liệu, vui lòng chờ...</p>`;

        try {
            // 1. Lấy tất cả giáo viên hiện tại và tạo một Set các UID hợp lệ
            const teachersQuery = query(collection(firestore, 'teachers'));
            const teachersSnapshot = await getDocs(teachersQuery);
            const allCurrentTeachers = teachersSnapshot.docs.map(doc => ({ uid: doc.data().uid, name: doc.data().teacher_name, ...doc.data() }));
            const validTeacherUids = new Set(allCurrentTeachers.map(t => t.uid).filter(Boolean));

            // 2. Lấy tất cả các lượt đăng ký
            const regsQuery = query(collection(firestore, 'registrations'));
            const regsSnapshot = await getDocs(regsQuery);

            // 3. Tìm các đăng ký "mồ côi"
            const orphanedRegs = new Map(); // Map: oldTeacherId -> { name, regs: [regDoc] }
            regsSnapshot.forEach(doc => {
                const regData = doc.data();
                if (regData.teacherId && !validTeacherUids.has(regData.teacherId)) {
                    const oldId = regData.teacherId;
                    if (!orphanedRegs.has(oldId)) {
                        orphanedRegs.set(oldId, {
                            name: regData.teacherName || 'Không rõ tên', // Dùng teacherName cũ nếu có
                            regs: []
                        });
                    }
                    orphanedRegs.get(oldId).regs.push({id: doc.id, ...regData});
                }
            });

            renderRepairUI(orphanedRegs, allCurrentTeachers);

        } catch (error) {
            console.error("Lỗi khi quét dữ liệu:", error);
            dataRepairContainer.innerHTML = `<p class="error-message">Đã có lỗi xảy ra trong quá trình quét. Vui lòng thử lại.</p>`;
            showToast('Quét dữ liệu thất bại!', 'error');
        }
    };

    const renderRepairUI = (orphanedMap, allCurrentTeachers) => {
        if (orphanedMap.size === 0) {
            dataRepairContainer.innerHTML = `<p class="success-message"><i class="fas fa-check-circle"></i> Không tìm thấy lượt đăng ký nào bị lỗi Teacher ID. Dữ liệu của bạn đã nhất quán!</p>`;
            return;
        }

        let html = `
            <div class="repair-header">
                <h4>Tìm thấy ${orphanedMap.size} tài khoản giáo viên cũ cần được ánh xạ lại:</h4>
                <button id="execute-repair-btn" class="btn-danger"><i class="fas fa-tools"></i> Thực hiện sửa lỗi</button>
            </div>
            <div class="repair-list">`;

        // Tạo dropdown HTML một lần để tái sử dụng
        const teacherOptions = allCurrentTeachers
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(t => `<option value="${t.uid}">${t.name}</option>`)
            .join('');

        orphanedMap.forEach((data, oldId) => {
            html += `
                <div class="repair-item" data-old-id="${oldId}">
                    <div class="repair-info">
                        <p><strong>Tên GV cũ:</strong> ${data.name}</p>
                        <p><strong>ID cũ:</strong> ${oldId}</p>
                        <p><strong>Số lượt đăng ký bị ảnh hưởng:</strong> ${data.regs.length}</p>
                    </div>
                    <div class="repair-action">
                        <label for="teacher-select-${oldId}">Chọn tài khoản GV mới để thay thế:</label>
                        <select id="teacher-select-${oldId}" class="form-control">
                            <option value="">-- Chọn giáo viên --</option>
                            ${teacherOptions}
                        </select>
                    </div>
                </div>
            `;
        });

        html += `</div>`;
        dataRepairContainer.innerHTML = html;

        document.getElementById('execute-repair-btn').addEventListener('click', () => executeRepair(orphanedMap));
    };

    const executeRepair = async (orphanedMap) => {
        const batch = writeBatch(firestore);
        let updatesCount = 0;

        document.querySelectorAll('.repair-item').forEach(item => {
            const oldId = item.dataset.oldId;
            const newId = item.querySelector('select').value;
            if (newId && orphanedMap.has(oldId)) {
                const { regs } = orphanedMap.get(oldId);
                regs.forEach(reg => {
                    const regRef = doc(firestore, 'registrations', reg.id);
                    batch.update(regRef, { teacherId: newId });
                    updatesCount++;
                });
            }
        });

        if (updatesCount === 0) {
            showToast('Bạn chưa chọn giáo viên mới nào để thay thế.', 'info');
            return;
        }

        try {
            await batch.commit();
            showToast(`Sửa lỗi thành công! Đã cập nhật ${updatesCount} lượt đăng ký.`, 'success');
            dataRepairContainer.innerHTML = `<p class="success-message">Đã hoàn tất việc sửa lỗi. Bạn có thể quét lại để kiểm tra.</p>`;
        } catch (error) {
            console.error("Lỗi khi thực hiện sửa lỗi hàng loạt:", error);
            showToast('Đã có lỗi xảy ra khi lưu thay đổi.', 'error');
        }
    };

    // --- SUBJECT MISMATCH REPAIR FUNCTIONS ---
    const findAndRepairSubjectMismatches = async () => {
        subjectRepairContainer.innerHTML = `<p><i class="fas fa-spinner fa-spin"></i> Đang quét dữ liệu môn học, vui lòng chờ...</p>`;

        try {
            // 1. Lấy tất cả giáo viên và tạo map UID -> teacherData
            const teachersQuery = query(collection(firestore, 'teachers'));
            const teachersSnapshot = await getDocs(teachersQuery);
            const teacherMap = new Map();
            teachersSnapshot.forEach(doc => {
                const data = doc.data();
                if (data.uid) { // Chỉ xử lý giáo viên đã có tài khoản
                    teacherMap.set(data.uid, data);
                }
            });

            // 2. Lấy tất cả lượt đăng ký
            const regsQuery = query(collection(firestore, 'registrations'));
            const regsSnapshot = await getDocs(regsQuery);

            // 3. Tìm các lượt đăng ký có môn học không khớp
            const mismatches = [];
            regsSnapshot.forEach(doc => {
                const regData = doc.data();
                const regId = doc.id;
                const teacher = teacherMap.get(regData.teacherId);

                // Chỉ kiểm tra nếu tìm thấy giáo viên và giáo viên đó có môn học chính được gán
                if (teacher && teacher.subject && regData.subject !== teacher.subject) {
                    // Kiểm tra các trường hợp ngoại lệ
                    const isBioException = teacher.subject === 'Sinh học' && regData.subject === 'Công nghệ nông nghiệp';
                    const isPhysicsException = teacher.subject === 'Vật lí' && regData.subject === 'Công nghệ công nghiệp';

                    if (!isBioException && !isPhysicsException) {
                        mismatches.push({
                            regId,
                            teacherName: teacher.teacher_name,
                            date: regData.date,
                            period: regData.period,
                            className: regData.className,
                            wrongSubject: regData.subject,
                            correctSubject: teacher.subject
                        });
                    }
                }
            });

            renderSubjectMismatchUI(mismatches);

        } catch (error) {
            console.error("Lỗi khi quét lỗi môn học:", error);
            subjectRepairContainer.innerHTML = `<p class="error-message">Đã có lỗi xảy ra trong quá trình quét. Vui lòng thử lại.</p>`;
            showToast('Quét dữ liệu thất bại!', 'error');
        }
    };

    const renderSubjectMismatchUI = (mismatches) => {
        if (mismatches.length === 0) {
            subjectRepairContainer.innerHTML = `<p class="success-message"><i class="fas fa-check-circle"></i> Không tìm thấy lượt đăng ký nào có môn học không khớp. Dữ liệu của bạn đã nhất quán!</p>`;
            return;
        }

        let tableRows = mismatches.map(m => `
            <tr>
                <td>${m.teacherName}</td>
                <td>${formatDate(m.date)}</td>
                <td style="text-align: center;">${m.period}</td>
                <td style="text-align: center;">${m.className}</td>
                <td style="color: red;">${m.wrongSubject}</td>
                <td style="color: green;">${m.correctSubject}</td>
            </tr>
        `).join('');

        subjectRepairContainer.innerHTML = `
            <div class="repair-header">
                <h4>Tìm thấy ${mismatches.length} lượt đăng ký có môn học không khớp:</h4>
                <button id="execute-subject-repair-btn" class="btn-danger"><i class="fas fa-check-double"></i> Sửa tất cả</button>
            </div>
            <table class="weekly-plan-table" style="margin-top: 15px;">
                <thead><tr><th>Giáo viên</th><th>Ngày</th><th>Tiết</th><th>Lớp</th><th>Môn học sai</th><th>Môn học đúng</th></tr></thead>
                <tbody>${tableRows}</tbody>
            </table>
        `;

        document.getElementById('execute-subject-repair-btn').addEventListener('click', async () => {
            const batch = writeBatch(firestore);
            mismatches.forEach(m => {
                const regRef = doc(firestore, 'registrations', m.regId);
                batch.update(regRef, { subject: m.correctSubject });
            });
            await batch.commit();
            showToast(`Đã sửa thành công ${mismatches.length} lượt đăng ký.`, 'success');
            subjectRepairContainer.innerHTML = `<p class="success-message">Đã hoàn tất việc sửa lỗi. Bạn có thể quét lại để kiểm tra.</p>`;
        });
    };

    // --- MISSING GROUPID REPAIR FUNCTIONS ---
    const findAndRepairMissingGroupId = async () => {
        groupIdRepairContainer.innerHTML = `<p><i class="fas fa-spinner fa-spin"></i> Đang quét dữ liệu, vui lòng chờ...</p>`;

        try {
            // 1. Lấy tất cả giáo viên và tạo map UID -> teacherData
            const teachersQuery = query(collection(firestore, 'teachers'));
            const teachersSnapshot = await getDocs(teachersQuery);
            const teacherMap = new Map();
            teachersSnapshot.forEach(doc => {
                const data = doc.data();
                if (data.uid) {
                    teacherMap.set(data.uid, data);
                }
            });

            // 2. Lấy tất cả lượt đăng ký trong năm học hiện tại
            const regsQuery = query(collection(firestore, 'registrations'), where('schoolYear', '==', currentSchoolYear));
            const regsSnapshot = await getDocs(regsQuery);

            // 3. Tìm các lượt đăng ký thiếu `groupId`
            const missingGroupIdRegs = [];
            regsSnapshot.forEach(doc => {
                const regData = doc.data();
                if (!regData.groupId && regData.teacherId) {
                    const teacher = teacherMap.get(regData.teacherId);
                    if (teacher && teacher.group_id) {
                        missingGroupIdRegs.push({
                            regId: doc.id,
                            teacherName: teacher.teacher_name,
                            date: regData.date,
                            period: regData.period,
                            className: regData.className,
                            subject: regData.subject,
                            correctGroupId: teacher.group_id
                        });
                    }
                }
            });

            renderMissingGroupIdUI(missingGroupIdRegs);

        } catch (error) {
            console.error("Lỗi khi quét lỗi thiếu groupId:", error);
            groupIdRepairContainer.innerHTML = `<p class="error-message">Đã có lỗi xảy ra trong quá trình quét. Vui lòng thử lại.</p>`;
            showToast('Quét dữ liệu thất bại!', 'error');
        }
    };

    const renderMissingGroupIdUI = (missingRegs) => {
        if (missingRegs.length === 0) {
            groupIdRepairContainer.innerHTML = `<p class="success-message"><i class="fas fa-check-circle"></i> Không tìm thấy lượt đăng ký nào thiếu ID Tổ. Dữ liệu của bạn đã nhất quán!</p>`;
            return;
        }

        let tableRows = missingRegs.map(m => `
            <tr>
                <td>${m.teacherName}</td>
                <td>${formatDate(m.date)}</td>
                <td style="text-align: center;">${m.period}</td>
                <td style="text-align: center;">${m.className}</td>
                <td>${m.subject}</td>
                <td style="color: green;">${m.correctGroupId}</td>
            </tr>
        `).join('');

        groupIdRepairContainer.innerHTML = `
            <div class="repair-header">
                <h4>Tìm thấy ${missingRegs.length} lượt đăng ký thiếu ID Tổ:</h4>
                <button id="execute-groupid-repair-btn" class="btn-danger"><i class="fas fa-check-double"></i> Sửa tất cả</button>
            </div>
            <table class="weekly-plan-table" style="margin-top: 15px;">
                <thead><tr><th>Giáo viên</th><th>Ngày</th><th>Tiết</th><th>Lớp</th><th>Môn học</th><th>ID Tổ cần cập nhật</th></tr></thead>
                <tbody>${tableRows}</tbody>
            </table>
        `;

        document.getElementById('execute-groupid-repair-btn').addEventListener('click', async () => {
            const batch = writeBatch(firestore);
            missingRegs.forEach(m => {
                const regRef = doc(firestore, 'registrations', m.regId);
                batch.update(regRef, { groupId: m.correctGroupId });
            });

            await batch.commit();
            showToast(`Đã cập nhật thành công ${missingRegs.length} lượt đăng ký.`, 'success');
            groupIdRepairContainer.innerHTML = `<p class="success-message">Đã hoàn tất việc sửa lỗi. Bạn có thể quét lại để kiểm tra.</p>`;
        });
    };

    // --- REGISTRATION RULES FUNCTIONS ---
    const loadAndRenderRules = async () => {
        const rules = [
            { id: 'none', title: 'Không giới hạn', description: 'Giáo viên có thể đăng ký/sửa tiết dạy bất kỳ lúc nào.' },
            { id: 'no-past-dates', title: 'Không đăng ký cho quá khứ', description: 'Giáo viên không thể đăng ký hoặc sửa các ngày đã qua.' },
            { id: 'current-month-before-report', title: 'Trong tháng, trước ngày chốt báo cáo', description: 'Giáo viên chỉ được đăng ký các ngày trong tháng hiện tại, và chỉ khi ngày hiện tại chưa vượt qua ngày chốt báo cáo của tháng.' },
            { id: 'next-week-only', title: 'Chỉ cho tuần kế tiếp', description: 'Giáo viên chỉ được đăng ký các ngày thuộc tuần học kế tiếp tuần hiện tại.' }
        ];

        try {
            const schoolYearDocRef = await getSchoolYearDocRef(currentSchoolYear);
            let currentRule = 'none'; // Mặc định
            if (schoolYearDocRef) {
                const docSnap = await getDoc(schoolYearDocRef);
                currentRule = docSnap.exists() && docSnap.data().registrationRule ? docSnap.data().registrationRule : 'none';
            }
            
            rulesContainer.innerHTML = rules.map(rule => `
                <div class="rule-option">
                    <input type="radio" id="rule-${rule.id}" name="registrationRule" value="${rule.id}" ${currentRule === rule.id ? 'checked' : ''}>
                    <label for="rule-${rule.id}">
                        <strong>${rule.title}</strong>
                        <p>${rule.description}</p>
                    </label>
                </div>
            `).join('');

        } catch (error) {
            console.error("Lỗi khi tải quy tắc:", error);
            rulesContainer.innerHTML = `<p class="error-message">Không thể tải cài đặt quy tắc.</p>`;
        }
    };

    const saveRegistrationRule = async () => {
        const selectedRuleInput = document.querySelector('input[name="registrationRule"]:checked');
        if (!selectedRuleInput) {
            showToast('Vui lòng chọn một quy tắc.', 'info');
            return;
        }

        const ruleId = selectedRuleInput.value;
        const schoolYearDocRef = await getSchoolYearDocRef(currentSchoolYear);

        if (!schoolYearDocRef) {
            showToast('Không tìm thấy năm học để lưu quy tắc.', 'error');
            return;
        }

        try {
            await updateDoc(schoolYearDocRef, { registrationRule: ruleId });
            showToast('Đã lưu quy tắc đăng ký thành công!', 'success');
        } catch (error) {
            console.error("Lỗi khi lưu quy tắc:", error);
            showToast('Không thể lưu quy tắc. Vui lòng thử lại.', 'error');
        }
    };
    // --- Hàm render ---
    const renderTeacher = (teacher, index) => {
        const name = teacher.teacher_name || 'Chưa có tên';
        const subjectPart = teacher.subject ? `[${teacher.subject}]` : '';
        const emailPart = teacher.email ? ` (${teacher.email})` : ''; // Chỉ thêm email nếu tồn tại

        return `
            <li class="teacher-item" data-teacher-id="${teacher.id}">
                <div class="teacher-info">
                    <i class="fas fa-grip-vertical teacher-drag-handle"></i>
                    <span class="teacher-stt">${index + 1}.</span>
                    <span class="teacher-name" title="${teacher.uid || 'Chưa có tài khoản'}">${name}${emailPart}</span>
                    <span class="teacher-subject">${subjectPart}</span>
                </div>
                <div class="item-actions teacher-actions">
                    <button class="edit-teacher-btn" title="Sửa"><i class="fas fa-pencil-alt"></i></button>
                    <button class="delete-teacher-btn" title="Xóa"><i class="fas fa-trash-alt"></i></button>
                </div>
            </li>
        `;
    };

    const renderGroup = (group, index) => `
        <div class="group-card collapsed" data-group-id="${group.id}">
            <div class="group-header">
                <div class="group-title-container">
                    <h3 class="group-name"><span class="group-stt">${index + 1}.</span> Tổ ${group.group_name}</h3>
                </div>
                <i class="fas fa-chevron-down collapse-icon"></i>
                <div class="item-actions">
                    <button class="edit-group-btn" title="Sửa tên tổ"><i class="fas fa-pencil-alt"></i></button>
                    <button class="delete-group-btn" title="Xóa tổ"><i class="fas fa-trash-alt"></i></button>
                </div>
            </div>
            <ul class="teacher-list">
                ${group.teachers.map((teacher, index) => renderTeacher(teacher, index)).join('')}
            </ul>
            <button class="add-teacher-btn"><i class="fas fa-plus"></i> Thêm Giáo viên</button>
        </div>
    `;

    const renderMethod = (method, index) => `
        <div class="item-card" data-method-id="${method.id}">
            <div class="item-info">
                <i class="fas fa-lightbulb method-icon"></i>
                <span class="item-stt">${index + 1}.</span>
                <span class="item-name">${method.method}</span>
            </div>
            <div class="item-actions">
                <button class="edit-method-btn" title="Sửa"><i class="fas fa-pencil-alt"></i></button>
                <button class="delete-method-btn" title="Xóa"><i class="fas fa-trash-alt"></i></button>
            </div>
        </div>
    `;

    const renderWeeklyPlan = (weeks) => {
        if (weeks.length === 0) {
            weeklyPlanContainer.innerHTML = '<p>Chưa có kế hoạch thời gian cho năm học này. Hãy chọn ngày bắt đầu và tạo kế hoạch.</p>';
            return;
        }
 
        // Lấy giá trị cấu hình từ input hoặc từ dữ liệu đã lưu
        const planConfig = weeks.length > 0 ? weeks[0].planConfig : {};
        const reportDay = planConfig.reportDay || parseInt(document.getElementById('report-day-input').value) || 23;
        const semester1EndWeek = planConfig.semester1EndWeek || parseInt(document.getElementById('semester-end-week-input').value) || 19;
 
        // Cập nhật giá trị trên giao diện
        document.getElementById('report-day-input').value = reportDay;
        document.getElementById('semester-end-week-input').value = semester1EndWeek;
 
        const sortedWeeks = weeks.sort((a, b) => a.weekNumber - b.weekNumber);
 
        // Logic tính toán tháng báo cáo
        let currentReportingMonth;
        let currentReportingYear;
        const firstWeekDate = new Date(sortedWeeks[0].startDate.replace(/-/g, '/'));
        const firstWeekCutoff = new Date(firstWeekDate.getFullYear(), firstWeekDate.getMonth(), reportDay);

        if (firstWeekDate <= firstWeekCutoff) {
            currentReportingMonth = firstWeekDate.getMonth() + 1; // JS month is 0-indexed
            currentReportingYear = firstWeekDate.getFullYear();
        } else {
            currentReportingMonth = firstWeekDate.getMonth() + 2;
            if (currentReportingMonth > 12) {
                currentReportingMonth = 1;
                currentReportingYear = firstWeekDate.getFullYear() + 1;
            } else {
                currentReportingYear = firstWeekDate.getFullYear();
            }
        }
 
        const tableRows = sortedWeeks.map(week => {
            const weekStartDate = new Date(week.startDate.replace(/-/g, '/'));
            const cutoffDate = new Date(currentReportingYear, currentReportingMonth - 1, reportDay); // JS month is 0-indexed

            if (weekStartDate > cutoffDate) {
                currentReportingMonth++;
                if (currentReportingMonth > 12) {
                    currentReportingMonth = 1;
                    currentReportingYear++;
                }
            }
            const semester = week.weekNumber <= semester1EndWeek ? 'Học kỳ I' : 'Học kỳ II';
 
            return `
            <tr data-week-id="${week.id}">
                <td>${week.weekNumber}</td>
                <td>${semester}</td>
                <td>Tháng ${currentReportingMonth}</td>
                <td>${formatDate(week.startDate)}</td>
                <td>${formatDate(week.endDate)}</td>
                <td><button class="edit-week-btn icon-button" title="Chỉnh sửa tuần"><i class="fas fa-pencil-alt"></i></button></td>
            </tr>
        `}).join('');
 
        weeklyPlanContainer.innerHTML = `
            <table class="weekly-plan-table">
                <thead><tr><th>Tuần</th><th>Học kỳ</th><th>Tháng báo cáo</th><th>Từ ngày</th><th>Đến ngày</th><th>Hành động</th></tr></thead>
                <tbody>${tableRows}</tbody>
            </table>`;
    };

    // --- Hàm khởi tạo kéo-thả ---
    const initSortable = () => {
        // Kéo-thả chỉ áp dụng cho danh sách giáo viên
        document.querySelectorAll('.teacher-list').forEach(list => {
            new Sortable(list, {
                animation: 150,
                ghostClass: 'sortable-ghost', // Class cho "bóng ma" khi kéo
                chosenClass: 'sortable-chosen', // Class cho mục đang được chọn
                handle: '.teacher-drag-handle', // Chỉ cho phép kéo khi giữ vào icon này
                dragClass: 'sortable-drag', // Class cho mục đang được kéo
                onEnd: async (evt) => {
                    const items = evt.to.children;
                    const batch = writeBatch(firestore);

                    Array.from(items).forEach((item, index) => {
                        // Cập nhật STT trên giao diện ngay lập tức
                        const sttSpan = item.querySelector('.teacher-stt');
                        if (sttSpan) {
                            sttSpan.textContent = `${index + 1}.`;
                        }

                        // Chuẩn bị cập nhật 'order' trong Firestore
                        const teacherId = item.dataset.teacherId;
                        const teacherRef = doc(firestore, 'teachers', teacherId);
                        batch.update(teacherRef, { order: index });
                    });
                    
                    try {
                        await batch.commit();
                        showToast('Đã cập nhật thứ tự giáo viên.', 'success');
                    } catch (error) {
                        console.error("Lỗi khi cập nhật thứ tự:", error);
                        showToast('Không thể cập nhật thứ tự.', 'error');
                    }
                },
            });
        });
    };

    // --- Hàm tải dữ liệu ---
    const loadGroupsAndTeachers = async (schoolYear) => {
        groupsContainer.innerHTML = '<p>Đang tải danh sách...</p>';
        try {
            // 1. Tải tất cả các tổ và tạo một map để dễ tra cứu, sắp xếp theo 'order'
            // Bỏ orderBy ở đây để tải tất cả các tổ, kể cả những tổ cũ không có trường 'order'
            const groupsQuery = query(collection(firestore, 'groups'), where("schoolYear", "==", schoolYear));
            const groupsSnapshot = await getDocs(groupsQuery);
            
            // Tạo một mảng các tổ và một map để tra cứu nhanh
            const groups = [];
            const groupMap = new Map();
            groupsSnapshot.forEach(doc => {
                const groupData = { id: doc.id, ...doc.data(), teachers: [] };
                groups.push(groupData);
                groupMap.set(groupData.group_id, groupData);
            });

            // Sắp xếp các tổ trên client-side để xử lý các tổ không có trường 'order'
            groups.sort((a, b) => {
                const orderA = a.order ?? Infinity; // Nếu order không tồn tại, coi là vô cực
                const orderB = b.order ?? Infinity; // để xếp chúng xuống cuối danh sách
                return orderA - orderB;
            });

            // 2. Tải tất cả giáo viên, sắp xếp theo thứ tự của họ
            // Cần phải lấy tất cả giáo viên vì họ không có schoolYearId trực tiếp.
            const teachersQuery = query(collection(firestore, 'teachers'), orderBy('order')); 
            const teachersSnapshot = await getDocs(teachersQuery);

            // 3. Phân loại giáo viên vào các tổ tương ứng
            teachersSnapshot.forEach(doc => {
                const teacher = { id: doc.id, ...doc.data() };
                if (teacher.group_id && groupMap.has(teacher.group_id)) {
                     groupMap.get(teacher.group_id).teachers.push(teacher);
                } else {
                     console.warn(` -> Cảnh báo: Không tìm thấy tổ "${teacher.group_id}" cho giáo viên "${teacher.teacher_name}".`);
                }
            });


            if (groups.length === 0 && teachersSnapshot.empty) {
                groupsContainer.innerHTML = '<p>Chưa có tổ chuyên môn nào. Hãy thêm một tổ mới!</p>';
            } else {
                groupsContainer.innerHTML = groups.map((group, index) => renderGroup(group, index)).join('');
                
                // 5. Khởi tạo chức năng kéo-thả sau khi đã render xong
                initSortable();
            }
        } catch (error) {
            console.error("Lỗi khi tải dữ liệu:", error);
            let errorMessage = '<p class="error-message">Không thể tải dữ liệu. Vui lòng thử lại.</p>';
            // Kiểm tra lỗi thiếu index của Firestore
            if (error.code === 'failed-precondition') {
                errorMessage = `
                    <div class="error-message">
                        <p><strong>Lỗi cấu hình Firestore:</strong> Cần phải tạo chỉ mục (index).</p>
                        <p>Vui lòng kiểm tra console (nhấn F12) để thấy link tạo chỉ mục tự động từ Firebase, hoặc tạo thủ công trong Firestore.</p>
                    </div>
                `;
            }
            groupsContainer.innerHTML = errorMessage;
        }
    };

    const loadMethods = async (schoolYear) => {
        methodsContainer.innerHTML = '<p>Đang tải danh sách...</p>';
        try {
            const methodsQuery = query(
                collection(firestore, 'teachingMethods'), 
                where("schoolYear", "==", schoolYear),
                orderBy('method')
            );
            const snapshot = await getDocs(methodsQuery);

            if (snapshot.empty) {
                methodsContainer.innerHTML = '<p>Chưa có phương pháp dạy học nào cho năm học này.</p>';
            } else {
                const methods = [];
                snapshot.forEach(doc => methods.push({ id: doc.id, ...doc.data() }));
                methodsContainer.innerHTML = methods.map((method, index) => renderMethod(method, index)).join('');
            }
        } catch (error) {
            console.error("Lỗi khi tải phương pháp dạy học:", error);
            let errorMessage = '<p class="error-message">Không thể tải dữ liệu phương pháp dạy học.</p>';
            if (error.code === 'failed-precondition') {
                errorMessage = `
                    <div class="error-message">
                        <p><strong>Lỗi cấu hình Firestore:</strong> Cần phải tạo chỉ mục (index) cho collection 'teachingMethods'.</p>
                        <p>Vui lòng kiểm tra console (nhấn F12) để thấy link tạo chỉ mục tự động từ Firebase.</p>
                    </div>
                `;
            }
            methodsContainer.innerHTML = errorMessage;
        }
    };

    const loadTimePlan = async (schoolYear) => {
        weeklyPlanContainer.innerHTML = '<p>Đang tải kế hoạch...</p>';
        document.getElementById('school-year-start-date').value = ''; // Reset input
        try {
            const planQuery = query(
                collection(firestore, 'timePlans'),
                where("schoolYear", "==", schoolYear)
            );
            const snapshot = await getDocs(planQuery);
            const weeks = [];
            let planDocId = null;
            let planConfig = {}; // Lưu cấu hình
            if (!snapshot.empty) {
                const planDoc = snapshot.docs[0];
                planDocId = planDoc.id;
                planConfig = { reportDay: planDoc.data().reportDay, semester1EndWeek: planDoc.data().semester1EndWeek };
                const weeksCollection = collection(firestore, 'timePlans', planDocId, 'weeks');
                const weeksSnapshot = await getDocs(weeksCollection);
                // Gắn cấu hình vào mỗi tuần để dễ truy cập
                weeksSnapshot.forEach(doc => weeks.push({ id: doc.id, ...doc.data(), planConfig }));
            }
            renderWeeklyPlan(weeks);
        } catch (error) {
            console.error("Lỗi khi tải kế hoạch thời gian:", error);
            weeklyPlanContainer.innerHTML = '<p class="error-message">Không thể tải kế hoạch thời gian.</p>';
        }
    };

    // --- Hàm tải và xử lý Năm học ---
    const loadSchoolYears = async () => {
        schoolYearSelect.innerHTML = '<option>Đang tải...</option>';
        try {
            const yearsQuery = query(collection(firestore, 'schoolYears'), orderBy('schoolYear', 'desc'));
            const snapshot = await getDocs(yearsQuery);

            if (snapshot.empty) {
                schoolYearSelect.innerHTML = '<option>Chưa có năm học</option>';
                groupsContainer.innerHTML = '<p>Vui lòng tạo một năm học mới để bắt đầu.</p>';
                return;
            }

            schoolYearSelect.innerHTML = '';
            snapshot.forEach(doc => {
                const year = { id: doc.id, ...doc.data() };
                const option = document.createElement('option');
                option.value = year.schoolYear; // Sử dụng chuỗi năm học làm value
                option.textContent = year.schoolYear; // và làm text hiển thị
                schoolYearSelect.appendChild(option);
            });

            // Tự động chọn năm học đầu tiên và tải dữ liệu
            if (schoolYearSelect.options.length > 0) {
                schoolYearSelect.selectedIndex = 0;
                currentSchoolYear = schoolYearSelect.value;
                await loadGroupsAndTeachers(currentSchoolYear);
                await loadMethods(currentSchoolYear); // Tải PPDH khi chọn năm học
                await loadTimePlan(currentSchoolYear);
                await loadAndRenderRules(); // Tải quy tắc khi chọn năm học
            }

        } catch (error) {
            console.error("Lỗi khi tải danh sách năm học:", error);
            schoolYearSelect.innerHTML = '<option>Lỗi tải dữ liệu</option>';
        }
    };

    // --- Xử lý sự kiện thay đổi năm học ---
    schoolYearSelect.addEventListener('change', async () => {
        currentSchoolYear = schoolYearSelect.value;
        if (currentSchoolYear) {
            await loadGroupsAndTeachers(currentSchoolYear);
            await loadMethods(currentSchoolYear); // Tải lại PPDH khi đổi năm học
            await loadTimePlan(currentSchoolYear);
            await loadAndRenderRules();
        }
    });

    // --- Hàm xử lý Modal ---
    const openModal = (modal) => modal.style.display = 'flex';
    const closeModal = (modal) => modal.style.display = 'none';

    // Đóng modal khi click ra ngoài
    [groupModal, teacherModal, confirmDeleteModal, schoolYearModal, methodModal, weekEditModal].forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal(modal);
        });
    });

    // Nút hủy trên các modal
    document.getElementById('cancel-group-modal').addEventListener('click', () => closeModal(groupModal));
    document.getElementById('cancel-teacher-modal').addEventListener('click', () => closeModal(teacherModal));
    document.getElementById('cancel-delete-btn').addEventListener('click', () => closeModal(confirmDeleteModal));
    document.getElementById('cancel-school-year-modal').addEventListener('click', () => closeModal(schoolYearModal));
    document.getElementById('cancel-method-modal').addEventListener('click', () => closeModal(methodModal));
    document.getElementById('cancel-week-edit-modal').addEventListener('click', () => closeModal(weekEditModal));

    // --- Xử lý sự kiện ---

    // Mở modal thêm Tổ
    document.getElementById('add-group-btn').addEventListener('click', () => {
        currentEditingId = null;
        document.getElementById('group-modal-title').textContent = 'Thêm Tổ chuyên môn';
        document.getElementById('group-name-input').value = '';
        openModal(groupModal);
    });

    // Mở modal thêm Năm học
    document.getElementById('add-school-year-btn').addEventListener('click', () => {
        document.getElementById('school-year-name-input').value = '';
        openModal(schoolYearModal);
    });

    // Mở modal thêm Phương pháp dạy học
    document.getElementById('add-method-btn').addEventListener('click', () => {
        currentEditingId = null;
        document.getElementById('method-modal-title').textContent = 'Thêm Phương pháp dạy học';
        document.getElementById('method-name-input').value = '';
        openModal(methodModal);
    });

    // Lưu Năm học mới
    document.getElementById('save-school-year-btn').addEventListener('click', async () => {
        const yearName = document.getElementById('school-year-name-input').value.trim();
        if (!yearName.match(/^\d{4}-\d{4}$/)) {
            showToast('Vui lòng nhập năm học đúng định dạng (VD: 2024-2025).', 'error');
            return;
        }

        try {
            await addDoc(collection(firestore, 'schoolYears'), { schoolYear: yearName });
            showToast(`Đã thêm năm học ${yearName}`, 'success');
            closeModal(schoolYearModal);
            await loadSchoolYears(); // Tải lại danh sách năm học
        } catch (error) {
            console.error("Lỗi khi lưu năm học:", error);
            showToast('Đã có lỗi xảy ra khi lưu năm học.', 'error');
        }
    });

    // Lưu Tổ (Thêm mới hoặc Cập nhật)
    document.getElementById('save-group-btn').addEventListener('click', async () => {
        const group_name = document.getElementById('group-name-input').value.trim();
        if (!group_name) {
            showToast('Vui lòng nhập tên tổ.', 'error');
            return;
        }

        try {
            if (currentEditingId) { // Cập nhật
                const groupRef = doc(firestore, 'groups', currentEditingId);
                await updateDoc(groupRef, { group_name });
            } else { // Thêm mới
                // Tự động tạo group_id từ tên tổ
                // Ví dụ: "Tổ Toán - Tin" -> "TO-TOAN-TIN"
                const groupId = 'TO-' + group_name.toUpperCase()
                    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Bỏ dấu
                    .replace(/Đ/g, "D") // Xử lý chữ Đ
                    .replace(/[^A-Z0-9\s-]/g, "") // Bỏ ký tự đặc biệt
                    .trim()
                    .replace(/\s+/g, '-'); // Thay khoảng trắng bằng gạch nối

                if (!currentSchoolYear) {
                    showToast('Vui lòng chọn một năm học trước khi thêm tổ.', 'error');
                    return;
                }

                // Lấy số lượng tổ hiện tại để gán thứ tự cho tổ mới ở cuối danh sách
                const groupsInYearQuery = query(collection(firestore, 'groups'), where("schoolYear", "==", currentSchoolYear));
                const groupsInYearSnapshot = await getDocs(groupsInYearQuery);
                const newOrder = groupsInYearSnapshot.size;

                await addDoc(collection(firestore, 'groups'), { 
                    group_name: group_name,
                    group_id: groupId,
                    order: newOrder,
                    schoolYear: currentSchoolYear // Thêm chuỗi năm học
                });
            }
            closeModal(groupModal);
            await loadGroupsAndTeachers(currentSchoolYear);
        } catch (error) {
            console.error("Lỗi khi lưu tổ:", error);
            showToast('Đã có lỗi xảy ra khi lưu tổ.', 'error');
        }
    });

    // Lưu Phương pháp dạy học (Thêm mới hoặc Cập nhật)
    document.getElementById('save-method-btn').addEventListener('click', async () => {
        const methodName = document.getElementById('method-name-input').value.trim();
        if (!methodName) {
            showToast('Vui lòng nhập tên phương pháp.', 'error');
            return;
        }
        if (!currentSchoolYear) {
            showToast('Vui lòng chọn một năm học trước.', 'error');
            return;
        }

        try {
            const data = {
                method: methodName,
                schoolYear: currentSchoolYear
            };

            if (currentEditingId) { // Cập nhật
                const methodRef = doc(firestore, 'teachingMethods', currentEditingId);
                await updateDoc(methodRef, data);
            } else { // Thêm mới
                await addDoc(collection(firestore, 'teachingMethods'), data);
            }
            closeModal(methodModal);
            await loadMethods(currentSchoolYear);
        } catch (error) {
            console.error("Lỗi khi lưu phương pháp dạy học:", error);
            showToast('Đã có lỗi xảy ra khi lưu.', 'error');
        }
    });

    // Lưu Giáo viên (Thêm mới hoặc Cập nhật)
    document.getElementById('save-teacher-btn').addEventListener('click', async () => {
        const isEditMode = !!currentEditingId;
        try {
            if (isEditMode) { // Cập nhật thông tin giáo viên
                const teacher_name = document.getElementById('teacher-names-input').value.trim();
                const subject = document.getElementById('teacher-subject-input').value;
                const teacherRef = doc(firestore, 'teachers', currentEditingId);
                // Chỉ cập nhật môn học nếu nó được hiển thị và có giá trị
                await updateDoc(teacherRef, { teacher_name, ...(subject && { subject }) });
            } else { // Thêm mới nhiều giáo viên
                const namesInput = document.getElementById('teacher-names-input').value;
                const names = namesInput.split('\n')
                                        .map(name => name.trim())
                                        .filter(name => name.length > 0);

                if (names.length === 0) {
                    showToast('Vui lòng nhập ít nhất một tên giáo viên.', 'error');
                    return;
                }
                const subject = document.getElementById('teacher-subject-input').value;

                const batch = writeBatch(firestore);
                // Lấy số lượng giáo viên hiện tại trong tổ để xác định thứ tự bắt đầu
                const groupCard = document.querySelector(`.group-card[data-group-id="${currentGroupId}"]`);
                const startOrder = groupCard ? groupCard.querySelectorAll('.teacher-item').length : 0;

                names.forEach((name, index) => {
                    const newTeacherRef = doc(collection(firestore, "teachers"));
                    batch.set(newTeacherRef, {
                        teacher_name: name,
                        email: '',
                        phone: '',
                        group_id: currentGroupId,
                        uid: null,
                        order: startOrder + index, // Gán thứ tự cho giáo viên mới
                        subject: subject || null // Lưu môn học đã chọn
                    });
                });

                await batch.commit();
                showToast(`Đã thêm thành công ${names.length} giáo viên.`, 'success');
            }
            closeModal(teacherModal);
            await loadGroupsAndTeachers(currentSchoolYear);
        } catch (error) {
            console.error("Lỗi khi lưu giáo viên:", error.code, error.message);
            showToast('Đã có lỗi xảy ra. Vui lòng kiểm tra lại thông tin.', 'error');
        }
    });

    // Tạo kế hoạch thời gian
    document.getElementById('generate-plan-btn').addEventListener('click', async () => {
        const startDateString = document.getElementById('school-year-start-date').value;
        const reportDay = parseInt(document.getElementById('report-day-input').value);
        const semester1EndWeek = parseInt(document.getElementById('semester-end-week-input').value);
        if (!startDateString) {
            showToast('Vui lòng chọn ngày bắt đầu năm học.', 'error');
            return;
        }
        if (!currentSchoolYear) {
            showToast('Vui lòng chọn một năm học.', 'error');
            return;
        }

        const startDate = new Date(startDateString.replace(/-/g, '/'));
        if (startDate.getDay() !== 1) { // 0 = Sunday, 1 = Monday
            showToast('Ngày bắt đầu phải là một ngày Thứ Hai.', 'error');
            return;
        }

        try {
            const planCollectionRef = collection(firestore, 'timePlans');
            // Kiểm tra xem kế hoạch đã tồn tại chưa
            const planQuery = query(planCollectionRef, where("schoolYear", "==", currentSchoolYear));
            const existingPlan = await getDocs(planQuery);

            if (!existingPlan.empty) {
                // Nếu kế hoạch đã tồn tại, chỉ cập nhật cấu hình
                const planDocRef = existingPlan.docs[0].ref;
                await updateDoc(planDocRef, {
                    reportDay: reportDay,
                    semester1EndWeek: semester1EndWeek
                });
                showToast('Đã cập nhật cấu hình kế hoạch.', 'success');
                await loadTimePlan(currentSchoolYear);
                return;
            }

            const batch = writeBatch(firestore);
            const planRef = doc(planCollectionRef);
            batch.set(planRef, { 
                schoolYear: currentSchoolYear, startDate: startDateString, reportDay: reportDay, semester1EndWeek: semester1EndWeek 
            });

            let currentWeekStart = startDate;
            for (let i = 1; i <= 37; i++) {
                const weekRef = doc(collection(firestore, planRef.path, 'weeks'));
                const weekEnd = new Date(currentWeekStart);
                weekEnd.setDate(weekEnd.getDate() + 6); // Tuần có 7 ngày, kết thúc vào Chủ Nhật

                batch.set(weekRef, {
                    weekNumber: i,
                    startDate: formatDateToYYYYMMDD(currentWeekStart),
                    endDate: formatDateToYYYYMMDD(weekEnd),
                });

                // Chuẩn bị cho tuần tiếp theo
                currentWeekStart.setDate(currentWeekStart.getDate() + 7);
            }

            await batch.commit();
            showToast('Đã tạo thành công kế hoạch 37 tuần.', 'success');
            await loadTimePlan(currentSchoolYear);

        } catch (error) {
            console.error("Lỗi khi tạo kế hoạch thời gian:", error);
            showToast('Đã có lỗi xảy ra khi tạo kế hoạch.', 'error');
        }
    });

    // Lưu chỉnh sửa tuần
    document.getElementById('save-week-btn').addEventListener('click', async () => {
        const newStartDate = document.getElementById('week-start-date-input').value;
        const newEndDate = document.getElementById('week-end-date-input').value;
        // Logic lưu tuần sẽ được thêm vào event listener của container
        // Đây chỉ là ví dụ, logic thực tế sẽ nằm trong event delegation
    });

    // Xử lý chuyển tab
    document.querySelector('.tab-nav').addEventListener('click', (e) => {
        const tabLink = e.target.closest('.tab-link');
        if (tabLink) {
            // Xóa active class khỏi tất cả các link và content
            document.querySelectorAll('.tab-link').forEach(link => link.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

            // Thêm active class cho link và content được click
            const tabId = tabLink.dataset.tab;
            tabLink.classList.add('active');
            document.getElementById(tabId).classList.add('active');
        }
    });

    // --- Sửa lỗi dữ liệu ---
    findOrphanedRegsBtn.addEventListener('click', findAndRepairOrphanedRegs);

    // --- Sửa lỗi môn học ---
    findSubjectMismatchBtn.addEventListener('click', findAndRepairSubjectMismatches);

    // --- Sửa lỗi thiếu groupId ---
    findMissingGroupIdBtn.addEventListener('click', findAndRepairMissingGroupId);

    // --- Lưu quy tắc đăng ký ---
    saveRulesBtn.addEventListener('click', saveRegistrationRule);

    // Xử lý click trong container của các tổ (delegation)
    groupsContainer.addEventListener('click', async (e) => {
        const target = e.target;

        // Lấy group card và group id
        const groupCard = target.closest('.group-card');
        const groupId = groupCard?.dataset.groupId;

        // Xử lý thu gọn/mở rộng tổ
        if (target.closest('.group-header')) {
            // Chỉ thu gọn khi click vào header, không phải các nút action
            if (!target.closest('.item-actions')) {
                // Toggle trạng thái của card được click
                groupCard.classList.toggle('collapsed');

                // Thu gọn tất cả các tổ khác
                document.querySelectorAll('.group-card').forEach(card => {
                    if (card !== groupCard) card.classList.add('collapsed');
                });
            }
        }

        // Mở modal thêm Giáo viên
        if (target.closest('.add-teacher-btn')) {
            // Lấy group_id từ data attribute của group-card
            const groupDocRef = doc(firestore, 'groups', groupId);
            const groupDocSnap = await getDoc(groupDocRef);
            if (groupDocSnap.exists()) {
                currentGroupId = groupDocSnap.data().group_id; // Lấy mã tổ (vd: 'TOAN')

                // Populate subject dropdown in teacher modal
                const groupName = groupDocSnap.data().group_name;
                const subjects = getSubjectsFromGroupName(groupName);
                const subjectSelect = document.getElementById('teacher-subject-input');
                subjectSelect.innerHTML = '<option value="">-- Chọn môn chính --</option>';
                subjects.forEach(sub => {
                    subjectSelect.innerHTML += `<option value="${sub}">${sub}</option>`;
                });

                // Hiển thị/ẩn ô chọn môn học
                if (subjects.length > 1) {
                    teacherSubjectGroup.style.display = 'block';
                } else {
                    teacherSubjectGroup.style.display = 'none';
                    subjectSelect.value = subjects[0] || ''; // Tự chọn nếu chỉ có 1 môn
                }
            }

            currentEditingId = null; // Đảm bảo đây là chế độ thêm mới
            document.getElementById('teacher-modal-title').textContent = 'Thêm Giáo viên';
            document.getElementById('teacher-form').reset(); // Xóa sạch các trường input
            openModal(teacherModal);
        }

        // Mở modal sửa Tổ
        if (target.closest('.edit-group-btn')) {
            try {
                const groupRef = doc(firestore, 'groups', groupId);
                const groupSnap = await getDoc(groupRef);
                if (groupSnap.exists()) {
                    currentEditingId = groupId;
                    document.getElementById('group-modal-title').textContent = 'Sửa tên Tổ';
                    document.getElementById('group-name-input').value = groupSnap.data().group_name;
                    openModal(groupModal);
                }
            } catch (error) {
                showToast('Không thể lấy thông tin tổ. Vui lòng thử lại.', 'error');
            }
        }

        // Mở modal sửa Giáo viên
        if (target.closest('.edit-teacher-btn')) {
            const teacherItem = target.closest('.teacher-item');
            const teacherId = teacherItem.dataset.teacherId;
            currentEditingId = teacherId;

            // Lấy thông tin giáo viên trực tiếp từ DB
            try {
                const teacherRef = doc(firestore, 'teachers', teacherId);
                const teacherSnap = await getDoc(teacherRef);
                if (teacherSnap.exists()) {
                    const teacherData = teacherSnap.data();
                    document.getElementById('teacher-modal-title').textContent = 'Sửa thông tin Giáo viên';
                    document.getElementById('teacher-names-input').value = teacherData.teacher_name || '';
                    document.getElementById('teacher-names-input').rows = 1; // Chỉ sửa 1 tên

                    // Populate và set giá trị cho subject dropdown
                    const groupRef = doc(firestore, 'groups', groupId);
                    const groupSnap = await getDoc(groupRef);
                    const groupName = groupSnap.exists() ? groupSnap.data().group_name : '';
                    const subjects = getSubjectsFromGroupName(groupName);
                    const subjectSelect = document.getElementById('teacher-subject-input');
                    subjectSelect.innerHTML = '<option value="">-- Chọn môn chính --</option>';
                    subjects.forEach(sub => {
                        subjectSelect.innerHTML += `<option value="${sub}">${sub}</option>`;
                    });
                    subjectSelect.value = teacherData.subject || '';

                    if (subjects.length > 1) {
                        teacherSubjectGroup.style.display = 'block';
                    } else {
                        teacherSubjectGroup.style.display = 'none';
                    }

                    openModal(teacherModal);
                }
            } catch (error) {
                console.error("Lỗi khi lấy thông tin giáo viên để sửa:", error);
                showToast("Không thể lấy thông tin giáo viên. Vui lòng thử lại.", 'error');
            }
        }

        // Mở modal xác nhận xóa Tổ
        if (target.closest('.delete-group-btn')) {
            document.getElementById('confirm-delete-message').textContent = `Bạn có chắc chắn muốn xóa tổ này và TOÀN BỘ giáo viên trong tổ? Hành động này không thể hoàn tác.`;
            deleteFunction = async () => {
                try {
                    const batch = writeBatch(firestore);
                    const groupDocRef = doc(firestore, 'groups', groupId);
                    const groupDocSnap = await getDoc(groupDocRef);
                    const groupData = groupDocSnap.data();

                    // Tìm và xóa tất cả giáo viên thuộc tổ này trong collection `teachers`
                    const teachersQuery = query(collection(firestore, "teachers"), where("group_id", "==", groupData.group_id));
                    const teachersSnapshot = await getDocs(teachersQuery);
                    teachersSnapshot.forEach(doc => batch.delete(doc.ref));
                    // Xóa chính tổ đó
                    batch.delete(groupDocRef);
                    await batch.commit();
                    
                    closeModal(confirmDeleteModal);
                    await loadGroupsAndTeachers(currentSchoolYear);
                } catch (error) {
                    console.error("Lỗi khi xóa tổ:", error);
                    showToast('Đã có lỗi xảy ra khi xóa tổ.', 'error');
                }
            };
            openModal(confirmDeleteModal);

        }

        // Mở modal xác nhận xóa Giáo viên
        if (target.closest('.delete-teacher-btn')) {
            const teacherItem = target.closest('.teacher-item');
            const teacherId = teacherItem.dataset.teacherId;
            const teacherName = teacherItem.querySelector('.teacher-name').textContent;

            document.getElementById('confirm-delete-message').textContent = `Bạn có chắc chắn muốn xóa giáo viên "${teacherName}"?`;
            deleteFunction = async () => {
                try {
                    await deleteDoc(doc(firestore, 'teachers', teacherId));
                    closeModal(confirmDeleteModal);
                    await loadGroupsAndTeachers(currentSchoolYear);
                } catch (error) {
                    console.error("Lỗi khi xóa giáo viên:", error);
                    showToast('Đã có lỗi xảy ra khi xóa giáo viên.', 'error');
                }
            };
            openModal(confirmDeleteModal);
        }
    });

    // Xử lý click trong container của các phương pháp (delegation)
    methodsContainer.addEventListener('click', async (e) => {
        const target = e.target;
        const itemCard = target.closest('.item-card');
        if (!itemCard) return;

        const methodId = itemCard.dataset.methodId;

        // Mở modal sửa Phương pháp
        if (target.closest('.edit-method-btn')) {
            try {
                const methodRef = doc(firestore, 'teachingMethods', methodId);
                const methodSnap = await getDoc(methodRef);
                if (methodSnap.exists()) {
                    currentEditingId = methodId;
                    document.getElementById('method-modal-title').textContent = 'Sửa Phương pháp dạy học';
                    document.getElementById('method-name-input').value = methodSnap.data().method;
                    openModal(methodModal);
                }
            } catch (error) {
                showToast('Không thể lấy thông tin. Vui lòng thử lại.', 'error');
            }
        }

        // Mở modal xác nhận xóa Phương pháp
        if (target.closest('.delete-method-btn')) {
            const methodName = itemCard.querySelector('.item-name').textContent;
            document.getElementById('confirm-delete-message').textContent = `Bạn có chắc chắn muốn xóa phương pháp "${methodName}"?`;
            deleteFunction = async () => {
                try {
                    await deleteDoc(doc(firestore, 'teachingMethods', methodId));
                    closeModal(confirmDeleteModal);
                    await loadMethods(currentSchoolYear);
                    showToast('Đã xóa thành công.', 'success');
                } catch (error) {
                    console.error("Lỗi khi xóa phương pháp:", error);
                    showToast('Đã có lỗi xảy ra khi xóa.', 'error');
                }
            };
            openModal(confirmDeleteModal);
        }
    });

    // Xử lý click trong container của kế hoạch tuần (delegation)
    weeklyPlanContainer.addEventListener('click', async (e) => {
        const editBtn = e.target.closest('.edit-week-btn');
        if (!editBtn) return;

        const weekRow = editBtn.closest('tr');
        currentEditingWeekId = weekRow.dataset.weekId;
        const weekNumber = weekRow.cells[0].textContent;
        const startDateDisplay = weekRow.cells[1].textContent; // dd/mm/yyyy
        const endDateDisplay = weekRow.cells[2].textContent;   // dd/mm/yyyy

        // Chuyển đổi dd/mm/yyyy sang yyyy-mm-dd cho input[type="date"]
        const [startDay, startMonth, startYear] = startDateDisplay.split('/');
        const [endDay, endMonth, endYear] = endDateDisplay.split('/');
        const startDateValue = `${startYear}-${startMonth}-${startDay}`;
        const endDateValue = `${endYear}-${endMonth}-${endDay}`;

        document.getElementById('week-edit-number').textContent = weekNumber;
        document.getElementById('week-start-date-input').value = startDateValue;
        document.getElementById('week-end-date-input').value = endDateValue;

        openModal(weekEditModal);
    });

    // Lưu thay đổi của tuần
    document.getElementById('save-week-btn').addEventListener('click', async () => {
        if (!currentEditingWeekId || !currentSchoolYear) return;

        const newStartDate = document.getElementById('week-start-date-input').value;
        const newEndDate = document.getElementById('week-end-date-input').value;

        if (!newStartDate || !newEndDate) {
            showToast('Vui lòng nhập đầy đủ ngày bắt đầu và kết thúc.', 'error');
            return;
        }

        try {
            // 1. Lấy ID của document kế hoạch
            const planQuery = query(collection(firestore, 'timePlans'), where("schoolYear", "==", currentSchoolYear));
            const planSnapshot = await getDocs(planQuery);
            if (planSnapshot.empty) {
                throw new Error("Không tìm thấy kế hoạch cho năm học này.");
            }
            const planDocId = planSnapshot.docs[0].id;

            // 2. Lấy tất cả các tuần của kế hoạch và sắp xếp
            const weeksCollectionRef = collection(firestore, 'timePlans', planDocId, 'weeks');
            const weeksSnapshot = await getDocs(weeksCollectionRef);
            const allWeeks = [];
            weeksSnapshot.forEach(doc => allWeeks.push({ id: doc.id, ...doc.data() }));
            allWeeks.sort((a, b) => a.weekNumber - b.weekNumber);

            // 3. Tìm tuần đang được chỉnh sửa
            const editedWeekIndex = allWeeks.findIndex(w => w.id === currentEditingWeekId);
            if (editedWeekIndex === -1) {
                throw new Error("Không tìm thấy tuần đang chỉnh sửa.");
            }

            // 4. Bắt đầu một batch write để cập nhật hàng loạt
            const batch = writeBatch(firestore);

            // Cập nhật tuần hiện tại
            const editedWeekRef = doc(firestore, 'timePlans', planDocId, 'weeks', currentEditingWeekId);
            batch.update(editedWeekRef, { startDate: newStartDate, endDate: newEndDate });

            // 5. Cập nhật các tuần tiếp theo theo chuỗi
            let previousEndDate = new Date(newEndDate.replace(/-/g, '/'));
            for (let i = editedWeekIndex + 1; i < allWeeks.length; i++) {
                const currentWeek = allWeeks[i];
                const weekRef = doc(firestore, 'timePlans', planDocId, 'weeks', currentWeek.id);

                // Ngày bắt đầu của tuần này = ngày kết thúc của tuần trước + 1
                previousEndDate.setDate(previousEndDate.getDate() + 1);
                const nextStartDate = new Date(previousEndDate);

                // Ngày kết thúc của tuần này = ngày bắt đầu mới + 6
                const nextEndDate = new Date(nextStartDate);
                nextEndDate.setDate(nextEndDate.getDate() + 6);

                batch.update(weekRef, {
                    startDate: formatDateToYYYYMMDD(nextStartDate),
                    endDate: formatDateToYYYYMMDD(nextEndDate)
                });

                // Cập nhật previousEndDate cho vòng lặp tiếp theo
                previousEndDate = nextEndDate;
            }

            // 6. Commit batch
            await batch.commit();

            showToast('Cập nhật tuần thành công!', 'success');
            closeModal(weekEditModal);
            await loadTimePlan(currentSchoolYear);
        } catch (error) {
            showToast('Lỗi khi cập nhật tuần.', 'error');
            console.error("Lỗi khi cập nhật tuần:", error);
        }
    });

    // Xác nhận xóa
    document.getElementById('confirm-delete-btn').addEventListener('click', () => {
        if (typeof deleteFunction === 'function') {
            deleteFunction();
            deleteFunction = null; // Reset sau khi gọi
        }
    });

    // --- Tải dữ liệu lần đầu ---
    loadSchoolYears();
});