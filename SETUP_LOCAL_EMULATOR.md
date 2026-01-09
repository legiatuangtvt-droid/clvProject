# Hướng dẫn sử dụng Functions Emulator trên Local

## Vấn đề hiện tại
Khi chạy `firebase serve` trên local (localhost:5000), tính năng giả danh (impersonation) vẫn gọi Cloud Functions về **production** thay vì local emulator.

## Giải pháp

### Option 1: Tiếp tục sử dụng Production Functions (ĐỀ XUẤT)
**Ưu điểm:**
- Không cần cấu hình thêm
- Functions đã deploy hoạt động tốt trên production
- Đơn giản, không cần chạy emulator

**Nhược điểm:**
- Khi test trên local, functions calls vẫn tính vào quota của Firebase
- Không test được offline hoàn toàn

**Cách sử dụng:**
```bash
# Chỉ cần chạy hosting
firebase serve --only hosting
# hoặc
npm start
```

---

### Option 2: Sử dụng Functions Emulator (Cho dev nâng cao)
**Ưu điểm:**
- Test hoàn toàn offline
- Không tính vào quota Firebase
- Debug dễ dàng hơn

**Nhược điểm:**
- Phức tạp hơn
- Cần cài đặt Java Runtime Environment (JRE)
- Cần chạy nhiều terminal

**Các bước thực hiện:**

#### Bước 1: Cài đặt dependencies
```bash
cd functions
npm install
```

#### Bước 2: Sửa file `firebase-config.js`
Mở file `public/js/firebase-config.js` và **bỏ comment** các dòng sau:

```javascript
// Thay đổi từ:
// import { connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-functions.js";
// connectFunctionsEmulator(functions, "localhost", 5001);

// Thành:
import { connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-functions.js";
connectFunctionsEmulator(functions, "localhost", 5001);
```

**LƯU Ý:** Bạn cần đưa dòng import ra ngoài khối if để tránh lỗi ES6 module.

Sửa lại như sau:
```javascript
import { getFunctions, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-functions.js";

export const functions = getFunctions(app);

// Cấu hình cho môi trường local
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    console.log('🔧 Running in LOCAL mode - connecting to Functions emulator');
    connectFunctionsEmulator(functions, "localhost", 5001);
}
```

#### Bước 3: Chạy Emulator
Mở **2 terminal riêng biệt**:

**Terminal 1 - Chạy Emulator (Functions + Firestore):**
```bash
firebase emulators:start
```

**Terminal 2 - Chạy Hosting:**
```bash
firebase serve --only hosting
```

Hoặc chạy tất cả cùng lúc:
```bash
firebase emulators:start --only functions,firestore,hosting
```

#### Bước 4: Truy cập
- Hosting: http://localhost:5000
- Emulator UI: http://localhost:4000
- Functions: http://localhost:5001

---

## Khuyến nghị

**Cho môi trường Development:**
- Sử dụng **Option 1** (Production Functions) để đơn giản
- Web đã public hoạt động tốt, không cần emulator

**Cho môi trường Test nâng cao:**
- Sử dụng **Option 2** nếu muốn test offline hoàn toàn
- Hữu ích khi phát triển tính năng mới cho Functions

---

## Lưu ý quan trọng

1. **Không commit file firebase-config.js với emulator enabled** lên production
2. Khi deploy, đảm bảo đã comment lại dòng `connectFunctionsEmulator`
3. Emulator chỉ dùng cho development, không bao giờ dùng cho production
