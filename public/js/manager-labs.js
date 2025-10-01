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
    getDoc
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { firestore } from "./firebase-config.js";
import { showToast } from "./toast.js";

document.addEventListener('DOMContentLoaded', () => {
    // Chỉ thực thi code nếu element chính tồn tại
    if (!document.getElementById('lab-management-content')) return;

    // --- DOM Elements ---
    const schoolYearSelect = document.getElementById('school-year-select');
    const labsContainer = document.getElementById('labs-container');
    const addLabBtn = document.getElementById('add-lab-btn');
    const labModal = document.getElementById('lab-modal');
    const labModalTitle = document.getElementById('lab-modal-title');
    const labNameInput = document.getElementById('lab-name-input');
    const labSubjectSelect = document.getElementById('lab-subject-select');
    const labDescriptionInput = document.getElementById('lab-description-input');
    const cancelLabModalBtn = document.getElementById('cancel-lab-modal');
    const saveLabBtn = document.getElementById('save-lab-btn');
    const confirmDeleteModal = document.getElementById('confirm-delete-modal');
    const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');

    // --- State ---
    let currentSchoolYear = null;
    let currentEditingId = null;
    let deleteFunction = null;
    let allSubjects = [];

    // --- Helper Functions ---
    const setButtonLoading = (button, isLoading) => {
        if (!button) return;
        const textSpan = button.querySelector('.btn-text');
        const spinnerSpan = button.querySelector('.btn-spinner');
        if (isLoading) {
            button.disabled = true;
            if (textSpan) textSpan.style.display = 'none';
            if (spinnerSpan) spinnerSpan.style.display = 'inline-block';
        } else {
            button.disabled = false;
            if (textSpan) textSpan.style.display = 'inline-block';
            if (spinnerSpan) spinnerSpan.style.display = 'none';
        }
    };

    // --- Data Loading ---
    const loadSchoolYears = async () => {
        schoolYearSelect.innerHTML = '<option>Đang tải...</option>';
        try {
            const yearsQuery = query(collection(firestore, 'schoolYears'), orderBy('schoolYear', 'desc'));
            const snapshot = await getDocs(yearsQuery);

            if (snapshot.empty) {
                schoolYearSelect.innerHTML = '<option>Chưa có năm học</option>';
                labsContainer.innerHTML = '<p>Vui lòng tạo một năm học mới để bắt đầu.</p>';
                return;
            }

            schoolYearSelect.innerHTML = '';
            snapshot.forEach(doc => {
                const year = doc.data();
                const option = document.createElement('option');
                option.value = year.schoolYear;
                option.textContent = year.schoolYear;
                schoolYearSelect.appendChild(option);
            });

            if (schoolYearSelect.options.length > 0) {
                schoolYearSelect.selectedIndex = 0;
                currentSchoolYear = schoolYearSelect.value;
                await loadSubjectsForYear(currentSchoolYear);
                await loadLabs(currentSchoolYear);
            }
        } catch (error) {
            console.error("Lỗi khi tải danh sách năm học:", error);
            schoolYearSelect.innerHTML = '<option>Lỗi tải dữ liệu</option>';
        }
    };

    const loadSubjectsForYear = async (schoolYear) => {
        labSubjectSelect.innerHTML = '<option value="">-- Chọn môn học --</option>';
        allSubjects = [];
        try {
            const subjectsQuery = query(collection(firestore, 'subjects'), where('schoolYear', '==', schoolYear), orderBy('name'));
            const snapshot = await getDocs(subjectsQuery);
            snapshot.forEach(doc => {
                const subject = doc.data().name;
                allSubjects.push(subject);
                const option = document.createElement('option');
                option.value = subject;
                option.textContent = subject;
                labSubjectSelect.appendChild(option);
            });
        } catch (error) {
            console.error("Lỗi khi tải môn học:", error);
            showToast("Không thể tải danh sách môn học.", "error");
        }
    };

    const loadLabs = async (schoolYear) => {
        labsContainer.innerHTML = '<p>Đang tải danh sách phòng học...</p>';
        try {
            const labsQuery = query(
                collection(firestore, 'labs'),
                where("schoolYear", "==", schoolYear),
                orderBy('name')
            );
            const snapshot = await getDocs(labsQuery);

            if (snapshot.empty) {
                labsContainer.innerHTML = '<p>Chưa có phòng học bộ môn nào cho năm học này.</p>';
                return;
            }

            const labs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderLabs(labs);

        } catch (error) {
            console.error("Lỗi khi tải phòng học:", error);
            labsContainer.innerHTML = '<p class="error-message">Không thể tải dữ liệu phòng học bộ môn.</p>';
        }
    };

    // --- UI Rendering ---
    const renderLabs = (labs) => {
        labsContainer.innerHTML = labs.map((lab, index) => `
            <div class="item-card" data-id="${lab.id}">
                <div class="item-info">
                    <i class="fas fa-flask method-icon"></i>
                    <div class="item-details">
                        <span class="item-name">${lab.name}</span>
                        ${lab.description ? `<span class="item-sub-info">Mô tả: ${lab.description}</span>` : ''}
                    </div>
                </div>
                <div class="item-actions">
                    <button class="edit-lab-btn icon-button" title="Sửa"><i class="fas fa-pencil-alt"></i></button>
                    <button class="delete-lab-btn icon-button" title="Xóa"><i class="fas fa-trash-alt"></i></button>
                </div>
            </div>
        `).join('');
    };

    // --- Modal Handling ---
    const openLabModal = (labData = null) => {
        if (labData) { // Edit mode
            currentEditingId = labData.id;
            labModalTitle.textContent = "Sửa thông tin Phòng học";
            labNameInput.value = labData.name;
            labSubjectSelect.value = labData.subject;
            labDescriptionInput.value = labData.description || '';
        } else { // Add mode
            currentEditingId = null;
            labModalTitle.textContent = "Thêm Phòng học bộ môn";
            labNameInput.value = '';
            labSubjectSelect.value = '';
            labDescriptionInput.value = '';
        }
        labModal.style.display = 'flex';
    };

    const closeLabModal = () => {
        labModal.style.display = 'none';
    };

    // --- CRUD Operations ---
    const saveLab = async () => {
        const name = labNameInput.value.trim();
        const subject = labSubjectSelect.value;
        const description = labDescriptionInput.value.trim();

        if (!name || !subject) {
            showToast("Vui lòng điền đầy đủ Tên phòng và Môn học.", "error");
            return;
        }

        setButtonLoading(saveLabBtn, true);

        const labData = {
            name,
            subject,
            description,
            schoolYear: currentSchoolYear
        };

        try {
            if (currentEditingId) {
                await updateDoc(doc(firestore, 'labs', currentEditingId), labData);
                showToast("Cập nhật phòng học thành công!", "success");
            } else {
                await addDoc(collection(firestore, 'labs'), labData);
                showToast("Thêm phòng học thành công!", "success");
            }
            closeLabModal();
            await loadLabs(currentSchoolYear);
        } catch (error) {
            console.error("Lỗi khi lưu phòng học:", error);
            showToast("Đã có lỗi xảy ra khi lưu.", "error");
        } finally {
            setButtonLoading(saveLabBtn, false);
        }
    };

    const handleDeleteLab = (labId) => {
        confirmDeleteModal.style.display = 'flex';
        deleteFunction = async () => {
            try {
                await deleteDoc(doc(firestore, 'labs', labId));
                showToast("Đã xóa phòng học.", "success");
                await loadLabs(currentSchoolYear);
            } catch (error) {
                console.error("Lỗi khi xóa phòng học:", error);
                showToast("Lỗi khi xóa phòng học.", "error");
            }
        };
    };

    // --- Event Listeners ---
    schoolYearSelect.addEventListener('change', async () => {
        currentSchoolYear = schoolYearSelect.value;
        if (currentSchoolYear) {
            await loadSubjectsForYear(currentSchoolYear);
            await loadLabs(currentSchoolYear);
        }
    });

    addLabBtn.addEventListener('click', () => openLabModal());
    cancelLabModalBtn.addEventListener('click', closeLabModal);
    saveLabBtn.addEventListener('click', saveLab);

    labsContainer.addEventListener('click', async (e) => {
        const itemCard = e.target.closest('.item-card');
        if (!itemCard) return;

        const labId = itemCard.dataset.id;

        if (e.target.closest('.edit-lab-btn')) {
            const docRef = doc(firestore, 'labs', labId);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                openLabModal({ id: docSnap.id, ...docSnap.data() });
            }
        }

        if (e.target.closest('.delete-lab-btn')) {
            handleDeleteLab(labId);
        }
    });

    // Delete confirmation modal
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

    // --- Initialization ---
    loadSchoolYears();
});