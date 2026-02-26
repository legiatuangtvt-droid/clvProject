# CLAUDE.md

## Project Overview

Dự án quản lý thiết bị dạy học THPT, sử dụng Firebase (project ID: `thptclvqt`).

- **Frontend:** Vanilla HTML/CSS/JS trong `public/`
- **Backend:** Cloud Functions (Node.js) trong `functions/`
- **Services:** Hosting, Auth, Firestore, Storage, Cloud Functions
- **Modules:** Manager, Supervisory, Teacher

## Workflow (mỗi nhánh fix/feature/screen)

1. `/plan Loại: [feature/fix] | Mô tả: [yêu cầu]`
2. Review plan → user chốt plan
3. `/spec` → Tạo/cập nhật spec từ plan (HỎI user trước khi edit spec)
4. `/impl` → Implement code theo plan (plan là source of truth)
5. Test local → fix bug/error nếu có
6. (Tùy chọn) `/deploy` → Deploy lên production
7. (Tùy chọn) Test production → fix bug/error nếu có
8. `/changelog` → Update CHANGELOG
9. `/merge` → Merge vào main → tạo tag → push tổng

## Sau mỗi lệnh/task xong

- `/done` → `git status` → có changes → đề xuất 1 commit message. User tự commit.

## Commit Format

- Format: `<type>(<scope>): <mô tả ngắn>`
- Types: feat | fix | refactor | docs | style | chore
- Scopes: frontend | backend | db | api | docs

## Deploy (Firebase)

- `firebase deploy` — Deploy tất cả
- `firebase deploy --only hosting` — Chỉ hosting
- `firebase deploy --only functions` — Chỉ functions
- `firebase deploy --only firestore` — Rules + indexes
- `firebase deploy --only firestore:indexes` — Chỉ indexes
- Script: `deploy_clv.bat`

## Công cụ

- Linter: `linter.js`, script `run-linter.bat`
