import {
    writeBatch,
    serverTimestamp,
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
    const cancelBulkImportBtn = document.getElementById('cancel-bulk-import-btn');
    const processBulkImportBtn = document.getElementById('process-bulk-import-btn');
    const bulkImportPreviewModal = document.getElementById('bulk-import-preview-modal');
    const cancelBulkImportPreviewBtn = document.getElementById('cancel-bulk-import-preview-btn');
    const confirmBulkImportBtn = document.getElementById('confirm-bulk-import-btn');


    // --- STATE ---
    let allItemsCache = [];
    let selectedNodeId = null;
    let currentEditingId = null;
    let currentModalType = 'category'; // 'subject', 'category', 'device'
    let deleteFunction = null;
    let activeTopLevelCategoryId = null; // NEW: Track the top-level category being viewed
    let expandedCategories = new Set(); // Theo dõi các danh mục đang mở
    let validRegistrationsToCreate = []; // Dùng cho nhập hàng loạt

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
                // Lấy thêm cả 'order' để hiển thị
                path.unshift({ id: item.id, name: item.name, order: item.order });
                currentId = item.parentId;
            } else {
                break;
            }
        }

        let html = '<a href="#" class="breadcrumb-item" data-id="null"><i class="fas fa-home"></i> Trang chủ</a>';
        path.forEach(item => {
            // Nếu có STT, hiển thị dạng "STT. Tên". Nếu không, chỉ hiển thị tên.
            const displayName = (item.order) ? `${item.order}. ${item.name}` : item.name;
            html += ` / <a href="#" class="breadcrumb-item" data-id="${item.id}">${displayName}</a>`;
        });

        breadcrumbContainer.innerHTML = html;
    };

    // --- NEW: Recursive function to render the entire tree ---
    const renderTreeRows = (parentId, depth) => {
        let children = allItemsCache
            .filter(item => item.parentId === parentId)
            .sort((a, b) => String(a.order || '').localeCompare(String(b.order || ''), undefined, { numeric: true, sensitivity: 'base' }));

        // Tách danh mục đang được chọn (selectedNodeId) ra và đẩy xuống cuối
        // SỬA LỖI: Sử dụng activeTopLevelCategoryId thay vì selectedNodeId
        if (activeTopLevelCategoryId && depth === 0) {
            const selectedItemInfo = allItemsCache.find(item => item.id === activeTopLevelCategoryId);
            if (selectedItemInfo && selectedItemInfo.parentId === null) { // Double-check it's a top-level item
                const selectedItemIndex = children.findIndex(item => item.id === activeTopLevelCategoryId);
                if (selectedItemIndex > -1) {
                    const [selectedItem] = children.splice(selectedItemIndex, 1);
                    children.push(selectedItem);
                }
            }
        }

        let html = '';
        const indent = depth * 25; // 25px per level

        children.forEach(item => {
            if (item.type === 'device') {
                const usageObject = item.usageObject || [];
                const usageGV = usageObject.includes('GV');
                const usageHS = usageObject.includes('HS');
                html += `
                    <tr data-id="${item.id}" data-type="device" data-parent-id="${parentId || 'root'}" style="padding-left: ${indent}px;">
                        <td class="col-stt">${item.order || ''}</td>
                        <td class="col-topic">${item.topic || ''}</td>
                        <td class="col-name">
                            <div class="item-name-cell">
                                <i class="fas fa-desktop"></i><span>${item.name}</span>
                            </div>
                        </td>
                        <td class="col-purpose">${item.purpose || ''}</td>
                        <td class="col-description">${item.description || ''}</td>
                        <td class="col-usage-gv"><input type="checkbox" ${usageGV ? 'checked' : ''} disabled></td>
                        <td class="col-usage-hs"><input type="checkbox" ${usageHS ? 'checked' : ''} disabled></td>
                        <td class="col-unit">${item.unit || ''}</td>
                        <td class="col-quota">${item.quota || ''}</td>
                        <td class="col-quantity">${item.quantity || 0}</td>
                        <td class="col-broken">${item.broken || 0}</td>
                        <td class="col-actions">
                            <div class="item-actions">
                                <button class="icon-button edit-item-btn" title="Sửa"><i class="fas fa-pencil-alt"></i></button>
                                <button class="icon-button delete-item-btn" title="Xóa"><i class="fas fa-trash-alt"></i></button>
                            </div>
                        </td>
                    </tr>
                `;
            } else { // Category
                const isExpanded = expandedCategories.has(item.id);
                const iconClass = isExpanded ? 'fa-folder-open' : 'fa-folder';
                html += `
                    <tr data-id="${item.id}" data-type="category" data-parent-id="${parentId || 'root'}" class="category-row">
                        <td class="col-stt">${item.order || ''}</td>
                        <td colspan="10" class="col-name">
                            <div class="item-name-cell" style="padding-left: ${indent}px;">
                                <i class="fas ${iconClass}"></i>
                                <span class="item-link" data-id="${item.id}" data-type="category">${item.name}</span>
                            </div>
                        </td>
                        <td class="col-actions">
                            <div class="item-actions">
                                <button class="icon-button edit-item-btn" title="Sửa"><i class="fas fa-pencil-alt"></i></button>
                                <button class="icon-button delete-item-btn" title="Xóa"><i class="fas fa-trash-alt"></i></button>
                            </div>
                        </td>
                    </tr>
                `;
                // Đệ quy để render các mục con nếu danh mục này đang được mở rộng
                if (isExpanded) {
                    html += renderTreeRows(item.id, depth + 1);
                }
            }
        });

        // --- NEW: Thêm nút "Thêm thiết bị" vào cuối danh sách con của danh mục đang được chọn ---
        // Chỉ hiển thị nút này khi đang xem một danh mục cụ thể (selectedNodeId không phải là null)
        // và parentId của lần render đệ quy này khớp với danh mục đang được chọn.
        if (parentId === selectedNodeId && parentId !== null) {
            // Kiểm tra xem có dòng inline nào đang hoạt động không. Nếu có, không hiển thị nút.
            const isAddingInline = document.querySelector('.inline-add-row');
            if (!isAddingInline) {
                html += `
                    <tr class="add-item-row" data-parent-id="${parentId}">
                        <td colspan="12">
                            <button class="btn-add-in-list add-single-device-btn"><i class="fas fa-plus"></i> Thêm thiết bị mới</button>
                            <button class="btn-add-in-list bulk-import-in-list-btn"><i class="fas fa-file-import"></i> Nhập hàng loạt</button>
                        </td>
                    </tr>`;
            }
        }
        return html;
    };

    const renderList = (parentId) => {
        selectedNodeId = parentId;
        const parentItem = parentId ? allItemsCache.find(item => item.id === parentId) : null;

        // --- NEW: Logic to determine and set the active top-level category ---
        if (parentId === null) {
            activeTopLevelCategoryId = null;
        } else {
            let current = parentItem;
            let topLevelParent = current;
            // Traverse up the tree until we find the root parent
            while (current && current.parentId !== null) {
                const parent = allItemsCache.find(item => item.id === current.parentId);
                if (parent) topLevelParent = parent;
                current = parent;
            }
            activeTopLevelCategoryId = topLevelParent ? topLevelParent.id : null;
        }

        renderBreadcrumbs(parentId);

        // Nút "Thêm danh mục" luôn hoạt động.
        addCategoryBtn.disabled = false;
        // Chỉ cho phép thêm thiết bị hoặc nhập hàng loạt khi đang ở trong một danh mục (không phải ở gốc).
        if (addDeviceBtn) addDeviceBtn.disabled = !parentItem;
        if (bulkImportBtn) bulkImportBtn.disabled = !parentItem;

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
                    ${renderTreeRows(null, 0)}
                </tbody>
            </table>
        `;
        listContainer.innerHTML = tableHTML;
        // Đánh dấu hàng đang được chọn (nếu có)
        if (parentId) {
            const activeRow = listContainer.querySelector(`tr[data-id="${parentId}"]`);
            if (activeRow) activeRow.classList.add('parent-category-row');
        }
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

        // Chèn vào cuối bảng
        table.appendChild(newRow);

        // Focus vào ô nhập tên
        newRow.querySelector('input[name="name"]').focus();
    };

    // Hàm ẩn hàng chứa các nút hành động (Thêm mới, Nhập hàng loạt)
    const hideActionButtonsRow = () => {
        const actionRow = document.querySelector('.add-item-row');
        if (actionRow) actionRow.remove();
    };

    const cancelAllInlineActions = () => {
        document.querySelector('.inline-add-row')?.remove();
        // Sau khi hủy, render lại list để nút "Thêm thiết bị mới" có thể hiện lại nếu cần
        // Điều này chỉ cần thiết khi hủy từ một hành động khác (ví dụ: click vào danh mục khác)
        renderList(selectedNodeId);
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
        let shouldUpdateSelectedNode = false;
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
                const docRef = doc(firestore, 'devices', currentEditingId);
                await updateDoc(docRef, data);
                // Cập nhật cache phía client
                const index = allItemsCache.findIndex(item => item.id === currentEditingId);
                if (index > -1) {
                    allItemsCache[index] = { ...allItemsCache[index], ...data };
                }
                showToast('Cập nhật danh mục thành công!', 'success', 3000);
            } else {
                const docRef = await addDoc(collection(firestore, 'devices'), data);
                // Thêm vào cache phía client
                allItemsCache.push({ id: docRef.id, ...data });
                showToast('Thêm danh mục mới thành công!', 'success', 3000);
            }
            selectedNodeId = parentId;
            categoryModal.style.display = 'none';
            renderList(parentId); // Render lại đúng danh mục cha
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
            // Khi sửa, lấy từ select. Khi thêm mới, lấy từ select (vì có thể người dùng đổi danh mục cha).
            // `|| null` để đảm bảo giá trị là null thay vì chuỗi rỗng "" khi ở thư mục gốc
            parentId: document.getElementById('device-parent-select').value || null,
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
                const docRef = doc(firestore, 'devices', currentEditingId);
                await updateDoc(docRef, data);
                // Cập nhật cache
                const index = allItemsCache.findIndex(item => item.id === currentEditingId);
                if (index > -1) {
                    allItemsCache[index] = { ...allItemsCache[index], ...data };
                }
                showToast('Cập nhật thiết bị thành công!', 'success', 3000);
            } else {
                const docRef = await addDoc(collection(firestore, 'devices'), data);
                // Thêm vào cache
                allItemsCache.push({ id: docRef.id, ...data });
                showToast('Thêm thiết bị mới thành công!', 'success', 3000);
            }
            selectedNodeId = data.parentId;
            deviceModal.style.display = 'none';
            renderList(data.parentId); // Render lại đúng danh mục cha
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
            const docRef = await addDoc(collection(firestore, 'devices'), data);
            // Thêm vào cache phía client
            allItemsCache.push({ id: docRef.id, ...data });
            // Xóa dòng inline add TRƯỚC KHI render lại
            row.remove();
            // Render lại với trạng thái hiện tại
            showToast('Thêm thiết bị thành công!', 'success', 3000);
            renderList(selectedNodeId);
        } catch (error) {
            console.error("Lỗi khi lưu thiết bị inline:", error);
            showToast('Đã có lỗi xảy ra khi lưu.', 'error');
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

    // --- NEW: Hàm đệ quy để ẩn/hiện cây con ---
    const toggleSubtreeVisibility = (parentId, hide) => {
        const childrenRows = document.querySelectorAll(`tr[data-parent-id="${parentId}"]`);

        childrenRows.forEach(childRow => {
            const childId = childRow.dataset.id;
            if (hide) {
                // Nếu lệnh là ẩn, ẩn luôn hàng con này
                childRow.classList.add('hidden');
                // Và đệ quy để ẩn tất cả các con của nó
                toggleSubtreeVisibility(childId, true);
            } else {
                // Nếu lệnh là hiện, chỉ hiện các con trực tiếp.
                childRow.classList.remove('hidden');
                // Đồng thời, đảm bảo tất cả các danh mục con cháu đều ở trạng thái đóng.
                if (childRow.dataset.type === 'category') {
                    expandedCategories.delete(childId); // Đóng danh mục con
                    const icon = childRow.querySelector('.col-name .fas');
                    if (icon) icon.className = 'fas fa-folder';

                    // Ẩn tất cả các cấp sâu hơn của danh mục con này.
                    toggleSubtreeVisibility(childId, true);
                }
            }
        });
    };

    const getCategoryPathString = (parentId) => {
        const path = [];
        let currentId = parentId;
        while (currentId) {
            const item = allItemsCache.find(i => i.id === currentId);
            if (item) {
                const displayName = (item.order) ? `${item.order}. ${item.name}` : item.name;
                path.unshift(displayName);
                currentId = item.parentId;
            } else {
                break;
            }
        }
        return `Trang chủ / ${path.join(' / ')}`;
    }

    // --- NEW: Handle Tab key in textarea ---
    const handleTextareaTab = (event) => {
        if (event.key === 'Tab') {
            event.preventDefault(); // Ngăn chặn hành vi mặc định (chuyển focus)

            const textarea = event.target;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;

            // Chèn ký tự Tab vào vị trí con trỏ
            textarea.value = textarea.value.substring(0, start) + '\t' + textarea.value.substring(end);

            // Di chuyển con trỏ đến sau ký tự Tab vừa chèn
            textarea.selectionStart = textarea.selectionEnd = start + 1;
        }
    };


    // --- BULK IMPORT ---
    const openBulkImportModal = () => {
        const parentItem = selectedNodeId ? allItemsCache.find(item => item.id === selectedNodeId) : null;
        if (!parentItem) {
            showToast('Vui lòng chọn một danh mục để nhập thiết bị vào.', 'info');
            return;
        }
        document.getElementById('bulk-import-parent-name').textContent = getCategoryPathString(selectedNodeId);
        document.getElementById('bulk-data-input').value = '';
        document.getElementById('bulk-data-input').addEventListener('keydown', handleTextareaTab); // Gắn sự kiện
        bulkImportModal.style.display = 'flex';
    };

    const processAndPreviewBulkData = async () => {
        const input = document.getElementById('bulk-data-input').value.trim();
        if (!input) {
            showToast('Vui lòng dán dữ liệu từ Excel.', 'error');
            return;
        }

        // Tách các dòng dựa trên ký tự xuống dòng. Cách này an toàn hơn regex
        // vì nó không bị ảnh hưởng bởi nội dung có ký tự xuống dòng bên trong một ô.
        const lines = input.split(/\r\n|\r|\n/);

        validRegistrationsToCreate = []; // Reset
        const previewData = [];
        const errors = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // Tách các cột trong một dòng bằng ký tự Tab
            const parts = line.split('\t').map(p => p.trim());

            // Cần ít nhất 3 cột: STT, Chủ đề, Tên thiết bị
            if (parts.length < 3) {
                errors.push(`Dòng ${i + 1}: Không đủ thông tin. Cần ít nhất 3 cột đầu tiên (Số TT, Chủ đề, Tên thiết bị).`);
                previewData.push({ data: parts, status: 'has-error', originalText: line });
                continue;
            }

            // Gán giá trị từ các cột đã tách bằng phương pháp Destructuring Assignment
            const [
                stt = '',
                topic = '',
                name = '',
                purpose = '',
                description = '',
                usageGV = '',
                usageHS = '',
                unit = '',
                quota = '',
                quantityStr = '0',
                brokenStr = '0'
            ] = parts;

            // Tên thiết bị là trường bắt buộc
            if (!name) {
                errors.push(`Dòng ${i + 1}: Tên thiết bị không được để trống.`);
                previewData.push({ data: parts, status: 'has-error', originalText: line });
                continue;
            }

            const usageObject = [];
            if (usageGV.toLowerCase() === 'x') usageObject.push('GV');
            if (usageHS.toLowerCase() === 'x') usageObject.push('HS');

            const quantity = parseInt(quantityStr) || 0;
            const broken = parseInt(brokenStr) || 0;

            const newDeviceData = {
                order: stt,
                topic: topic,
                name: name,
                purpose: purpose,
                description: description,
                usageObject: usageObject,
                unit: unit,
                quota: quota,
                quantity: quantity,
                broken: broken,
                type: 'device',
                parentId: selectedNodeId,
                createdAt: serverTimestamp()
            };

            validRegistrationsToCreate.push(newDeviceData);
            previewData.push({ data: parts, status: 'is-valid', originalText: line });
        }

        // Render preview
        const errorContainer = document.getElementById('bulk-import-error-section');
        const previewContainer = document.getElementById('bulk-import-preview-container');
        const confirmBtn = document.getElementById('confirm-bulk-import-btn');

        if (errors.length > 0) {
            errorContainer.innerHTML = `<h4>Phát hiện ${errors.length} lỗi:</h4><ul>${errors.map(e => `<li>${e}</li>`).join('')}</ul>`;
            errorContainer.style.display = 'block';
            confirmBtn.style.display = validRegistrationsToCreate.length > 0 ? 'inline-block' : 'none'; // Chỉ ẩn nếu không có dòng nào hợp lệ
        } else {
            errorContainer.style.display = 'none';
            confirmBtn.style.display = 'inline-block';
        }

        let tableHTML = `<table class="preview-table"><thead><tr><th>Số TT</th><th>Chủ đề</th><th>Tên</th><th>Mục đích</th><th>Mô tả</th><th>GV</th><th>HS</th><th>ĐVT</th><th>ĐM</th><th>Tổng số</th><th>Hỏng</th></tr></thead><tbody>`;
        previewData.forEach(row => {
            // SỬA LỖI: Đảm bảo tất cả các hàng đều có đủ 11 ô để không bị vỡ layout bảng
            const cells = [...row.data];
            while (cells.length < 11) {
                cells.push('');
            }
            tableHTML += `<tr class="${row.status}">${cells.map(cell => `<td>${cell}</td>`).join('')}</tr>`;
        });
        tableHTML += `</tbody></table>`;
        previewContainer.innerHTML = tableHTML;

        bulkImportModal.style.display = 'none';
        bulkImportPreviewModal.style.display = 'flex';
    };

    const commitBulkImport = async () => {
        if (validRegistrationsToCreate.length === 0) {
            showToast('Không có dữ liệu hợp lệ để nhập.', 'info');
            return;
        }
        setButtonLoading(confirmBulkImportBtn, true);
        const batch = writeBatch(firestore);
        validRegistrationsToCreate.forEach(data => {
            const newDocRef = doc(collection(firestore, 'devices'));
            batch.set(newDocRef, data);
        });
        await batch.commit();
        setButtonLoading(confirmBulkImportBtn, false);
        bulkImportPreviewModal.style.display = 'none';
        showToast(`Nhập thành công ${validRegistrationsToCreate.length} thiết bị!`, 'success');
        await loadAllItems();
        renderList(selectedNodeId);
    };

    // --- EVENT LISTENERS ---
    const setupEventListeners = () => {
        // Mở modal
        addCategoryBtn?.addEventListener('click', () => openCategoryModal(false));
        addDeviceBtn?.addEventListener('click', addInlineDeviceRow); // <-- THAY ĐỔI Ở ĐÂY
        bulkImportBtn?.addEventListener('click', openBulkImportModal);

        // Đóng/Lưu modal Danh mục
        cancelCategoryBtn?.addEventListener('click', () => categoryModal.style.display = 'none');
        saveCategoryBtn?.addEventListener('click', saveCategory);

        // Đóng/Lưu modal Thiết bị
        cancelDeviceBtn?.addEventListener('click', () => deviceModal.style.display = 'none');
        saveDeviceBtn?.addEventListener('click', saveDevice);

        // Modal xác nhận xóa
        cancelDeleteBtn?.addEventListener('click', () => confirmDeleteModal.style.display = 'none');
        confirmDeleteBtn?.addEventListener('click', () => {
            if (typeof deleteFunction === 'function') deleteFunction();
            confirmDeleteModal.style.display = 'none';
        });

        // Bulk import modals
        cancelBulkImportBtn?.addEventListener('click', () => {
            document.getElementById('bulk-data-input').removeEventListener('keydown', handleTextareaTab); // Gỡ sự kiện
            bulkImportModal.style.display = 'none';
        });
        processBulkImportBtn?.addEventListener('click', () => {
            document.getElementById('bulk-data-input').removeEventListener('keydown', handleTextareaTab); // Gỡ sự kiện
            processAndPreviewBulkData();
        });
        cancelBulkImportPreviewBtn?.addEventListener('click', () => {
            bulkImportPreviewModal.style.display = 'none';
            // Mở lại modal nhập liệu để người dùng có thể sửa
            bulkImportModal.style.display = 'flex';
        });
        confirmBulkImportBtn?.addEventListener('click', commitBulkImport);

        // Event delegation cho breadcrumbs
        breadcrumbContainer?.addEventListener('click', (e) => {
            const target = e.target;
            const breadcrumbItem = target.closest('.breadcrumb-item');
            if (!breadcrumbItem) return;
            const nodeId = breadcrumbItem.dataset.id === 'null' ? null : breadcrumbItem.dataset.id;
            renderList(nodeId);
        });

        // Event delegation cho bảng bên phải
        listContainer?.addEventListener('click', (e) => { // Gộp 2 event listener thành 1
            const target = e.target;
            const row = target.closest('tr');
            if (!row) return; // Click không nằm trong hàng nào, bỏ qua

            // --- Xử lý cho dòng thêm mới inline ---
            if (row.classList.contains('inline-add-row')) {
                if (target.closest('.save-inline-btn')) {
                    saveInlineDevice(row);
                } else if (target.closest('.cancel-inline-btn')) {
                    row.remove();
                    // Render lại list để nút "Thêm thiết bị mới" hiện lại
                    renderList(selectedNodeId);
                }
                return; // Dừng lại để không xử lý tiếp
            }
            // --- Xử lý cho nút "Thêm thiết bị mới" trong danh sách ---
            if (target.closest('.add-single-device-btn')) {
                addInlineDeviceRow();
                hideActionButtonsRow(); // Ẩn hàng chứa nút sau khi click
                return;
            }
            // --- Xử lý cho nút "Nhập hàng loạt" trong danh sách ---
            if (target.closest('.bulk-import-in-list-btn')) {
                openBulkImportModal();
                hideActionButtonsRow(); // Ẩn hàng chứa nút sau khi click
                return;
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
                // --- SỬA LỖI: Cập nhật lại trạng thái khi chọn một danh mục ---
                // 1. Cập nhật ID của danh mục đang được chọn
                // selectedNodeId = id; // Đã được gán ở đầu hàm renderList

                // 4. Logic thu/phóng cây thư mục (giữ nguyên)
                const icon = row.querySelector('.col-name .fas');
                if (expandedCategories.has(id)) {
                    // Nếu đang mở, chỉ cần đóng nó lại
                    expandedCategories.delete(id);
                    if (icon) icon.className = 'fas fa-folder';
                } else { // Mở rộng
                    // Nếu là danh mục cấp gốc (không có parentId), đóng tất cả các mục khác trước khi mở mục này
                    const itemToExpand = allItemsCache.find(item => item.id === id);
                    if (itemToExpand && itemToExpand.parentId === null) {
                        // Lấy danh sách tất cả các mục cấp gốc
                        const topLevelCategoryIds = allItemsCache
                            .filter(item => item.parentId === null && item.type === 'category')
                            .map(item => item.id);
                        // Xóa tất cả các mục cấp gốc khỏi danh sách đang mở rộng
                        topLevelCategoryIds.forEach(catId => expandedCategories.delete(catId));
                    }
                    // Thêm mục hiện tại vào danh sách mở rộng
                    expandedCategories.add(id);
                    if (icon) icon.className = 'fas fa-folder-open';
                }
                renderList(id); // Vẽ lại toàn bộ cây với trạng thái mới
            }
        });
    };

    // --- Khởi chạy ---
    initializePage();
});