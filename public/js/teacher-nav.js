import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { auth, firestore } from "./firebase-config.js";
import { canViewReport } from "./utils.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

document.addEventListener('DOMContentLoaded', () => {
    const navLinks = document.querySelectorAll('.nav-link');
    const currentPath = window.location.pathname;

    navLinks.forEach(link => {
        const linkPath = new URL(link.href).pathname;
        link.classList.remove('active');

        // So sánh đường dẫn của link với đường dẫn của trang hiện tại
        // teacher.html được coi là trang chính
        if (currentPath === linkPath || (currentPath.endsWith('/') && linkPath.endsWith('/teacher.html'))) {
            link.classList.add('active');
        }
    });

    // Kiểm tra quyền xem báo cáo và ẩn/hiện menu
    checkReportPermission();
});

async function checkReportPermission() {
    const reportLinks = document.querySelectorAll('a[href="teacher-report.html"]');
    if (reportLinks.length === 0) return; // Không có menu báo cáo

    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            // Nếu chưa đăng nhập, ẩn menu báo cáo
            reportLinks.forEach(link => {
                const listItem = link.parentElement;
                if (listItem && listItem.tagName === 'LI') {
                    listItem.style.display = 'none';
                }
            });
            return;
        }

        try {
            // Load teacher info
            const teacherQuery = query(collection(firestore, 'teachers'), where('uid', '==', user.uid));
            const teacherSnapshot = await getDocs(teacherQuery);

            if (teacherSnapshot.empty) {
                // Không tìm thấy giáo viên, ẩn menu
                reportLinks.forEach(link => {
                    const listItem = link.parentElement;
                    if (listItem && listItem.tagName === 'LI') {
                        listItem.style.display = 'none';
                    }
                });
                return;
            }

            const teacherData = teacherSnapshot.docs[0].data();
            const teacherOrder = teacherData.order !== undefined ? teacherData.order : 999;
            let groupName = '';

            // Load group name
            if (teacherData.group_id) {
                const groupQuery = query(collection(firestore, 'groups'), where('group_id', '==', teacherData.group_id));
                const groupSnapshot = await getDocs(groupQuery);
                if (!groupSnapshot.empty) {
                    groupName = groupSnapshot.docs[0].data().group_name || '';
                }
            }

            // Kiểm tra quyền
            const hasPermission = canViewReport(teacherOrder, groupName);

            // Ẩn/hiện menu dựa trên quyền
            reportLinks.forEach(link => {
                const listItem = link.parentElement;
                if (listItem && listItem.tagName === 'LI') {
                    listItem.style.display = hasPermission ? '' : 'none';
                }
            });

            // Nếu đang ở trang báo cáo mà không có quyền, chuyển về trang chính
            if (!hasPermission && window.location.pathname.includes('teacher-report.html')) {
                window.location.href = 'teacher.html';
            }
        } catch (error) {
            console.error("Lỗi khi kiểm tra quyền xem báo cáo:", error);
            // Nếu có lỗi, ẩn menu để an toàn
            reportLinks.forEach(link => {
                const listItem = link.parentElement;
                if (listItem && listItem.tagName === 'LI') {
                    listItem.style.display = 'none';
                }
            });
        }
    });
}