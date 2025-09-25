import {
    collection,
    getDocs,
    query,
    orderBy,
    where,
    limit,
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { auth, firestore } from "./firebase-config.js";
import { showToast } from "./toast.js";

document.addEventListener('DOMContentLoaded', () => {
    if (!document.querySelector('.report-container')) return;

    const filterTypeSelect = document.getElementById('time-filter-type');
    const filterValueSelect = document.getElementById('time-filter-value');
    const viewReportBtn = document.querySelector('.view-report-btn');
    const reportContainer = document.querySelector('.report-container');

    let currentSchoolYear = null;
    let timePlan = [];
    let pieChartInstance = null; // Biến để lưu trữ biểu đồ, giúp hủy khi vẽ lại

    const initializePage = async () => {
        try {
            // 1. Lấy năm học mới nhất
            const yearsQuery = query(collection(firestore, 'schoolYears'), orderBy('schoolYear', 'desc'), limit(1));
            const yearsSnapshot = await getDocs(yearsQuery);
            if (yearsSnapshot.empty) {
                reportContainer.innerHTML = '<p>Chưa có dữ liệu năm học.</p>';
                return;
            }
            currentSchoolYear = yearsSnapshot.docs[0].data().schoolYear;

            // 2. Tải kế hoạch thời gian (các tuần)
            await loadTimePlan();

            // 3. Tìm tuần hiện tại
            const today = new Date().toISOString().split('T')[0];
            let currentWeekNumber = null;
            for (const week of [...timePlan].reverse()) { // Tìm từ cuối để lấy tuần gần nhất
                if (week.startDate <= today) {
                    currentWeekNumber = week.weekNumber;
                    break;
                }
            }

            // 4. Thiết lập bộ lọc mặc định là tuần hiện tại
            filterTypeSelect.value = 'week';
            updateFilterValueOptions();
            if (currentWeekNumber) {
                filterValueSelect.value = currentWeekNumber;
            }

            // 5. Tự động hiển thị báo cáo cho lựa chọn mặc định (tuần hiện tại)
            await generateReport();

        } catch (error) {
            console.error("Lỗi khởi tạo trang:", error);
            reportContainer.innerHTML = '<p class="error-message">Không thể tải dữ liệu trang.</p>';
        }
    };

    const loadTimePlan = async () => {
        const planQuery = query(collection(firestore, 'timePlans'), where("schoolYear", "==", currentSchoolYear));
        const planSnapshot = await getDocs(planQuery);
        if (planSnapshot.empty) return;

        const planDocId = planSnapshot.docs[0].id;
        const weeksQuery = query(collection(firestore, 'timePlans', planDocId, 'weeks'), orderBy('weekNumber'));
        const weeksSnapshot = await getDocs(weeksQuery);

        weeksSnapshot.forEach(doc => {
            timePlan.push({ id: doc.id, ...doc.data() });
        });
    };

    const updateFilterValueOptions = () => {
        const filterType = filterTypeSelect.value;
        filterValueSelect.innerHTML = '';

        switch (filterType) {
            case 'week':
                timePlan.forEach(week => {
                    const option = document.createElement('option');
                    option.value = week.weekNumber;
                    option.textContent = `Tuần ${week.weekNumber}`;
                    filterValueSelect.appendChild(option);
                });
                break;
            case 'month':
                const months = [...new Set(timePlan.map(week => week.startDate.substring(0, 7)))];
                months.forEach(monthStr => {
                    const [year, month] = monthStr.split('-');
                    const option = document.createElement('option');
                    option.value = monthStr;
                    option.textContent = `Tháng ${month}/${year}`;
                    filterValueSelect.appendChild(option);
                });
                break;
            case 'semester':
                filterValueSelect.innerHTML = `
                    <option value="1">Học kỳ I</option>
                    <option value="2">Học kỳ II</option>
                `;
                break;
            case 'year':
                const option = document.createElement('option');
                option.value = currentSchoolYear;
                option.textContent = `Năm học ${currentSchoolYear}`;
                filterValueSelect.appendChild(option);
                break;
        }
    };

    const generateReport = async () => {
        const user = auth.currentUser;
        if (!user) {
            showToast('Không thể xác thực người dùng.', 'error');
            return;
        }

        const filterType = filterTypeSelect.value;
        const filterValue = filterValueSelect.value;
        let startDate, endDate;

        if (timePlan.length === 0) {
            showToast('Chưa có kế hoạch thời gian cho năm học này.', 'error');
            return;
        }

        // Xác định khoảng thời gian
        switch (filterType) {
            case 'week':
                const weekData = timePlan.find(w => w.weekNumber == filterValue);
                startDate = weekData.startDate;
                endDate = weekData.endDate;
                break;
            case 'month':
                const [year, month] = filterValue.split('-');
                startDate = `${filterValue}-01`;
                endDate = new Date(year, month, 0).toISOString().split('T')[0];
                break;
            case 'semester':
                if (filterValue === '1') { // Học kỳ I (tuần 1-19)
                    startDate = timePlan[0].startDate;
                    endDate = timePlan[18] ? timePlan[18].endDate : timePlan[timePlan.length - 1].endDate;
                } else { // Học kỳ II (tuần 20-37)
                    startDate = timePlan[19] ? timePlan[19].startDate : timePlan[timePlan.length - 1].startDate;
                    endDate = timePlan[timePlan.length - 1].endDate;
                }
                break;
            case 'year':
                startDate = timePlan[0].startDate;
                endDate = timePlan[timePlan.length - 1].endDate;
                break;
        }

        reportContainer.innerHTML = '<p>Đang tổng hợp dữ liệu...</p>';

        try {
            // 1. Lấy danh sách TẤT CẢ các PPDH của năm học để làm mẫu báo cáo
            const methodCounts = {};
            const methodsQuery = query(collection(firestore, 'teachingMethods'), where("schoolYear", "==", currentSchoolYear));
            const methodsSnapshot = await getDocs(methodsQuery);
            methodsSnapshot.forEach(doc => {
                methodCounts[doc.data().method] = 0; // Khởi tạo tất cả PPDH với 0 tiết
            });

            // 2. Lấy tất cả các đăng ký của giáo viên trong khoảng thời gian đã chọn
            const regsQuery = query(
                collection(firestore, 'registrations'),
                where('teacherId', '==', user.uid),
                where('date', '>=', startDate),
                where('date', '<=', endDate)
            );
            const snapshot = await getDocs(regsQuery);

            // 3. Nếu có đăng ký, cập nhật số đếm vào mẫu báo cáo đã tạo
            if (!snapshot.empty) {
                snapshot.forEach(doc => {
                    const data = doc.data();
                    if (data.teachingMethod && Array.isArray(data.teachingMethod)) {
                        data.teachingMethod.forEach(method => {
                            // Chỉ tăng số đếm cho các PPDH có trong danh sách của năm học
                            if (methodCounts.hasOwnProperty(method)) {
                                methodCounts[method]++;
                            }
                        });
                    };
                });
            }

            renderReport(methodCounts);

        } catch (error) {
            console.error("Lỗi khi tạo báo cáo:", error);
            reportContainer.innerHTML = '<p class="error-message">Đã có lỗi xảy ra khi tạo báo cáo.</p>';
            if (error.code === 'failed-precondition') {
                showToast('Lỗi cấu hình: Cần tạo chỉ mục trong Firestore. Kiểm tra console (F12) để xem chi tiết.', 'error', 5000);
            }
        }
    };

    const renderReport = (methodCounts) => {
        // Sắp xếp PPDH theo tên
        const sortedMethods = Object.keys(methodCounts).sort();

        if (sortedMethods.length === 0) {
            reportContainer.innerHTML = '<p>Chưa có phương pháp dạy học nào được cấu hình cho năm học này.</p>';
            return;
        }

        let tableHTML = `
            <table class="report-table">
                <thead>
                    <tr>
                        <th>STT</th>
                        <th>Phương pháp dạy học</th>
                        <th>Số tiết đã đăng ký</th>
                        <th>Tỷ lệ %</th>
                    </tr>
                </thead>
                <tbody>
        `;

        let totalUsages = 0;
        sortedMethods.forEach((method, index) => {
            const count = methodCounts[method];
            totalUsages += count;
        });

        sortedMethods.forEach((method, index) => {
            const count = methodCounts[method];
            // Tính tỷ lệ, nếu tổng số lần sử dụng là 0 thì tỷ lệ là 0
            const percentage = totalUsages > 0 ? ((count / totalUsages) * 100).toFixed(1) : 0;

            tableHTML += `
                <tr>
                    <td>${index + 1}</td>
                    <td>${method}</td>
                    <td>${count}</td>
                    <td>${percentage}%</td>
                </tr>
            `;
        });

        tableHTML += `
                <tr class="total-row">
                    <td colspan="2">Tổng cộng</td>
                    <td>${totalUsages}</td>
                    <td>100%</td>
                </tr>
            </tbody>
            </table>
        `;

        // Tạo layout chứa bảng và biểu đồ
        reportContainer.innerHTML = `
            <div class="report-layout">
                <div class="report-table-container">
                    ${tableHTML}
                </div>
                <div class="report-chart-container">
                    <canvas id="methods-pie-chart"></canvas>
                </div>
            </div>
        `;

        // Vẽ biểu đồ
        renderPieChart(methodCounts, sortedMethods);
    };

    const renderPieChart = (methodCounts, sortedMethods) => {
        const ctx = document.getElementById('methods-pie-chart').getContext('2d');
        if (pieChartInstance) {
            pieChartInstance.destroy();
        }

        // Đăng ký plugin datalabels
        Chart.register(ChartDataLabels);

        const labels = sortedMethods;
        const data = sortedMethods.map(method => methodCounts[method]);

        // Bảng màu đẹp và hài hòa hơn
        const professionalColors = [
            '#3498db', '#2ecc71', '#e74c3c', '#f1c40f', '#9b59b6',
            '#34495e', '#1abc9c', '#e67e22', '#ecf0f1', '#7f8c8d'
        ];
        const backgroundColors = labels.map((_, index) => professionalColors[index % professionalColors.length]);

        pieChartInstance = new Chart(ctx, {
            type: 'doughnut', // Chuyển sang biểu đồ Doughnut hiện đại hơn
            data: {
                labels: labels,
                datasets: [{
                    label: 'Số tiết đã đăng ký',
                    data: data,
                    backgroundColor: backgroundColors,
                    borderColor: '#fff', // Thêm viền trắng để tách các phần
                    borderWidth: 3,
                    hoverOffset: 15 // Hiệu ứng "nổi" lên khi hover
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom', // Chuyển chú giải xuống dưới
                        labels: {
                            padding: 20,
                            boxWidth: 15,
                            font: { size: 12 }
                        }
                    },
                    title: {
                        display: true,
                        text: 'Tỷ lệ sử dụng Phương pháp dạy học',
                        font: { size: 16, weight: 'bold' },
                        padding: { top: 10, bottom: 20 }
                    },
                    // Cấu hình plugin datalabels để hiển thị %
                    datalabels: {
                        formatter: (value, ctx) => {
                            const sum = ctx.chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
                            const percentage = (value * 100 / sum).toFixed(1) + '%';
                            // Chỉ hiển thị % nếu giá trị > 0
                            return sum > 0 && value > 0 ? percentage : '';
                        },
                        color: '#fff',
                        font: { weight: 'bold', size: 12 }
                    }
                }
            }
        });
    };

    // --- Event Listeners ---
    filterTypeSelect.addEventListener('change', updateFilterValueOptions);
    viewReportBtn.addEventListener('click', generateReport);

    // --- Khởi chạy ---
    initializePage();
});