import {
    writeBatch,
    collection,
    getDocs,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    query,
    orderBy
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { firestore } from "./firebase-config.js";
import { showToast, setButtonLoading } from "./toast.js";

document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('device-explorer-layout')) {
        console.error("Lỗi nghiêm trọng: Không tìm thấy element #device-explorer-layout. Script manager-device.js sẽ không chạy.");
        return;
    }

    // --- DOM ELEMENTS ---
    const listContainer = document.getElementById('device-list-container');
    const breadcrumbContainer = document.getElementById('breadcrumb-container');
    const addSubjectBtn = document.getElementById('add-subject-btn');
    const addCategoryBtn = document.getElementById('add-category-btn');
    const addDeviceBtn = document.getElementById('add-device-btn');
    const bulkImportBtn = document.getElementById('bulk-import-btn');

    // Category Modal Elements
    const categoryModal = document.getElementById('category-modal');
    const categoryModalTitle = document.getElementById('category-modal-title');
    const categoryForm = document.getElementById('category-form');
    const saveCategoryBtn = document.getElementById('save-category-btn');
    const cancelCategoryBtn = document.getElementById('cancel-category-modal');

    // Device Modal Elements
    const deviceModal = document.getElementById('device-modal');
    const deviceModalTitle = document.getElementById('device-modal-title');
    const deviceForm = document.getElementById('device-form');
    const saveDeviceBtn = document.getElementById('save-device-btn');
    const cancelDeviceBtn = document.getElementById('cancel-device-modal');

    const confirmDeleteModal = document.getElementById('confirm-delete-modal');
    const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');

    // Bulk Import Modal Elements
    const bulkImportModal = document.getElementById('bulk-import-modal');
    const bulkImportInput = document.getElementById('bulk-import-input');
    const saveBulkImportBtn = document.getElementById('save-bulk-import-btn');
    const cancelBulkImportBtn = document.getElementById('cancel-bulk-import-modal');

    // Bulk Import Preview Modal Elements
    const bulkImportPreviewModal = document.getElementById('bulk-import-preview-modal');
    const backToBulkInputBtn = document.getElementById('back-to-bulk-input-btn');
    const confirmBulkImportBtn = document.getElementById('confirm-bulk-import-btn');
    const errorSection = document.getElementById('bulk-import-error-section');
    const previewContainer = document.getElementById('bulk-import-preview-container');

    // --- STATE ---
    let allItemsCache = [];
    let selectedNodeId = null;
    let currentEditingId = null;
    let currentModalType = 'category'; // 'subject', 'category', 'device'
    let deleteFunction = null;
    let validRecordsToImport = []; // Lưu các bản ghi hợp lệ để chờ xác nhận

    // --- INITIALIZATION ---
    const initializePage = async () => {
        try {
            await loadAllItems();
            setupEventListeners();
        } catch (error) {
            console.error("Lỗi khởi tạo trang:", error);
            listContainer.innerHTML = '<p class="error-message">Lỗi tải dữ liệu.</p>';
        }
    };

    // --- DATA LOADING ---
    const loadAllItems = async () => {
        listContainer.innerHTML = '<p>Đang tải danh sách thiết bị...</p>';
        try {
            const q = query(collection(firestore, 'devices'), orderBy('order'));
            const snapshot = await getDocs(q);
            allItemsCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            renderList(null); // Hiển thị nội dung gốc ban đầu
        } catch (error) {
            console.error("Lỗi khi tải dữ liệu:", error);
            listContainer.innerHTML = '<p class="error-message">Không thể tải dữ liệu từ cơ sở dữ liệu.</p>';
        }
    };

    // --- UI RENDERING ---
    const renderBreadcrumbs = (parentId) => {
        const path = [];
        let currentId = parentId;
        while (currentId) {
            const item = allItemsCache.find(i => i.id === currentId);
            if (item) {
                path.unshift({ id: item.id, name: item.name });
                currentId = item.parentId;
            } else {
                break;
            }
        }

        let html = '<a href="#" class="breadcrumb-item" data-id="null"><i class="fas fa-home"></i>Trang chủ</a>';
        path.forEach(item => {
            html += ` / <a href="#" class="breadcrumb-item" data-id="${item.id}">${item.name}</a>`;
        });

        breadcrumbContainer.innerHTML = html;
    };

    const renderList = (parentId) => {
        selectedNodeId = parentId;
        const parentItem = parentId ? allItemsCache.find(item => item.id === parentId) : null;
        renderBreadcrumbs(parentId);

        // Nút "Thêm danh mục" luôn hoạt động.
        addCategoryBtn.disabled = false;
        // Chỉ cho phép thêm thiết bị hoặc nhập hàng loạt khi đang ở trong một danh mục (không phải ở gốc).
        addDeviceBtn.disabled = !parentItem;
        bulkImportBtn.disabled = !parentItem;

        const children = allItemsCache
            .filter(item => item.parentId === parentId)
            .sort((a, b) => String(a.order || '').localeCompare(String(b.order || ''), undefined, { numeric: true, sensitivity: 'base' }));

        const tableHTML = `
            <table class="device-table">
                <thead>
                    <tr>
                        <th class="col-stt" rowspan="2">Số TT</th>
                        <th class="col-topic" rowspan="2">Chủ đề dạy học</th>
                        <th class="col-name" rowspan="2">Tên thiết bị</th>
                        <th class="col-purpose" rowspan="2">Mục đích sử dụng</th>
                        <th class="col-description" rowspan="2">Mô tả chi tiết</th>
                        <th class="col-usage-object" colspan="2">Đối tượng SD</th>
                        <th class="col-unit" rowspan="2">Đơn vị</th>
                        <th class="col-quota" rowspan="2">Định mức</th>
                        <th class="col-quantity" rowspan="2">Tổng số</th>
                        <th class="col-broken" rowspan="2">Hỏng</th>
                        <th class="col-actions" rowspan="2">Hành động</th>
                    </tr>
                    <tr>
                        <th class="col-usage-gv">GV</th>
                        <th class="col-usage-hs">HS</th>
                    </tr>
                </thead>
                <tbody>
                    ${children.length > 0 ? 
                        children.map(item => {
                            const isDevice = item.type === 'device';
                            const icon = isDevice ? 'fa-desktop' : 'fa-folder';
                            const usageObject = item.usageObject || [];
                            const usageGV = usageObject.includes('GV');
                            const usageHS = usageObject.includes('HS');
                            return `
                                <tr data-id="${item.id}" data-type="${item.type}">
                                    <td class="col-stt">${item.order || ''}</td>
                                    <td class="col-topic">${isDevice ? (item.topic || '') : ''}</td>
                                    <td class="col-name">
                                        <div class="item-name-cell">
                                            <i class="fas ${icon}"></i>
                                            <span>${item.name}</span>
                                        </div>
                                    </td>
                                    <td class="col-purpose">${isDevice ? (item.purpose || '') : ''}</td>
                                    <td class="col-description">${isDevice ? (item.description || '') : ''}</td>
                                    <td class="col-usage-gv">${isDevice ? `<input type="checkbox" ${usageGV ? 'checked' : ''} disabled>` : ''}</td>
                                    <td class="col-usage-hs">${isDevice ? `<input type="checkbox" ${usageHS ? 'checked' : ''} disabled>` : ''}</td>
                                    <td class="col-unit">${isDevice ? (item.unit || '') : ''}</td>
                                    <td class="col-quota">${isDevice ? (item.quota || '') : ''}</td>
                                    <td class="col-quantity">${isDevice ? (item.quantity || 0) : ''}</td>
                                    <td class="col-broken">${isDevice ? (item.broken || 0) : ''}</td>
                                    <td class="col-actions">
                                        <div class="item-actions">
                                            <button class="icon-button edit-item-btn" title="Sửa"><i class="fas fa-pencil-alt"></i></button>
                                            <button class="icon-button delete-item-btn" title="Xóa"><i class="fas fa-trash-alt"></i></button>
                                        </div>
                                    </td>
                                </tr>
                            `;
                        }).join('') :
                        `<tr><td colspan="12" class="empty-list-message">Danh mục này trống.</td>
                         </tr>`
                    }
                </tbody>
            </table>
        `;
        listContainer.innerHTML = tableHTML;
    };

    const addInlineDeviceRow = () => {
        // Kiểm tra xem đã có dòng inline nào chưa để tránh tạo nhiều dòng
        if (document.querySelector('.inline-add-row')) {
            document.querySelector('.inline-add-row input[type="text"]').focus();
            return;
        }

        const table = listContainer.querySelector('.device-table tbody');
        if (!table) {
            showToast('Không có bảng để thêm thiết bị. Hãy tạo danh mục trước.', 'error');
            return;
        }

        const newRow = document.createElement('tr');
        newRow.className = 'inline-add-row';
        newRow.innerHTML = `
            <td class="col-stt"><input type="text" name="order" placeholder="Số TT" inputmode="decimal"></td>
            <td class="col-topic"><input type="text" name="topic" placeholder="Chủ đề"></td>
            <td class="col-name">
                <div class="item-name-cell">
                    <i class="fas fa-desktop"></i>
                    <input type="text" name="name" placeholder="Tên thiết bị (bắt buộc)" required>
                </div>
            </td>
            <td class="col-purpose"><input type="text" name="purpose" placeholder="Mục đích"></td>
            <td class="col-description"><textarea name="description" rows="1" placeholder="Mô tả"></textarea></td>
            <td class="col-usage-gv"><input type="checkbox" name="usageGV" checked></td>
            <td class="col-usage-hs"><input type="checkbox" name="usageHS"></td>
            <td class="col-unit"><input type="text" name="unit" placeholder="Đơn vị"></td>
            <td class="col-quota"><input type="text" name="quota" placeholder="Định mức"></td>
            <td class="col-quantity"><input type="text" name="quantity" value="0"></td>
            <td class="col-broken"><input type="text" name="broken" value="0"></td>
            <td class="col-actions">
                <div class="item-actions">
                    <button class="icon-button save-inline-btn" title="Lưu"><i class="fas fa-check"></i></button>
                    <button class="icon-button cancel-inline-btn" title="Hủy"><i class="fas fa-times"></i></button>
                </div>
            </td>
        `;

        // Chèn vào đầu bảng
        table.prepend(newRow);

        // Focus vào ô nhập tên
        newRow.querySelector('input[name="name"]').focus();
    };

    const cancelAllInlineActions = () => {
        document.querySelector('.inline-add-row')?.remove();
        const editingRow = document.querySelector('.inline-edit-row');
        if (editingRow && editingRow.dataset.originalHtml) {
            editingRow.innerHTML = editingRow.dataset.originalHtml;
            editingRow.classList.remove('inline-edit-row');
            delete editingRow.dataset.originalHtml;
        }
    };

    // --- MODAL HANDLING ---
    const buildCategoryTreeForSelect = (selectElement, currentParentId) => {
        selectElement.innerHTML = '<option value="">-- Chọn danh mục gốc --</option>'; // Thêm option gốc
        const buildOptions = (parentId = null, prefix = '') => {
            const children = allItemsCache
                .filter(item => item.parentId === parentId && item.type !== 'device')
                .sort((a, b) => String(a.order || '').localeCompare(String(b.order || ''), undefined, { numeric: true, sensitivity: 'base' }));

            children.forEach(child => {
                const option = document.createElement('option');
                option.value = child.id;
                option.textContent = `${prefix}${child.name}`;
                // Không tự động chọn nữa, để người dùng tự chọn
                selectElement.appendChild(option);
                buildOptions(child.id, prefix + '— ');
            });
        };
        buildOptions(null, '');
    };
    const openItemModal = (type, isEditing = false, data = {}) => {
        if (type === 'device') {
            openDeviceModal(isEditing, data);
        } else if (type === 'category') {
            openCategoryModal(isEditing, data);
        }
    };

    const openCategoryModal = (isEditing = false, data = {}) => {
        currentEditingId = isEditing ? data.id : null;
        categoryForm.reset();
        categoryModalTitle.textContent = isEditing ? 'Sửa Danh mục' : 'Thêm Danh mục';

        const parentSelectGroup = document.getElementById('category-parent-select-group');
        const parentSelect = document.getElementById('category-parent-select');

        if (isEditing) {
            document.getElementById('category-name').value = data.name || '';
            document.getElementById('category-order').value = data.order !== undefined ? data.order : '';
            buildCategoryTreeForSelect(parentSelect, data.parentId);
            parentSelect.value = data.parentId || '';
            parentSelectGroup.style.display = 'block';
        } else {
            // Khi thêm mới, vị trí là danh mục hiện tại, nên không cần hiển thị selector
            parentSelectGroup.style.display = 'none';
        }

        categoryModal.style.display = 'flex';
        document.getElementById('category-name').focus();
    };

    const openDeviceModal = (isEditing = false, data = {}) => {
        currentEditingId = isEditing ? data.id : null;
        deviceForm.reset();
        deviceModalTitle.textContent = isEditing ? 'Sửa Thiết bị' : 'Thêm Thiết bị';

        const parentSelect = document.getElementById('device-parent-select');

        if (isEditing) {
            document.getElementById('device-name').value = data.name || '';
            document.getElementById('device-order').value = data.order !== undefined ? data.order : '';
            buildCategoryTreeForSelect(parentSelect, data.parentId);
            parentSelect.value = data.parentId || '';
            document.getElementById('device-topic').value = data.topic || '';
            document.getElementById('device-purpose').value = data.purpose || '';
            document.getElementById('device-description').value = data.description || '';
            document.getElementById('device-usage-gv').checked = data.usageObject?.includes('GV') || false;
            document.getElementById('device-usage-hs').checked = data.usageObject?.includes('HS') || false;
            document.getElementById('device-unit').value = data.unit || '';
            document.getElementById('device-quota').value = data.quota || '';
            document.getElementById('device-quantity').value = data.quantity || 0;
            document.getElementById('device-broken').value = data.broken || 0;
        } else {
            // Khi thêm mới, tự động chọn danh mục cha là danh mục đang xem
            buildCategoryTreeForSelect(parentSelect, selectedNodeId);
            parentSelect.value = selectedNodeId || '';
        }

        deviceModal.style.display = 'flex';
        document.getElementById('device-name').focus();
    };

    // --- DATA OPERATIONS (CRUD) ---
    const saveCategory = async () => {
        setButtonLoading(saveCategoryBtn, true);
        const name = document.getElementById('category-name').value.trim();
        if (!name) {
            showToast('Vui lòng nhập tên danh mục.', 'error', 3000);
            setButtonLoading(saveCategoryBtn, false);
            return;
        }

        let parentId;
        if (currentEditingId) { // Nếu đang sửa
            parentId = document.getElementById('category-parent-select').value || null;
        } else { // Nếu thêm mới
            parentId = selectedNodeId; // parentId là mục đang xem
        }

        const data = {
            name: name,
            order: document.getElementById('category-order').value.trim(),
            type: 'category',
            parentId: parentId
        };

        try {
            if (currentEditingId) {
                const itemRef = doc(firestore, 'devices', currentEditingId);
                await updateDoc(itemRef, data);
                showToast('Cập nhật danh mục thành công!', 'success', 3000);
            } else {
                await addDoc(collection(firestore, 'devices'), data);
                showToast('Thêm danh mục mới thành công!', 'success', 3000);
            }
            categoryModal.style.display = 'none';
            await loadAllItems();
            renderList(selectedNodeId); // Luôn render lại danh mục đang xem
        } catch (error) {
            console.error("Lỗi khi lưu danh mục:", error);
            showToast('Đã có lỗi xảy ra khi lưu danh mục.', 'error');
        } finally {
            setButtonLoading(saveCategoryBtn, false);
        }
    };

    const saveDevice = async () => {
        setButtonLoading(saveDeviceBtn, true);
        const name = document.getElementById('device-name').value.trim();
        if (!name) {
            showToast('Vui lòng nhập tên thiết bị.', 'error', 3000);
            setButtonLoading(saveDeviceBtn, false);
            return;
        }

        const usageObject = [];
        if (document.getElementById('device-usage-gv').checked) usageObject.push('GV');
        if (document.getElementById('device-usage-hs').checked) usageObject.push('HS');

        const data = {
            name: name,
            order: document.getElementById('device-order').value.trim(),
            type: 'device',
            parentId: currentEditingId ? document.getElementById('device-parent-select').value : selectedNodeId,
            topic: document.getElementById('device-topic').value.trim(),
            purpose: document.getElementById('device-purpose').value.trim(),
            description: document.getElementById('device-description').value.trim(),
            usageObject: usageObject,
            unit: document.getElementById('device-unit').value.trim(),
            quota: document.getElementById('device-quota').value.trim(),
            quantity: parseInt(document.getElementById('device-quantity').value) || 0,
            broken: parseInt(document.getElementById('device-broken').value) || 0,
        };

        try {
            if (currentEditingId) {
                const itemRef = doc(firestore, 'devices', currentEditingId);
                await updateDoc(itemRef, data);
                showToast('Cập nhật thiết bị thành công!', 'success', 3000);
            } else {
                await addDoc(collection(firestore, 'devices'), data);
                showToast('Thêm thiết bị mới thành công!', 'success', 3000);
            }
            deviceModal.style.display = 'none';
            await loadAllItems();
            renderList(selectedNodeId); // Luôn render lại danh mục đang xem
        } catch (error) {
            console.error("Lỗi khi lưu thiết bị:", error);
            showToast('Đã có lỗi xảy ra khi lưu thiết bị.', 'error');
        } finally {
            setButtonLoading(saveDeviceBtn, false);
        }
    };

    const saveItem = async () => {
        // This function is now deprecated and replaced by saveCategory/saveDevice
        // It's kept here to avoid breaking old references if any, but should be removed in the future.
        console.warn('saveItem is deprecated. Use saveCategory or saveDevice instead.');
    };

    const saveInlineDevice = async (row) => {
        const name = row.querySelector('input[name="name"]').value.trim();
        if (!name) {
            showToast('Vui lòng nhập tên thiết bị.', 'error', 3000);
            row.querySelector('input[name="name"]').focus();
            return;
        }

        const usageObject = [];
        if (row.querySelector('input[name="usageGV"]').checked) usageObject.push('GV');
        if (row.querySelector('input[name="usageHS"]').checked) usageObject.push('HS');

        const data = {
            name: name,
            order: row.querySelector('input[name="order"]').value.trim(), // Store order as string
            topic: row.querySelector('input[name="topic"]').value.trim(),
            purpose: row.querySelector('input[name="purpose"]').value.trim(),
            description: row.querySelector('textarea[name="description"]').value.trim(),
            usageObject: usageObject,
            unit: row.querySelector('input[name="unit"]').value.trim(),
            quota: row.querySelector('input[name="quota"]').value.trim(),
            quantity: parseInt(row.querySelector('input[name="quantity"]').value) || 0,
            broken: parseInt(row.querySelector('input[name="broken"]').value) || 0,
            type: 'device',
            parentId: selectedNodeId,
        };

        try {
            await addDoc(collection(firestore, 'devices'), data);
            showToast('Thêm thiết bị thành công!', 'success', 3000);
            // Tải lại toàn bộ dữ liệu và render lại
            await loadAllItems();
            renderList(selectedNodeId);
        } catch (error) {
            console.error("Lỗi khi lưu thiết bị inline:", error);
            showToast('Đã có lỗi xảy ra khi lưu.', 'error');
        }
    };

    const validateAndPreviewBulkImport = async () => {
        if (!selectedNodeId) {
            showToast('Vui lòng chọn một danh mục để nhập thiết bị vào.', 'error');
            return;
        }

        const text = bulkImportInput.value.trim();
        if (!text) {
            showToast('Vui lòng dán dữ liệu vào ô nhập.', 'error', 3000);
            return;
        }

        const rawLines = text.split('\n');
        if (rawLines.length === 0) {
            showToast('Không có dữ liệu hợp lệ để nhập.', 'info');
            return;
        } // Log the actual error

        const saveBtn = document.getElementById('confirm-bulk-import-btn');
        setButtonLoading(saveBtn, true);
        validRecordsToImport = []; // Reset mảng
        const previewRecords = [];
        const errors = [];
        let currentRecord = null;

        for (let i = 0; i < rawLines.length; i++) {
            const line = rawLines[i];
            const isNewRecord = /^\d+(\.\d+)?[\.\)]?\s*\t/.test(line);

            if (isNewRecord) {
                if (currentRecord) {
                    previewRecords.push({ ...currentRecord, isValid: true });
                    validRecordsToImport.push(currentRecord);
                }

                const columns = line.split('\t');
                if (columns.length < 9) {
                    errors.push(`Dòng ${i + 1}: Không đủ 9 cột, sẽ bị bỏ qua.`); // Error message for insufficient columns
                    currentRecord = null;
                    continue;
                }
                const [orderStr, topic, name, purpose, description, unit, quota, quantityStr, brokenStr] = columns.map(c => c.trim());
                if (!name) {
                    errors.push(`Dòng ${i + 1}: Tên thiết bị không được để trống, sẽ bị bỏ qua.`); // Error message for empty device name
                    currentRecord = null;
                    continue;
                }
                currentRecord = {
                    parentId: selectedNodeId, type: 'device',
                    order: orderStr, // Store order as a string
                    topic: topic, name: name, purpose: purpose, description: description,
                    unit: unit, quantity: parseInt(quantityStr) || 0, broken: parseInt(brokenStr) || 0, // Quantity and broken remain numbers
                    quota: quota, };
            } else if (currentRecord) {
                currentRecord.description += '\n' + line;
            }
        }

        if (currentRecord) {
            previewRecords.push({ ...currentRecord, isValid: true });
            validRecordsToImport.push(currentRecord);
        }

        // Hiển thị modal xem trước
        renderPreviewModal(previewRecords, errors);
    }; // Log the actual error

    const renderPreviewModal = (records, errors) => {
        // Hiển thị lỗi nếu có
        if (errors.length > 0) {
            errorSection.innerHTML = `<h4><i class="fas fa-exclamation-triangle"></i> Cảnh báo:</h4><ul>${errors.map(e => `<li>${e}</li>`).join('')}</ul>`;
            errorSection.style.display = 'block';
        } else {
            errorSection.style.display = 'none';
        }

        // Hiển thị bảng xem trước
        if (validRecordsToImport.length > 0) {
            const tableHTML = `
                <table class="device-table preview"><thead><tr><th>STT</th><th>Tên thiết bị</th><th>Đơn vị</th><th>Định mức</th><th>Tổng số</th><th>Hỏng</th><th>Chủ đề</th></tr></thead> // Table headers for preview
                    <tbody>
                        ${validRecordsToImport.map(r => `
                            <tr>
                                <td>${r.order}</td>
                                <td>${r.name}</td>
                                <td>${r.unit}</td>
                                <td>${r.quantity}</td>
                                <td>${r.quota}</td>
                                <td>${r.broken}</td>
                                <td>${r.topic}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>`;
            previewContainer.innerHTML = tableHTML;
            confirmBulkImportBtn.style.display = 'inline-block';
        } else {
            previewContainer.innerHTML = '<p>Không có dữ liệu hợp lệ nào để nhập.</p>';
            confirmBulkImportBtn.style.display = 'none';
        }

        bulkImportModal.style.display = 'none';
        bulkImportPreviewModal.style.display = 'flex';
    };

    const commitBulkImport = async () => {
        if (validRecordsToImport.length === 0) {
            showToast('Không có dữ liệu hợp lệ để nhập.', 'info', 3000);
            return;
        }

        setButtonLoading(confirmBulkImportBtn, true);

        try {
            const batch = writeBatch(firestore);
            validRecordsToImport.forEach(record => {
                const newDeviceRef = doc(collection(firestore, 'devices'));
                batch.set(newDeviceRef, record);
            });
            await batch.commit();
            showToast(`Nhập thành công ${validRecordsToImport.length} thiết bị!`, 'success', 3000);
            bulkImportPreviewModal.style.display = 'none';
            await loadAllItems();
            renderList(selectedNodeId);
        } catch (error) {
            console.error("Lỗi khi xác nhận nhập hàng loạt:", error);
            showToast('Đã có lỗi xảy ra khi lưu dữ liệu.', 'error');
        } finally {
            setButtonLoading(confirmBulkImportBtn, false);
        }
    };


    const handleDelete = (id, type) => {
        // Hàm này chỉ chuẩn bị cho việc xóa, việc xóa thực sự nằm trong `deleteFunction`
        document.getElementById('confirm-delete-message').textContent = "Bạn có chắc chắn muốn xóa mục này? Nếu đây là danh mục cha, tất cả các mục con cũng sẽ bị xóa.";
        deleteFunction = async () => {
            try {
                // Lấy tất cả thiết bị để tìm cây con cần xóa
                const q = query(collection(firestore, 'devices'));
                const snapshot = await getDocs(q);
                const allItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                const idsToDelete = getSubtreeIds(allItems, id);
                const batch = writeBatch(firestore);
                idsToDelete.forEach(deleteId => {
                    const docRef = doc(firestore, 'devices', deleteId);
                    batch.delete(docRef);
                });

                await batch.commit();

                showToast('Đã xóa thành công!', 'success', 3000);
                await loadAllItems();
                renderList(selectedNodeId); // Cập nhật lại list sau khi xóa
            } catch (error) {
                console.error("Lỗi khi xóa:", error);
                showToast('Đã có lỗi xảy ra khi xóa.', 'error');
            }
        };
        confirmDeleteModal.style.display = 'flex';
    };

    // Hàm đệ quy để lấy ID của tất cả các mục con trong cây
    const getSubtreeIds = (allItems, parentId) => {
        let ids = [parentId];
        const children = allItems.filter(d => d.parentId === parentId);
        children.forEach(child => {
            ids = ids.concat(getSubtreeIds(allItems, child.id));
        });
        return ids;
    };

    // --- EVENT LISTENERS ---
    const setupEventListeners = () => {
        // Mở modal
        addCategoryBtn.addEventListener('click', () => openCategoryModal(false));
        addDeviceBtn.addEventListener('click', addInlineDeviceRow); // <-- THAY ĐỔI Ở ĐÂY
        bulkImportBtn.addEventListener('click', () => { // Event listener for bulk import button
            if (!selectedNodeId) {
                showToast('Vui lòng chọn một danh mục để nhập thiết bị.', 'error');
                return;
            }
            bulkImportInput.value = ''; // Xóa dữ liệu cũ
            bulkImportModal.style.display = 'flex';
        });

        // Đóng/Lưu modal Danh mục
        cancelCategoryBtn.addEventListener('click', () => categoryModal.style.display = 'none');
        saveCategoryBtn.addEventListener('click', saveCategory);

        // Đóng/Lưu modal Thiết bị
        cancelDeviceBtn.addEventListener('click', () => deviceModal.style.display = 'none');
        saveDeviceBtn.addEventListener('click', saveDevice);

        // Modal xác nhận xóa
        cancelDeleteBtn.addEventListener('click', () => confirmDeleteModal.style.display = 'none');
        confirmDeleteBtn.addEventListener('click', () => {
            if (typeof deleteFunction === 'function') deleteFunction();
            confirmDeleteModal.style.display = 'none';
        });

        // Modal nhập hàng loạt
        cancelBulkImportBtn.addEventListener('click', () => bulkImportModal.style.display = 'none');
        saveBulkImportBtn.addEventListener('click', validateAndPreviewBulkImport);

        // Modal xem trước nhập hàng loạt
        backToBulkInputBtn.addEventListener('click', () => {
            bulkImportPreviewModal.style.display = 'none';
            bulkImportModal.style.display = 'flex';
        });
        confirmBulkImportBtn.addEventListener('click', commitBulkImport);

        // Cho phép nhấn phím Tab trong textarea nhập hàng loạt
        bulkImportInput.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault(); // Ngăn không cho chuyển focus

                // Lấy vị trí con trỏ
                const start = e.target.selectionStart;
                const end = e.target.selectionEnd;

                // Chèn ký tự Tab vào vị trí con trỏ
                e.target.value = e.target.value.substring(0, start) + '\t' + e.target.value.substring(end);

                // Di chuyển con trỏ đến sau ký tự Tab vừa chèn
                e.target.selectionStart = e.target.selectionEnd = start + 1;
            }
        });

        // Event delegation cho breadcrumbs
        breadcrumbContainer.addEventListener('click', (e) => {
            const target = e.target;
            const breadcrumbItem = target.closest('.breadcrumb-item');
            if (!breadcrumbItem) return;
            const nodeId = breadcrumbItem.dataset.id === 'null' ? null : breadcrumbItem.dataset.id;
            renderList(nodeId);
        });

        // Event delegation cho bảng bên phải
        listContainer.addEventListener('click', (e) => { // Gộp 2 event listener thành 1
            const target = e.target;
            const row = target.closest('tr');
            if (!row) return; // Click không nằm trong hàng nào, bỏ qua

            // --- Xử lý cho dòng thêm mới inline ---
            if (row.classList.contains('inline-add-row')) {
                if (target.closest('.save-inline-btn')) {
                    saveInlineDevice(row);
                } else if (target.closest('.cancel-inline-btn')) {
                    row.remove();
                }
                return; // Dừng lại để không xử lý tiếp
            }

            // --- Xử lý cho các hàng dữ liệu thông thường ---
            const id = row.dataset.id;
            const type = row.dataset.type;
            const itemData = allItemsCache.find(item => item.id === id);

            // Ưu tiên xử lý các nút hành động trước
            if (target.closest('.edit-item-btn')) {
                openItemModal(type, true, itemData);
            } else if (target.closest('.delete-item-btn')) {
                handleDelete(id, type);
            } else if (type === 'category' && target.closest('.col-name')) {
                // Nếu click vào ô tên của một danh mục (và không phải các nút trên), đi vào trong
                renderList(id);
            }
        });
    };

    // --- Khởi chạy ---
    initializePage();
});