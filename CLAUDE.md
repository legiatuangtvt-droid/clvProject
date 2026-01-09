# CLAUDE.md - Ghi chú phiên làm việc

## Quy tắc làm việc

### Bắt đầu phiên làm việc
- Luôn check branch hiện tại: `git branch`
- Fetch và sync với remote: `git fetch origin` và `git pull origin <branch>`
- Đảm bảo đồng bộ với remote trước khi bắt đầu code

### Trong phiên làm việc
- Luôn commit & push mỗi khi có thay đổi code:
  - `git add .`
  - `git commit -m "message"`
  - `git push origin <branch>`

### Deploy
- Nhắc nhở deploy lên Firebase khi có screen/feature hoàn thiện
- Các lệnh deploy:
  - `firebase deploy` - Deploy tất cả (hosting, functions, firestore, storage)
  - `firebase deploy --only hosting` - Chỉ deploy hosting
  - `firebase deploy --only functions` - Chỉ deploy functions
  - `firebase deploy --only firestore` - Deploy rules và indexes
  - `firebase deploy --only firestore:indexes` - Chỉ deploy indexes
  - Script: `deploy_clv.bat`

## Cấu hình dự án Firebase

Dự án hoàn toàn sử dụng các dịch vụ của Firebase với project ID: `thptclvqt`

### Các dịch vụ Firebase đã sử dụng:

1. **Firebase Hosting**
   - Cấu hình trong `firebase.json`
   - Public folder: `public/`
   - Rewrites cho SPA routing (device-info, index.html)

2. **Firebase Authentication (Auth)**
   - **Tính năng chính:**
     - Đăng nhập/đăng xuất: `signInWithEmailAndPassword()`, `signOut()`
     - Theo dõi trạng thái: `onAuthStateChanged()`
     - Quản lý mật khẩu: `sendPasswordResetEmail()`, `updatePassword()`, `reauthenticateWithCredential()`
     - Quản lý profile: `updateProfile()`
     - Persistence: `setPersistence()` (Local/Session)
     - Custom tokens cho impersonation: `signInWithCustomToken()`
   - **Files chính sử dụng:**
     - `main.js`: Đăng nhập chính, redirect theo role
     - `auth-guard.js`: Bảo vệ trang, quản lý profile, đổi mật khẩu
     - `impersonate.js`: Giả danh người dùng (Manager)
     - `teacher-register.js`: Xác thực giáo viên

3. **Cloud Firestore**
   - **Collections chính:**
     - `users`: Thông tin user (uid, name, rule, email)
     - `teachers`: Chi tiết giáo viên (teacher_name, group_id, status)
     - `labs`: Bài thực hành (schoolYear, subject, name, order)
     - `devices`: Thiết bị/công cụ (name, category, subject)
     - `registrations`: Đăng ký bài học (teacherId, date, period, labId, status)
     - `groups`: Nhóm/lớp học (schoolYear, name, status)
     - `schoolYears`: Năm học
     - `subjects`: Môn học
     - `syllabuses`: Giáo trình
     - `teachingMethods`: Phương pháp giảng dạy
     - `timePlans`: Kế hoạch thời gian (weeks, holidays)
   - **Sử dụng rộng rãi trong 21 files:**
     - Manager: main, setting, device, report, synthetic, labs, syllabus, nav
     - Supervisory: main, report, synthetic, nav
     - Teacher: main, register, tracking, nav
     - Common: auth-guard, device-info, main, toast

4. **Firebase Storage**
   - **Tính năng:**
     - Upload file: `uploadBytes()`
     - Tạo reference: `ref()`
     - Xóa file: `deleteObject()`
     - Lấy URL: `getDownloadURL()`
   - **Chức năng chính:**
     - Upload hướng dẫn sử dụng thiết bị
     - Quản lý file tài liệu
     - Tạo mã QR cho thiết bị
   - **File chính:** `manager-device.js`
   - **Sử dụng trong 13 files** (manager/supervisory/teacher modules)

5. **Cloud Functions**
   - **Hàm 1: impersonateUser** (onCall với CORS)
     - Input: `{ uid: string }`
     - Output: `{ token: string }`
     - Chức năng: Manager giả danh user khác
     - Bảo mật: Kiểm tra quyền Manager trong Firestore (2 lớp)
     - Tạo custom token với claim: `{ impersonatedBy: callerUid }`
   - **Hàm 2: revertImpersonation** (onCall với CORS)
     - Output: `{ token: string }`
     - Chức năng: Thoát chế độ giả danh
     - Kiểm tra claim 'impersonatedBy' trước khi tạo lại token Manager
   - **File backend:** `functions/index.js`
   - **File gọi:** `impersonate.js` (sử dụng httpsCallable)

6. **Firebase Analytics**
   - Có measurementId: `G-E3H9L4FW4D` trong config
   - Chưa thấy sử dụng rõ ràng trong code

### Cấu trúc dự án
- Frontend: HTML/CSS/JS trong `public/`
- Backend: Cloud Functions trong `functions/`
- Config Firebase (đã được khởi tạo đầy đủ trên local):
  - `firebase.json` - Cấu hình chính cho tất cả services
  - `firebase-config.js` - Client-side Firebase config
  - `firestore.rules` - Security rules cho Firestore
  - `firestore.indexes.json` - 19 composite indexes (đã sync với server)
  - `storage.rules` - Security rules cho Storage

### Tính năng chính theo module

1. **Manager Module**
   - Dashboard: `manager-main.js`
   - Quản lý thiết bị: `manager-device.js` (có upload Storage + QR code)
   - Cài đặt hệ thống: `manager-setting.js` (file lớn nhất)
   - Báo cáo: `manager-report.js` (Tổng = CNTT + TBDH + TH)
   - Quản lý bài thực hành: `manager-labs.js`
   - Quản lý giáo trình: `manager-syllabus.js`
   - Tổng hợp dữ liệu: `manager-synthetic.js`
   - **Theo dõi & Tổng hợp: `manager-tracking.js` (MỚI)**
     - Bộ lọc đa cấp: Tổ / Giáo viên / Môn học / Thời gian
     - Hiển thị báo cáo tổng quan hoặc chi tiết
     - Biểu đồ doughnut visualize PPDH
     - Tự động loại trừ ngày nghỉ lễ
   - Giả danh người dùng: `impersonate.js`

2. **Supervisory Module**
   - Dashboard: `supervisory-main.js`
   - Báo cáo: `supervisory-report.js`
   - Tổng hợp dữ liệu: `supervisory-synthetic.js`

3. **Teacher Module**
   - Dashboard: `teacher-main.js`
   - Đăng ký bài học: `teacher-register.js`
   - Theo dõi hoạt động: `teacher-tracking.js`

4. **Common/Shared**
   - Xác thực & bảo vệ: `auth-guard.js`, `main.js`
   - Thông tin thiết bị: `device-info.js`
   - Navigation: `*-nav.js`
   - Utils: `utils.js`, `toast.js`

### Lưu ý bảo mật
- Sử dụng Firebase Rules cho Firestore và Storage
- Files rules (đã được version control):
  - `firestore.rules` (copy từ `rules.txt`)
  - `storage.rules` (copy từ `rules_storage.txt`)
- Cloud Functions có kiểm tra quyền Manager (2 lớp bảo mật)
- Custom claims để theo dõi giả danh
- SessionStorage cho trạng thái giả danh (không dùng localStorage)

### Firestore Indexes
- File: `firestore.indexes.json` (19 composite indexes)
- Đã sync với Firebase server
- Hỗ trợ query phức tạp cho tất cả modules
- Collections có indexes: devices, groups, labs, registrations, subjects, teachers, teachingMethods
- Deploy indexes: `firebase deploy --only firestore:indexes`

### Công cụ
- Linter: `linter.js`, script `run-linter.bat`
- Deploy: `deploy_clv.bat`

### Files quan trọng cần lưu ý
- `manager-setting.js`: File lớn nhất, chứa nhiều logic cài đặt
- `manager-device.js`: Xử lý Storage, upload file, tạo QR code
- `manager-report.js`: Báo cáo với công thức Tổng = CNTT + TBDH + TH
- `manager-tracking.js`: Theo dõi chi tiết với bộ lọc đa cấp (MỚI)
- `impersonate.js`: Tính năng giả danh độc đáo
- `auth-guard.js`: Bảo vệ tất cả các trang, kiểm tra quyền
- `functions/index.js`: Backend logic cho impersonation

## Lịch sử cập nhật quan trọng

### 2026-01-08
1. **Tạo screen manager-tracking**
   - Bộ lọc: Tổ chuyên môn / Giáo viên / Môn học / Thời gian
   - Hiển thị: Báo cáo tổng quan + Chi tiết theo giáo viên
   - Biểu đồ: Chart.js với doughnut chart
   - Tự động loại trừ ngày nghỉ lễ

2. **Sửa phương pháp tính Tổng trong manager-report**
   - Trước: Tổng = Số lượt đăng ký
   - Sau: Tổng = CNTT + TBDH + TH
   - Label: "Tổng (lượt)"

3. **Khởi tạo Firebase config đầy đủ trên local**
   - Export indexes từ Firebase: 19 composite indexes
   - Tạo `firestore.rules` và `storage.rules`
   - Cập nhật `firebase.json` với cấu hình đầy đủ
   - Deploy test thành công

4. **Cập nhật .gitignore**
   - Thêm `.claude/` (Claude Code config)
   - Thêm `nul` (temp files)

### 2026-01-10
1. **Fix: Lỗi đọc field order = 0 trong teacher permission check**
   - **Vấn đề:** Tổ trưởng (order = 0) không thể truy cập trang teacher-report
   - **Nguyên nhân:** Code `teacherData.order || 999` đánh giá `0` là falsy → trả về `999`
   - **Giải pháp:** Đổi thành `teacherData.order !== undefined ? teacherData.order : 999`
   - **Files:** teacher-report.js:129, teacher-nav.js:58
   - **Bài học:** Luôn cẩn thận với falsy values (0, false, '', null, undefined) khi dùng `||` operator
   - **Deploy:** firebase deploy --only hosting (thành công)