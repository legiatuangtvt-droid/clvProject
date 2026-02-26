# Changelog

## [v1.1.0] - 2026-02-26

### Added
- Chế độ rút gọn biên bản kiểm kê (toggle "Bản đầy đủ / Bản rút gọn")
  - Bản rút gọn chỉ giữ dòng đầu tiên của tên thiết bị, ẩn mô tả chi tiết
  - Giảm đáng kể số trang file Word khi in đi kiểm kê thực tế
  - Chuyển đổi giữa 2 chế độ không mất dữ liệu đã nhập
  - Export Word tự động theo chế độ đang chọn

### Fixed
- Tối ưu Firestore reads: cập nhật cache local thay vì reload toàn bộ khi xóa

### Deployment Info
- **Branch**: `feature/v1.1.0-inventory-compact-mode`
- **Commit**: `52ec915`
- **Deployed**: Firebase Hosting (thptclvqt)

## [v1.0.0] - 2026-02-26

### Added
- Xuất biên bản kiểm kê thiết bị dạy học ra file Word (.doc)
  - Preview trước khi xuất, đảm bảo khớp 100% với file Word
  - Editable fields (năm học, thời gian, địa điểm, thành phần kiểm kê) với localStorage persistence
  - Nút "Điền mẫu" và "Xóa tất cả" cho dữ liệu mẫu
  - STT theo đúng Thông tư 39/2021/TT-BGDĐT (A/B → I/II → 1/2 → 1.1/1.2)
  - Inline edit cột Tổng số và Hỏng, lưu trực tiếp vào Firestore
  - Validation: số hỏng không vượt quá tổng số
  - Bàn phím số (inputmode numeric) và auto-select trên mobile
  - Sắp xếp môn học theo thứ tự quy định, normalize tên tiếng Việt (ý/í)
- Responsive mobile cho trang quản lý thiết bị
  - Toolbar buttons xếp dọc full-width
  - Bảng thiết bị scroll ngang
  - Modal preview full-screen với dvh viewport
  - Thu gọn mô tả thiết bị dài (nhấn để mở rộng)
  - Grid 2x2 cho buttons footer

### Deployment Info
- **Branch**: `feature/v1.0.0-device-word-export`
- **Commit**: `d7381ff`
- **Deployed**: Firebase Hosting (thptclvqt)
