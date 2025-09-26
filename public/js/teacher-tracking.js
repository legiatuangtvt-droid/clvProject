import {
    collection,
    getDocs,
    getDoc,
    query,
    orderBy,
    where,
    limit,
    doc,
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { auth, firestore } from "./firebase-config.js";
import { showToast } from "./toast.js";

document.addEventListener('DOMContentLoaded', () => {
    if (!document.querySelector('.report-container')) return;

    // Đăng ký plugin ChartDataLabels một lần duy nhất khi script được tải
    Chart.register(ChartDataLabels);

    const filterTypeSelect = document.getElementById('time-filter-type');
    const filterValueSelect = document.getElementById('time-filter-value');
    const viewReportBtn = document.querySelector('.view-report-btn');
    const filterContainer = document.querySelector('.filter-container'); // Container của các bộ lọc
    const reportContainer = document.querySelector('.report-container');

    let currentSchoolYear = null;
    let timePlan = [];
    let currentTeacherInfo = null; // Lưu thông tin GV hiện tại (gồm order, group_id)
    let teachersInGroup = []; // Lưu các giáo viên trong cùng tổ
    let groupMap = new Map(); // Map: group_id -> group data
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

            // Tải thông tin các tổ để kiểm tra quyền hạn
            await loadAllGroups();

            // Lấy thông tin của giáo viên đang đăng nhập
            const user = auth.currentUser;
            if (!user) return;
            await loadCurrentTeacherInfo(user);

            // Kiểm tra quyền hạn hiển thị tab "Tổ chuyên môn"
            let canViewGroupTab = false;
            if (currentTeacherInfo) {
                if (currentTeacherInfo.order === 0) { // Tổ trưởng luôn có quyền
                    canViewGroupTab = true;
                } else if (currentTeacherInfo.order === 1) { // Tổ phó có điều kiện
                    const group = groupMap.get(currentTeacherInfo.group_id);
                    const excludedGroups = ["Vật Lí - CNCN", "Toán", "Tiếng Anh"];
                    // Chỉ có quyền nếu không thuộc các tổ bị loại trừ
                    if (group && !excludedGroups.includes(group.group_name)) {
                        canViewGroupTab = true;
                    }
                }
            }
            if (canViewGroupTab) {
                setupGroupTab(); // Thiết lập giao diện tab
                await loadTeachersInGroup(); // Tải danh sách giáo viên trong tổ
            }

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

    const loadCurrentTeacherInfo = async (user) => {
        const teacherQuery = query(collection(firestore, 'teachers'), where('uid', '==', user.uid), limit(1));
        const teacherSnapshot = await getDocs(teacherQuery);
        if (!teacherSnapshot.empty) {
            currentTeacherInfo = { id: teacherSnapshot.docs[0].id, ...teacherSnapshot.docs[0].data() };
        }
    };

    const loadTeachersInGroup = async () => {
        if (!currentTeacherInfo?.group_id) return;
        const teachersQuery = query(collection(firestore, 'teachers'), where('group_id', '==', currentTeacherInfo.group_id));
        const teachersSnapshot = await getDocs(teachersQuery);
        teachersInGroup = teachersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    };

    const loadAllGroups = async () => {
        if (!currentSchoolYear) return;
        const groupsQuery = query(collection(firestore, 'groups'), where('schoolYear', '==', currentSchoolYear));
        const groupsSnapshot = await getDocs(groupsQuery);
        groupMap.clear();
        groupsSnapshot.forEach(groupDoc => {
            groupMap.set(groupDoc.data().group_id, groupDoc.data());
        });
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

    const setupGroupTab = () => {
        const tabContainer = document.createElement('div');
        tabContainer.className = 'tab-nav';
        tabContainer.innerHTML = `
            <button class="tab-link active" data-tab="personal">Cá nhân</button>
            <button class="tab-link" data-tab="group">Tổ chuyên môn</button>
        `;

        // Chèn tab vào trước bộ lọc
        filterContainer.parentNode.insertBefore(tabContainer, filterContainer);

        tabContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('tab-link')) {
                tabContainer.querySelector('.active').classList.remove('active');
                e.target.classList.add('active');
                generateReport(); // Tải lại báo cáo khi chuyển tab
            }
        });
    };

    const generateReport = async () => {
        const user = auth.currentUser;
        if (!user) {
            showToast('Không thể xác thực người dùng.', 'error');
            return;
        }

        // Xác định tab đang được chọn
        const activeTab = document.querySelector('.tab-link.active')?.dataset.tab || 'personal';
        const isGroupView = activeTab === 'group';

        reportContainer.innerHTML = '<p>Đang tổng hợp dữ liệu...</p>';

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

        try {
            // 1. Lấy danh sách TẤT CẢ các PPDH của năm học để làm mẫu báo cáo
            const allMethodsTemplate = {};
            const methodCounts = {};
            const methodsQuery = query(collection(firestore, 'teachingMethods'), where("schoolYear", "==", currentSchoolYear));
            const methodsSnapshot = await getDocs(methodsQuery);
            methodsSnapshot.forEach(doc => {
                methodCounts[doc.data().method] = 0; // Khởi tạo tất cả PPDH với 0 tiết
            });

            Object.assign(allMethodsTemplate, methodCounts);

            // 2. Tạo query dựa trên tab đang chọn
            let regsQuery;
            let groupData = {}; // Dữ liệu tổng hợp cho từng GV trong tổ

            if (isGroupView && teachersInGroup.length > 0) {
                const teacherUids = teachersInGroup.map(t => t.uid).filter(Boolean);
                // Khởi tạo cấu trúc dữ liệu cho từng giáo viên
                teachersInGroup.forEach(t => {
                    if (t.uid) groupData[t.uid] = { teacherName: t.teacher_name, methodCounts: { ...allMethodsTemplate }, total: 0 };
                });                regsQuery = query(
                    collection(firestore, 'registrations'),
                    where('teacherId', 'in', teacherUids), // Lấy của tất cả GV trong tổ
                    where('date', '>=', startDate),
                    where('date', '<=', endDate)
                );
            } else { // Mặc định hoặc tab cá nhân
                regsQuery = query(
                    collection(firestore, 'registrations'),
                    where('teacherId', '==', user.uid), // Chỉ lấy của GV đang đăng nhập
                    where('date', '>=', startDate),
                    where('date', '<=', endDate)
                );
            }
            const snapshot = await getDocs(regsQuery);

            // 3. Nếu có đăng ký, cập nhật số đếm vào mẫu báo cáo đã tạo
            snapshot.forEach(doc => {
                const data = doc.data();
                if (!data.teachingMethod || !Array.isArray(data.teachingMethod)) return;

                if (isGroupView) {
                    const teacherId = data.teacherId;
                    if (groupData[teacherId]) {
                        data.teachingMethod.forEach(method => {
                            if (groupData[teacherId].methodCounts.hasOwnProperty(method)) {
                                groupData[teacherId].methodCounts[method]++;
                                groupData[teacherId].total++;
                            }
                        });
                    }
                } else { // Chế độ xem cá nhân
                    data.teachingMethod.forEach(method => {
                        if (methodCounts.hasOwnProperty(method)) {
                                methodCounts[method]++;
                            }
                    });
                }
            });

            // 4. Render báo cáo
            if (isGroupView) {
                renderGroupReport(groupData, allMethodsTemplate);
            } else {
                renderPersonalReport(methodCounts);
            }

        } catch (error) {
            console.error("Lỗi khi tạo báo cáo:", error);
            reportContainer.innerHTML = '<p class="error-message">Đã có lỗi xảy ra khi tạo báo cáo.</p>';
            if (error.code === 'failed-precondition') {
                showToast('Lỗi cấu hình: Cần tạo chỉ mục trong Firestore. Kiểm tra console (F12) để xem chi tiết.', 'error', 5000);
            }
        }
    };

    const renderPersonalReport = (methodCounts) => {
        // Hủy biểu đồ cũ trước khi render giao diện mới
        if (pieChartInstance) {
            pieChartInstance.destroy();
        }

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

    const renderGroupReport = (groupData, allMethodsTemplate) => {
        // Hủy biểu đồ cũ trước khi render giao diện mới
        if (pieChartInstance) {
            pieChartInstance.destroy();
        }

        const sortedMethods = Object.keys(allMethodsTemplate).sort();

        // Sắp xếp danh sách giáo viên theo 'order' thay vì theo tên
        const sortedTeachersFromSource = teachersInGroup
            .filter(t => t.uid && groupData[t.uid]) // Chỉ lấy những GV có dữ liệu báo cáo
            .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity)); // Sắp xếp theo 'order'

        // Tạo mảng dữ liệu cuối cùng để render dựa trên thứ tự đã sắp xếp
        const sortedTeachers = sortedTeachersFromSource.map(t => groupData[t.uid]);

        if (sortedTeachers.length === 0) {
            reportContainer.innerHTML = '<p>Tổ chuyên môn này chưa có giáo viên nào.</p>';
            return;
        }

        // --- Tạo bảng ma trận ---
        // Hàng là Giáo viên, Cột là PPDH
        let tableHTML = `<h4 class="report-subtitle">Bảng thống kê chi tiết theo giáo viên</h4><table class="report-table"><thead><tr><th>Giáo viên</th>`;
        sortedMethods.forEach(method => {
            tableHTML += `<th>${method}</th>`;
        });
        tableHTML += `<th>Tổng cộng</th></tr></thead><tbody>`;

        const methodTotals = { ...allMethodsTemplate };

        // Lặp qua từng giáo viên để tạo hàng
        sortedTeachers.forEach(teacher => {
            tableHTML += `<tr><td>${teacher.teacherName}</td>`;
            // Lặp qua từng PPDH để điền số liệu
            sortedMethods.forEach(method => {
                const count = teacher.methodCounts[method] || 0;
                tableHTML += `<td>${count}</td>`;
                methodTotals[method] += count; // Cộng dồn vào tổng của cột PPDH
            });
            // Thêm cột tổng cộng của hàng (tổng số tiết của giáo viên)
            tableHTML += `<td>${teacher.total}</td></tr>`;
        });

        // Dòng tổng cộng cuối bảng
        tableHTML += `<tr class="total-row"><td>Tổng cộng</td>`;
        let grandTotal = 0;
        sortedMethods.forEach(method => {
            tableHTML += `<td>${methodTotals[method]}</td>`;
            grandTotal += methodTotals[method];
        });
        tableHTML += `<td>${grandTotal}</td></tr>`;
        tableHTML += `</tbody></table>`;

        // --- Tạo layout và chèn biểu đồ ---
        reportContainer.innerHTML = `
            <div class="report-layout">
                <div class="report-table-container">
                    ${tableHTML}
                </div>
                <div class="report-chart-container">
                    <h4 class="report-subtitle">Biểu đồ tổng quan của tổ</h4>
                    <canvas id="methods-pie-chart"></canvas>
                </div>
            </div>
        `;

        // --- Render các biểu đồ ---
        renderPieChart(methodTotals, sortedMethods); // Tái sử dụng biểu đồ tròn cho tổng của tổ
    };

    const renderPieChart = (methodCounts, sortedMethods) => {
        const ctx = document.getElementById('methods-pie-chart').getContext('2d');
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