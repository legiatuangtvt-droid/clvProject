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
});