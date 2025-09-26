import {
    collection,
    getDocs,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    query,
    orderBy,
    where,
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

    // State
    let currentSchoolYear = null;
    let allGroups = [];
    let currentEditingSyllabusId = null;
    let deleteFunction = null;

    const getSubjectsFromGroupName = (groupName) => {
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

    const loadSchoolYears = async () => {
        schoolYearSelect.innerHTML = '<option>Đang tải...</option>';
        try {
            const yearsQuery = query(collection(firestore, 'schoolYears'), orderBy('schoolYear', 'desc'));
            const snapshot = await getDocs(yearsQuery);

            if (snapshot.empty) {
                schoolYearSelect.innerHTML = '<option>Chưa có năm học</option>';
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
            }
        } catch (error) {
            console.error("Lỗi khi tải danh sách năm học:", error);
            schoolYearSelect.innerHTML = '<option>Lỗi tải dữ liệu</option>';
        }
    };

    const loadFiltersForYear = async (schoolYear) => {
        groupSelect.innerHTML = '<option value="">Tất cả</option>';
        subjectSelect.innerHTML = '<option value="">Tất cả</option>';
        modalGroupSelect.innerHTML = '<option value="">-- Chọn tổ --</option>';

        const groupsQuery = query(collection(firestore, 'groups'), where("schoolYear", "==", schoolYear), orderBy('order'));
        const groupsSnapshot = await getDocs(groupsQuery);
        
        allGroups = groupsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        allGroups.forEach(group => {
            const option = document.createElement('option');
            option.value = group.group_id;
            option.textContent = group.group_name;
            groupSelect.appendChild(option.cloneNode(true));
            modalGroupSelect.appendChild(option);
        });

        updateSubjectFilter();
        loadSyllabusData();
    };

    const updateSubjectFilter = (selectElement = subjectSelect, groupId) => {
        selectElement.innerHTML = '<option value="">Tất cả</option>';
        let subjects = new Set();

        if (groupId) {
            const group = allGroups.find(g => g.group_id === groupId);
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

    const loadSyllabusData = async () => {
        syllabusContainer.innerHTML = '<p>Đang tải dữ liệu...</p>';
        
        const selectedGroupId = groupSelect.value;
        const selectedSubject = subjectSelect.value;
        const selectedGrade = gradeSelect.value;

        try {
            let q = query(collection(firestore, 'syllabuses'), where('schoolYear', '==', currentSchoolYear));
            if (selectedGroupId) q = query(q, where('groupId', '==', selectedGroupId));
            if (selectedSubject) q = query(q, where('subject', '==', selectedSubject));
            if (selectedGrade) q = query(q, where('grade', '==', parseInt(selectedGrade)));

            const snapshot = await getDocs(q);

            if (snapshot.empty) {
                syllabusContainer.innerHTML = '<p>Không tìm thấy phân phối chương trình nào khớp với bộ lọc.</p>';
                return;
            }

            renderSyllabus(snapshot.docs);

        } catch (error) {
            console.error("Lỗi khi tải PPCT:", error);
            syllabusContainer.innerHTML = '<p class="error-message">Không thể tải dữ liệu.</p>';
        }
    };

    const renderSyllabus = (docs) => {
        syllabusContainer.innerHTML = '';
        docs.forEach(doc => {
            const syllabus = { id: doc.id, ...doc.data() };
            const group = allGroups.find(g => g.group_id === syllabus.groupId);
            const typeText = syllabus.type === 'specialized' ? 'Chuyên đề' : 'Chính';

            const card = document.createElement('div');
            card.className = 'syllabus-card';
            card.dataset.id = syllabus.id;

            let lessonsHTML = syllabus.lessons.sort((a, b) => a.period - b.period).map(lesson => `
                <tr>
                    <td>${lesson.period}</td>
                    <td>${lesson.lessonName}</td>
                </tr>
            `).join('');

            card.innerHTML = `
                <div class="syllabus-card-header">
                    <h3>${syllabus.subject} - Khối ${syllabus.grade} (${typeText})</h3>
                    <p>${group?.group_name || 'N/A'}</p>
                    <div class="item-actions">
                        <button class="edit-syllabus-btn icon-button" title="Sửa"><i class="fas fa-pencil-alt"></i></button>
                    </div>
                </div>
                <div class="syllabus-card-body">
                    <table class="lesson-table">
                        <thead>
                            <tr>
                                <th style="width: 20%;">Tiết PPCT</th>
                                <th>Tên bài học</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${lessonsHTML}
                        </tbody>
                    </table>
                </div>
            `;
            syllabusContainer.appendChild(card);
        });
    };

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
                updateSubjectFilter(modalSubjectSelect, data.groupId);
                modalSubjectSelect.value = data.subject;
                modalGradeSelect.value = data.grade;
                modalTypeSelect.value = data.type;

                // Format lessons to string and set to textarea
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
        const groupId = modalGroupSelect.value;
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
            if (trimmedLine === '') continue; // Bỏ qua các dòng trống

            const parts = trimmedLine.split('\t'); // Tách bằng dấu Tab
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

        if (lessons.length === 0 && lessonsInput.value.trim() !== '') {
            showToast('Phải có ít nhất một bài học.', 'error');
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

        [subjectSelect, gradeSelect].forEach(el => {
            el.addEventListener('change', loadSyllabusData);
        });

        addSyllabusBtn.addEventListener('click', () => openSyllabusModal());

        syllabusContainer.addEventListener('click', (e) => {
            const editBtn = e.target.closest('.edit-syllabus-btn');
            if (editBtn) {
                const card = editBtn.closest('.syllabus-card');
                openSyllabusModal(card.dataset.id);
            }
        });

        // Modal listeners
        cancelSyllabusModalBtn.addEventListener('click', () => syllabusModal.style.display = 'none');
        saveSyllabusBtn.addEventListener('click', saveSyllabus);
        deleteSyllabusBtn.addEventListener('click', handleDeleteSyllabus);

        modalGroupSelect.addEventListener('change', (e) => {
            updateSubjectFilter(modalSubjectSelect, e.target.value);
        });

        // Confirm Delete Modal Listeners
        cancelDeleteBtn.addEventListener('click', () => {
            confirmDeleteModal.style.display = 'none';
            deleteFunction = null;
        });
        confirmDeleteBtn.addEventListener('click', () => {
            if (typeof deleteFunction === 'function') {
                deleteFunction();
            }
            confirmDeleteModal.style.display = 'none';
            deleteFunction = null;
        });
    };

    initializePage();
});