import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy, writeBatch, where, getDoc, limit } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { firestore } from "./firebase-config.js";
import { showToast, setButtonLoading } from "./toast.js";
import { formatDate } from "./utils.js";

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
    const subjectModal = document.getElementById('subject-modal');
    const subjectsContainer = document.getElementById('subjects-container');

    // NEW: Elements for Subject Assignments
    const subjectAssignmentsContainer = document.getElementById('subject-assignments-container');
    const assignmentModal = document.getElementById('assignment-modal');
    const cancelAssignmentModalBtn = document.getElementById('cancel-assignment-modal');

    // NEW: Holiday management elements
    const holidayModal = document.getElementById('holiday-modal');
    const holidaysContainer = document.getElementById('holidays-container');
    const addHolidayBtn = document.getElementById('add-holiday-btn');

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
    const activeScheduleTitle = document.getElementById('active-schedule-title');
    const activeScheduleContainer = document.getElementById('active-schedule-container');

    // Config inputs
    const periodDurationInput = document.getElementById('period-duration');
    const shortBreakDurationInput = document.getElementById('short-break-duration');
    const longBreakDurationInput = document.getElementById('long-break-duration');
    const summerMorningStartInput = document.getElementById('summer-morning-start');
    const summerAfternoonStartInput = document.getElementById('summer-afternoon-start');
    const winterMorningStartInput = document.getElementById('winter-morning-start');
    const winterAfternoonStartInput = document.getElementById('winter-afternoon-start');
    const activeSeasonDisplay = document.getElementById('active-season-display');
    const applySummerBtn = document.getElementById('apply-summer-btn');
    const applyWinterBtn = document.getElementById('apply-winter-btn');



    let currentSchoolYear = null; // Chuỗi năm học đang được chọn (VD: "2024-2025")
    let currentGroupId = null; // Dùng để biết đang thêm/sửa giáo viên cho tổ nào
    let currentEditingId = null; // Dùng để biết đang sửa tổ/giáo viên nào
    let currentEditingWeekId = null; // Dùng để biết đang sửa tuần nào
    let deleteFunction = null; // Hàm sẽ được gọi khi xác nhận xóa
    let currentEditingSubjectForAssignment = null; // NEW: Dùng cho modal phân công môn học
    let allSubjectsCache = []; // Cache danh sách môn học của năm học hiện tại


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

    const formatDateToYYYYMMDD = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    // --- NEW: Progress Bar Helper ---
    const updateRepairProgress = (cardElement, status, message = '', progress = 0) => {
        const progressContainer = cardElement.querySelector('.repair-progress-container');
        const progressBar = progressContainer.querySelector('.progress-bar');
        const progressText = progressContainer.querySelector('.progress-status-text');

        if (status === 'idle') {
            progressContainer.style.display = 'none';
            return;
        }

        progressContainer.style.display = 'flex';
        progressText.textContent = message;
        progressBar.style.width = `${progress}%`;

        // Reset classes
        progressBar.classList.remove('animated', 'success', 'error');

        if (status === 'scanning') {
            progressBar.classList.add('animated');
        } else if (status === 'success') {
            progressBar.classList.add('success');
        } else if (status === 'error') {
            progressBar.classList.add('error');
        }
    };


    // --- DATA REPAIR FUNCTIONS ---
    const findAndRepairOrphanedRegs = async () => {
        const container = dataRepairContainer;
        container.innerHTML = `<p><i class="fas fa-spinner fa-spin"></i> Đang quét dữ liệu, vui lòng chờ...</p>`;
    
        try {
            // 1. Lấy tất cả giáo viên và tạo map/set cần thiết
            const teachersQuery = query(
                collection(firestore, 'teachers'),
                where('status', '==', 'active') // CHỈ LẤY GV ĐANG HOẠT ĐỘNG
            );
            const teachersSnapshot = await getDocs(teachersQuery);
            const allCurrentTeachers = teachersSnapshot.docs.map(doc => ({ uid: doc.data().uid, name: doc.data().teacher_name, ...doc.data() }));
            const validTeacherUids = new Set(allCurrentTeachers.map(t => t.uid).filter(Boolean));
    
            // 2. Tối ưu hóa: Đếm tổng số đăng ký và số đăng ký hợp lệ
            updateRepairProgress(container.parentElement, 'scanning', 'Đang đếm số lượt đăng ký...', 30);
             const totalRegsSnapshot = await getDocs(collection(firestore, 'registrations'));
            const totalRegsCount = totalRegsSnapshot.size;
    
            const validUidsArray = Array.from(validTeacherUids);
            const CHUNK_SIZE = 30; // Giới hạn của Firestore cho 'in' query
            const chunks = [];
            for (let i = 0; i < validUidsArray.length; i += CHUNK_SIZE) {
                chunks.push(validUidsArray.slice(i, i + CHUNK_SIZE));
            }
    
            updateRepairProgress(container.parentElement, 'scanning', 'Đang xác thực đăng ký...', 50);
            const queryPromises = chunks.map(chunk => 
                getDocs(query(collection(firestore, 'registrations'), where('teacherId', 'in', chunk)))
            );
            const snapshots = await Promise.all(queryPromises);
            const validRegsCount = snapshots.reduce((acc, snapshot) => acc + snapshot.size, 0);
    
            // 3. Nếu số lượng khớp, không cần quét sâu hơn
            if (totalRegsCount === validRegsCount) {
                updateRepairProgress(container.parentElement, 'success', 'Quét hoàn tất!', 100);
                container.innerHTML = `<p class="success-message"><i class="fas fa-check-circle"></i> Không tìm thấy lượt đăng ký nào bị lỗi Teacher ID. Dữ liệu của bạn đã nhất quán!</p>`;
                return;
            }
    
            // 4. Nếu có sự chênh lệch, thực hiện quét sâu để tìm ra các đăng ký mồ côi
            updateRepairProgress(container.parentElement, 'scanning', 'Phân tích chi tiết các lỗi...', 80);
            const orphanedRegs = new Map(); // Map: oldTeacherId -> { name, regs: [regDoc] }
    
            totalRegsSnapshot.forEach(doc => {
                const regData = doc.data();
                // Chỉ kiểm tra những đăng ký có teacherId nhưng không nằm trong danh sách hợp lệ
                if (regData.teacherId && !validTeacherUids.has(regData.teacherId)) {
                    const oldId = regData.teacherId;
                    if (!orphanedRegs.has(oldId)) {
                        orphanedRegs.set(oldId, {
                            name: regData.teacherName || 'Không rõ tên', // Dùng teacherName cũ nếu có
                            regs: []
                        });
                    }
                    orphanedRegs.get(oldId).regs.push({ id: doc.id, ...regData });
                }
            });
    
            updateRepairProgress(container.parentElement, 'success', 'Quét hoàn tất!', 100);
            renderRepairUI(orphanedRegs, allCurrentTeachers);
    
        } catch (error) {
            console.error("Lỗi khi quét dữ liệu mồ côi:", error);
            updateRepairProgress(container.parentElement, 'error', 'Quét thất bại!', 100);
            container.innerHTML = `<p class="error-message">Đã có lỗi xảy ra trong quá trình quét. Vui lòng thử lại.</p>`;
            showToast('Quét dữ liệu thất bại!', 'error');
        }
    };

    const renderRepairUI = (orphanedMap, allCurrentTeachers) => {
        const container = dataRepairContainer;
        if (orphanedMap.size === 0) {
            updateRepairProgress(container.parentElement, 'success', 'Quét hoàn tất!', 100);
            container.innerHTML = `<p class="success-message"><i class="fas fa-check-circle"></i> Không tìm thấy lượt đăng ký nào bị lỗi Teacher ID. Dữ liệu của bạn đã nhất quán!</p>`;
            return;
        }

        let html = `
            <details class="repair-details" open>
                <summary>
                    <span class="summary-title">Tìm thấy ${orphanedMap.size} tài khoản giáo viên cũ cần được ánh xạ lại</span>
                    <span class="summary-actions">
                        <button id="execute-repair-btn" class="btn-danger"><i class="fas fa-tools"></i> Thực hiện sửa lỗi</button>
                    </span>
                </summary>
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

        html += `</div></details>`;
        container.innerHTML = html;

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
        const container = subjectRepairContainer;
        updateRepairProgress(container.parentElement, 'scanning', 'Đang quét dữ liệu...', 10);
    
        try {
            // 1. Lấy tất cả giáo viên có môn học chính được gán
            updateRepairProgress(container.parentElement, 'scanning', 'Đang tải danh sách giáo viên...', 20);
             const teachersQuery = query(collection(firestore, 'teachers'));
            const teachersSnapshot = await getDocs(teachersQuery);
            const teachersWithSubject = teachersSnapshot.docs
                .map(doc => doc.data())
                .filter(t => t.uid && t.subject);
    
            if (teachersWithSubject.length === 0) {
                subjectRepairContainer.innerHTML = `<p>Không có giáo viên nào được gán môn học chính để kiểm tra.</p>`;
                return;
            }
    
            // 2. Tối ưu hóa: Tạo các truy vấn song song cho mỗi giáo viên
            // Tìm các đăng ký có môn học KHÁC với môn chính của họ
            updateRepairProgress(container.parentElement, 'scanning', 'Đang so khớp môn học...', 50);
            const queryPromises = teachersWithSubject.map(teacher => {
                const regsQuery = query(
                    collection(firestore, 'registrations'),
                    where('teacherId', '==', teacher.uid),
                    where('subject', '!=', teacher.subject)
                );
                return getDocs(regsQuery).then(snapshot => ({ teacher, snapshot }));
            });
    
            const results = await Promise.all(queryPromises);
    
            // 3. Lọc và tổng hợp các kết quả không khớp
            const mismatches = [];
            for (const { teacher, snapshot } of results) {
                snapshot.forEach(doc => {
                    const regData = doc.data();
                    // Kiểm tra các trường hợp ngoại lệ sau khi đã có kết quả
                    const isBioException = teacher.subject === 'Sinh học' && regData.subject === 'Công nghệ nông nghiệp';
                    const isPhysicsException = teacher.subject === 'Vật lí' && regData.subject === 'Công nghệ công nghiệp';
    
                    if (!isBioException && !isPhysicsException) {
                        mismatches.push({ regId: doc.id, teacherName: teacher.teacher_name, correctSubject: teacher.subject, ...regData });
                    }
                });
            }
    
            updateRepairProgress(container.parentElement, 'success', 'Quét hoàn tất!', 100);
            renderSubjectMismatchUI(mismatches);

        } catch (error) {
            console.error("Lỗi khi quét lỗi môn học:", error);
            updateRepairProgress(subjectRepairContainer.parentElement, 'error', 'Quét thất bại!', 100);
            subjectRepairContainer.innerHTML = `<p class="error-message">Đã có lỗi xảy ra trong quá trình quét. Vui lòng thử lại.</p>`;
            showToast('Quét dữ liệu thất bại!', 'error');
        }
    };

    const renderSubjectMismatchUI = (mismatches) => {
        if (mismatches.length === 0) {
            updateRepairProgress(subjectRepairContainer.parentElement, 'success', 'Quét hoàn tất!', 100);
            subjectRepairContainer.innerHTML = `<p class="success-message"><i class="fas fa-check-circle"></i> Không tìm thấy lượt đăng ký nào có môn học không khớp. Dữ liệu của bạn đã nhất quán!</p>`;
            return;
        }

        let tableRows = mismatches.map(m => `
            <tr>
                <td>${m.teacherName}</td>
                <td>${formatDate(m.date)}</td>
                <td style="text-align: center;">${m.period}</td>
                <td style="text-align: center;">${m.className || 'N/A'}</td>
                <td style="color: red;">${m.wrongSubject}</td>
                <td style="color: green;">${m.correctSubject}</td>
            </tr>
        `).join('');

        subjectRepairContainer.innerHTML = `
            <details class="repair-details" open>
                <summary>
                    <span class="summary-title">Tìm thấy ${mismatches.length} lượt đăng ký có môn học không khớp</span>
                    <span class="summary-actions">
                        <button id="execute-subject-repair-btn" class="btn-danger"><i class="fas fa-check-double"></i> Sửa tất cả</button>
                    </span>
                </summary>
                <table class="weekly-plan-table">
                    <thead><tr><th>Giáo viên</th><th>Ngày</th><th>Tiết</th><th>Lớp</th><th>Môn học sai</th><th>Môn học đúng</th></tr></thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </details>
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
        const container = groupIdRepairContainer;
        updateRepairProgress(container.parentElement, 'scanning', 'Đang quét dữ liệu...', 10);
    
        try {
            // 1. Lấy tất cả giáo viên và tạo map UID -> group_id để tra cứu
            updateRepairProgress(container.parentElement, 'scanning', 'Đang tải thông tin tổ...', 20);
            const teachersQuery = query(collection(firestore, 'teachers'));
            const teachersSnapshot = await getDocs(teachersQuery);
            const teacherToGroupMap = new Map();
            teachersSnapshot.forEach(doc => {
                const data = doc.data();
                if (data.uid && data.group_id) {
                    teacherToGroupMap.set(data.uid, data.group_id);
                }
            });
    
            // 2. Tối ưu hóa: Chỉ truy vấn các đăng ký thiếu groupId trong năm học hiện tại
            updateRepairProgress(container.parentElement, 'scanning', 'Đang tìm đăng ký thiếu ID Tổ...', 50);
            const regsQuery = query(
                collection(firestore, 'registrations'),
                where('schoolYear', '==', currentSchoolYear),
                where('groupId', '==', null) // Chỉ lấy các doc không có trường groupId hoặc giá trị là null
            );
            const regsSnapshot = await getDocs(regsQuery);
    
            // 3. Tìm các lượt đăng ký thiếu `groupId`
            const missingGroupIdRegs = [];
            regsSnapshot.forEach(doc => {
                const regData = doc.data();
                const correctGroupId = teacherToGroupMap.get(regData.teacherId);
                const teacher = allCurrentTeachers.find(t => t.uid === regData.teacherId);
                if (correctGroupId) { // Chỉ thêm vào danh sách nếu tìm thấy groupId đúng
                        missingGroupIdRegs.push({
                            regId: doc.id,
                            teacherName: teacher ? teacher.name : (regData.teacherName || 'N/A'),
                            date: regData.date,
                            period: regData.period,
                            className: regData.className,
                            subject: regData.subject,
                            correctGroupId: correctGroupId
                        });
                    }
            });
    
            updateRepairProgress(container.parentElement, 'success', 'Quét hoàn tất!', 100);
            renderMissingGroupIdUI(missingGroupIdRegs);
    
        } catch (error) {
            console.error("Lỗi khi quét lỗi thiếu groupId:", error);
            updateRepairProgress(groupIdRepairContainer.parentElement, 'error', 'Quét thất bại!', 100);
            groupIdRepairContainer.innerHTML = `<p class="error-message">Đã có lỗi xảy ra trong quá trình quét. Vui lòng thử lại.</p>`;
            showToast('Quét dữ liệu thất bại!', 'error');
        }
    };

    const renderMissingGroupIdUI = (missingRegs) => {
        if (missingRegs.length === 0) {
            updateRepairProgress(groupIdRepairContainer.parentElement, 'success', 'Quét hoàn tất!', 100);
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
            <details class="repair-details" open>
                <summary>
                    <span class="summary-title">Tìm thấy ${missingRegs.length} lượt đăng ký thiếu ID Tổ</span>
                    <span class="summary-actions">
                        <button id="execute-groupid-repair-btn" class="btn-danger"><i class="fas fa-check-double"></i> Sửa tất cả</button>
                    </span>
                </summary>
                <table class="weekly-plan-table">
                    <thead><tr><th>Giáo viên</th><th>Ngày</th><th>Tiết</th><th>Lớp</th><th>Môn học</th><th>ID Tổ cần cập nhật</th></tr></thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </details>
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
                    <span class="rule-selected-icon"><i class="fas fa-check-circle"></i></span>
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

    // --- Helper for Button Loading State ---
    const setButtonLoading = (button, isLoading) => {
        if (!button) return;
        if (isLoading) {
            button.disabled = true;
            button.classList.add('loading');
        } else {
            button.disabled = false;
            button.classList.remove('loading');
        }
    };

    // --- CLASS TIMINGS FUNCTIONS ---
    const calculateScheduleFromConfig = (config) => {
        const { 
            periodDuration, shortBreakDuration, longBreakDuration, 
            summerMorningStart, summerAfternoonStart, 
            winterMorningStart, winterAfternoonStart 
        } = config;

        const calculateSession = (startTime) => {
            const sessionItems = [];
            let currentTime = new Date(`1970-01-01T${startTime}`);
            const breakAfterPeriods = { morning: 2, afternoon: 3 }; // Cố định giải lao sau tiết 2 (sáng) và 3 (chiều)
            for (let i = 1; i <= 5; i++) {
                const periodStart = new Date(currentTime);
                currentTime.setMinutes(currentTime.getMinutes() + periodDuration);
                const periodEnd = new Date(currentTime);
                
                sessionItems.push({
                    type: 'period',
                    startTime: periodStart.toTimeString().substring(0, 5),
                    endTime: periodEnd.toTimeString().substring(0, 5)
                });

                if (i < 5) { // Sau tiết cuối không có nghỉ
                    const breakStart = new Date(currentTime);
                    const currentSession = startTime.startsWith('0') ? 'morning' : 'afternoon';
                    let breakDuration;
                    if (i === breakAfterPeriods[currentSession]) {
                        breakDuration = longBreakDuration;
                    } else {
                        breakDuration = shortBreakDuration;
                    }
                    currentTime.setMinutes(currentTime.getMinutes() + breakDuration);
                    const breakEnd = new Date(currentTime);
                    sessionItems.push({
                        type: 'break',
                        duration: breakDuration,
                        startTime: breakStart.toTimeString().substring(0, 5),
                        endTime: breakEnd.toTimeString().substring(0, 5)
                    });
                }
            }
            return sessionItems;
        };

        const summerMorning = calculateSession(summerMorningStart);
        const summerAfternoon = calculateSession(summerAfternoonStart);
        const winterMorning = calculateSession(winterMorningStart);
        const winterAfternoon = calculateSession(winterAfternoonStart);

        return {
            summer: [...summerMorning, ...summerAfternoon],
            winter: [...winterMorning, ...winterAfternoon]
        };
    };

    const renderActiveSchedule = (schedule, container) => {
        if (!schedule || schedule.length === 0) {
            container.innerHTML = '<p>Không có dữ liệu thời gian.</p>';
            return;
        }
        const renderSession = (startPeriod, title) => {
            let sessionHtml = `<div class="timing-group"><h4>${title}</h4>`;
            let periodCounter = startPeriod === 1 ? 1 : 6;
            // Một buổi có 5 tiết và 4 lần giải lao => 9 items
            const sessionItems = startPeriod === 1 ? schedule.slice(0, 9) : schedule.slice(9);

            sessionItems.forEach(item => {
                if (item.type === 'period') {
                    const displayPeriod = startPeriod === 1 ? periodCounter : periodCounter - 5;
                    // Hiển thị dạng chỉ đọc
                    sessionHtml += `
                        <div class="timing-row" data-period="${periodCounter}">
                            <label>Tiết ${displayPeriod}</label>
                            <input type="time" class="start-time" value="${item.startTime}" readonly>
                            <span class="time-separator">-</span>
                            <input type="time" class="end-time" value="${item.endTime}" readonly>
                        </div>
                    `;
                    periodCounter++;
                } else { // item.type === 'break'
                    sessionHtml += `
                        <div class="timing-break-row">
                            <i class="fas fa-coffee"></i> Giải lao (${item.duration} phút)
                        </div>
                    `;
                }
            });
            sessionHtml += `</div>`;
            return sessionHtml;
        };
        container.innerHTML = renderSession(1, 'Buổi sáng') + renderSession(6, 'Buổi chiều'); // Giữ nguyên logic tạo HTML
    };

    const loadAndRenderTimings = async () => {
        // 1. Lấy config từ DB
        const schoolYearDocRef = await getSchoolYearDocRef(currentSchoolYear);
        if (!schoolYearDocRef) {
            showToast('Không tìm thấy năm học để tải cấu hình.', 'error');
            return;
        }
        const docSnap = await getDoc(schoolYearDocRef);
        const savedData = docSnap.exists() ? docSnap.data().classTimings : null;
        
        // 2. Thiết lập giá trị mặc định nếu không có dữ liệu
        const defaultConfig = {
            periodDuration: 45,
            shortBreakDuration: 5,
            longBreakDuration: 15,
            summerMorningStart: '07:00',
            summerAfternoonStart: '13:00',
            winterMorningStart: '07:00',
            winterAfternoonStart: '12:45'
        };

        const config = savedData && savedData.config ? savedData.config : defaultConfig;

        // 3. Điền giá trị vào các ô input
        periodDurationInput.value = config.periodDuration;
        shortBreakDurationInput.value = config.shortBreakDuration;
        longBreakDurationInput.value = config.longBreakDuration;
        summerMorningStartInput.value = config.summerMorningStart;
        summerAfternoonStartInput.value = config.summerAfternoonStart;
        winterMorningStartInput.value = config.winterMorningStart;
        winterAfternoonStartInput.value = config.winterAfternoonStart;

        // 4. Hiển thị trạng thái mùa đang được áp dụng
        const activeSeason = savedData && savedData.activeSeason ? savedData.activeSeason : null;
        updateActiveSeasonDisplay(activeSeason);

        // 5. Render khung thời gian đang áp dụng
        const scheduleToRender = activeSeason === 'summer' ? savedData?.summer : savedData?.winter;
        if (scheduleToRender) {
            renderActiveSchedule(scheduleToRender, activeScheduleContainer);
        } else {
            activeScheduleContainer.innerHTML = '<p>Chưa có lịch học được áp dụng. Vui lòng lưu và áp dụng một mùa.</p>';
        }
    };

    const applySeason = async (season) => {
        const schoolYearDocRef = await getSchoolYearDocRef(currentSchoolYear);
        if (!schoolYearDocRef) {
            showToast('Không tìm thấy năm học để lưu và áp dụng.', 'error');
            return;
        }
        try {
            // Hợp nhất logic: Lưu cấu hình và áp dụng mùa trong một lần
            const configToSave = {
                periodDuration: parseInt(periodDurationInput.value), shortBreakDuration: parseInt(shortBreakDurationInput.value), longBreakDuration: parseInt(longBreakDurationInput.value),
                summerMorningStart: summerMorningStartInput.value, summerAfternoonStart: summerAfternoonStartInput.value,
                winterMorningStart: winterMorningStartInput.value, winterAfternoonStart: winterAfternoonStartInput.value
            };
            const fullSchedules = calculateScheduleFromConfig(configToSave);
            const dataToSave = { config: configToSave, ...fullSchedules, activeSeason: season };

            await updateDoc(schoolYearDocRef, { classTimings: dataToSave });

            showToast(`Đã áp dụng lịch ${season === 'summer' ? 'MÙA HÈ' : 'MÙA ĐÔNG'} cho toàn hệ thống.`, 'success');
            updateActiveSeasonDisplay(season);
            renderActiveSchedule(season === 'summer' ? fullSchedules.summer : fullSchedules.winter, activeScheduleContainer);
        } catch (error) {
            console.error("Lỗi khi áp dụng mùa:", error);
            showToast('Không thể áp dụng lịch. Vui lòng thử lại.', 'error');
        }
    };

    const updateActiveSeasonDisplay = (activeSeason) => {
        if (!activeSeason) {
            activeSeasonDisplay.textContent = 'Chưa đặt';
            activeSeasonDisplay.className = 'status-badge'; // Xóa các class màu
            return;
        }
        // Cập nhật text và class cho badge
        activeSeasonDisplay.textContent = activeSeason === 'summer' ? 'Mùa hè' : 'Mùa đông';
        activeSeasonDisplay.classList.remove('summer', 'winter');
        activeSeasonDisplay.classList.add(activeSeason);

        // Cập nhật tiêu đề của bảng xem trước
        const titleIcon = activeSeason === 'summer' ? 'fa-sun' : 'fa-snowflake';
        const titleText = `Khung thời gian áp dụng hiện tại (${activeSeason === 'summer' ? 'Mùa hè' : 'Mùa đông'})`;
        activeScheduleTitle.innerHTML = `<i class="fas ${titleIcon}"></i> ${titleText}`;
        activeScheduleTitle.querySelector('i').style.color = activeSeason === 'summer' ? '#f39c12' : '#3498db';

        // Thêm viền cho nút đang được áp dụng để làm nổi bật
        applySummerBtn.style.borderColor = activeSeason === 'summer' ? 'var(--primary-color)' : 'transparent';
        applyWinterBtn.style.borderColor = activeSeason === 'winter' ? 'var(--primary-color)' : 'transparent';
    };

    // --- SUBJECT ASSIGNMENT FUNCTIONS ---
    const loadSubjectAssignments = async (schoolYear) => {
        subjectAssignmentsContainer.innerHTML = '<p>Đang tải dữ liệu phân công...</p>';
        try {
            // Chỉ lấy các môn học thông thường, vì môn đặc biệt không cần phân công
            const subjectsQuery = query(
                collection(firestore, 'subjects'),
                where("schoolYear", "==", schoolYear),
                where("type", "==", "regular"),
                orderBy('name')
            );
            const snapshot = await getDocs(subjectsQuery);

            if (snapshot.empty) {
                subjectAssignmentsContainer.innerHTML = '<p>Chưa có môn học nào (loại thông thường) được cấu hình cho năm học này.</p>';
                return;
            }

            const subjects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderSubjectAssignments(subjects);

        } catch (error) {
            console.error("Lỗi khi tải dữ liệu phân công môn học:", error);
            subjectAssignmentsContainer.innerHTML = '<p class="error-message">Không thể tải dữ liệu phân công.</p>';
        }
    };

    const renderSubjectAssignments = (subjects) => {
        let tableHTML = `
            <table class="subject-assignment-table">
                <thead>
                    <tr>
                        <th>Môn học chính</th>
                        <th>Các môn học phụ được phép đăng ký</th>
                        <th>Hành động</th>
                    </tr>
                </thead>
                <tbody>
        `;

        subjects.forEach(subject => {
            const allowedSubjects = subject.allowedSubSubjects || [];
            tableHTML += `
                <tr data-subject-id="${subject.id}" data-subject-name="${subject.name}">
                    <td class="primary-subject-cell">${subject.name}</td>
                    <td>
                        ${allowedSubjects.length > 0 
                            ? allowedSubjects.map(sub => `<span class="subject-tag-display">${sub}</span>`).join('') 
                            : '<span class="no-assignment">Chưa phân công</span>'
                        }
                    </td>
                    <td class="item-actions">
                        <button class="edit-assignment-btn icon-button" title="Sửa phân công"><i class="fas fa-pencil-alt"></i></button>
                    </td>
                </tr>
            `;
        });

        tableHTML += `</tbody></table>`;
        subjectAssignmentsContainer.innerHTML = tableHTML;
    };

    const openAssignmentModal = (subjectId, subjectName) => {
        currentEditingSubjectForAssignment = { id: subjectId, name: subjectName };
        document.getElementById('primary-subject-display').value = subjectName;

        // Lấy danh sách môn phụ đã phân công
        const subjectData = allSubjectsCache.find(s => s.id === subjectId);
        const selectedSubjects = subjectData?.allowedSubSubjects || [];

        // Khởi tạo bộ chọn môn học (tương tự như của Tổ)
        setupAssignmentSubjectSelect(selectedSubjects);

        openModal(assignmentModal);
    };

    const saveSubjectAssignment = async () => {
        if (!currentEditingSubjectForAssignment) return;

        const saveBtn = document.getElementById('save-assignment-btn');
        setButtonLoading(saveBtn, true);

        const selectedSubSubjects = getSelectedAssignmentSubjects(); // Cần hàm này

        try {
            const subjectRef = doc(firestore, 'subjects', currentEditingSubjectForAssignment.id);
            await updateDoc(subjectRef, { allowedSubSubjects: selectedSubSubjects });
            showToast('Đã cập nhật phân công thành công!', 'success');
            closeModal(assignmentModal);
            await loadSubjectAssignments(currentSchoolYear); // Tải lại để hiển thị thay đổi
        } catch (error) {
            showToast('Lỗi khi lưu phân công.', 'error');
        } finally {
            setButtonLoading(saveBtn, false);
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
                    <button class="delete-teacher-btn" title="Xóa"><i class="fas fa-trash-alt"></i></button>
                </div>
            </li>
        `;
    };

    const renderGroup = (group, index) => `
        <div class="group-card collapsed" data-group-id="${group.id}" data-group-id-text="${group.group_id}">
            <div class="group-header" title="Nhấn để mở/đóng danh sách giáo viên">
                <div class="group-title-container">
                    <h3 class="group-name"><span class="group-stt">${index + 1}.</span> Tổ ${group.group_name}</h3>
                </div>
                <div class="item-actions">
                    <button class="edit-group-btn" title="Sửa tên tổ"><i class="fas fa-pencil-alt"></i></button>
                    <button class="delete-group-btn" title="Vô hiệu hóa tổ"><i class="fas fa-trash-alt"></i></button>
                </div>
            </div>
            <ul class="teacher-list">
                ${group.teachers.map((teacher, index) => renderTeacher(teacher, index)).join('')}
            </ul>
            <button class="add-teacher-btn"><i class="fas fa-plus"></i> Thêm Giáo viên</button>
        </div>
    `;

    const renderUnassignedGroup = (teachers) => `
        <div class="group-card unassigned-card">
            <div class="group-header">
                <div class="group-title-container">
                    <h3 class="group-name"><i class="fas fa-user-tag"></i> Giáo viên chưa có tổ</h3>
                </div>
                <i class="fas fa-chevron-down collapse-icon"></i>
            </div>
            <ul class="teacher-list">
                ${teachers.map((teacher, index) => renderTeacher(teacher, index)).join('')}
            </ul>
            <p class="form-note" style="padding: 0 20px 15px;">Để phân công, hãy nhấn nút sửa <i class="fas fa-pencil-alt"></i> trên mỗi giáo viên.</p>
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
                <button class="delete-method-btn" title="Xóa"><i class="fas fa-trash-alt"></i></button>
            </div>
        </div>
    `;

    const renderSubject = (subject, index) => `
        <div class="item-card" data-subject-id="${subject.id}">
            <div class="item-info">
                <i class="fas fa-book method-icon"></i>
                <span class="item-stt">${index + 1}.</span>
                <span class="item-name">${subject.name} (${subject.type === 'special' ? 'Đặc biệt' : 'Thông thường'})</span>
            </div>
            <div class="item-actions">
                <button class="delete-subject-btn" title="Xóa"><i class="fas fa-trash-alt"></i></button>
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
        const unassignedContainer = document.getElementById('unassigned-teachers-container');
        try {
            // 1. Tải tất cả các tổ đang hoạt động và tạo một map để dễ tra cứu
            const groupsQuery = query(
                collection(firestore, 'groups'), 
                where("schoolYear", "==", schoolYear),
                where("status", "==", "active") // CHỈ LẤY TỔ ĐANG HOẠT ĐỘNG
            );
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
            // Cần phải lấy tất cả giáo viên đang hoạt động.
            const teachersQuery = query(
                collection(firestore, 'teachers'), 
                where('status', '==', 'active'), // CHỈ LẤY GV ĐANG HOẠT ĐỘNG
                orderBy('order')); 
            const teachersSnapshot = await getDocs(teachersQuery);

            // 3. Phân loại giáo viên vào các tổ tương ứng
            const unassignedTeachers = [];
            teachersSnapshot.forEach(doc => {
                const teacher = { id: doc.id, ...doc.data() };
                if (teacher.group_id && groupMap.has(teacher.group_id)) {
                     groupMap.get(teacher.group_id).teachers.push(teacher);
                } else if (!teacher.group_id) {
                    // Nếu không có group_id, thêm vào danh sách chưa phân công
                    unassignedTeachers.push(teacher);
                } else {
                     console.warn(` -> Cảnh báo: Không tìm thấy tổ "${teacher.group_id}" cho giáo viên "${teacher.teacher_name}".`);
                }
            });

            // 4. Render các tổ và giáo viên đã được phân công
            if (groups.length === 0 && teachersSnapshot.empty) {
                groupsContainer.innerHTML = '<p>Chưa có tổ chuyên môn nào. Hãy thêm một tổ mới!</p>';
            } else {
                groupsContainer.innerHTML = groups.map((group, index) => renderGroup(group, index)).join('');
            }

            // 5. Render card cho giáo viên chưa được phân công (nếu có)
            if (unassignedTeachers.length > 0) {
                unassignedContainer.innerHTML = renderUnassignedGroup(unassignedTeachers);
                unassignedContainer.style.display = 'block';
            } else {
                unassignedContainer.innerHTML = '';
                unassignedContainer.style.display = 'none';
            }

            // 6. Khởi tạo chức năng kéo-thả sau khi đã render xong
            initSortable();

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
            unassignedContainer.style.display = 'none';
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

    const loadSubjects = async (schoolYear) => {
        subjectsContainer.innerHTML = '<p>Đang tải danh sách...</p>';
        try {
            const subjectsQuery = query(
                collection(firestore, 'subjects'),
                where("schoolYear", "==", schoolYear),
                orderBy('name')
            );
            const snapshot = await getDocs(subjectsQuery);

            if (snapshot.empty) {
                subjectsContainer.innerHTML = '<p>Chưa có môn học nào được cấu hình cho năm học này.</p>';
            } else {
                const subjects = [];
                snapshot.forEach(doc => subjects.push({ id: doc.id, ...doc.data() }));
                subjectsContainer.innerHTML = subjects.map((subject, index) => renderSubject(subject, index)).join('');
            }
        } catch (error) {
            console.error("Lỗi khi tải môn học:", error);
            let errorMessage = '<p class="error-message">Không thể tải dữ liệu môn học.</p>';
            if (error.code === 'failed-precondition') {
                errorMessage += `<p>Vui lòng tạo chỉ mục (index) cho collection 'subjects' trong Firestore.</p>`;
            }
            subjectsContainer.innerHTML = errorMessage;
        }
    };

    // --- HOLIDAY MANAGEMENT FUNCTIONS ---

    const getPlanDocRef = async (schoolYear) => {
        const planQuery = query(collection(firestore, 'timePlans'), where("schoolYear", "==", schoolYear), limit(1));
        const snapshot = await getDocs(planQuery);
        if (snapshot.empty) {
            return null;
        }
        return snapshot.docs[0].ref;
    };

    const loadHolidays = async (schoolYear) => {
        holidaysContainer.innerHTML = '<p>Đang tải danh sách ngày nghỉ...</p>';
        const planRef = await getPlanDocRef(schoolYear);
        if (!planRef) {
            holidaysContainer.innerHTML = '<p>Chưa có kế hoạch thời gian. Vui lòng tạo kế hoạch trước khi thêm ngày nghỉ.</p>';
            if (addHolidayBtn) addHolidayBtn.disabled = true;
            return;
        }
        if (addHolidayBtn) addHolidayBtn.disabled = false;

        try {
            const holidaysQuery = query(collection(planRef, 'holidays'), orderBy('startDate'));
            const snapshot = await getDocs(holidaysQuery);

            if (snapshot.empty) {
                holidaysContainer.innerHTML = '<p>Chưa có ngày nghỉ nào được thêm cho năm học này.</p>';
                return;
            }

            const holidays = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderHolidays(holidays);
        } catch (error) {
            console.error("Lỗi khi tải ngày nghỉ:", error);
            holidaysContainer.innerHTML = '<p class="error-message">Không thể tải danh sách ngày nghỉ.</p>';
        }
    };

    const renderHolidays = (holidays) => {
        const holidayTypes = {
            'Lễ': { icon: 'fa-calendar-star', color: '#e74c3c' },
            'Tết': { icon: 'fa-landmark', color: '#e67e22' },
            'Bão lụt': { icon: 'fa-cloud-showers-heavy', color: '#3498db' },
            'Kế hoạch trường': { icon: 'fa-school', color: '#9b59b6' },
            'Khác': { icon: 'fa-info-circle', color: '#7f8c8d' }
        };

        holidaysContainer.innerHTML = holidays.map(holiday => `
            <div class="item-card" data-holiday-id="${holiday.id}">
                <div class="item-info">
                    <i class="fas ${holidayTypes[holiday.type]?.icon || 'fa-calendar-day'}" style="color: ${holidayTypes[holiday.type]?.color || '#333'}"></i>
                    <div class="holiday-details">
                        <span class="item-name">${holiday.name}</span>
                        <span class="holiday-date-range">
                            <i class="fas fa-calendar-alt"></i> 
                            ${formatDate(holiday.startDate)} ${holiday.endDate !== holiday.startDate ? ` - ${formatDate(holiday.endDate)}` : ''}
                        </span>
                    </div>
                </div>
                <div class="item-actions">
                    <button class="edit-holiday-btn icon-button" title="Sửa"><i class="fas fa-pencil-alt"></i></button>
                    <button class="delete-holiday-btn icon-button" title="Xóa"><i class="fas fa-trash-alt"></i></button>
                </div>
            </div>
        `).join('');
    };

    if (document.getElementById('save-holiday-btn')) {
        document.getElementById('save-holiday-btn').addEventListener('click', async () => {
            const saveBtn = document.getElementById('save-holiday-btn');
            const name = document.getElementById('holiday-name-input').value.trim();
            const type = document.getElementById('holiday-type-select').value;
            const startDate = document.getElementById('holiday-start-date-input').value;
            const endDate = document.getElementById('holiday-end-date-input').value;
    
            if (!name || !type || !startDate || !endDate) {
                showToast('Vui lòng điền đầy đủ thông tin.', 'error');
                return;
            }
            if (endDate < startDate) {
                showToast('Ngày kết thúc không được nhỏ hơn ngày bắt đầu.', 'error');
                return;
            }
    
            const planRef = await getPlanDocRef(currentSchoolYear);
            if (!planRef) {
                showToast('Không tìm thấy kế hoạch thời gian để lưu ngày nghỉ.', 'error');
                return;
            }
    
            setButtonLoading(saveBtn, true);
            try {
                const holidayData = { name, type, startDate, endDate };
                const holidaysCollection = collection(planRef, 'holidays');
    
                if (currentEditingId) {
                    await updateDoc(doc(holidaysCollection, currentEditingId), holidayData);
                    showToast('Cập nhật ngày nghỉ thành công!', 'success');
                } else {
                    await addDoc(holidaysCollection, holidayData);
                    showToast('Thêm ngày nghỉ thành công!', 'success');
                }
                closeModal(holidayModal);
                await loadHolidays(currentSchoolYear);
            } catch (error) {
                console.error("Lỗi khi lưu ngày nghỉ:", error);
                showToast('Đã có lỗi xảy ra khi lưu.', 'error');
            } finally {
                setButtonLoading(saveBtn, false);
            }
        });
    }

    if (holidaysContainer) {
        holidaysContainer.addEventListener('click', async (e) => {
            const holidayCard = e.target.closest('.item-card');
            if (!holidayCard) return;
            const holidayId = holidayCard.dataset.holidayId;
            const planRef = await getPlanDocRef(currentSchoolYear);
    
            if (e.target.closest('.edit-holiday-btn')) {
                const holidayDoc = await getDoc(doc(planRef, 'holidays', holidayId));
                if (holidayDoc.exists()) {
                    currentEditingId = holidayId;
                    const data = holidayDoc.data();
                    document.getElementById('holiday-modal-title').textContent = 'Sửa Ngày nghỉ';
                    document.getElementById('holiday-name-input').value = data.name;
                    document.getElementById('holiday-type-select').value = data.type;
                    document.getElementById('holiday-start-date-input').value = data.startDate;
                    document.getElementById('holiday-end-date-input').value = data.endDate;
                    openModal(holidayModal);
                }
            } else if (e.target.closest('.delete-holiday-btn')) {
                document.getElementById('confirm-delete-message').textContent = `Bạn có chắc chắn muốn xóa ngày nghỉ này không?`;
                deleteFunction = async () => {
                    await deleteDoc(doc(planRef, 'holidays', holidayId));
                    showToast('Đã xóa ngày nghỉ.', 'success');
                    await loadHolidays(currentSchoolYear);
                };
                openModal(confirmDeleteModal);
            }
        });
    }

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
                await loadSubjects(currentSchoolYear); // Tải Môn học khi chọn năm học
                await loadTimePlan(currentSchoolYear);
                await loadAllSubjectsForYear(currentSchoolYear); // Tải cache môn học cho select
                await loadAndRenderRules(); // Tải quy tắc khi chọn năm học
                await loadSubjectAssignments(currentSchoolYear); 
                await loadHolidays(currentSchoolYear); // NEW: Tải ngày nghỉ
            }

        } catch (error) {
            console.error("Lỗi khi tải danh sách năm học:", error);
            schoolYearSelect.innerHTML = '<option>Lỗi tải dữ liệu</option>';
        }
    };
    // Tải dữ liệu lần đầu sau khi loadSchoolYears hoàn tất
    const loadAllSubjectsForYear = async (schoolYear) => {
        try {
            const subjectsQuery = query(
                collection(firestore, 'subjects'),
                where("schoolYear", "==", schoolYear),
                where("status", "==", "active")
            );
            const snapshot = await getDocs(subjectsQuery);
            allSubjectsCache = snapshot.docs.map(doc => doc.data());            
        } catch (error) {
            console.error("Lỗi khi tải cache môn học:", error);
        }
    };
    loadSchoolYears().then(() => {
        if (currentSchoolYear) loadAndRenderTimings();
    });

    // --- Xử lý sự kiện thay đổi năm học ---
    schoolYearSelect.addEventListener('change', async () => {
        currentSchoolYear = schoolYearSelect.value;
        if (currentSchoolYear) {
            await loadGroupsAndTeachers(currentSchoolYear);
            await loadMethods(currentSchoolYear); // Tải lại PPDH khi đổi năm học
            await loadSubjects(currentSchoolYear); // Tải lại Môn học khi đổi năm học
            await loadTimePlan(currentSchoolYear);
            await loadAllSubjectsForYear(currentSchoolYear); // Tải lại cache môn học
            await loadAndRenderRules();
            await loadSubjectAssignments(currentSchoolYear); 
            await loadAndRenderTimings();
            await loadHolidays(currentSchoolYear); // NEW: Tải lại ngày nghỉ
        }
    });

    // --- Hàm xử lý Modal ---
    const openModal = (modal) => modal.style.display = 'flex';
    const closeModal = (modal) => modal.style.display = 'none';

    // Đóng modal khi click ra ngoài
    [groupModal, teacherModal, confirmDeleteModal, schoolYearModal, methodModal, subjectModal, weekEditModal, assignmentModal, holidayModal]
        .filter(modal => modal) // Lọc ra các giá trị null để tránh lỗi
        .forEach(modal => {
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
    document.getElementById('cancel-subject-modal').addEventListener('click', () => closeModal(subjectModal));
    document.getElementById('cancel-week-edit-modal').addEventListener('click', () => closeModal(weekEditModal));
    cancelAssignmentModalBtn.addEventListener('click', () => closeModal(assignmentModal));
    document.getElementById('cancel-holiday-modal').addEventListener('click', () => closeModal(holidayModal));

    // --- Xử lý sự kiện ---

    // Mở modal thêm Tổ
    document.getElementById('add-group-btn').addEventListener('click', () => {
        currentEditingId = null;
        document.getElementById('group-modal-title').textContent = 'Thêm Tổ chuyên môn';
        setupGroupSubjectSelect(); // Khởi tạo bộ chọn môn học
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

    // Mở modal thêm Môn học
    document.getElementById('add-subject-btn').addEventListener('click', () => {
        currentEditingId = null;
        document.getElementById('subject-modal-title').textContent = 'Thêm Môn học';
        document.getElementById('subject-name-input').value = '';
        document.getElementById('subject-type-select').value = 'regular';
        openModal(subjectModal);
    });

    // Mở modal thêm Ngày nghỉ
    // SỬA LỖI: Di chuyển addEventListener vào trong khối if để đảm bảo addHolidayBtn không phải là null.
    const addHolidayBtnElement = document.getElementById('add-holiday-btn');
    if (addHolidayBtnElement) {
        addHolidayBtnElement.addEventListener('click', () => {
            currentEditingId = null;
            document.getElementById('holiday-modal-title').textContent = 'Thêm Ngày nghỉ';
            // Sửa lỗi: Gọi reset() trên phần tử form, không phải div.
            const holidayForm = document.getElementById('holiday-form');
            if (holidayForm) holidayForm.reset();

            openModal(holidayModal);
        });
    }

    // Lưu Năm học mới
    document.getElementById('save-school-year-btn').addEventListener('click', async () => {
        const saveBtn = document.getElementById('save-school-year-btn');
        const yearName = document.getElementById('school-year-name-input').value.trim();
        if (!yearName.match(/^\d{4}-\d{4}$/)) {
            showToast('Vui lòng nhập năm học đúng định dạng (VD: 2024-2025).', 'error');
            return;
        }

        setButtonLoading(saveBtn, true);

        try {
            await addDoc(collection(firestore, 'schoolYears'), { schoolYear: yearName });
            showToast(`Đã thêm năm học ${yearName}`, 'success');
            closeModal(schoolYearModal);
            await loadSchoolYears(); // Tải lại danh sách năm học
        } catch (error) {
            console.error("Lỗi khi lưu năm học:", error);
            showToast('Đã có lỗi xảy ra khi lưu năm học.', 'error');
        } finally {
            setButtonLoading(saveBtn, false);
        }
    });

    // Lưu Tổ (Thêm mới hoặc Cập nhật)
    document.getElementById('save-group-btn').addEventListener('click', async () => {
        const saveBtn = document.getElementById('save-group-btn');
        const group_name = document.getElementById('group-name-input').value.trim();
        if (!group_name) {
            showToast('Vui lòng nhập tên tổ.', 'error');
            return;
        }

        const selectedSubjects = getSelectedGroupSubjects();

        setButtonLoading(saveBtn, true);

        try {
            if (currentEditingId) { // Cập nhật
                const groupRef = doc(firestore, 'groups', currentEditingId);
                await updateDoc(groupRef, { group_name, subjects: selectedSubjects });
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
                    status: 'active', // THÊM MỚI: Gán trạng thái hoạt động
                    order: newOrder,
                    schoolYear: currentSchoolYear, // Thêm chuỗi năm học
                    subjects: selectedSubjects // Thêm danh sách môn học
                });
            }
            closeModal(groupModal);
            await loadGroupsAndTeachers(currentSchoolYear);
        } catch (error) {
            console.error("Lỗi khi lưu tổ:", error);
            showToast('Đã có lỗi xảy ra khi lưu tổ.', 'error');
        } finally {
            setButtonLoading(saveBtn, false);
        }
    });

    // Lưu Phương pháp dạy học (Thêm mới hoặc Cập nhật)
    document.getElementById('save-method-btn').addEventListener('click', async () => {
        const saveBtn = document.getElementById('save-method-btn');
        const methodName = document.getElementById('method-name-input').value.trim();
        if (!methodName) {
            showToast('Vui lòng nhập tên phương pháp.', 'error');
            return;
        }
        if (!currentSchoolYear) {
            showToast('Vui lòng chọn một năm học trước.', 'error');
            return;
        }

        setButtonLoading(saveBtn, true);

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
        } finally {
            setButtonLoading(saveBtn, false);
        }
    });

    // Lưu Môn học (Thêm mới hoặc Cập nhật)
    document.getElementById('save-subject-btn').addEventListener('click', async () => {
        const saveBtn = document.getElementById('save-subject-btn');
        const subjectName = document.getElementById('subject-name-input').value.trim();
        const subjectType = document.getElementById('subject-type-select').value;
        // Lấy và xử lý các phân môn
        const subTypesInput = document.getElementById('subject-subtypes-input').value.trim();
        const subTypes = subTypesInput ? subTypesInput.split(',').map(s => s.trim()).filter(s => s) : [];

        if (!subjectName) {
            showToast('Vui lòng nhập tên môn học.', 'error');
            return;
        }
        if (!currentSchoolYear) {
            showToast('Vui lòng chọn một năm học trước.', 'error');
            return;
        }

        setButtonLoading(saveBtn, true);

        try {
            const data = {
                name: subjectName,
                type: subjectType,
                status: 'active', // THÊM MỚI: Gán trạng thái hoạt động
                schoolYear: currentSchoolYear,
                subTypes: subTypes // Thêm trường subTypes vào dữ liệu lưu
            };

            if (currentEditingId) { // Cập nhật
                const subjectRef = doc(firestore, 'subjects', currentEditingId);
                await updateDoc(subjectRef, data);
            } else { // Thêm mới
                await addDoc(collection(firestore, 'subjects'), data);
            }
            closeModal(subjectModal);
            await loadSubjects(currentSchoolYear);
        } catch (error) {
            console.error("Lỗi khi lưu môn học:", error);
            showToast('Đã có lỗi xảy ra khi lưu.', 'error');
        } finally {
            setButtonLoading(saveBtn, false);
        }
    });

    // Lưu Giáo viên (Thêm mới hoặc Cập nhật)
    document.getElementById('save-teacher-btn').addEventListener('click', async () => {
        const saveBtn = document.getElementById('save-teacher-btn');
        const isEditMode = !!currentEditingId;
        setButtonLoading(saveBtn, true);

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
                        status: 'active', // THÊM MỚI: Gán trạng thái hoạt động mặc định
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
        } finally {
            setButtonLoading(saveBtn, false);
        }
    });

    // Tạo kế hoạch thời gian
    document.getElementById('generate-plan-btn').addEventListener('click', async () => {
        const generateBtn = document.getElementById('generate-plan-btn');
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

        setButtonLoading(generateBtn, true);

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
                setButtonLoading(generateBtn, false);
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
        } finally {
            setButtonLoading(generateBtn, false);
        }
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

    // --- NEW: Event listener for subject assignments ---
    subjectAssignmentsContainer.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.edit-assignment-btn');
        if (editBtn) {
            const row = editBtn.closest('tr');
            openAssignmentModal(row.dataset.subjectId, row.dataset.subjectName);
        }
    });
    findMissingGroupIdBtn.addEventListener('click', findAndRepairMissingGroupId);

    // --- Áp dụng mùa ---
    applySummerBtn.addEventListener('click', () => applySeason('summer'));
    applyWinterBtn.addEventListener('click', () => applySeason('winter'));


    // Xử lý click trong container của các tổ (delegation)
    groupsContainer.addEventListener('click', async (e) => {
        const target = e.target;

        // Lấy group card và group id
        const groupCard = target.closest('.group-card:not(.unassigned-card)'); // Bỏ qua card "chưa có tổ"
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
                const subjects = groupDocSnap.data().subjects || [];
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

        // Mở modal xác nhận xóa Tổ
        if (target.closest('.delete-group-btn')) {
            const groupName = groupCard.querySelector('.group-name').textContent;
            const confirmBtn = document.getElementById('confirm-delete-btn'); 
            document.getElementById('confirm-delete-message').textContent = `Bạn có chắc chắn muốn vô hiệu hóa "${groupName}"? Tổ sẽ bị ẩn và các giáo viên trong tổ sẽ được chuyển vào danh sách "Chưa có tổ".`;
            confirmBtn.textContent = 'Vô hiệu hóa';

            deleteFunction = async () => {
                try {
                    const batch = writeBatch(firestore);
                    const groupDocRef = doc(firestore, 'groups', groupId);
                    
                    // Vô hiệu hóa tổ
                    batch.update(groupDocRef, { status: 'inactive' });

                    // Tìm và cập nhật group_id của tất cả giáo viên thuộc tổ này thành null
                    const teachersQuery = query(collection(firestore, "teachers"), where("group_id", "==", groupCard.dataset.groupIdText)); // Lấy group_id từ data attribute
                    const teachersSnapshot = await getDocs(teachersQuery);
                    teachersSnapshot.forEach(teacherDoc => batch.update(teacherDoc.ref, { group_id: null }));
                    
                    await batch.commit();
                    closeModal(confirmDeleteModal);
                    showToast(`Đã vô hiệu hóa ${groupName}. Các giáo viên đã được chuyển sang danh sách chưa phân công.`, 'success');
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
            const confirmBtn = document.getElementById('confirm-delete-btn');

            document.getElementById('confirm-delete-message').textContent = `Bạn có chắc chắn muốn vô hiệu hóa giáo viên "${teacherName}"? Họ sẽ không thể đăng nhập và sẽ không xuất hiện trong các danh sách chọn, nhưng dữ liệu cũ vẫn được bảo toàn.`;
            confirmBtn.textContent = 'Vô hiệu hóa'; // Thay đổi text nút

            deleteFunction = async () => {
                try {
                    // Soft delete: update status to 'inactive'
                    await updateDoc(doc(firestore, 'teachers', teacherId), {
                        status: 'inactive'
                    });
                    closeModal(confirmDeleteModal);
                    showToast(`Đã vô hiệu hóa giáo viên ${teacherName}.`, 'success');
                    await loadGroupsAndTeachers(currentSchoolYear);
                } catch (error) {
                    console.error("Lỗi khi vô hiệu hóa giáo viên:", error);
                    showToast('Đã có lỗi xảy ra khi vô hiệu hóa giáo viên.', 'error');
                } finally {
                    confirmBtn.textContent = 'Xóa'; // Reset lại text nút
                }
            };
            openModal(confirmDeleteModal);
        }

        // --- NEW: Xử lý click vào thẻ hoặc nút sửa ---
        const teacherItem = target.closest('.teacher-item');
        if (teacherItem && !target.closest('.item-actions') && !target.closest('.teacher-drag-handle')) { // Click vào thẻ giáo viên
            const teacherId = teacherItem.dataset.teacherId;
            const parentGroupCard = teacherItem.closest('.group-card');
            openTeacherEditModal(teacherId, parentGroupCard, groupId);
        }

        // Xử lý click vào header của group để sửa
        if (target.closest('.edit-group-btn')) { // Click vào nút sửa của tổ
            openGroupEditModal(groupId);
        }
    });

    const openGroupEditModal = async (groupId) => {
        try {
            const groupRef = doc(firestore, 'groups', groupId);
            const groupSnap = await getDoc(groupRef);
            if (groupSnap.exists()) {
                currentEditingId = groupId;
                const groupData = groupSnap.data();                
                document.getElementById('group-modal-title').textContent = 'Sửa tên Tổ';
                document.getElementById('group-name-input').value = groupData.group_name;
                setupGroupSubjectSelect(groupData.subjects || []); // Khởi tạo với các môn đã chọn
                openModal(groupModal);
            }
        } catch (error) {
            showToast('Không thể lấy thông tin tổ. Vui lòng thử lại.', 'error');
        }
    };

    // --- GROUP SUBJECT MULTI-SELECT LOGIC ---
    const setupGroupSubjectSelect = (selectedSubjects = []) => {        
        const wrapper = document.getElementById('group-subjects-select-wrapper');
        const container = document.getElementById('group-selected-subjects'); // Sửa lại container là vùng chứa thẻ
        const searchInput = document.getElementById('group-subject-search-input');
        const dropdown = document.getElementById('group-subject-dropdown');

        // Xóa các tag cũ và reset input
        container.innerHTML = ''; // Xóa các thẻ cũ
        searchInput.value = '';

        // Thêm các tag đã được chọn từ trước (khi sửa)
        selectedSubjects.forEach(subjectName => addGroupSubjectTag(subjectName, container));

        const filterSubjects = () => {
            const filterText = searchInput.value.toLowerCase();
            const currentSelected = getSelectedGroupSubjects();            

            const filtered = allSubjectsCache.filter(subject => 
                !currentSelected.includes(subject.name) && subject.name.toLowerCase().includes(filterText)
            );    

            dropdown.innerHTML = filtered.map(subject => `<div class="subject-dropdown-item">${subject.name}</div>`).join('');
            dropdown.style.display = filtered.length > 0 ? 'block' : 'none';           
        };

        searchInput.onkeyup = () => {
            filterSubjects();
        };
        searchInput.onfocus = () => {
            filterSubjects();
        };

        dropdown.onclick = (e) => {
            if (e.target.classList.contains('subject-dropdown-item')) {
                addGroupSubjectTag(e.target.textContent, container);
                searchInput.value = '';
                filterSubjects();
                searchInput.focus();
            }
        };

        // SỬA LỖI: Ngăn dropdown đóng lại khi click vào input hoặc các thẻ đã chọn
        container.parentElement.addEventListener('click', (e) => {
            e.stopPropagation(); // Dừng sự kiện click lan ra ngoài
            searchInput.focus(); // Focus lại vào input để người dùng có thể gõ tiếp
        });

        // Đóng dropdown khi click ra ngoài
        document.addEventListener('click', (e) => {            
            if (!wrapper.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });
    };

    const addGroupSubjectTag = (subjectName, container) => {
        // Không cần searchInput ở đây nữa
        const tag = document.createElement('span');
        tag.className = 'subject-tag';
        tag.textContent = subjectName;

        const removeBtn = document.createElement('span');
        removeBtn.className = 'remove-tag';
        removeBtn.innerHTML = '&times;';
        removeBtn.onclick = () => tag.remove();

        tag.appendChild(removeBtn);
        container.appendChild(tag); // Chỉ cần thêm vào cuối container thẻ
    };

    const getSelectedGroupSubjects = () => {
        return Array.from(document.querySelectorAll('#group-selected-subjects .subject-tag'))
            .map(tag => tag.firstChild.textContent.trim());
    };

    // --- ASSIGNMENT SUBJECT MULTI-SELECT LOGIC (Tương tự của Group) ---
    const setupAssignmentSubjectSelect = (selectedSubjects = []) => {
        const wrapper = document.querySelector('.modal-assignment .custom-select-wrapper');
        const container = wrapper.querySelector('.custom-select-container');
        const searchInput = wrapper.querySelector('#subject-search-input');
        const dropdown = wrapper.querySelector('#subject-dropdown-list');

        // Xóa các tag cũ và reset input
        container.querySelectorAll('.subject-tag').forEach(tag => tag.remove());
        searchInput.value = '';

        // Thêm các tag đã được chọn từ trước
        selectedSubjects.forEach(subjectName => addAssignmentSubjectTag(subjectName, container));

        const filterSubjects = () => {
            const filterText = searchInput.value.toLowerCase();
            const currentSelected = getSelectedAssignmentSubjects();
            const primarySubject = currentEditingSubjectForAssignment.name;

            // Lọc ra các môn không phải là môn chính và chưa được chọn
            const filtered = allSubjectsCache.filter(subject =>
                subject.name !== primarySubject &&
                !currentSelected.includes(subject.name) &&
                subject.name.toLowerCase().includes(filterText)
            );

            dropdown.innerHTML = filtered.map(subject => `<div class="subject-dropdown-item">${subject.name}</div>`).join('');
            dropdown.style.display = filtered.length > 0 ? 'block' : 'none';
        };

        searchInput.onkeyup = filterSubjects;
        searchInput.onfocus = filterSubjects;

        dropdown.onclick = (e) => {
            if (e.target.classList.contains('subject-dropdown-item')) {
                addAssignmentSubjectTag(e.target.textContent, container);
                searchInput.value = '';
                filterSubjects();
                searchInput.focus();
            }
        };

        document.addEventListener('click', (e) => {
            if (!wrapper.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });
    };

    const addAssignmentSubjectTag = (subjectName, container) => {
        const searchInput = container.querySelector('#subject-search-input');
        const tag = document.createElement('span');
        tag.className = 'subject-tag';
        tag.textContent = subjectName;
        const removeBtn = document.createElement('span');
        removeBtn.className = 'remove-tag';
        removeBtn.innerHTML = '&times;';
        removeBtn.onclick = () => tag.remove();
        tag.appendChild(removeBtn);
        container.insertBefore(tag, searchInput);
    };

    const getSelectedAssignmentSubjects = () => {
        const container = document.querySelector('.modal-assignment .custom-select-container');
        return Array.from(container.querySelectorAll('.subject-tag'))
            .map(tag => tag.firstChild.textContent.trim());
    };

    const openTeacherEditModal = async (teacherId, parentGroupCard, groupId) => {
        currentEditingId = teacherId;
        try {
            const teacherRef = doc(firestore, 'teachers', teacherId);
            const teacherSnap = await getDoc(teacherRef);
            if (teacherSnap.exists()) {
                const teacherData = teacherSnap.data();
                document.getElementById('teacher-modal-title').textContent = 'Sửa thông tin Giáo viên';
                document.getElementById('teacher-names-input').value = teacherData.teacher_name || '';
                document.getElementById('teacher-names-input').rows = 1;

                const subjectSelect = document.getElementById('teacher-subject-input');
                const groupSelectGroup = document.getElementById('teacher-group-select-group');
                const groupSelect = document.getElementById('teacher-group-select');

                if (parentGroupCard && parentGroupCard.classList.contains('unassigned-card')) {
                    if (groupSelectGroup) groupSelectGroup.style.display = 'block';
                    if (teacherSubjectGroup) teacherSubjectGroup.style.display = 'none';
                    if (groupSelect) groupSelect.innerHTML = '<option value="">-- Chọn tổ mới --</option>';
                    const activeGroupsQuery = query(collection(firestore, 'groups'), where('status', '==', 'active'), where('schoolYear', '==', currentSchoolYear));
                    const activeGroupsSnapshot = await getDocs(activeGroupsQuery);
                    activeGroupsSnapshot.forEach(gDoc => {
                        const gData = gDoc.data();
                        if (groupSelect) groupSelect.innerHTML += `<option value="${gData.group_id}">${gData.group_name}</option>`;
                    });
                } else {
                    if (groupSelectGroup) groupSelectGroup.style.display = 'none';
                    const groupRef = doc(firestore, 'groups', groupId);
                    const groupSnap = await getDoc(groupRef);
                    const subjects = groupSnap.exists() ? (groupSnap.data().subjects || []) : [];

                    subjectSelect.innerHTML = '<option value="">-- Chọn môn chính --</option>';
                    subjects.forEach(sub => {
                        subjectSelect.innerHTML += `<option value="${sub}">${sub}</option>`;
                    });
                    subjectSelect.value = teacherData.subject || '';

                    // Luôn hiển thị ô chọn môn học khi sửa giáo viên đã có tổ
                    if (teacherSubjectGroup) teacherSubjectGroup.style.display = 'block';
                }
                openModal(teacherModal);
            }
        } catch (error) {
            console.error("Lỗi khi lấy thông tin giáo viên để sửa:", error);
            showToast("Không thể lấy thông tin giáo viên. Vui lòng thử lại.", 'error');
        }
    };

    // --- NEW: Xử lý click vào thẻ để sửa cho các container khác ---
    const setupItemCardEditListener = (container) => {
        container.addEventListener('click', (e) => {
            const itemCard = e.target.closest('.item-card');
            if (itemCard && !e.target.closest('.item-actions')) {
                const methodId = itemCard.dataset.methodId;
                const subjectId = itemCard.dataset.subjectId;
                if (methodId) openMethodEditModal(methodId);
                if (subjectId) openSubjectEditModal(subjectId);
            }
        });
    };
    setupItemCardEditListener(methodsContainer);
    setupItemCardEditListener(subjectsContainer);

    const openMethodEditModal = async (methodId) => {
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
    };

    const openSubjectEditModal = async (subjectId) => {
        try {
            const subjectRef = doc(firestore, 'subjects', subjectId);
            const subjectSnap = await getDoc(subjectRef);
            if (subjectSnap.exists()) {
                currentEditingId = subjectId;
                const subjectData = subjectSnap.data();

                document.getElementById('subject-modal-title').textContent = 'Sửa Môn học';
                document.getElementById('subject-name-input').value = subjectData.name || '';
                document.getElementById('subject-type-select').value = subjectData.type || 'regular';

                // Xử lý hiển thị subTypes
                const subTypesInput = document.getElementById('subject-subtypes-input');
                if (subjectData.subTypes && Array.isArray(subjectData.subTypes)) {
                    subTypesInput.value = subjectData.subTypes.join(', ');
                } else {
                    subTypesInput.value = '';
                }

                openModal(subjectModal);
            }
        } catch (error) {
            console.error("Lỗi khi lấy thông tin môn học:", error);
            showToast('Không thể lấy thông tin môn học. Vui lòng thử lại.', 'error');
        }
    };

    // Global listener for Escape key to close modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            // Tìm và đóng modal đang mở
            if (groupModal.style.display === 'flex') closeModal(groupModal);
            else if (teacherModal.style.display === 'flex') closeModal(teacherModal);
            else if (confirmDeleteModal.style.display === 'flex') closeModal(confirmDeleteModal);
            else if (schoolYearModal.style.display === 'flex') closeModal(schoolYearModal);
            else if (methodModal.style.display === 'flex') closeModal(methodModal);
            else if (subjectModal.style.display === 'flex') closeModal(subjectModal);
            else if (weekEditModal.style.display === 'flex') closeModal(weekEditModal);
            else if (holidayModal.style.display === 'flex') closeModal(holidayModal);
        }
    });

    // Lưu phân công môn học
    document.getElementById('save-assignment-btn').addEventListener('click', saveSubjectAssignment);


    // Xử lý click trong container của các phương pháp (delegation)
    methodsContainer.addEventListener('click', async (e) => {
        const target = e.target;
        const itemCard = target.closest('.item-card');
        if (!itemCard) return;

        const methodId = itemCard.dataset.methodId;

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

    // Xử lý click trong container của các môn học (delegation)
    subjectsContainer.addEventListener('click', async (e) => {
        const target = e.target;
        const itemCard = target.closest('.item-card');
        if (!itemCard) return;

        const subjectId = itemCard.dataset.subjectId;

        // Mở modal xác nhận xóa Môn học
        if (target.closest('.delete-subject-btn')) {
            const confirmBtn = document.getElementById('confirm-delete-btn');
            const subjectName = itemCard.querySelector('.item-name').textContent;
            document.getElementById('confirm-delete-message').textContent = `Bạn có chắc chắn muốn vô hiệu hóa môn học "${subjectName}"? Môn học sẽ bị ẩn khỏi các danh sách chọn.`;
            confirmBtn.textContent = 'Vô hiệu hóa';

            deleteFunction = async () => {
                try {
                    await updateDoc(doc(firestore, 'subjects', subjectId), { status: 'inactive' });
                    closeModal(confirmDeleteModal);
                    showToast(`Đã vô hiệu hóa môn học "${subjectName}".`, 'success');
                    await loadSubjects(currentSchoolYear);
                } catch (error) {
                    showToast('Lỗi khi vô hiệu hóa môn học.', 'error');
                } finally {
                    confirmBtn.textContent = 'Xóa'; // Reset lại text nút
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
        const saveBtn = document.getElementById('save-week-btn');
        if (!currentEditingWeekId || !currentSchoolYear) return;

        const newStartDate = document.getElementById('week-start-date-input').value;
        const newEndDate = document.getElementById('week-end-date-input').value;

        if (!newStartDate || !newEndDate) {
            showToast('Vui lòng nhập đầy đủ ngày bắt đầu và kết thúc.', 'error');
            return;
        }

        setButtonLoading(saveBtn, true);

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
        } finally {
            setButtonLoading(saveBtn, false);
        }
    });

    // Lưu phân công môn học (với kiểm tra null)
    const saveAssignmentBtn = document.getElementById('save-assignment-btn');
    if (saveAssignmentBtn) {
        saveAssignmentBtn.addEventListener('click', saveSubjectAssignment);
    }


    // Xác nhận xóa
    document.getElementById('confirm-delete-btn').addEventListener('click', () => {
        if (typeof deleteFunction === 'function') {
            deleteFunction();
            deleteFunction = null; // Reset sau khi gọi
        }
    });

});