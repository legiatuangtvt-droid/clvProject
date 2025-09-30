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
    const subjectSelect = document.getElementById('subject-select');
    const gradeSelect = document.getElementById('grade-select');
    const typeSelect = document.getElementById('type-select');
    const syllabusContainer = document.getElementById('syllabus-container');
 
    const confirmDeleteModal = document.getElementById('confirm-delete-modal');
    const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
    const bulkImportBtn = document.getElementById('bulk-import-btn');
    const bulkImportModal = document.getElementById('bulk-import-modal');
    const bulkLessonsInput = document.getElementById('bulk-lessons-input');
    const cancelBulkImportModalBtn = document.getElementById('cancel-bulk-import-modal');
    const saveBulkImportBtn = document.getElementById('save-bulk-import-btn');
 
    // State
    let currentSchoolYear = null;
    let allSubjects = []; // NEW: State to hold all subjects for the selected year
    let deleteFunction = null;
 
    // --- INITIALIZATION ---
    const initializePage = async () => {
        await loadSchoolYears();
        setupEventListeners();
    };

    const setControlsState = (enabled) => {
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
        subjectSelect.innerHTML = '<option value="">Tất cả</option>';

        // NEW: Load subjects directly from the 'subjects' collection
        const subjectsQuery = query(collection(firestore, 'subjects'), where("schoolYear", "==", schoolYear), orderBy('name'));
        const subjectsSnapshot = await getDocs(subjectsQuery);
        allSubjects = subjectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        if (allSubjects.length === 0) {
            syllabusContainer.innerHTML = '<p>Năm học này chưa có môn học nào được định nghĩa. Vui lòng thêm môn học trong trang "Quản lý thông tin năm học".</p>';
            return;
        }

        updateSubjectFilter(subjectSelect);
    };
 
    // --- BULK IMPORT LOGIC ---
    const openBulkImportModal = () => {
        // Kiểm tra xem tất cả các bộ lọc cần thiết đã được chọn chưa
        const selectedSubject = subjectSelect.value;
        const selectedGrade = gradeSelect.value;
        const selectedType = typeSelect.value;

        if (!selectedSubject || !selectedGrade || !selectedType) {
            showToast('Vui lòng chọn đầy đủ các bộ lọc: Môn, Khối và Phân môn trước khi nhập hàng loạt.', 'error', 5000);
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
            subject,
            grade,
            type,
            lessons
        };

        // Kiểm tra xem PPCT đã tồn tại chưa
        const q = query(collection(firestore, 'syllabuses'),
            where('schoolYear', '==', currentSchoolYear),
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
    // REFACTORED: This function now populates selects from the allSubjects array
    const updateSubjectFilter = (selectElement, defaultOptionText = 'Tất cả') => {
        selectElement.innerHTML = `<option value="">${defaultOptionText}</option>`;
        allSubjects.sort((a, b) => a.name.localeCompare(b.name)).forEach(subject => { // Sắp xếp theo tên
            const option = document.createElement('option');
            option.value = subject.name;
            option.textContent = subject.name;
            selectElement.appendChild(option);
        });
    };
 
    // --- DATA FETCHING & RENDERING ---
    const loadSyllabusData = async () => {
        const selectedSubject = subjectSelect.value;
        const selectedGrade = gradeSelect.value;
        const selectedType = typeSelect.value;

        // Chỉ tải dữ liệu khi tất cả các bộ lọc đã được chọn
        if (!selectedSubject || !selectedGrade || !selectedType) {
            // Nếu có bất kỳ bộ lọc nào chưa được chọn, hiển thị thông báo hướng dẫn
            syllabusContainer.innerHTML = '<p>Hãy chọn Năm học/Tổ chuyên môn/Môn học/Khối/Phân môn để xem Phân phối chương trình tương ứng.</p>';
            return; // Dừng hàm tại đây
        }

        // Nếu tất cả đã được chọn, tiến hành tải dữ liệu
        syllabusContainer.innerHTML = '<p>Đang tải dữ liệu...</p>';
 
        try {
            let q = query(collection(firestore, 'syllabuses'), where('schoolYear', '==', currentSchoolYear));
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
                    </tr>
                `;
            });
 
            html += `</tbody></table>`;
        }
 
        syllabusContainer.innerHTML = html || '<p>Không có dữ liệu để hiển thị.</p>';
    };
    // --- EVENT LISTENERS ---
    const setupEventListeners = () => {
        schoolYearSelect.addEventListener('change', async (e) => {
            currentSchoolYear = e.target.value;
            await loadFiltersForYear(currentSchoolYear);
        });
 
        [subjectSelect, gradeSelect, typeSelect].forEach(el => {
            el.addEventListener('change', loadSyllabusData);
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

    initializePage();
});