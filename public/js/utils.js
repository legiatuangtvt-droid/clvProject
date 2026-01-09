/**
 * Định dạng chuỗi ngày 'YYYY-MM-DD' thành 'DD/MM/YYYY'.
 * @param {string} dateString - Chuỗi ngày đầu vào.
 * @returns {string} Chuỗi ngày đã định dạng hoặc chuỗi rỗng nếu đầu vào không hợp lệ.
 */
export const formatDate = (dateString) => {
    if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        return dateString; // Trả về chuỗi gốc nếu không đúng định dạng yyyy-mm-dd
    }
    const [year, month, day] = dateString.split('-');
    return `${day}/${month}/${year}`;
};

/**
 * Lấy đệ quy danh sách các thiết bị con từ một danh mục cha.
 * @param {string} parentId - ID của danh mục cha.
 * @param {Array} allDeviceItemsCache - Mảng chứa tất cả các mục (danh mục và thiết bị).
 * @returns {Array} Mảng các thiết bị con.
 */
export const getDevicesRecursive = (parentId, allDeviceItemsCache) => {
    let devices = [];
    const children = allDeviceItemsCache.filter(item => item.parentId === parentId);
    children.forEach(child => {
        if (child.type === 'device') {
            devices.push(child);
        } else if (child.type === 'category') {
            devices = devices.concat(getDevicesRecursive(child.id, allDeviceItemsCache));
        }
    });
    return devices.sort((a, b) => String(a.order || '').localeCompare(String(b.order || ''), undefined, { numeric: true, sensitivity: 'base' }));
};

/**
 * Kiểm tra xem giáo viên có quyền xem báo cáo không.
 * Quyền xem báo cáo:
 * - Tổ trưởng (order = 0): Có quyền
 * - Tổ phó (order = 1) của tổ ghép (tên có " - "): Có quyền
 * - Tổ phó (order = 1) của tổ đơn (tên không có " - "): KHÔNG có quyền
 * - Các giáo viên khác: KHÔNG có quyền
 *
 * @param {number} teacherOrder - Thứ tự của giáo viên trong tổ (0 = tổ trưởng, 1 = tổ phó, ...)
 * @param {string} groupName - Tên tổ chuyên môn
 * @returns {boolean} True nếu có quyền xem báo cáo, false nếu không
 */
export const canViewReport = (teacherOrder, groupName) => {
    // Tổ trưởng (order = 0) luôn có quyền
    if (teacherOrder === 0) {
        return true;
    }

    // Tổ phó (order = 1)
    if (teacherOrder === 1) {
        // Kiểm tra xem có phải tổ ghép không (tên chứa " - ")
        const isMultiSubjectGroup = groupName && groupName.includes(' - ');
        return isMultiSubjectGroup; // Chỉ tổ phó của tổ ghép mới có quyền
    }

    // Các giáo viên khác không có quyền
    return false;
};