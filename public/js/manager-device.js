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
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { firestore } from "./firebase-config.js";
import { showToast } from "./toast.js";

document.addEventListener('DOMContentLoaded', () => {
    // Chỉ thực thi nếu đang ở đúng trang
    if (!document.getElementById('device-table-body')) return;

    // DOM Elements
    const tableBody = document.getElementById('device-table-body');
    const addDeviceBtn = document.getElementById('add-device-btn');
    // Modal elements are no longer needed for adding, but kept for editing for now.
    const confirmDeleteModal = document.getElementById('confirm-delete-modal');
    const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');

    // State
    let currentEditingId = null;
    let parentId = null;
    let deleteFunction = null;
    let allDevicesCache = []; // Cache for device data
    let editModal, editForm, editModalTitle, cancelEditBtn, saveEditBtn; // For editing

    // --- Tải và hiển thị dữ liệu ---
    const loadDevices = async () => {
        tableBody.innerHTML = '<tr><td colspan="9" style="text-align: center;">Đang tải dữ liệu...</td></tr>';
        try {
            const q = query(collection(firestore, 'devices'), orderBy('order'));
            const snapshot = await getDocs(q);

            if (snapshot.empty) {
                tableBody.innerHTML = '<tr><td colspan="9" style="text-align: center;">Chưa có thiết bị nào. Hãy thêm mới.</td></tr>';
                return;
            }

            allDevicesCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderDeviceTree(allDevicesCache);

        } catch (error) {
            console.error("Lỗi khi tải danh mục thiết bị:", error);
            tableBody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: red;">Không thể tải dữ liệu.</td></tr>';
            if (error.code === 'failed-precondition') {
                showToast('Lỗi cấu hình: Cần tạo chỉ mục trong Firestore. Kiểm tra console (F12) để xem chi tiết.', 'error', 7000);
            }
        }
    };

    const renderDeviceTree = (devicesData, parentId = null, level = 0) => {
        const children = devicesData.filter(d => d.parentId === parentId);

        if (level === 0) {
            tableBody.innerHTML = ''; // Xóa bảng trước khi render
        }

        children.forEach((device, index) => {
            const isGroup = device.type === 'group';
            const isParent = device.type === 'parent';
            const isItem = device.type === 'item';

            const row = document.createElement('tr');
            row.className = `device-row level-${level}`;
            row.dataset.id = device.id;
            if (isGroup) row.classList.add('is-group');
            if (isParent) row.classList.add('is-parent');
            if (isItem) row.classList.add('is-item');

            let stt = device.order;
            if (isGroup) stt = `${device.order}.`;
            // For children, find parent's order
            else if (parentId) stt = `${devicesData.find(p => p.id === parentId)?.order || ''}.${index + 1}`;

            row.innerHTML = `
                <td class="col-stt">${stt || ''}</td>
                <td class="col-subject">${device.subject || ''}</td>
                <td class="col-category">${device.category || ''}</td>
                <td class="col-code">${device.code || ''}</td>
                <td class="col-name">
                    <div class="device-name-cell">
                        ${isGroup ? `<i class="fas fa-folder-open group-icon"></i>` : ''}
                        ${device.name}
                    </div>
                </td>
                <td class="col-description">${device.description || ''}</td>
                <td class="col-grades">${device.grades || ''}</td>
                <td class="col-notes">${device.notes || ''}</td>
                <td class="col-actions">
                    <div class="item-actions">
                        ${isGroup || isParent ? `<button class="icon-button add-child-btn" title="Thêm mục con"><i class="fas fa-plus"></i></button>` : ''}
                        <button class="icon-button edit-btn" title="Sửa"><i class="fas fa-pencil-alt"></i></button>
                        <button class="icon-button delete-btn" title="Xóa"><i class="fas fa-trash-alt"></i></button>
                    </div>
                </td>
            `;
            tableBody.appendChild(row);

            // Render các mục con (đệ quy)
            renderDeviceTree(devicesData, device.id, level + 1);
        });
    };

    // --- Inline Add Functionality ---
    const addInlineRow = (pId = null) => {
        // Prevent adding multiple inline rows
        if (document.querySelector('.inline-add-row')) {
            showToast('Vui lòng hoàn tất việc thêm mục hiện tại.', 'info');
            return;
        }

        const parent = pId ? allDevicesCache.find(d => d.id === pId) : null;
        let type = 'group';
        let level = 0;
        if (parent) {
            type = parent.type === 'group' ? 'parent' : 'item';
            level = allDevicesCache.filter(d => d.parentId === parent.id).length > 0 ? parseInt(document.querySelector(`[data-id="${pId}"]`).className.match(/level-(\d+)/)[1]) + 1 : 1;
        }

        const row = document.createElement('tr');
        row.className = `inline-add-row level-${level}`;
        row.dataset.parentId = pId || '';
        row.dataset.type = type;

        const isGroup = type === 'group';
        const isItem = type === 'item';

        row.innerHTML = `
            <td class="col-stt"><input type="number" class="inline-input" name="order" placeholder="STT" style="width: 60px;"></td>
            <td class="col-subject">${isGroup ? '<input type="text" class="inline-input" name="subject" placeholder="Môn học">' : (parent?.subject || '')}</td>
            <td class="col-category">${isGroup ? '<input type="text" class="inline-input" name="category" placeholder="Loại">' : (parent?.category || '')}</td>
            <td class="col-code">${isItem ? '<input type="text" class="inline-input" name="code" placeholder="Mã TB">' : ''}</td>
            <td class="col-name"><input type="text" class="inline-input" name="name" placeholder="Tên mục" required></td>
            <td class="col-description"><input type="text" class="inline-input" name="description" placeholder="Mô tả"></td>
            <td class="col-grades">${isItem ? '<input type="text" class="inline-input" name="grades" placeholder="Lớp">' : ''}</td>
            <td class="col-notes"><input type="text" class="inline-input" name="notes" placeholder="Ghi chú"></td>
            <td class="col-actions">
                <div class="item-actions">
                    <button class="icon-button save-inline-btn" title="Lưu"><i class="fas fa-check"></i></button>
                    <button class="icon-button cancel-inline-btn" title="Hủy"><i class="fas fa-times"></i></button>
                </div>
            </td>
        `;

        if (pId) {
            const parentRow = document.querySelector(`tr[data-id='${pId}']`);
            // Find last child of parent and insert after it
            const children = allDevicesCache.filter(d => d.parentId === pId);
            if (children.length > 0) {
                const lastChildId = children[children.length - 1].id;
                const lastChildRow = document.querySelector(`tr[data-id='${lastChildId}']`);
                lastChildRow.insertAdjacentElement('afterend', row);
            } else {
                parentRow.insertAdjacentElement('afterend', row);
            }
        } else {
            tableBody.insertAdjacentElement('afterbegin', row);
        }

        row.querySelector('input[name="name"]').focus();
    };

    const saveInlineRow = async (rowElement) => {
        const inputs = rowElement.querySelectorAll('.inline-input');
        const deviceData = {
            parentId: rowElement.dataset.parentId || null,
            type: rowElement.dataset.type
        };

        let isValid = true;
        inputs.forEach(input => {
            if (input.required && !input.value.trim()) {
                isValid = false;
            }
            if (input.type === 'number') {
                deviceData[input.name] = parseFloat(input.value) || 0;
            } else {
                deviceData[input.name] = input.value.trim();
            }
        });

        if (!isValid) {
            showToast('Vui lòng nhập Tên mục.', 'error');
            return;
        }

        // Inherit subject and category if it's a child
        if (deviceData.parentId) {
            const parent = allDevicesCache.find(d => d.id === deviceData.parentId);
            if (parent) {
                deviceData.subject = parent.subject;
                deviceData.category = parent.category;
            }
        }

        try {
            await addDoc(collection(firestore, 'devices'), deviceData);
            showToast('Thêm mới thành công!', 'success');
            loadDevices(); // Reload to show the new static row
        } catch (error) {
            console.error('Lỗi khi lưu thiết bị:', error);
            showToast('Đã có lỗi xảy ra khi lưu.', 'error');
        }
    };

    const cancelInlineRow = (rowElement) => {
        rowElement.remove();
    };

    // --- Edit Modal Functionality ---
    const openEditModal = (deviceData = {}) => {
        // This function will be used for editing existing items via a modal
        // For now, it's a placeholder. The user asked to change the ADD functionality.
        showToast('Chức năng sửa đang được phát triển.', 'info');
    };

    const closeModal = (modal) => {
        modal.style.display = 'none';
    };

    // --- CRUD Operations ---
    const handleDelete = (id) => {
        document.getElementById('confirm-delete-message').textContent = "Bạn có chắc chắn muốn xóa mục này? Nếu đây là danh mục cha, tất cả các mục con cũng sẽ bị xóa.";
        deleteFunction = async () => {
            try {
                // Lấy tất cả thiết bị để tìm cây con cần xóa
                const q = query(collection(firestore, 'devices'));
                const snapshot = await getDocs(q);
                const devicesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                const idsToDelete = getSubtreeIds(devicesData, id);
                const batch = writeBatch(firestore);
                idsToDelete.forEach(deleteId => {
                    const docRef = doc(firestore, 'devices', deleteId);
                    batch.delete(docRef);
                });

                await batch.commit();

                showToast('Đã xóa thành công!', 'success');
                loadDevices();
            } catch (error) {
                console.error("Lỗi khi xóa:", error);
                showToast('Đã có lỗi xảy ra khi xóa.', 'error');
            }
        };
        confirmDeleteModal.style.display = 'flex';
    };

    // Hàm đệ quy để lấy ID của tất cả các mục con
    const getSubtreeIds = (allDevices, parentId) => {
        let ids = [parentId];
        const children = allDevices.filter(d => d.parentId === parentId);
        children.forEach(child => {
            ids = ids.concat(getSubtreeIds(allDevices, child.id));
        });
        return ids;
    };

    // --- Event Listeners ---
    addDeviceBtn.addEventListener('click', () => {
        addInlineRow(null); // Thêm một hàng ở cấp cao nhất
    });

    cancelDeleteBtn.addEventListener('click', () => closeModal(confirmDeleteModal));
    confirmDeleteBtn.addEventListener('click', () => {
        if (typeof deleteFunction === 'function') {
            deleteFunction();
        }
        closeModal(confirmDeleteModal);
    });

    // Đóng modal khi click ra ngoài
    confirmDeleteModal.addEventListener('click', (e) => {
        if (e.target === confirmDeleteModal) closeModal(confirmDeleteModal);
    });

    // Event delegation cho các nút trong bảng
    tableBody.addEventListener('click', async (e) => {
        const target = e.target;
        const row = target.closest('.device-row');
        if (!row) return;

        const id = row.dataset.id;

        if (target.closest('.add-child-btn')) {
            addInlineRow(id);
        }

        if (target.closest('.edit-btn')) {
            const device = allDevicesCache.find(d => d.id === id);
            if (device) openEditModal(device);
        }

        if (target.closest('.delete-btn')) {
            handleDelete(id);
        }

        // Listeners for inline add row
        if (target.closest('.save-inline-btn')) {
            saveInlineRow(row);
        }

        if (target.closest('.cancel-inline-btn')) {
            cancelInlineRow(row);
        }
    });

    // --- Khởi chạy ---
    loadDevices();
});