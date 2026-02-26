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
    orderBy,
    where
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import {
    getStorage,
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-storage.js";

import { firestore, storage } from "./firebase-config.js";
import { showToast, setButtonLoading } from "./toast.js";
import { getDevicesRecursive } from "./utils.js";
// Tải thư viện QRCode như một module. Đối tượng QRCode sẽ được import trực tiếp.
import QRCode from 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/+esm';

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

    // NEW: QR Code Modal Elements
    const qrCodeModal = document.getElementById('qr-code-modal');
    const qrCodeContainer = document.getElementById('qr-code-container');
    const qrDeviceName = document.getElementById('qr-device-name');
    const qrDeviceId = document.getElementById('qr-device-id');
    const printQrBtn = document.getElementById('print-qr-btn');
    const downloadQrBtn = document.getElementById('download-qr-btn');
    const viewInfoQrBtn = document.getElementById('view-info-qr-btn');

    // NEW: Manual file elements
    const manualFileInput = document.getElementById('device-manual-file');
    const manualFileLink = document.getElementById('device-manual-link');

    // Inventory Preview Modal Elements
    const exportInventoryBtn = document.getElementById('export-inventory-btn');
    const inventoryPreviewModal = document.getElementById('inventory-preview-modal');
    const inventoryPreviewContainer = document.getElementById('inventory-preview-container');
    const cancelInventoryPreviewBtn = document.getElementById('cancel-inventory-preview-btn');
    const downloadWordBtn = document.getElementById('download-word-btn');

    // --- STATE ---
    let allItemsCache = [];
    let selectedNodeId = null;
    let currentEditingId = null;
    let currentModalType = 'category'; // 'subject', 'category', 'device'
    let deleteFunction = null;
    let activeTopLevelCategoryId = null; // NEW: Track the top-level category being viewed
    let expandedCategories = new Set(); // Theo dõi các danh mục đang mở
    let validRegistrationsToCreate = []; // Dùng cho nhập hàng loạt
    let allSubjectsCache = []; // Cache cho danh sách môn học

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

            await loadAllSubjects(); // Tải danh sách môn học
            renderList(null); // Hiển thị nội dung gốc ban đầu
        } catch (error) {
            console.error("Lỗi khi tải dữ liệu:", error);
            listContainer.innerHTML = '<p class="error-message">Không thể tải dữ liệu từ cơ sở dữ liệu.</p>';
        }
    };

    const loadAllSubjects = async () => {
        try {
            // Giả định năm học hiện tại đã được xác định.
            // Nếu chưa, cần thêm logic để lấy năm học mới nhất.
            const q = query(
                collection(firestore, 'subjects'),
                where('status', '==', 'active'), // CHỈ LẤY MÔN HỌC ĐANG HOẠT ĐỘNG
                orderBy('name')
            );
            const snapshot = await getDocs(q);
            allSubjectsCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (error) {
            console.error("Lỗi khi tải danh sách môn học:", error);
            showToast('Không thể tải danh sách môn học.', 'error');
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

        let html = '';
        const indent = depth * 25; // 25px per level

        children.forEach(item => {
            if (item.type === 'device') {
                const usageObject = item.usageObject || [];
                const usageGV = usageObject.includes('GV');
                const usageHS = usageObject.includes('HS');
                html += `
                    <tr data-id="${item.id}" data-type="device" data-parent-id="${parentId || 'root'}" class="bg-hover" style="padding-left: ${indent}px;">
                        <td class="col-stt" data-field="device-order">${item.order || ''}</td>
                        <td class="col-topic" data-field="device-topic">${item.topic || ''}</td>
                        <td class="col-name" data-field="device-name">
                            <div class="item-name-cell">
                                <i class="fas fa-desktop"></i><span>${item.name}</span>
                            </div>
                        </td>
                        <td class="col-purpose" data-field="device-purpose">${item.purpose || ''}</td>
                        <td class="col-description" data-field="device-description">${item.description || ''}</td>
                        <td class="col-usage-gv" data-field="device-usage-gv"><input type="checkbox" ${usageGV ? 'checked' : ''} disabled></td>
                        <td class="col-usage-hs" data-field="device-usage-hs"><input type="checkbox" ${usageHS ? 'checked' : ''} disabled></td>
                        <td class="col-unit" data-field="device-unit">${item.unit || ''}</td>
                        <td class="col-quota" data-field="device-quota">${item.quota || ''}</td>
                        <td class="col-quantity" data-field="device-quantity">${item.quantity || 0}</td>
                        <td class="col-broken" data-field="device-broken">${item.broken || 0}</td>
                        <td class="col-actions">
                            <div class="item-actions">
                                <!-- Nút sửa đã được thay bằng sự kiện click trực tiếp vào ô -->
                                <button class="icon-button qr-code-btn" title="Tạo mã QR"><i class="fas fa-qrcode"></i></button>
                                <button class="icon-button delete-item-btn" title="Xóa"><i class="fas fa-trash-alt"></i></button>
                            </div>
                        </td>
                    </tr>
                `;
            } else { // Category
                const isExpanded = expandedCategories.has(item.id);
                const iconClass = isExpanded ? 'fa-folder-open' : 'fa-folder';
                html += `
                    <tr data-id="${item.id}" data-type="category" data-parent-id="${parentId || 'root'}" class="category-row bg-hover">
                        <td class="col-stt" data-field="category-order">${item.order || ''}</td>
                        <td colspan="10" class="col-name">
                            <div class="item-name-cell" style="padding-left: ${indent}px;">
                                <i class="fas ${iconClass} category-toggle-icon"></i>
                                <span class="item-link" data-field="category-name">
                                    ${item.name}
                                    ${depth === 0 && item.subjects && item.subjects.length > 0 ? `<span class="category-subject-tag">(${item.subjects.join(', ')})</span>` : ''}
                                </span>
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
                            <button class="btn-add-in-list add-single-category-btn"><i class="fas fa-folder-plus"></i> Thêm danh mục mới</button>
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
                    <tr class="sticky-header-second-row">
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

        // Cập nhật chiều cao của hàng header đầu tiên cho sticky header
        const firstHeaderRow = listContainer.querySelector('.device-table thead tr:first-child');
        if (firstHeaderRow) {
            const height = firstHeaderRow.offsetHeight;
            document.documentElement.style.setProperty('--header-row1-height', `${height}px`);
        }
    };

    // --- NEW: QR CODE MODAL ---
    const openQrCodeModal = (itemData) => {
        if (!itemData) return;

        // 1. Clear previous QR code
        qrCodeContainer.innerHTML = '';

        // 2. Update modal content
        qrDeviceName.textContent = itemData.name;
        qrDeviceId.textContent = `ID: ${itemData.id}`;

        // Lưu ID thiết bị vào data attribute của modal để các nút khác có thể sử dụng
        qrCodeModal.dataset.deviceId = itemData.id;

        // 3. Generate QR Code
        // URL này sẽ trỏ đến một trang công khai có thể đọc ID thiết bị từ query string
        // và hiển thị thông tin của thiết bị đó.
        const lookupUrl = `${window.location.origin}/device-info.html?id=${itemData.id}`;

        // Sử dụng đối tượng QRCode đã được import trực tiếp, không cần `window.`
        QRCode.toCanvas(lookupUrl, {
            width: 256,
            margin: 2,
            errorCorrectionLevel: 'H'
        }, (err, canvas) => {
            if (err) {
                console.error("Lỗi tạo mã QR:", err);
                qrCodeContainer.innerHTML = '<p class="error-message">Không thể tạo mã QR.</p>';
                return;
            }
            qrCodeContainer.appendChild(canvas);
        });

        // 4. Show the modal
        qrCodeModal.style.display = 'flex';
    };

    const printQrCode = () => {
        const canvas = qrCodeContainer.querySelector('canvas');
        const deviceName = qrDeviceName.textContent;
        const deviceId = qrDeviceId.textContent;

        if (!canvas) {
            showToast('Không tìm thấy mã QR để in.', 'error');
            return;
        }

        // Chuyển đổi canvas thành ảnh PNG dạng data URL
        const qrImageSrc = canvas.toDataURL('image/png');

        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <html>
                <head>
                    <title>In Mã QR - ${deviceName}</title>
                    <style>
                        body { text-align: center; font-family: Arial, sans-serif; margin: 20px; }
                        img { width: 256px; height: 256px; }
                        h3 { margin-top: 15px; margin-bottom: 5px; }
                        p { font-size: 0.9rem; color: #6c757d; margin-top: 0; }
                    </style>
                </head>
                <body>
                    <img src="${qrImageSrc}" alt="QR Code for ${deviceName}">
                    <h3>${deviceName}</h3>
                    <p>${deviceId}</p>
                </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.onload = function() { // Đợi cho ảnh được tải xong
            printWindow.focus();
            printWindow.print();
            printWindow.close();
        };
    };

    const downloadQrCode = () => {
        const canvas = qrCodeContainer.querySelector('canvas');
        const deviceName = qrDeviceName.textContent;
        if (!canvas || !deviceName) {
            showToast('Không tìm thấy mã QR để tải.', 'error');
            return;
        }

        // Tạo một thẻ <a> ẩn để kích hoạt việc tải xuống
        const link = document.createElement('a');

        // Tạo tên file thân thiện, loại bỏ các ký tự không hợp lệ
        const safeFileName = deviceName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        link.download = `qr-code-${safeFileName}.png`;

        // Chuyển đổi canvas thành data URL và gán vào link
        link.href = canvas.toDataURL('image/png');

        // Kích hoạt click để tải file và sau đó xóa link
        link.click();
    };

    const viewDeviceInfo = () => {
        const deviceId = qrCodeModal.dataset.deviceId;
        if (!deviceId) {
            showToast('Không tìm thấy ID thiết bị.', 'error');
            return;
        }
        const url = `${window.location.origin}/device-info.html?id=${deviceId}`;
        window.open(url, '_blank');
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
        // Sau khi hủy, render lại list để hàng chứa nút "Thêm thiết bị mới" và "Nhập hàng loạt" có thể hiện lại.
        // Điều này đảm bảo giao diện nhất quán sau khi hủy bỏ hành động.
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
    const openItemModal = (type, isEditing = false, data = {}, focusFieldId = null) => {
        if (type === 'device') {
            openDeviceModal(isEditing, data, focusFieldId);
        } else if (type === 'category') {
            openCategoryModal(isEditing, data, focusFieldId);
        }
    };

    const openCategoryModal = (isEditing = false, data = {}, focusFieldId = null) => {
        currentEditingId = isEditing ? data.id : null;
        categoryForm.reset();
        categoryModalTitle.textContent = isEditing ? 'Sửa Danh mục' : 'Thêm Danh mục';
    
        const parentSelectGroup = document.getElementById('category-parent-select-group');
        const parentSelect = document.getElementById('category-parent-select');
        const subjectGroup = document.getElementById('category-subject-select-group');
    
        // Xác định xem có phải là danh mục cấp cao nhất không
        const isTopLevel = isEditing ? !data.parentId : !selectedNodeId;
    
        // Reset và thiết lập lại bộ chọn môn học đa lựa chọn
        setupSubjectMultiSelect();
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
    
        // Xử lý hiển thị và điền dữ liệu cho dropdown Môn học
        subjectGroup.style.display = isTopLevel ? 'block' : 'none';
        if (isTopLevel && isEditing && data.subjects) {
            const subjectsContainer = document.getElementById('category-subjects-container');
            data.subjects.forEach(subjectName => {
                addSubjectTag(subjectName, subjectsContainer);
            });
        }

        categoryModal.style.display = 'flex';
        // Focus vào trường được chỉ định hoặc trường tên mặc định
        const fieldToFocus = focusFieldId ? document.getElementById(focusFieldId) : document.getElementById('category-name');
        if (fieldToFocus) {
            setTimeout(() => fieldToFocus.focus(), 100); // Delay nhỏ để đảm bảo modal hiển thị
        }
    };

    // --- SUBJECT MULTI-SELECT LOGIC ---
    const setupSubjectMultiSelect = () => {
        const wrapper = document.getElementById('category-subjects-select-wrapper');
        const container = document.getElementById('category-subjects-container');
        const searchInput = document.getElementById('category-subject-search-input');
        const dropdown = document.getElementById('category-subject-dropdown');

        // Xóa các tag cũ và reset input
        container.querySelectorAll('.subject-tag').forEach(tag => tag.remove());
        searchInput.value = '';

        const filterSubjects = () => {
            const filterText = searchInput.value.toLowerCase();
            const selectedSubjects = new Set(Array.from(container.querySelectorAll('.subject-tag')).map(tag => tag.firstChild.textContent));
            
            const filtered = allSubjectsCache.filter(subject => 
                !selectedSubjects.has(subject.name) && subject.name.toLowerCase().includes(filterText)
            );

            dropdown.innerHTML = filtered.map(subject => `<div class="subject-dropdown-item">${subject.name}</div>`).join('');
            dropdown.style.display = filtered.length > 0 ? 'block' : 'none';
        };

        searchInput.onkeyup = filterSubjects;
        searchInput.onfocus = filterSubjects;

        dropdown.onclick = (e) => {
            if (e.target.classList.contains('subject-dropdown-item')) {
                addSubjectTag(e.target.textContent, container);
                searchInput.value = '';
                filterSubjects();
                searchInput.focus();
            }
        };

        // Đóng dropdown khi click ra ngoài
        document.addEventListener('click', (e) => {
            if (!wrapper.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });
    };

    const addSubjectTag = (subjectName, container) => {
        const searchInput = document.getElementById('category-subject-search-input');
        const tag = document.createElement('span');
        tag.className = 'subject-tag';
        tag.textContent = subjectName;

        const removeBtn = document.createElement('span');
        removeBtn.className = 'remove-tag';
        removeBtn.innerHTML = '&times;';
        removeBtn.onclick = () => {
            tag.remove();
        };

        tag.appendChild(removeBtn);
        container.insertBefore(tag, searchInput);
    };

    const getSelectedSubjects = () => {
        return Array.from(document.querySelectorAll('#category-subjects-container .subject-tag'))
            .map(tag => tag.firstChild.textContent.trim());
    };


    const openDeviceModal = (isEditing = false, data = {}, focusFieldId = null) => {
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

            // NEW: Handle manual file link
            manualFileLink.href = data.manualUrl || '#';
            manualFileLink.textContent = data.manualUrl ? (data.manualFileName || 'Xem tài liệu') : 'Chưa có tài liệu';
        } else {
            // Khi thêm mới, tự động chọn danh mục cha là danh mục đang xem
            buildCategoryTreeForSelect(parentSelect, selectedNodeId);
            parentSelect.value = selectedNodeId || '';
        }

        deviceModal.style.display = 'flex';
        // NEW: Reset file input
        manualFileInput.value = '';
        manualFileLink.style.display = isEditing ? 'block' : 'none';

        // Focus vào trường được chỉ định hoặc trường tên mặc định
        const fieldToFocus = focusFieldId ? document.getElementById(focusFieldId) : document.getElementById('device-name');
        if (fieldToFocus) {
            setTimeout(() => fieldToFocus.focus(), 100); // Delay nhỏ để đảm bảo modal hiển thị
        }
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
        const isTopLevel = currentEditingId ? !document.getElementById('category-parent-select').value : !selectedNodeId;

        if (currentEditingId) { // Nếu đang sửa
            parentId = document.getElementById('category-parent-select').value || null;
        } else { // Nếu thêm mới
            parentId = selectedNodeId; // parentId là mục đang xem
        }

        const subjects = isTopLevel ? getSelectedSubjects() : [];

        const data = {
            name: name,
            order: document.getElementById('category-order').value.trim(),
            type: 'category',
            parentId: parentId,
            // Lưu dưới dạng mảng, ngay cả khi rỗng
            subjects: subjects
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
            categoryModal.style.display = 'none';
            // Nếu là thêm mới, mở danh mục vừa tạo. Nếu là sửa, render lại danh mục cha.
            const newCategoryId = currentEditingId ? parentId : allItemsCache[allItemsCache.length - 1].id;
            if (!currentEditingId && newCategoryId) {
                expandedCategories.add(newCategoryId); // Tự động mở danh mục mới
            }
            renderList(newCategoryId);
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

        // --- SỬA LỖI: Tạo ID trước để đảm bảo tính nhất quán ---
        // Nếu là thêm mới, tạo một document reference mới để lấy ID.
        // Nếu là sửa, sử dụng document reference hiện có.
        const docRef = currentEditingId
            ? doc(firestore, 'devices', currentEditingId)
            : doc(collection(firestore, 'devices'));

        // Gán ID vào data để sử dụng cho việc tải tệp lên.
        const deviceIdForPath = docRef.id;

        // --- NEW: Handle file upload ---
        const manualFile = manualFileInput.files[0];
        if (manualFile) {
            const filePath = `manuals/${deviceIdForPath}/${manualFile.name}`;
            const fileRef = ref(storage, filePath);

            try {
                const uploadResult = await uploadBytes(fileRef, manualFile);
                const downloadURL = await getDownloadURL(uploadResult.ref);
                data.manualUrl = downloadURL;
                data.manualFileName = manualFile.name; // Lưu tên tệp
            } catch (uploadError) {
                console.error("Lỗi tải tệp lên:", uploadError);
                showToast('Không thể tải tệp hướng dẫn lên. Vui lòng thử lại.', 'error');
                setButtonLoading(saveDeviceBtn, false);
                return;
            }
        } else if (currentEditingId) {
            // Giữ lại URL cũ nếu không có tệp mới được chọn khi chỉnh sửa
            data.manualUrl = allItemsCache.find(item => item.id === currentEditingId)?.manualUrl || null;
            data.manualFileName = allItemsCache.find(item => item.id === currentEditingId)?.manualFileName || null;
        }

        try {
            if (currentEditingId) {
                await updateDoc(docRef, data);
                // Cập nhật cache
                const index = allItemsCache.findIndex(item => item.id === currentEditingId);
                if (index > -1) {
                    allItemsCache[index] = { ...allItemsCache[index], ...data };
                }
                showToast('Cập nhật thiết bị thành công!', 'success', 3000);
            } else {
                await setDoc(docRef, data); // Sử dụng setDoc thay vì addDoc vì đã có docRef
                // Thêm vào cache
                allItemsCache.push({ id: docRef.id, ...data });
                showToast('Thêm thiết bị mới thành công!', 'success', 3000);
            }
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
                // Sử dụng cache đã có sẵn thay vì truy vấn lại
                const idsToDelete = getSubtreeIds(allItemsCache, id);
                const itemsToDelete = allItemsCache.filter(item => idsToDelete.includes(item.id));

                // --- NEW: Xóa các tệp liên quan khỏi Firebase Storage ---
                const deleteFilePromises = [];
                itemsToDelete.forEach(item => {
                    // Chỉ xóa tệp nếu là thiết bị và có thông tin tệp
                    if (item.type === 'device' && item.manualFileName) {
                        const filePath = `manuals/${item.id}/${item.manualFileName}`;
                        const fileRef = ref(storage, filePath);
                        console.log(`Đang chuẩn bị xóa tệp: ${filePath}`);
                        // Thêm promise xóa vào mảng
                        deleteFilePromises.push(deleteObject(fileRef).catch(error => {
                            // Ghi lại lỗi nếu không xóa được tệp nhưng không dừng toàn bộ quá trình
                            if (error.code !== 'storage/object-not-found') {
                                console.error(`Lỗi khi xóa tệp ${filePath}:`, error);
                            }
                        }));
                    }
                });

                // Chờ tất cả các promise xóa tệp hoàn tất
                await Promise.all(deleteFilePromises);

                // --- Xóa các bản ghi trong Firestore bằng batch ---
                const batch = writeBatch(firestore);
                idsToDelete.forEach(deleteId => {
                    const docRef = doc(firestore, 'devices', deleteId);
                    batch.delete(docRef);
                });
                await batch.commit();

                showToast('Đã xóa thành công!', 'success', 3000);
                // Cập nhật cache local thay vì reload toàn bộ collection (tiết kiệm reads)
                allItemsCache = allItemsCache.filter(item => !idsToDelete.includes(item.id));
                renderList(selectedNodeId);
            } catch (error) {
                console.error("Lỗi khi xóa:", error);
                showToast('Đã có lỗi xảy ra khi xóa. Một số tệp có thể chưa được dọn dẹp.', 'error');
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


    // --- INVENTORY REPORT (Biên bản kiểm kê) ---
    const toRoman = (num) => {
        const numerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
        return numerals[num - 1] || String(num);
    };

    // depth 0 → A,B,C  |  depth 1 → I,II,III  |  depth 2 → 1,2,3  |  devices → parentNum.x
    const renderInventoryTreeRows = (parentId, depth, parentNumStr) => {
        let html = '';
        const children = allItemsCache
            .filter(item => item.parentId === parentId)
            .sort((a, b) => String(a.order || '').localeCompare(String(b.order || ''), undefined, { numeric: true, sensitivity: 'base' }));

        let catIdx = 0;
        let deviceIdx = 0;

        children.forEach(child => {
            if (child.type === 'category') {
                catIdx++;
                let stt;
                if (depth === 0) {
                    stt = String.fromCharCode(64 + catIdx); // A, B, C...
                } else if (depth === 1) {
                    stt = toRoman(catIdx); // I, II, III...
                } else {
                    stt = String(catIdx); // 1, 2, 3...
                }
                html += `<tr>
                    <td style="border: 1px solid #000; padding: 4px; text-align: center; font-weight: bold; font-size: 13pt;">${stt}</td>
                    <td colspan="5" style="border: 1px solid #000; padding: 4px 8px; font-weight: bold; text-transform: uppercase; font-size: 13pt;">
                        ${child.name}
                    </td>
                </tr>`;
                // depth >= 2 categories pass their number as prefix for device STT
                const numStr = depth >= 2 ? String(catIdx) : '';
                const result = renderInventoryTreeRows(child.id, depth + 1, numStr);
                html += result.html;
            } else if (child.type === 'device') {
                deviceIdx++;
                const stt = parentNumStr ? `${parentNumStr}.${deviceIdx}` : String(deviceIdx);
                const desc = child.description ? child.description.replace(/\n/g, '<br/>') : '';
                const nameCell = desc
                    ? `${child.name || ''}<div class="inv-desc" onclick="this.classList.toggle('expanded')">${desc}</div>`
                    : (child.name || '');
                html += `<tr>
                    <td style="border: 1px solid #000; padding: 4px; text-align: center; font-size: 13pt;">${stt}</td>
                    <td style="border: 1px solid #000; padding: 4px; font-size: 13pt;">${child.topic || ''}</td>
                    <td style="border: 1px solid #000; padding: 4px; font-size: 13pt;">${nameCell}</td>
                    <td style="border: 1px solid #000; padding: 4px; text-align: center; font-size: 13pt;">${child.unit || ''}</td>
                    <td contenteditable="true" inputmode="numeric" data-device-id="${child.id}" data-field="quantity" style="border: 1px solid #000; padding: 4px; text-align: center; font-size: 13pt;">${child.quantity || 0}</td>
                    <td contenteditable="true" inputmode="numeric" data-device-id="${child.id}" data-field="broken" style="border: 1px solid #000; padding: 4px; text-align: center; font-size: 13pt;">${child.broken || 0}</td>
                </tr>`;
            }
        });

        return { html };
    };

    const buildInventoryHTML = () => {
        const topLevelCategories = allItemsCache.filter(item => !item.parentId && item.type === 'category');

        // Normalize Vietnamese for flexible matching (case-insensitive, ý/í variants)
        const normalizeVi = (str) => str.normalize('NFC').replace(/[ýỳỷỹỵÝỲỶỸỴ]/g, m => m === m.toUpperCase() ? 'i' : 'i').toLowerCase().trim();

        // Build subject-to-categories mapping using normalized keys
        const subjectMap = new Map(); // normalized key → categories[]
        topLevelCategories.forEach(cat => {
            if (cat.subjects && cat.subjects.length > 0) {
                cat.subjects.forEach(subjectName => {
                    const normKey = normalizeVi(subjectName);
                    if (!subjectMap.has(normKey)) {
                        subjectMap.set(normKey, []);
                    }
                    subjectMap.get(normKey).push(cat);
                });
            }
        });

        // Sort subjects by predefined order (using actual DB names), then remaining alphabetically
        const SUBJECT_ORDER = ['Toán', 'Vật Lý', 'Hóa học', 'Sinh học', 'CNCN', 'CNNN', 'Lịch sử', 'Địa Lý', 'Tin học', 'Ngữ Văn', 'GDQP AN', 'Giáo dục thể chất', 'Hoạt động trải nghiệm', 'KTGD&PL'];
        const findOrderIndex = (name) => {
            const norm = normalizeVi(name);
            return SUBJECT_ORDER.findIndex(s => normalizeVi(s) === norm);
        };
        // Filter subjects that have categories mapped (using normalized matching)
        const allSubjectNames = allSubjectsCache.map(s => s.name).filter(name => subjectMap.has(normalizeVi(name)));
        const sortedSubjects = allSubjectNames.sort((a, b) => {
            const idxA = findOrderIndex(a);
            const idxB = findOrderIndex(b);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.localeCompare(b, 'vi');
        });

        const hStyle = 'border: 1px solid #000; padding: 5px; text-align: center; font-weight: bold; font-size: 13pt;';

        let html = `<div style="font-family: 'Times New Roman', serif; font-size: 13pt; line-height: 1.5; max-width: 800px; margin: 0 auto;">`;

        // Header
        html += `<table style="width: 100%; border-collapse: collapse;">
            <tr>
                <td style="width: 40%; text-align: center; vertical-align: top; padding: 0;">
                    <p style="margin: 0; font-size: 13pt;">SỞ GD&amp;ĐT QUẢNG TRỊ</p>
                    <p style="margin: 0; font-weight: bold; font-size: 13pt;">TRƯỜNG THPT CHẾ LAN VIÊN</p>
                </td>
                <td style="width: 60%; text-align: center; vertical-align: top; padding: 0;">
                    <p style="margin: 0; font-weight: bold; font-size: 13pt;">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</p>
                    <p style="margin: 0; font-weight: bold; font-size: 13pt;"><u>Độc lập - Tự do - Hạnh phúc</u></p>
                </td>
            </tr>
        </table>`;

        // Title
        html += `<p style="text-align: center; font-weight: bold; font-size: 15pt; margin-top: 25px; margin-bottom: 0;">BIÊN BẢN</p>`;
        html += `<p style="text-align: center; font-weight: bold; font-size: 13pt; margin-top: 5px;">Về việc kiểm kê thiết bị dạy học</p>`;

        // Editable field helper with ID for localStorage persistence
        const ef = (id, text) => `<span contenteditable="true" class="editable-field" data-field-id="${id}">${text}</span>`;

        // Body intro
        html += `<p style="text-indent: 30px;">Căn cứ nhiệm vụ năm học ${ef('nam-hoc', '')}, Trường THPT Chế Lan Viên thành lập Hội đồng kiểm kê thiết bị dạy học tối thiểu các bộ môn Vật lý, Hóa học, Sinh học, Công nghệ, Toán học, Lịch sử, Địa Lý, Ngữ văn, TD- QPAN, Trải nghiệm, Hướng nghiệp...</p>`;
        html += `<p style="text-indent: 30px;">Thời gian kiểm kê: ${ef('thoi-gian', '')}</p>`;
        html += `<p style="text-indent: 30px;">Địa điểm: ${ef('dia-diem', '')}</p>`;
        html += `<p style="text-indent: 30px;">Thành phần kiểm kê gồm:</p>`;

        // Committee members (editable placeholders)
        for (let i = 1; i <= 10; i++) {
            html += `<p style="margin-left: 50px; margin-top: 2px; margin-bottom: 2px;">${i}. ${ef(`member-${i}`, '')}</p>`;
        }

        // For each subject, create a section with table
        sortedSubjects.forEach((subjectName, index) => {
            const romanNum = toRoman(index + 1);
            html += `<p style="font-weight: bold; margin-top: 20px; font-size: 13pt;">${romanNum}. MÔN ${subjectName.toUpperCase()}</p>`;

            html += `<table style="width: 100%; border-collapse: collapse; table-layout: fixed; word-break: break-word;">
                <thead>
                    <tr>
                        <th style="${hStyle} width: 6%;">Số<br/>TT</th>
                        <th style="${hStyle} width: 15%;">Chủ đề dạy học</th>
                        <th style="${hStyle} width: 39%;">Tên thiết bị</th>
                        <th style="${hStyle} width: 12%;">Đơn vị tính</th>
                        <th style="${hStyle} width: 10%;">Tổng số</th>
                        <th style="${hStyle} width: 8%;">Hỏng</th>
                    </tr>
                </thead>
                <tbody>`;

            const categories = subjectMap.get(normalizeVi(subjectName));

            categories.forEach(topCat => {
                const result = renderInventoryTreeRows(topCat.id, 0, '');
                html += result.html;
            });

            html += `</tbody></table>`;
        });

        html += `</div>`;
        return html;
    };

    const INVENTORY_STORAGE_KEY = 'inventoryReportFields';

    const INVENTORY_SAMPLE_DATA = {
        'nam-hoc': '2024-2025',
        'thoi-gian': '7h30 ngày 30 tháng 12 năm 2024',
        'dia-diem': 'Phòng học bộ môn Vật lý, Hóa học, Sinh học, Phòng Thiết bị, Phòng Bản đồ, Kho TD- QPAN trường THPT Chế Lan Viên',
        'member-1': 'Bà Nguyễn Thị Tân, Phó hiệu trưởng – Phụ trách CSVC',
        'member-2': 'Bà Nguyễn Thị Loan, Nhân viên thiết bị',
        'member-3': 'Bà Nguyễn Thị Mỹ Hạnh, Kế toán',
        'member-4': 'Ông Hoàng Ngọc Phúc, TTCM tổ Sinh-TD-GDQP',
        'member-5': 'Bà Nguyễn Thị Thùy Hoài, TPCM tổ Vật lý- CN',
        'member-6': 'Ông Nguyễn Đức Đạt, TTCM tổ Địa -Tin',
        'member-7': 'Ông Phan Quốc Dũng, TTCM tổ Sử- GDKT&PL',
        'member-8': 'Ông Phạm Văn Lê Long, TPCM tổ Địa –Tin',
        'member-9': 'Bà Nguyễn Thị Hải Hiền, TPCM tổ Sinh-TD-GDQP',
        'member-10': 'Ông Từ Xuân Thành, TTCM tổ Hóa học'
    };

    const fillSampleData = () => {
        inventoryPreviewContainer.querySelectorAll('.editable-field[data-field-id]').forEach(el => {
            const value = INVENTORY_SAMPLE_DATA[el.dataset.fieldId];
            if (value) el.innerHTML = value;
        });
        saveInventoryFields();
    };

    const clearAllFields = () => {
        inventoryPreviewContainer.querySelectorAll('.editable-field[data-field-id]').forEach(el => {
            el.innerHTML = '';
        });
        saveInventoryFields();
    };

    const saveInventoryFields = () => {
        const fields = {};
        inventoryPreviewContainer.querySelectorAll('.editable-field[data-field-id]').forEach(el => {
            fields[el.dataset.fieldId] = el.innerHTML;
        });
        localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(fields));
    };

    const restoreInventoryFields = () => {
        try {
            const saved = JSON.parse(localStorage.getItem(INVENTORY_STORAGE_KEY));
            if (!saved) return;
            inventoryPreviewContainer.querySelectorAll('.editable-field[data-field-id]').forEach(el => {
                if (saved[el.dataset.fieldId] !== undefined) {
                    el.innerHTML = saved[el.dataset.fieldId];
                }
            });
        } catch (e) { /* ignore parse errors */ }
    };

    const openInventoryPreview = () => {
        const html = buildInventoryHTML();
        inventoryPreviewContainer.innerHTML = html;
        restoreInventoryFields();

        // Auto-save editable fields on edit
        inventoryPreviewContainer.addEventListener('input', (e) => {
            if (e.target.classList.contains('editable-field')) {
                saveInventoryFields();
            }
        });

        // Auto-select all text on focus for quantity/broken cells
        // Delay to avoid triggering mobile context menu (Cut/Copy/Paste) immediately
        inventoryPreviewContainer.addEventListener('focus', (e) => {
            if (e.target.dataset?.deviceId && e.target.dataset?.field) {
                setTimeout(() => {
                    const range = document.createRange();
                    range.selectNodeContents(e.target);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                }, 50);
            }
        }, true);

        // Save quantity/broken to Firestore on blur
        inventoryPreviewContainer.addEventListener('blur', async (e) => {
            const cell = e.target;
            const deviceId = cell.dataset?.deviceId;
            const field = cell.dataset?.field;
            if (!deviceId || !field) return;

            const newValue = parseInt(cell.textContent.trim(), 10);
            const item = allItemsCache.find(i => i.id === deviceId);
            if (isNaN(newValue) || newValue < 0) {
                cell.textContent = item ? (item[field] || 0) : 0;
                return;
            }

            // Validate: broken <= quantity
            if (field === 'broken') {
                const qty = item ? (item.quantity || 0) : 0;
                if (newValue > qty) {
                    showToast(`Số hỏng (${newValue}) không được lớn hơn tổng số (${qty})!`, 'error');
                    cell.textContent = item ? (item.broken || 0) : 0;
                    return;
                }
            }
            if (field === 'quantity') {
                const broken = item ? (item.broken || 0) : 0;
                if (newValue < broken) {
                    showToast(`Tổng số (${newValue}) không được nhỏ hơn số hỏng (${broken})!`, 'error');
                    cell.textContent = item ? (item.quantity || 0) : 0;
                    return;
                }
            }

            if (item && item[field] === newValue) return;

            try {
                await updateDoc(doc(firestore, 'devices', deviceId), { [field]: newValue });
                // Update local cache
                if (item) item[field] = newValue;
            } catch (err) {
                console.error('Lỗi cập nhật:', err);
                showToast('Lỗi cập nhật dữ liệu!', 'error');
                // Revert on error
                cell.textContent = item ? (item[field] || 0) : 0;
            }
        }, true);

        inventoryPreviewModal.style.display = 'flex';
    };

    const downloadInventoryWord = () => {
        const contentHtml = inventoryPreviewContainer.innerHTML;
        const fullHtml = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
            <head>
                <meta charset='utf-8'>
                <title>Biên bản kiểm kê thiết bị dạy học</title>
                <style>
                    @page { size: A4; margin: 2cm 2cm 2cm 3cm; }
                    body { font-family: 'Times New Roman', serif; font-size: 13pt; }
                </style>
            </head>
            <body>${contentHtml}</body>
        </html>`;
        const blob = new Blob(['\ufeff' + fullHtml], { type: 'application/msword' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'bien-ban-kiem-ke-thiet-bi.doc';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
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

        // SỬA LỖI: Thay vì split, dùng match để tìm tất cả các bản ghi.
        // Một bản ghi bắt đầu bằng một số (Số TT) và kéo dài cho đến khi gặp số TT tiếp theo hoặc kết thúc chuỗi.
        // Regex: `\d+(\.\d+)?[\s\t][\s\S]*?(?=\r?\n\d+(\.\d+)?[\s\t]|$)`
        // - `\d+(\.\d+)?[\s\t]`: Bắt đầu bằng số thứ tự (vd: 1, 1.1) theo sau là khoảng trắng/tab.
        // - `[\s\S]*?`: Khớp với bất kỳ ký tự nào (bao gồm cả xuống dòng) một cách không tham lam.
        // - `(?=\r?\n\d+(\.\d+)?[\s\t]|$)`: Dừng lại khi gặp dòng tiếp theo bắt đầu bằng số thứ tự, hoặc khi kết thúc chuỗi.
        const recordRegex = /\d+(\.\d+)?[\s\t][\s\S]*?(?=\r?\n\d+(\.\d+)?[\s\t]|$)/g;
        const recordsRaw = input.match(recordRegex) || [];
        validRegistrationsToCreate = []; // Reset
        const previewData = [];
        const errors = [];

        for (let i = 0; i < recordsRaw.length; i++) {
            const recordText = recordsRaw[i].trim();
            if (!recordText) continue;

            // --- LOGIC MỚI: Tách toàn bộ dòng bằng ký tự Tab để xử lý chính xác các cột ---
            const parts = recordText.split('\t');

            // Cần ít nhất 6 cột (đến cột GV) để được coi là hợp lệ
            if (parts.length < 6) {
                errors.push(`Dòng ${i + 1}: Không đủ cột dữ liệu. Cần tối thiểu 6 cột.`);
                previewData.push({ data: [recordText], status: 'has-error', originalText: recordText });
                continue;
            }

            const stt = parts[0]?.trim() || '';
            const topic = parts[1]?.trim() || '';
            const name = parts[2]?.trim() || '';
            const purpose = parts[3]?.trim() || '';
            const description = parts[4]?.trim() || '';
            const usageGV = parts[5]?.trim() || '';
            const usageHS = parts[6]?.trim() || '';
            const unit = parts[7]?.trim() || '';
            const quota = parts[8]?.trim() || '';
            const quantityStr = parts[9]?.trim() || '0';
            const brokenStr = parts[10]?.trim() || '0';

            if (!name) {
                errors.push(`Dòng ${i + 1}: Tên thiết bị không được để trống.`);
                previewData.push({ data: [recordText], status: 'has-error', originalText: recordText });
                continue;
            }

            const usageObject = [];
            if (usageGV.toLowerCase() === 'x') usageObject.push('GV');
            if (usageHS.toLowerCase() === 'x') usageObject.push('HS');

            const quantity = parseInt(quantityStr) || 0;
            const broken = parseInt(brokenStr) || 0;

            // Tạo đối tượng dữ liệu để lưu
            const newDeviceData = {
                order: stt,
                topic: topic,
                name: name,
                purpose: purpose,
                description: description,
                usageObject: usageObject, // Lưu dạng mảng ['GV', 'HS']
                unit: unit,
                quota: quota,
                quantity: quantity,
                broken: broken,
                type: 'device',
                parentId: selectedNodeId,
                createdAt: serverTimestamp()
            };

            validRegistrationsToCreate.push(newDeviceData);
            // Dữ liệu để hiển thị trong bảng xem trước
            const previewRow = [stt, topic, name, purpose, description, usageGV, usageHS, unit, quota, quantityStr, brokenStr];
            previewData.push({ data: previewRow, status: 'is-valid', originalText: recordText });
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
        const newItemsForCache = [];
        validRegistrationsToCreate.forEach(data => {
            const newDocRef = doc(collection(firestore, 'devices'));
            batch.set(newDocRef, data);
            newItemsForCache.push({ id: newDocRef.id, ...data });
        });
        await batch.commit();
        allItemsCache.push(...newItemsForCache); // Chỉ thêm các mục mới vào cache
        setButtonLoading(confirmBulkImportBtn, false);
        bulkImportPreviewModal.style.display = 'none';
        showToast(`Nhập thành công ${validRegistrationsToCreate.length} thiết bị!`, 'success');
        renderList(selectedNodeId);
    };

    // --- EVENT LISTENERS ---
    const setupEventListeners = () => {
        // Mở modal
        addCategoryBtn?.addEventListener('click', () => openCategoryModal(false));
        addDeviceBtn?.addEventListener('click', addInlineDeviceRow); // <-- THAY ĐỔI Ở ĐÂY
        bulkImportBtn?.addEventListener('click', openBulkImportModal);

        // Inventory preview
        exportInventoryBtn?.addEventListener('click', openInventoryPreview);
        cancelInventoryPreviewBtn?.addEventListener('click', () => inventoryPreviewModal.style.display = 'none');
        downloadWordBtn?.addEventListener('click', downloadInventoryWord);
        document.getElementById('fill-sample-btn')?.addEventListener('click', fillSampleData);
        document.getElementById('clear-fields-btn')?.addEventListener('click', clearAllFields);

        // Đóng/Lưu modal Danh mục
        cancelCategoryBtn?.addEventListener('click', () => {
            categoryModal.style.display = 'none';
            // Render lại danh sách để hiển thị lại các nút hành động nếu chúng đã bị ẩn
            renderList(selectedNodeId);
        });
        saveCategoryBtn?.addEventListener('click', saveCategory);

        // Thêm sự kiện Enter để lưu cho modal Danh mục
        categoryForm?.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                cancelCategoryBtn.click();
            }
            if (e.key === 'Enter') {
                e.preventDefault(); // Ngăn hành vi mặc định của form
                saveCategoryBtn.click();
            }
        });

        // Thêm sự kiện Enter để lưu cho modal Thiết bị
        deviceForm?.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                cancelDeviceBtn.click();
            }
            // Chỉ thực hiện khi phím Enter được nhấn và không phải trong textarea
            if (e.key === 'Enter' && e.target.tagName.toLowerCase() !== 'textarea') {
                e.preventDefault();
                saveDeviceBtn.click();
            }
        });

        // Thêm sự kiện Enter để xác nhận xóa
        confirmDeleteModal?.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                cancelDeleteBtn.click();
            }
            if (e.key === 'Enter') confirmDeleteBtn.click();
        });

        // Đóng/Lưu modal Thiết bị
        cancelDeviceBtn?.addEventListener('click', () => {
            deviceModal.style.display = 'none';
            // Render lại danh sách để hiển thị lại các nút hành động nếu chúng đã bị ẩn
            renderList(selectedNodeId);
        });
        saveDeviceBtn?.addEventListener('click', saveDevice);

        // Modal xác nhận xóa
        cancelDeleteBtn?.addEventListener('click', () => confirmDeleteModal.style.display = 'none');
        confirmDeleteBtn?.addEventListener('click', () => {
            if (typeof deleteFunction === 'function') deleteFunction();
            confirmDeleteModal.style.display = 'none';
        });
        document.getElementById('cancel-qr-modal')?.addEventListener('click', () => {
            qrCodeModal.style.display = 'none';
        });

        // Bulk import modals
        cancelBulkImportBtn?.addEventListener('click', () => {
            document.getElementById('bulk-data-input').removeEventListener('keydown', handleTextareaTab); // Gỡ sự kiện
            // Render lại danh sách để hiển thị lại các nút hành động
            renderList(selectedNodeId);
            bulkImportModal.style.display = 'none';
        });
        // Thêm sự kiện Enter để xử lý cho modal Nhập hàng loạt
        bulkImportModal?.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                cancelBulkImportBtn.click();
            }
            if (e.key === 'Enter' && e.target.tagName.toLowerCase() !== 'textarea') {
                e.preventDefault();
                processBulkImportBtn.click();
            }
        });
        processBulkImportBtn?.addEventListener('click', () => {
            document.getElementById('bulk-data-input').removeEventListener('keydown', handleTextareaTab); // Gỡ sự kiện
            processAndPreviewBulkData();
        });
        cancelBulkImportPreviewBtn?.addEventListener('click', () => {
            bulkImportPreviewModal.style.display = 'none';
            // Mở lại modal nhập liệu để người dùng có thể sửa lỗi.
            bulkImportModal.style.display = 'flex';
            document.getElementById('bulk-data-input').addEventListener('keydown', handleTextareaTab); // Gắn lại sự kiện cho textarea
        });
        // Thêm sự kiện Enter để xác nhận nhập
        bulkImportPreviewModal?.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                cancelBulkImportPreviewBtn.click();
            }
            if (e.key === 'Enter') confirmBulkImportBtn.click();
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
            // --- Xử lý cho nút "Thêm danh mục mới" trong danh sách ---
            if (target.closest('.add-single-category-btn')) {
                openCategoryModal(false); // Mở modal thêm danh mục
                hideActionButtonsRow(); // Ẩn hàng chứa nút sau khi click
                return;
            }

            // --- Xử lý cho các hàng dữ liệu thông thường ---
            const id = row.dataset.id;
            const type = row.dataset.type;
            const itemData = allItemsCache.find(item => item.id === id);

            // Ưu tiên xử lý các nút hành động trước
            if (target.closest('.delete-item-btn')) {
                handleDelete(id, type);
            } else if (target.closest('.edit-item-btn')) {
                // Sửa lỗi: Thêm lại handler cho nút sửa của danh mục
                openItemModal(type, true, itemData);
            } 
            // Xử lý click vào ô có thể sửa
            else if (target.closest('.qr-code-btn')) {
                openQrCodeModal(itemData);
            }
             else if (target.closest('td[data-field]')) {
                const clickedCell = target.closest('td[data-field]');
                const focusFieldId = clickedCell.dataset.field;
                openItemModal(type, true, itemData, focusFieldId);
            }
            // Xử lý click vào tên danh mục để mở rộng/thu gọn
            else if (type === 'category' && target.closest('.col-name')) {
                // --- SỬA LỖI: Cập nhật lại trạng thái khi chọn một danh mục ---
                // 1. Cập nhật ID của danh mục đang được chọn
                // selectedNodeId = id; // Đã được gán ở đầu hàm renderList

                // 4. Logic thu/phóng cây thư mục (giữ nguyên)
                const icon = row.querySelector('.col-name .fas');
                if (expandedCategories.has(id)) {
                    // Nếu đang mở, đóng nó lại
                    expandedCategories.delete(id);
                    if (icon) icon.className = 'fas fa-folder';
                    // Yêu cầu mới: gán danh mục cha là danh mục hiện tại
                    const parentIdToRender = itemData.parentId || null; // Nếu không có parentId, quay về gốc (null)
                    renderList(parentIdToRender);
                    return; // Dừng hàm ở đây để không chạy renderList(id) ở cuối
                } else { // Mở rộng
                    // Logic mới: Đóng tất cả các danh mục đồng cấp trước khi mở danh mục hiện tại.
                    const itemToExpand = allItemsCache.find(item => item.id === id);
                    if (itemToExpand) {
                        // Lấy parentId của mục đang được mở
                        const parentIdOfItem = itemToExpand.parentId;

                        // Tìm tất cả các mục đồng cấp (cùng parentId)
                        const siblings = allItemsCache.filter(item => item.parentId === parentIdOfItem && item.type === 'category');

                        // Đóng tất cả các mục đồng cấp bằng cách xóa chúng khỏi Set
                        siblings.forEach(sibling => {
                            expandedCategories.delete(sibling.id);
                        });
                    }
                    expandedCategories.add(id);
                    if (icon) icon.className = 'fas fa-folder-open';
                }
                renderList(id); // Vẽ lại toàn bộ cây với trạng thái mới
            }
        });

        // QR Code Print Button
        printQrBtn?.addEventListener('click', printQrCode);
        downloadQrBtn?.addEventListener('click', downloadQrCode);
        viewInfoQrBtn?.addEventListener('click', viewDeviceInfo);

        // Global listener for Escape key to close modals
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (categoryModal.style.display === 'flex') cancelCategoryBtn.click();
                else if (deviceModal.style.display === 'flex') cancelDeviceBtn.click();
                else if (confirmDeleteModal.style.display === 'flex') cancelDeleteBtn.click();
                else if (bulkImportModal.style.display === 'flex') cancelBulkImportBtn.click();
                else if (bulkImportPreviewModal.style.display === 'flex') cancelBulkImportPreviewBtn.click();                
                else if (inventoryPreviewModal.style.display === 'flex') inventoryPreviewModal.style.display = 'none';
                else if (qrCodeModal.style.display === 'flex') qrCodeModal.style.display = 'none';
            }
        });

    };

    // --- Khởi chạy ---
    initializePage();
});