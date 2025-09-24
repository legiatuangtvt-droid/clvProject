document.addEventListener('DOMContentLoaded', () => {
    const navLinks = document.querySelectorAll('.nav-link');
    // Lấy tên file của trang hiện tại, ví dụ: "manager-synthetic.html"
    const currentPage = window.location.pathname.split('/').pop();

    navLinks.forEach(link => {
        link.classList.remove('active');

        // Lấy tên file từ thuộc tính href của link
        const linkPage = new URL(link.href).pathname.split('/').pop();

        // So sánh tên file của link với tên file của trang hiện tại
        if (currentPage === linkPage) {
            link.classList.add('active');
        }
    });
});