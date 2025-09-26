import {
    collection,
    getDocs,
    getDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    query,
    orderBy,
    where,
    writeBatch,
    limit
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { firestore } from "./firebase-config.js";
import { showToast } from "./toast.js";

document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('syllabus-management-content')) return;
 
    // DOM Elements
    const schoolYearSelect = document.getElementById('school-year-select');
    const groupSelect = document.getElementById('group-select');
    const subjectSelect = document.getElementById('subject-select');
    const gradeSelect = document.getElementById('grade-select');
    const typeSelect = document.getElementById('type-select');
    const addSyllabusBtn = document.getElementById('add-syllabus-btn');
    const syllabusContainer = document.getElementById('syllabus-container');
 
    // Modal Elements
    const syllabusModal = document.getElementById('syllabus-modal');
    const syllabusModalTitle = document.getElementById('syllabus-modal-title');
    const syllabusForm = document.getElementById('syllabus-form');
    const modalGroupSelect = document.getElementById('modal-group-select');
    const modalSubjectSelect = document.getElementById('modal-subject-select');
    const modalGradeSelect = document.getElementById('modal-grade-select');
    const modalTypeSelect = document.getElementById('modal-type-select');
    const lessonsInput = document.getElementById('lessons-input');
    const cancelSyllabusModalBtn = document.getElementById('cancel-syllabus-modal');
    const saveSyllabusBtn = document.getElementById('save-syllabus-btn');
    const deleteSyllabusBtn = document.getElementById('delete-syllabus-btn');
 
    // Confirm Delete Modal
    const confirmDeleteModal = document.getElementById('confirm-delete-modal');
    const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');

    // Bulk Import Modal Elements
    const bulkImportBtn = document.getElementById('bulk-import-btn');
    const bulkImportModal = document.getElementById('bulk-import-modal');
    const bulkLessonsInput = document.getElementById('bulk-lessons-input');
    const cancelBulkImportModalBtn = document.getElementById('cancel-bulk-import-modal');
    const saveBulkImportBtn = document.getElementById('save-bulk-import-btn');
 
    // State
    let currentSchoolYear = null;
    let allGroups = [];
    let currentEditingSyllabusId = null;
    let deleteFunction = null;
 
    // --- HELPERS ---
    const getSubjectsFromGroupName = (groupName) => {
        if (!groupName) return [];
        const cleanedName = groupName.replace(/^Tổ\s*/, '').trim();
        const placeholder = 'TDQP_PLACEHOLDER';
        return cleanedName.replace('Giáo dục thể chất - QP', placeholder)
                          .split(/\s*-\s*/)
                          .map(s => s.trim().replace(placeholder, 'Giáo dục thể chất - QP'));
    };
 
    // --- INITIALIZATION ---
    const initializePage = async () => {
        await loadSchoolYears();
        setupEventListeners();
    };

    const setControlsState = (enabled) => {
        addSyllabusBtn.disabled = !enabled; // Chỉ quản lý nút Thêm PPCT
        groupSelect.disabled = !enabled;
        subjectSelect.disabled = !enabled;
        gradeSelect.disabled = !enabled;
        typeSelect.disabled = !enabled;
    };
    const loadSchoolYears = async () => {
        schoolYearSelect.innerHTML = '<option>Đang tải...</option>';
        try {
            const yearsQuery = query(collection(firestore, 'schoolYears'), orderBy('schoolYear', 'desc'));
            const snapshot = await getDocs(yearsQuery);
 
            if (snapshot.empty) {
                schoolYearSelect.innerHTML = '<option>Chưa có năm học</option>';
                syllabusContainer.innerHTML = '<p>Vui lòng tạo một năm học mới trong trang "Quản lý thông tin năm học" để bắt đầu.</p>';
                setControlsState(false); // Vô hiệu hóa các bộ lọc và nút Thêm
                return;
            }
 
            schoolYearSelect.innerHTML = '';
            snapshot.forEach(doc => {
                const year = doc.data().schoolYear;
                const option = document.createElement('option');
                option.value = year;
                option.textContent = year;
                schoolYearSelect.appendChild(option);
            });
 
            if (schoolYearSelect.options.length > 0) {
                schoolYearSelect.selectedIndex = 0;
                currentSchoolYear = schoolYearSelect.value;
                await loadFiltersForYear(currentSchoolYear);
                setControlsState(true); // Kích hoạt các bộ lọc và nút Thêm
            }
        } catch (error) {
            console.error("Lỗi khi tải danh sách năm học:", error.code, error.message);
            if (error.code === 'unavailable') {
                schoolYearSelect.innerHTML = '<option>Lỗi mạng</option>';
                syllabusContainer.innerHTML = '<p class="error-message">Không thể kết nối đến máy chủ. Vui lòng kiểm tra kết nối mạng và tải lại trang.</p>';
            } else {
                schoolYearSelect.innerHTML = '<option>Lỗi tải dữ liệu</option>';
                syllabusContainer.innerHTML = '<p class="error-message">Đã có lỗi xảy ra khi tải dữ liệu năm học.</p>';
            }
            setControlsState(false); // Vô hiệu hóa các bộ lọc và nút Thêm khi có lỗi
        }
    };
 
    const loadFiltersForYear = async (schoolYear) => {
        groupSelect.innerHTML = '<option value="">Tất cả</option>';
        subjectSelect.innerHTML = '<option value="">Tất cả</option>';
        modalGroupSelect.innerHTML = '<option value="">-- Chọn tổ --</option>';
 
        const groupsQuery = query(collection(firestore, 'groups'), where("schoolYear", "==", schoolYear), orderBy('order'));
        const groupsSnapshot = await getDocs(groupsQuery);
        
        allGroups = groupsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        if (allGroups.length === 0) {
            syllabusContainer.innerHTML = '<p>Năm học này chưa có tổ chuyên môn nào. Vui lòng thêm tổ trong trang "Quản lý thông tin năm học".</p>';
            return;
        }
 
        allGroups.forEach(group => {
            const option = document.createElement('option');
            option.value = group.id; // Sử dụng doc.id để dễ dàng tham chiếu
            option.textContent = group.group_name;
            groupSelect.appendChild(option.cloneNode(true));
            modalGroupSelect.appendChild(option);
        });

        updateSubjectFilter();
    };
 
    // --- BULK IMPORT LOGIC ---
    const openBulkImportModal = () => {
        // Kiểm tra xem tất cả các bộ lọc cần thiết đã được chọn chưa
        const selectedGroupId = groupSelect.value;
        const selectedSubject = subjectSelect.value;
        const selectedGrade = gradeSelect.value;
        const selectedType = typeSelect.value;

        if (!selectedGroupId || !selectedSubject || !selectedGrade || !selectedType) {
            showToast('Vui lòng chọn đầy đủ các bộ lọc: Tổ, Môn, Khối và Phân môn trước khi nhập hàng loạt.', 'error', 5000);
            return;
        }

        // Nếu đã chọn đủ, mở modal
        bulkLessonsInput.value = '';
        bulkImportModal.style.display = 'flex';
    };

    const processAndSaveBulkImport = async () => {
        const lines = bulkLessonsInput.value.split('\n').filter(line => line.trim() !== '');
        if (lines.length === 0) {
            showToast('Vui lòng dán dữ liệu từ Excel.', 'error');
            return;
        }

        // Lấy thông tin từ các bộ lọc
        const groupId = groupSelect.value;
        const subject = subjectSelect.value;
        const grade = parseInt(gradeSelect.value);
        const type = typeSelect.value;

        const lessons = [];

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine === '') continue;

            const parts = trimmedLine.split('\t');
            if (parts.length < 2) {
                showToast(`Dòng "${trimmedLine}" không đúng định dạng. Cần có Tiết và Tên bài học cách nhau bởi Tab.`, 'error');
                return;
            }

            const period = parseInt(parts[0], 10);
            const lessonName = parts[1].trim();

            if (isNaN(period) || !lessonName) {
                showToast(`Dòng "${trimmedLine}" có dữ liệu không hợp lệ.`, 'error');
                return;
            }
            lessons.push({ period, lessonName });
        }

        if (lessons.length === 0) {
            showToast('Nội dung PPCT không được để trống hoặc không hợp lệ.', 'error');
            return;
        }

        const syllabusData = {
            schoolYear: currentSchoolYear,
            groupId,
            subject,
            grade,
            type,
            lessons
        };

        // Kiểm tra xem PPCT đã tồn tại chưa
        const q = query(collection(firestore, 'syllabuses'),
            where('schoolYear', '==', currentSchoolYear),
            where('groupId', '==', groupId),
            where('subject', '==', subject),
            where('grade', '==', grade),
            where('type', '==', type),
            limit(1)
        );

        const existingSyllabusSnapshot = await getDocs(q);

        if (!existingSyllabusSnapshot.empty) {
            // PPCT đã tồn tại, hiển thị modal xác nhận ghi đè
            const existingSyllabusId = existingSyllabusSnapshot.docs[0].id;
            
            document.getElementById('confirm-delete-title').textContent = 'Xác nhận ghi đè';
            document.getElementById('confirm-delete-message').textContent = 'Phân phối chương trình cho môn học này đã tồn tại. Bạn có muốn xóa dữ liệu cũ và ghi đè bằng dữ liệu mới không?';
            confirmDeleteBtn.textContent = 'Xác nhận';
            confirmDeleteBtn.classList.remove('btn-danger');
            confirmDeleteBtn.classList.add('btn-save');
            confirmDeleteModal.style.display = 'flex';

            deleteFunction = async () => {
                try {
                    const syllabusRef = doc(firestore, 'syllabuses', existingSyllabusId);
                    await updateDoc(syllabusRef, { lessons: syllabusData.lessons });
                    showToast('Đã ghi đè PPCT thành công!', 'success');
                    bulkImportModal.style.display = 'none';
                    loadSyllabusData();
                } catch (error) {
                    console.error("Lỗi khi ghi đè PPCT:", error);
                    showToast('Đã có lỗi xảy ra khi ghi đè.', 'error');
                }
            };
        } else {
            // PPCT chưa tồn tại, thêm mới như bình thường
            try {
                await addDoc(collection(firestore, 'syllabuses'), syllabusData);
                showToast('Nhập hàng loạt thành công!', 'success');
                bulkImportModal.style.display = 'none';
                loadSyllabusData();
            } catch (error) {
                console.error("Lỗi khi nhập hàng loạt PPCT:", error);
                showToast('Đã có lỗi xảy ra khi lưu.', 'error');
            }
        }
    };
    const updateSubjectFilter = (selectElement = subjectSelect, groupId) => {
        selectElement.innerHTML = '<option value="">Tất cả</option>';
        let subjects = new Set();
 
        if (groupId) {
            const group = allGroups.find(g => g.id === groupId);
            if (group) {
                getSubjectsFromGroupName(group.group_name).forEach(sub => subjects.add(sub));
            }
        } else { // All groups
            allGroups.forEach(group => {
                getSubjectsFromGroupName(group.group_name).forEach(sub => subjects.add(sub));
            });
        }
 
        [...subjects].sort().forEach(subject => {
            const option = document.createElement('option');
            option.value = subject;
            option.textContent = subject;
            selectElement.appendChild(option);
        });
    };
 
    // --- DATA FETCHING & RENDERING ---
    const loadSyllabusData = async () => {
        const selectedGroupId = groupSelect.value; // Đây là doc.id của group
        const selectedSubject = subjectSelect.value;
        const selectedGrade = gradeSelect.value;
        const selectedType = typeSelect.value;

        // Chỉ tải dữ liệu khi tất cả các bộ lọc đã được chọn
        if (!selectedGroupId || !selectedSubject || !selectedGrade || !selectedType) {
            // Nếu có bất kỳ bộ lọc nào chưa được chọn, hiển thị thông báo hướng dẫn
            syllabusContainer.innerHTML = '<p>Hãy chọn Năm học/Tổ chuyên môn/Môn học/Khối/Phân môn để xem Phân phối chương trình tương ứng.</p>';
            return; // Dừng hàm tại đây
        }

        // Nếu tất cả đã được chọn, tiến hành tải dữ liệu
        syllabusContainer.innerHTML = '<p>Đang tải dữ liệu...</p>';
 
        try {
            let q = query(collection(firestore, 'syllabuses'), where('schoolYear', '==', currentSchoolYear));
            if (selectedGroupId) q = query(q, where('groupId', '==', selectedGroupId));
            if (selectedSubject) q = query(q, where('subject', '==', selectedSubject));
            if (selectedGrade) q = query(q, where('grade', '==', parseInt(selectedGrade)));
            if (selectedType) q = query(q, where('type', '==', selectedType));
 
            const snapshot = await getDocs(q);
 
            if (snapshot.empty) {
                syllabusContainer.innerHTML = '<p>Không tìm thấy phân phối chương trình nào khớp với bộ lọc.</p>';
                return;
            }
 
            renderSyllabus(snapshot.docs);
 
        } catch (error) {
            console.error("Lỗi khi tải PPCT:", error.code, error.message);
            if (error.code === 'unavailable') {
                syllabusContainer.innerHTML = '<p class="error-message">Mất kết nối mạng. Không thể tải dữ liệu phân phối chương trình.</p>';
            } else {
                syllabusContainer.innerHTML = '<p class="error-message">Không thể tải dữ liệu. Vui lòng kiểm tra cấu hình Firestore Index.</p>';
            }
        }
    };
 
    const renderSyllabus = (docs) => {
        const groupedBySubject = docs.reduce((acc, doc) => {
            const syllabus = { id: doc.id, ...doc.data() };
            const key = `${syllabus.subject}-${syllabus.grade}`;
            if (!acc[key]) {
                acc[key] = [];
            }
            acc[key].push(syllabus);
            return acc;
        }, {});
 
        let html = '';
        for (const key in groupedBySubject) {
            const syllabuses = groupedBySubject[key];
            const firstSyllabus = syllabuses[0];
 
            const typeText = firstSyllabus.type === 'main' ? 'chính' : 'chuyên đề';
            const newTitle = `Bảng Phân phối chương trình, Môn ${firstSyllabus.subject}, Phân môn ${typeText}, Khối ${firstSyllabus.grade}, Năm học ${currentSchoolYear}`;

            html += `<h3 class="syllabus-table-title">${newTitle}</h3>`;
            html += `<table class="syllabus-table">
                        <thead>
                            <tr>
                                <th class="col-period">Tiết PPCT</th>
                                <th>Tên bài học / Nội dung</th>
                                <th class="col-actions">Hành động</th>
                            </tr>
                        </thead>
                        <tbody>`;
 
            const allLessons = syllabuses.flatMap(s =>
                s.lessons.map(lesson => ({ ...lesson, syllabusId: s.id, type: s.type }))
            ).sort((a, b) => a.period - b.period);
 
            allLessons.forEach(lesson => {
                const typeText = lesson.type === 'specialized' ? ' (Chuyên đề)' : '';
                html += `
                    <tr data-syllabus-id="${lesson.syllabusId}">
                        <td class="col-period">${lesson.period}</td>
                        <td>${lesson.lessonName}${typeText}</td>
                        <td class="col-actions item-actions">
                            <button class="edit-syllabus-btn icon-button" title="Sửa PPCT"><i class="fas fa-pencil-alt"></i></button>
                        </td>
                    </tr>
                `;
            });
 
            html += `</tbody></table>`;
        }
 
        syllabusContainer.innerHTML = html || '<p>Không có dữ liệu để hiển thị.</p>';
    };
 
    // --- MODAL & FORM HANDLING ---
    const openSyllabusModal = async (syllabusId = null) => {
        syllabusForm.reset();
        lessonsInput.value = '';
        currentEditingSyllabusId = syllabusId;
 
        if (syllabusId) {
            syllabusModalTitle.textContent = 'Chỉnh sửa Phân phối chương trình';
            deleteSyllabusBtn.style.display = 'inline-block';
 
            const syllabusRef = doc(firestore, 'syllabuses', syllabusId);
            const syllabusSnap = await getDoc(syllabusRef);
            if (syllabusSnap.exists()) {
                const data = syllabusSnap.data();
                modalGroupSelect.value = data.groupId;
                updateModalSubjectSelect(data.groupId);
                modalSubjectSelect.value = data.subject;
                modalGradeSelect.value = data.grade;
                modalTypeSelect.value = data.type;
 
                const lessonsString = data.lessons
                    .sort((a, b) => a.period - b.period)
                    .map(lesson => `${lesson.period}\t${lesson.lessonName}`)
                    .join('\n');
                lessonsInput.value = lessonsString;
            }
        } else {
            syllabusModalTitle.textContent = 'Thêm Phân phối chương trình';
            deleteSyllabusBtn.style.display = 'none';
        }
 
        syllabusModal.style.display = 'flex';
    };
 
    const saveSyllabus = async () => {
        const groupId = modalGroupSelect.value; // Đây là doc.id của group
        const subject = modalSubjectSelect.value;
        const grade = parseInt(modalGradeSelect.value);
        const type = modalTypeSelect.value;
 
        if (!groupId || !subject || !grade) {
            showToast('Vui lòng điền đầy đủ thông tin Tổ, Môn và Khối.', 'error');
            return;
        }
 
        const lessons = [];
        const lines = lessonsInput.value.split('\n');
 
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine === '') continue;
 
            const parts = trimmedLine.split('\t');
            if (parts.length < 2) {
                showToast(`Dòng "${trimmedLine}" không đúng định dạng. Cần có Tiết và Tên bài học cách nhau bởi Tab.`, 'error');
                return;
            }

            const period = parseInt(parts[0], 10);
            const lessonName = parts[1].trim();
 
            if (isNaN(period) || !lessonName) {
                showToast(`Dòng "${trimmedLine}" có dữ liệu không hợp lệ.`, 'error');
                return;
            }
            lessons.push({ period, lessonName });
        }
 
        if (lessons.length === 0) {
            showToast('Nội dung PPCT không được để trống hoặc không hợp lệ.', 'error');
            return;
        }
 
        const syllabusData = {
            schoolYear: currentSchoolYear,
            groupId,
            subject,
            grade,
            type,
            lessons
        };
 
        try {
            if (currentEditingSyllabusId) {
                const syllabusRef = doc(firestore, 'syllabuses', currentEditingSyllabusId);
                await updateDoc(syllabusRef, syllabusData);
                showToast('Cập nhật thành công!', 'success');
            } else {
                await addDoc(collection(firestore, 'syllabuses'), syllabusData);
                showToast('Thêm mới thành công!', 'success');
            }
            syllabusModal.style.display = 'none';
            loadSyllabusData();
        } catch (error) {
            console.error("Lỗi khi lưu PPCT:", error);
            showToast('Đã có lỗi xảy ra khi lưu.', 'error');
        }
    };
 
    const handleDeleteSyllabus = () => {
        if (!currentEditingSyllabusId) return;
 
        confirmDeleteModal.style.display = 'flex';
        document.getElementById('confirm-delete-message').textContent = "Bạn có chắc chắn muốn xóa Phân phối chương trình này?";
 
        deleteFunction = async () => {
            try {
                await deleteDoc(doc(firestore, 'syllabuses', currentEditingSyllabusId));
                showToast('Đã xóa thành công.', 'success');
                syllabusModal.style.display = 'none';
                loadSyllabusData();
            } catch (error) {
                console.error("Lỗi khi xóa PPCT:", error);
                showToast('Lỗi khi xóa.', 'error');
            }
        };
    };
 
    const updateModalSubjectSelect = (groupId) => {
        const group = allGroups.find(g => g.id === groupId);
        const subjects = getSubjectsFromGroupName(group?.group_name);
        modalSubjectSelect.innerHTML = '<option value="">-- Chọn môn --</option>';
        subjects.forEach(sub => {
            modalSubjectSelect.innerHTML += `<option value="${sub}">${sub}</option>`;
        });
    };
 
    // --- EVENT LISTENERS ---
    const setupEventListeners = () => {
        schoolYearSelect.addEventListener('change', async (e) => {
            currentSchoolYear = e.target.value;
            await loadFiltersForYear(currentSchoolYear);
        });
 
        groupSelect.addEventListener('change', () => {
            updateSubjectFilter(subjectSelect, groupSelect.value);
            loadSyllabusData();
        });
 
        [subjectSelect, gradeSelect, typeSelect].forEach(el => {
            el.addEventListener('change', loadSyllabusData);
        });
 
        addSyllabusBtn.addEventListener('click', () => openSyllabusModal());
 
        syllabusContainer.addEventListener('click', (e) => {
            const editBtn = e.target.closest('.edit-syllabus-btn');
            if (editBtn) {
                const row = editBtn.closest('tr');
                openSyllabusModal(row.dataset.syllabusId);
            }
        });
 
        // Modal listeners
        cancelSyllabusModalBtn.addEventListener('click', () => syllabusModal.style.display = 'none');
        saveSyllabusBtn.addEventListener('click', saveSyllabus);
        deleteSyllabusBtn.addEventListener('click', handleDeleteSyllabus);
 
        modalGroupSelect.addEventListener('change', (e) => {
            updateModalSubjectSelect(e.target.value);
        });
 
        // Bulk Import Listeners
        bulkImportBtn.addEventListener('click', openBulkImportModal);
        cancelBulkImportModalBtn.addEventListener('click', () => bulkImportModal.style.display = 'none');
        saveBulkImportBtn.addEventListener('click', processAndSaveBulkImport);

        // Confirm Delete Modal Listeners
        cancelDeleteBtn.addEventListener('click', () => {
            confirmDeleteModal.style.display = 'none';
            deleteFunction = null;
            // Reset modal về trạng thái xóa mặc định
            setTimeout(() => {
                document.getElementById('confirm-delete-title').textContent = 'Xác nhận xóa';
                confirmDeleteBtn.textContent = 'Xóa';
                confirmDeleteBtn.classList.add('btn-danger');
            }, 300);
        });
        confirmDeleteBtn.addEventListener('click', () => {
            if (typeof deleteFunction === 'function') {
                deleteFunction();
            }
            confirmDeleteModal.style.display = 'none';
            deleteFunction = null;
            // Reset modal về trạng thái xóa mặc định
            setTimeout(() => {
                document.getElementById('confirm-delete-title').textContent = 'Xác nhận xóa';
                confirmDeleteBtn.textContent = 'Xóa';
                confirmDeleteBtn.classList.add('btn-danger');
            }, 300);
        });
    };

    const setupScrollToTop = () => {
        const scrollToTopBtn = document.querySelector('.scroll-to-top-btn');
        if (!scrollToTopBtn) return;

        // Lắng nghe sự kiện cuộn trên phần tử main-content, vì đây là khu vực cuộn chính
        const mainContent = document.getElementById('main-content');
        if (!mainContent) return;

        mainContent.addEventListener('scroll', () => {
            if (mainContent.scrollTop > 200) {
                scrollToTopBtn.classList.add('show');
            } else {
                scrollToTopBtn.classList.remove('show');
            }
        });

        // Xử lý click để cuộn lên đầu
        scrollToTopBtn.addEventListener('click', (e) => {
            e.preventDefault();
            mainContent.scrollTo({ top: 0, behavior: 'smooth' });
        });
    };
 
    initializePage();
    setupScrollToTop();
});