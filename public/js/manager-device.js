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
    const treeContainer = document.getElementById('device-tree-container');
    const listContainer = document.getElementById('device-list-container');
    const currentFolderTitle = document.getElementById('current-folder-title');
    const addSubjectBtn = document.getElementById('add-subject-btn');
    const addCategoryBtn = document.getElementById('add-category-btn');
    const addDeviceBtn = document.getElementById('add-device-btn');
    const bulkImportBtn = document.getElementById('bulk-import-btn');

    const itemModal = document.getElementById('item-modal');
    if (!itemModal) {
        console.error("Lỗi nghiêm trọng: Không tìm thấy modal #item-modal. Các chức năng thêm/sửa sẽ không hoạt động.");
        // Không return ở đây để các phần khác có thể vẫn chạy, nhưng cảnh báo là cần thiết
    }
    const itemModalTitle = document.getElementById('item-modal-title');
    const itemForm = document.getElementById('item-form');
    const deviceOnlyFields = itemModal.querySelector('.device-only-fields');
    const saveItemBtn = document.getElementById('save-item-btn');
    const cancelItemBtn = document.getElementById('cancel-item-modal');

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
            treeContainer.innerHTML = '<p class="error-message">Lỗi tải dữ liệu.</p>';
        }
    };

    // --- DATA LOADING ---
    const loadAllItems = async () => {
        treeContainer.innerHTML = '<p>Đang tải cây danh mục...</p>';
        listContainer.innerHTML = '<p>Chọn một mục từ cây danh mục để xem chi tiết.</p>';
        try {
            const q = query(collection(firestore, 'devices'), orderBy('order'));
            const snapshot = await getDocs(q);
            allItemsCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            renderTree();
            initTreeSortable(); // Kích hoạt kéo-thả sau khi cây được render
            renderList(null); // Hiển thị nội dung gốc ban đầu
        } catch (error) {
            console.error("Lỗi khi tải dữ liệu:", error);
            treeContainer.innerHTML = '<p class="error-message">Không thể tải dữ liệu.</p>';
        }
    };

    // --- UI RENDERING ---
    const renderTree = () => {
        const buildTreeHtml = (parentId = null) => {
            const children = allItemsCache
                .filter(item => item.parentId === parentId && item.type !== 'device') // Chỉ lấy thư mục/môn học
                .sort((a, b) => (a.order || 0) - (b.order || 0));

            if (children.length === 0) return '';

            let html = '<div class="tree-children">';
            children.forEach(child => {
                const hasChildren = allItemsCache.some(item => item.parentId === child.id && item.type !== 'device');
                const toggleIconClass = hasChildren ? 'fas fa-chevron-down toggle' : 'fas fa-minus';
                const folderIcon = child.type === 'subject' ? 'fas fa-book' : 'fas fa-folder';

                html += `
                    <div class="tree-node" data-id="${child.id}">
                        <i class="fas fa-grip-vertical tree-drag-handle" title="Kéo để sắp xếp"></i>
                        <i class="tree-node-icon ${toggleIconClass}"></i>
                        <i class="tree-node-icon ${folderIcon}" title="${child.type}"></i>
                        <span class="tree-node-name" title="${child.name}">${child.name}</span>
                    </div>
                    ${buildTreeHtml(child.id)}
                `;
            });
            html += '</div>';
            return html;
        };
        treeContainer.innerHTML = buildTreeHtml(null);
    };

    /**
     * Khởi tạo chức năng kéo-thả cho cây thư mục.
     */
    const initTreeSortable = () => {
        const treeContainers = document.querySelectorAll('#device-tree-container .tree-children');
        treeContainers.forEach(container => {
            new Sortable(container, {
                group: 'nested-tree', // Đặt tên group để chỉ cho phép kéo-thả trong cùng cấp
                animation: 150,
                handle: '.tree-drag-handle', // Chỉ định phần tử để kéo
                ghostClass: 'sortable-ghost', // Class cho "bóng ma" khi kéo
                chosenClass: 'sortable-chosen', // Class cho mục đang được chọn
                dragClass: 'sortable-drag', // Class cho mục đang được kéo
                onEnd: async (evt) => {
                    const items = evt.to.children;
                    const batch = writeBatch(firestore);

                    // Lặp qua các mục trong container đã được sắp xếp lại
                    Array.from(items).forEach((itemNode, index) => {
                        const itemId = itemNode.dataset.id;
                        if (itemId) {
                            const itemRef = doc(firestore, 'devices', itemId);
                            // Cập nhật lại trường 'order' theo vị trí mới
                            batch.update(itemRef, { order: index });
                        }
                    });

                    try {
                        await batch.commit();
                        showToast('Đã cập nhật thứ tự danh mục.', 'success');
                        await loadAllItems(); // Tải lại toàn bộ dữ liệu để đảm bảo cache và UI đồng bộ
                    } catch (error) {
                        console.error("Lỗi khi cập nhật thứ tự:", error);
                        showToast('Không thể cập nhật thứ tự.', 'error');
                    }
                }
            });
        });
    };

    const renderList = (parentId) => {
        selectedNodeId = parentId;
        const parentItem = parentId ? allItemsCache.find(item => item.id === parentId) : null;
        currentFolderTitle.textContent = parentItem ? parentItem.name : 'Tất cả danh mục';

        // Kích hoạt/Vô hiệu hóa các nút thêm mới trong phần nội dung bên phải
        // - Nút "Thêm Môn học" (gốc) không bị ảnh hưởng bởi lựa chọn này và luôn hoạt động.
        // - Có thể thêm "Danh mục con" nếu một môn học hoặc danh mục khác được chọn.
        addCategoryBtn.disabled = !parentItem;
        // - Có thể thêm "Thiết bị" nếu một danh mục (không phải môn học) được chọn.
        addDeviceBtn.disabled = !parentItem || parentItem.type === 'subject';
        // - Nút "Nhập hàng loạt" cũng yêu cầu chọn một danh mục cha.
        bulkImportBtn.disabled = !parentItem;

        const children = allItemsCache
            .filter(item => item.parentId === parentId)
            .sort((a, b) => (a.order || 0) - (b.order || 0));

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
                        `<tr><td colspan="12" class="empty-list-message">Thư mục này trống.</td>
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
        selectElement.innerHTML = ''; // Xóa các option cũ
        const buildOptions = (parentId = null, prefix = '') => {
            const children = allItemsCache
                .filter(item => item.parentId === parentId && item.type !== 'device')
                .sort((a, b) => (a.order || 0) - (b.order || 0));

            children.forEach(child => {
                const option = document.createElement('option');
                option.value = child.id;
                option.textContent = `${prefix}${child.name}`;
                option.selected = child.id === currentParentId;
                selectElement.appendChild(option);
                buildOptions(child.id, prefix + '— ');
            });
        };
        buildOptions(null, '');
    };
    const openItemModal = (type, isEditing = false, data = {}) => {
        if (!itemModal) {
            console.error('Lỗi: Không tìm thấy modal với ID "item-modal". Vui lòng kiểm tra HTML.');
            return;
        }
        currentModalType = type;
        currentEditingId = isEditing ? data.id : null;
        itemForm.reset();

        // Xóa các class type cũ và thêm class mới để CSS có thể định dạng icon
        itemModal.classList.remove('modal-type-subject', 'modal-type-category', 'modal-type-device');
        itemModal.classList.add(`modal-type-${type}`);

        const titles = {
            subject: isEditing ? 'Sửa Môn học' : 'Thêm Môn học mới',
            category: isEditing ? 'Sửa Danh mục' : 'Thêm Danh mục mới',
            device: isEditing ? 'Sửa Thiết bị' : 'Thêm Thiết bị mới',
        };
        itemModalTitle.textContent = titles[type];
        
        // Sử dụng class 'hidden' thay vì thay đổi style 'display' trực tiếp
        // để không phá vỡ layout 'display: contents' của grid.
        if (type === 'device') {
            deviceOnlyFields.classList.remove('hidden');
        } else {
            deviceOnlyFields.classList.add('hidden');
        }

        if (isEditing && data) {
            document.getElementById('item-name').value = data.name || '';
            document.getElementById('item-order').value = data.order || '';
            if (type === 'device') {
                buildCategoryTreeForSelect(document.getElementById('item-parent-select'), data.parentId);
                document.getElementById('item-topic').value = data.topic || '';
                document.getElementById('item-purpose').value = data.purpose || '';
                document.getElementById('item-description').value = data.description || '';
                document.getElementById('item-usage-gv').checked = data.usageObject?.includes('GV') || false;
                document.getElementById('item-usage-hs').checked = data.usageObject?.includes('HS') || false;
                document.getElementById('item-unit').value = data.unit || '';
                document.getElementById('item-quota').value = data.quota || '';
                document.getElementById('item-quantity').value = data.quantity || 0;
                document.getElementById('item-broken').value = data.broken || 0;
            }
        } else if (type === 'device') {
            // Khi thêm mới thiết bị, tự động chọn danh mục cha hiện tại
            buildCategoryTreeForSelect(document.getElementById('item-parent-select'), selectedNodeId);
        }

        itemModal.style.display = 'flex';
        document.getElementById('item-name').focus();
    };

    // --- DATA OPERATIONS (CRUD) ---
    const saveItem = async () => {
        setButtonLoading(saveItemBtn, true);
        const name = document.getElementById('item-name').value.trim();
        if (!name) {
            showToast('Vui lòng nhập tên.', 'error');
            return;
        }

        const orderInput = document.getElementById('item-order').value;
        const data = {
            name: name,
            order: orderInput ? parseInt(orderInput) : 0,
            type: currentModalType
        };

        if (currentModalType === 'device') {
            const usageObject = [];
            if (document.getElementById('item-usage-gv').checked) usageObject.push('GV');
            if (document.getElementById('item-usage-hs').checked) usageObject.push('HS');

            data.parentId = document.getElementById('item-parent-select').value;
            data.topic = document.getElementById('item-topic').value.trim();
            data.purpose = document.getElementById('item-purpose').value.trim();
            data.description = document.getElementById('item-description').value.trim();
            data.usageObject = usageObject;
            data.unit = document.getElementById('item-unit').value.trim();
            data.quota = document.getElementById('item-quota').value.trim();
            data.quantity = parseInt(document.getElementById('item-quantity').value) || 0;
            data.broken = parseInt(document.getElementById('item-broken').value) || 0;
        } else {
            data.parentId = currentModalType === 'subject' ? null : selectedNodeId;
        }

        try {
            if (currentEditingId) {
                const itemRef = doc(firestore, 'devices', currentEditingId);
                await updateDoc(itemRef, data);
                showToast('Cập nhật thành công!', 'success');
            } else {
                await addDoc(collection(firestore, 'devices'), data);
                showToast('Thêm mới thành công!', 'success');
            }
            itemModal.style.display = 'none';
            await loadAllItems();
            // Cập nhật lại view sau khi tải lại dữ liệu
            renderList(selectedNodeId);
            document.querySelector(`.tree-node[data-id="${selectedNodeId}"]`)?.classList.add('active');

        } catch (error) {
            console.error("Lỗi khi lưu:", error);
            showToast('Đã có lỗi xảy ra khi lưu.', 'error');
        } finally {
            setButtonLoading(saveItemBtn, false);
        }
    };

    const saveInlineDevice = async (row) => {
        const name = row.querySelector('input[name="name"]').value.trim();
        if (!name) {
            showToast('Vui lòng nhập tên thiết bị.', 'error');
            row.querySelector('input[name="name"]').focus();
            return;
        }

        const usageObject = [];
        if (row.querySelector('input[name="usageGV"]').checked) usageObject.push('GV');
        if (row.querySelector('input[name="usageHS"]').checked) usageObject.push('HS');

        const data = {
            name: name,
            order: parseFloat(row.querySelector('input[name="order"]').value.replace(/,/, '.')) || 0,
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
            showToast('Thêm thiết bị thành công!', 'success');
            // Tải lại toàn bộ dữ liệu và render lại
            await loadAllItems();
            renderList(selectedNodeId);
            document.querySelector(`.tree-node[data-id="${selectedNodeId}"]`)?.classList.add('active');
        } catch (error) {
            console.error("Lỗi khi lưu thiết bị inline:", error);
            showToast('Đã có lỗi xảy ra khi lưu.', 'error');
        }
    };

    const validateAndPreviewBulkImport = async () => {
        if (!selectedNodeId) {
            showToast('Vui lòng chọn một danh mục để nhập thiết bị vào.', 'error');
            return; // Dừng hàm
        }

        const text = bulkImportInput.value.trim();
        if (!text) {
            showToast('Vui lòng dán dữ liệu vào ô nhập.', 'error');
            return;
        }

        const rawLines = text.split('\n');
        if (rawLines.length === 0) {
            showToast('Không có dữ liệu hợp lệ để nhập.', 'info');
            return;
        }

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
                    errors.push(`Dòng ${i + 1}: Không đủ 9 cột, sẽ bị bỏ qua.`);
                    currentRecord = null;
                    continue;
                }
                const [orderStr, topic, name, purpose, description, unit, quota, quantityStr, brokenStr] = columns.map(c => c.trim());
                if (!name) {
                    errors.push(`Dòng ${i + 1}: Tên thiết bị không được để trống, sẽ bị bỏ qua.`);
                    currentRecord = null;
                    continue;
                }
                currentRecord = {
                    parentId: selectedNodeId, type: 'device',
                    order: parseFloat(orderStr.replace(/,/, '.')) || 0,
                    topic: topic, name: name, purpose: purpose, description: description,
                    unit: unit, quantity: parseInt(quantityStr) || 0, broken: parseInt(brokenStr) || 0,
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
    };

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
                <table class="device-table preview"><thead><tr><th>STT</th><th>Tên thiết bị</th><th>Đơn vị</th><th>Định mức</th><th>Tổng số</th><th>Hỏng</th><th>Chủ đề</th></tr></thead>
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
            showToast('Không có dữ liệu hợp lệ để nhập.', 'info');
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
            showToast(`Nhập thành công ${validRecordsToImport.length} thiết bị!`, 'success');
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

                showToast('Đã xóa thành công!', 'success');
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
        addSubjectBtn.addEventListener('click', () => openItemModal('subject'));
        addCategoryBtn.addEventListener('click', () => openItemModal('category'));
        addDeviceBtn.addEventListener('click', addInlineDeviceRow); // <-- THAY ĐỔI Ở ĐÂY
        bulkImportBtn.addEventListener('click', () => {
            if (!selectedNodeId || allItemsCache.find(item => item.id === selectedNodeId)?.type === 'subject') {
                showToast('Vui lòng chọn một danh mục (không phải môn học) để nhập thiết bị.', 'error');
                return;
            }
            bulkImportInput.value = ''; // Xóa dữ liệu cũ
            bulkImportModal.style.display = 'flex';
        });

        // Đóng/Lưu modal
        cancelItemBtn.addEventListener('click', () => itemModal.style.display = 'none');
        saveItemBtn.addEventListener('click', saveItem);

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

        // Event delegation cho cây thư mục bên trái
        treeContainer.addEventListener('click', (e) => {
            const target = e.target;
            const node = target.closest('.tree-node');
            if (!node) return;

            const nodeId = node.dataset.id;

            // Xử lý thu/mở
            if (target.classList.contains('toggle')) {
                node.classList.toggle('collapsed');
                const childrenContainer = node.nextElementSibling;
                if (childrenContainer && childrenContainer.classList.contains('tree-children')) {
                    childrenContainer.classList.toggle('hidden');
                }
                return; // Không chọn node khi chỉ thu/mở
            }

            // Xử lý chọn node
            document.querySelectorAll('.tree-node.active').forEach(n => n.classList.remove('active'));
            node.classList.add('active');
            renderList(nodeId);
        });

        // Event delegation cho bảng bên phải
        listContainer.addEventListener('click', (e) => {
            const row = e.target.closest('tr');
            if (!row) return;

            const id = row.dataset.id;
            const type = row.dataset.type;
            const itemData = allItemsCache.find(item => item.id === id);

            if (e.target.closest('.edit-item-btn')) {
                openItemModal(type, true, itemData);
            }

            if (e.target.closest('.delete-item-btn')) {
                handleDelete(id, type);
            }
        });

        // Event delegation cho các nút trên dòng inline
        listContainer.addEventListener('click', (e) => {
            const addRow = e.target.closest('.inline-add-row');
            if (addRow) {
                if (e.target.closest('.save-inline-btn')) {
                    saveInlineDevice(addRow);
                } else if (e.target.closest('.cancel-inline-btn')) {
                    addRow.remove();
                }
                return; // Dừng lại để không xử lý tiếp
            }
        });
    };

    // --- Khởi chạy ---
    initializePage();
});