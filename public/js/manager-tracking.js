import {
    collection,
    getDocs,
    query,
    orderBy,
    where,
    limit,
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { firestore } from "./firebase-config.js";
import { showToast } from "./toast.js";

document.addEventListener('DOMContentLoaded', () => {
    if (!document.querySelector('.report-container')) return;

    // Đăng ký plugin ChartDataLabels một lần duy nhất khi script được tải
    Chart.register(ChartDataLabels);

    const groupFilterSelect = document.getElementById('group-filter');
    const teacherFilterSelect = document.getElementById('teacher-filter');
    const subjectFilterSelect = document.getElementById('subject-filter');
    const filterTypeSelect = document.getElementById('time-filter-type');
    const filterValueSelect = document.getElementById('time-filter-value');
    const sortTypeSelect = document.getElementById('sort-type');
    const reportContainer = document.querySelector('.report-container');

    let currentSchoolYear = null;
    let timePlan = [];
    let allGroups = [];
    let allTeachers = [];
    let allSubjects = [];
    let allHolidays = [];
    let pieChartInstance = null;
    let cachedDetailedData = null;
    let cachedMethodsTemplate = null;

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

            // 2. Tải dữ liệu cơ bản
            await Promise.all([
                loadAllGroups(),
                loadAllTeachers(),
                loadAllSubjects(),
                loadTimePlan(),
                loadHolidays()
            ]);

            // 3. Khởi tạo các bộ lọc
            populateGroupFilter();
            populateSubjectFilter();

            // 4. Tìm tuần hiện tại
            const today = new Date().toISOString().split('T')[0];
            let currentWeekNumber = null;
            for (const week of [...timePlan].reverse()) {
                if (week.startDate <= today) {
                    currentWeekNumber = week.weekNumber;
                    break;
                }
            }

            // 5. Thiết lập bộ lọc mặc định
            filterTypeSelect.value = 'week';
            updateFilterValueOptions();
            if (currentWeekNumber) {
                filterValueSelect.value = currentWeekNumber;
            }

            // 6. Tự động hiển thị báo cáo
            await generateReport();

        } catch (error) {
            console.error("Lỗi khởi tạo trang:", error);
            reportContainer.innerHTML = '<p class="error-message">Không thể tải dữ liệu trang.</p>';
        }
    };

    const loadAllGroups = async () => {
        const groupsQuery = query(
            collection(firestore, 'groups'),
            where('schoolYear', '==', currentSchoolYear),
            where('status', '==', 'active'),
            orderBy('order')
        );
        const groupsSnapshot = await getDocs(groupsQuery);
        allGroups = groupsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    };

    const loadAllTeachers = async () => {
        const teachersQuery = query(
            collection(firestore, 'teachers'),
            where('status', '==', 'active'),
            orderBy('teacher_name')
        );
        const teachersSnapshot = await getDocs(teachersQuery);
        allTeachers = teachersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    };

    const loadAllSubjects = async () => {
        const subjectsQuery = query(
            collection(firestore, 'subjects'),
            where('schoolYear', '==', currentSchoolYear),
            where('status', '==', 'active'),
            orderBy('name')
        );
        const subjectsSnapshot = await getDocs(subjectsQuery);
        allSubjects = subjectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    };

    const loadTimePlan = async () => {
        const planQuery = query(collection(firestore, 'timePlans'), where("schoolYear", "==", currentSchoolYear));
        const planSnapshot = await getDocs(planQuery);
        if (planSnapshot.empty) return;

        const planDocId = planSnapshot.docs[0].id;
        const weeksQuery = query(collection(firestore, 'timePlans', planDocId, 'weeks'), orderBy('weekNumber'));
        const weeksSnapshot = await getDocs(weeksQuery);
        timePlan = weeksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    };

    const loadHolidays = async () => {
        const planQuery = query(collection(firestore, 'timePlans'), where("schoolYear", "==", currentSchoolYear));
        const planSnapshot = await getDocs(planQuery);
        if (planSnapshot.empty) {
            allHolidays = [];
            return;
        }
        const planDocId = planSnapshot.docs[0].id;
        const holidaysQuery = query(collection(firestore, 'timePlans', planDocId, 'holidays'), orderBy('startDate'));
        const holidaysSnapshot = await getDocs(holidaysQuery);
        allHolidays = holidaysSnapshot.docs.map(doc => doc.data());
    };

    const populateGroupFilter = () => {
        groupFilterSelect.innerHTML = '<option value="all">Tất cả</option>';
        allGroups.forEach(group => {
            const option = document.createElement('option');
            option.value = group.group_id;
            option.textContent = group.group_name;
            groupFilterSelect.appendChild(option);
        });
    };

    const populateTeacherFilter = (selectedGroupId) => {
        teacherFilterSelect.innerHTML = '<option value="all">Tất cả</option>';

        let filteredTeachers = allTeachers;
        if (selectedGroupId !== 'all') {
            filteredTeachers = allTeachers.filter(t => t.group_id === selectedGroupId);
        }

        filteredTeachers.forEach(teacher => {
            const option = document.createElement('option');
            option.value = teacher.uid;
            option.textContent = teacher.teacher_name;
            teacherFilterSelect.appendChild(option);
        });
    };

    const populateSubjectFilter = () => {
        subjectFilterSelect.innerHTML = '<option value="all">Tất cả</option>';
        allSubjects.forEach(subject => {
            const option = document.createElement('option');
            option.value = subject.name;
            option.textContent = subject.name;
            subjectFilterSelect.appendChild(option);
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
                const reportingMonths = new Map();
                const reportDay = 23;

                let currentReportingMonth;
                let currentReportingYear;

                if (timePlan.length > 0) {
                    const firstWeekDate = new Date(timePlan[0].startDate.replace(/-/g, '/'));
                    const firstWeekCutoff = new Date(firstWeekDate.getFullYear(), firstWeekDate.getMonth(), reportDay);

                    if (firstWeekDate < firstWeekCutoff) {
                        currentReportingMonth = firstWeekDate.getMonth() + 1;
                        currentReportingYear = firstWeekDate.getFullYear();
                    } else {
                        currentReportingMonth = firstWeekDate.getMonth() + 2;
                        if (currentReportingMonth > 12) {
                            currentReportingMonth = 1;
                            currentReportingYear = firstWeekDate.getFullYear() + 1;
                        } else {
                            currentReportingYear = firstWeekDate.getFullYear();
                        }
                    }
                }

                timePlan.forEach(week => {
                    const weekStartDate = new Date(week.startDate.replace(/-/g, '/'));
                    const cutoffDate = new Date(currentReportingYear, currentReportingMonth - 1, reportDay);

                    if (weekStartDate >= cutoffDate) {
                        currentReportingMonth++;
                        if (currentReportingMonth > 12) {
                            currentReportingMonth = 1;
                            currentReportingYear++;
                        }
                    }
                    const monthKey = `${currentReportingYear}-${String(currentReportingMonth).padStart(2, '0')}`;
                    reportingMonths.set(monthKey, `Tháng ${currentReportingMonth}/${currentReportingYear}`);
                });

                reportingMonths.forEach((text, value) => {
                    const option = document.createElement('option');
                    option.value = value;
                    option.textContent = text;
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

    const isHoliday = (dateString) => {
        if (!dateString || allHolidays.length === 0) return false;
        for (const holiday of allHolidays) {
            if (dateString >= holiday.startDate && dateString <= holiday.endDate) {
                return true;
            }
        }
        return false;
    };

    const generateReport = async () => {
        reportContainer.innerHTML = '<p>Đang tổng hợp dữ liệu...</p>';

        const selectedGroupId = groupFilterSelect.value;
        const selectedTeacherId = teacherFilterSelect.value;
        const selectedSubject = subjectFilterSelect.value;
        const filterType = filterTypeSelect.value;
        const filterValue = filterValueSelect.value;

        if (!filterValue) {
            reportContainer.innerHTML = '<p class="instruction-text">Vui lòng chọn một giá trị từ bộ lọc để xem báo cáo.</p>';
            return;
        }

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
                const [reportYear, reportMonth] = filterValue.split('-').map(Number);
                const reportDay = 23;

                let startReportYear = reportYear;
                let startReportMonth = reportMonth - 1;
                if (startReportMonth === 0) {
                    startReportMonth = 12;
                    startReportYear--;
                }
                startDate = new Date(startReportYear, startReportMonth - 1, reportDay).toISOString().split('T')[0];

                let endReportDate = new Date(reportYear, reportMonth - 1, reportDay);
                endReportDate.setDate(endReportDate.getDate() - 1);
                endDate = endReportDate.toISOString().split('T')[0];

                const planStartDate = timePlan[0].startDate;
                const planEndDate = timePlan[timePlan.length - 1].endDate;
                if (startDate < planStartDate) startDate = planStartDate;
                if (endDate > planEndDate) endDate = planEndDate;
                break;
            case 'semester':
                if (filterValue === '1') {
                    startDate = timePlan[0].startDate;
                    endDate = timePlan[18] ? timePlan[18].endDate : timePlan[timePlan.length - 1].endDate;
                } else {
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
            // 1. Lấy danh sách PPDH
            const allMethodsTemplate = {};
            const methodsQuery = query(collection(firestore, 'teachingMethods'), where("schoolYear", "==", currentSchoolYear));
            const methodsSnapshot = await getDocs(methodsQuery);
            methodsSnapshot.forEach(doc => {
                allMethodsTemplate[doc.data().method] = 0;
            });

            // 2. Tạo query với các bộ lọc
            let queryConstraints = [
                where('schoolYear', '==', currentSchoolYear),
                where('date', '>=', startDate),
                where('date', '<=', endDate)
            ];

            // Áp dụng bộ lọc giáo viên
            if (selectedTeacherId !== 'all') {
                queryConstraints.push(where('teacherId', '==', selectedTeacherId));
            } else if (selectedGroupId !== 'all') {
                // Nếu chọn tổ, lọc theo danh sách giáo viên trong tổ
                const teachersInGroup = allTeachers.filter(t => t.group_id === selectedGroupId);
                const teacherUids = teachersInGroup.map(t => t.uid).filter(Boolean);
                if (teacherUids.length > 0) {
                    queryConstraints.push(where('teacherId', 'in', teacherUids.slice(0, 30)));
                }
            }

            const regsQuery = query(collection(firestore, 'registrations'), ...queryConstraints);
            const snapshot = await getDocs(regsQuery);

            let holidayRegsCount = 0;
            const methodCounts = { ...allMethodsTemplate };
            const detailedData = {};

            // Nếu chọn môn học, khởi tạo tất cả giáo viên được phân công dạy môn đó với giá trị 0
            if (selectedSubject !== 'all') {
                const assignedTeachers = allTeachers.filter(t => t.subject === selectedSubject);
                assignedTeachers.forEach(teacher => {
                    const teacherGroup = allGroups.find(g => g.group_id === teacher.group_id);
                    detailedData[teacher.uid] = {
                        teacherName: teacher.teacher_name,
                        groupName: teacherGroup ? teacherGroup.group_name : 'Không xác định',
                        subjects: new Set(),
                        methodCounts: { ...allMethodsTemplate },
                        total: 0
                    };
                });
            }

            // 3. Xử lý dữ liệu - Cập nhật số liệu từ registrations
            snapshot.forEach(doc => {
                const data = doc.data();

                if (isHoliday(data.date)) {
                    holidayRegsCount++;
                    return;
                }

                // Áp dụng bộ lọc môn học
                if (selectedSubject !== 'all' && data.subject !== selectedSubject) {
                    return;
                }

                if (!data.teachingMethod || !Array.isArray(data.teachingMethod)) return;

                const teacherId = data.teacherId;

                // Khởi tạo giáo viên nếu chưa có (cho trường hợp không chọn môn học)
                if (!detailedData[teacherId]) {
                    const teacher = allTeachers.find(t => t.uid === teacherId);
                    const teacherGroup = teacher ? allGroups.find(g => g.group_id === teacher.group_id) : null;
                    detailedData[teacherId] = {
                        teacherName: teacher ? teacher.teacher_name : 'N/A',
                        groupName: teacherGroup ? teacherGroup.group_name : 'Không xác định',
                        subjects: new Set(),
                        methodCounts: { ...allMethodsTemplate },
                        total: 0
                    };
                }

                // Đếm PPDH tổng quan
                data.teachingMethod.forEach(method => {
                    if (methodCounts.hasOwnProperty(method)) {
                        methodCounts[method]++;
                    }
                });

                // Cập nhật dữ liệu giáo viên
                if (data.subject) {
                    detailedData[teacherId].subjects.add(data.subject);
                }
                data.teachingMethod.forEach(method => {
                    if (detailedData[teacherId].methodCounts.hasOwnProperty(method)) {
                        detailedData[teacherId].methodCounts[method]++;
                        detailedData[teacherId].total++;
                    }
                });
            });

            if (holidayRegsCount > 0) {
                showToast(`Đã loại trừ ${holidayRegsCount} tiết dạy trong ngày nghỉ.`, 'info');
            }

            // 4. Render báo cáo (luôn dùng bảng chi tiết theo giáo viên)
            if (Object.keys(detailedData).length > 0) {
                await renderDetailedReport(detailedData, allMethodsTemplate, methodCounts);
            } else {
                reportContainer.innerHTML = '<p>Không có dữ liệu để hiển thị.</p>';
            }

        } catch (error) {
            console.error("Lỗi khi tạo báo cáo:", error);
            reportContainer.innerHTML = '<p class="error-message">Đã có lỗi xảy ra khi tạo báo cáo.</p>';
            showToast('Lỗi khi tạo báo cáo. Kiểm tra Firestore Index.', 'error');
        }
    };

    const renderSummaryReport = async (methodCounts) => {
        if (!document.getElementById('summary-report-table')) {
            await createSummaryReportStructure(methodCounts);
        }
        updateSummaryReportData(methodCounts);
        const sortedMethods = Object.keys(methodCounts).sort();
        renderPieChart(methodCounts, sortedMethods);
    };

    const createSummaryReportStructure = async (methodCounts) => {
        const sortedMethods = Object.keys(methodCounts).sort();
        if (sortedMethods.length === 0) {
            reportContainer.innerHTML = '<p>Chưa có phương pháp dạy học nào được cấu hình.</p>';
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

        sortedMethods.forEach((method, index) => {
            tableHTML += `
                <tr data-method="${method}">
                    <td>${index + 1}</td>
                    <td>${method}</td>
                    <td class="count-cell">0</td>
                    <td class="percentage-cell">0%</td>
                </tr>
            `;
        });

        tableHTML += `
                <tr class="total-row">
                    <td colspan="2">Tổng cộng</td>
                    <td>0</td>
                    <td>100%</td>
                </tr>
            </tbody>
            </table>
        `;

        reportContainer.innerHTML = `
            <div class="report-layout">
                <div id="summary-report-table" class="report-table-container">
                    ${tableHTML}
                </div>
                <div class="report-chart-container">
                    <canvas id="methods-pie-chart"></canvas>
                </div>
            </div>
        `;

        return new Promise(resolve => setTimeout(resolve, 0));
    };

    const updateSummaryReportData = (methodCounts) => {
        const sortedMethods = Object.keys(methodCounts).sort();
        let totalUsages = 0;
        sortedMethods.forEach(method => {
            totalUsages += methodCounts[method];
        });

        sortedMethods.forEach(method => {
            const count = methodCounts[method];
            const percentage = totalUsages > 0 ? ((count / totalUsages) * 100).toFixed(1) : 0;
            const row = document.querySelector(`tr[data-method="${method}"]`);
            if (row) {
                row.querySelector('.count-cell').textContent = count;
                row.querySelector('.percentage-cell').textContent = `${percentage}%`;
            }
        });

        const totalRow = document.querySelector('.total-row');
        if (totalRow) {
            totalRow.children[1].textContent = totalUsages;
        }
    };

    const renderDetailedReport = async (detailedData, allMethodsTemplate, methodTotals) => {
        cachedDetailedData = detailedData;
        cachedMethodsTemplate = allMethodsTemplate;

        if (!document.getElementById('detailed-report-table')) {
            await createDetailedReportStructure(detailedData, allMethodsTemplate);
        }
        updateDetailedReportData(detailedData, allMethodsTemplate);
        const sortedMethods = Object.keys(allMethodsTemplate).sort();
        renderPieChart(methodTotals, sortedMethods);
    };

    const getGroupingKey = (teacher) => {
        // Kiểm tra xem tổ chuyên môn có phải là tổ ghép không (có dấu '-' trong tên)
        const isMultiSubjectGroup = teacher.groupName && teacher.groupName.includes(' - ');

        // Nếu là tổ ghép, phân theo môn dạy chính
        if (isMultiSubjectGroup) {
            // Danh sách các môn phụ cần loại trừ
            const excludedSubjects = [
                'Hoạt động trải nghiệm',
                'Giáo dục thể chất',
                'Giáo dục quốc phòng và an ninh',
                'Giáo dục địa phương'
            ];

            // Lấy môn dạy chính của giáo viên (lọc bỏ các môn phụ)
            if (teacher.subjects && teacher.subjects.size > 0) {
                const mainSubjects = Array.from(teacher.subjects)
                    .filter(subject => !excludedSubjects.includes(subject))
                    .sort();

                // Nếu có môn chính, trả về môn đầu tiên
                if (mainSubjects.length > 0) {
                    return mainSubjects[0];
                }

                // Nếu chỉ có môn phụ, vẫn trả về môn đầu tiên
                return Array.from(teacher.subjects).sort()[0];
            }
            return 'Không xác định';
        } else {
            // Nếu là tổ đơn, dùng tên tổ chuyên môn
            return teacher.groupName || 'Không xác định';
        }
    };

    const sortTeachersData = (detailedData) => {
        const sortType = sortTypeSelect.value;
        const teachersArray = Object.entries(detailedData);

        if (sortType === 'asc') {
            return teachersArray.sort((a, b) => a[1].teacherName.localeCompare(b[1].teacherName));
        } else if (sortType === 'desc') {
            return teachersArray.sort((a, b) => b[1].teacherName.localeCompare(a[1].teacherName));
        } else if (sortType === 'group') {
            // Sắp xếp theo tổ chuyên môn hoặc môn dạy, sau đó theo tên giáo viên
            return teachersArray.sort((a, b) => {
                const groupA = getGroupingKey(a[1]);
                const groupB = getGroupingKey(b[1]);
                const groupCompare = groupA.localeCompare(groupB);
                if (groupCompare !== 0) return groupCompare;
                return a[1].teacherName.localeCompare(b[1].teacherName);
            });
        } else {
            // Mặc định: sắp xếp theo tổng giảm dần
            return teachersArray.sort((a, b) => b[1].total - a[1].total);
        }
    };

    const createDetailedReportStructure = async (detailedData, allMethodsTemplate) => {
        const sortedMethods = Object.keys(allMethodsTemplate).sort();
        const sortedTeachers = sortTeachersData(detailedData);

        if (sortedTeachers.length === 0) {
            reportContainer.innerHTML = '<p>Không có dữ liệu giáo viên.</p>';
            return;
        }

        const sortType = sortTypeSelect.value;
        let tableHTML = `<h4 class="report-subtitle">Bảng thống kê chi tiết theo giáo viên</h4><table class="report-table"><thead><tr><th>Giáo viên</th>`;
        sortedMethods.forEach(method => {
            tableHTML += `<th>${method}</th>`;
        });
        tableHTML += `<th>Tổng cộng</th></tr></thead><tbody>`;

        if (sortType === 'group') {
            // Render theo nhóm (tổ chuyên môn hoặc môn dạy)
            let currentGroup = null;
            const groupTotals = {};

            sortedTeachers.forEach(([uid, teacher]) => {
                const groupKey = getGroupingKey(teacher);

                // Nếu đổi nhóm, tạo dòng tổng cộng cho nhóm trước đó
                if (currentGroup && currentGroup !== groupKey) {
                    tableHTML += `<tr class="group-total-row"><td>${currentGroup} - Tổng cộng</td>`;
                    sortedMethods.forEach(method => {
                        tableHTML += `<td>${groupTotals[currentGroup][method] || 0}</td>`;
                    });
                    const groupTotal = Object.values(groupTotals[currentGroup]).reduce((sum, val) => sum + val, 0);
                    tableHTML += `<td>${groupTotal}</td></tr>`;
                }

                // Khởi tạo group totals nếu chưa có
                if (!groupTotals[groupKey]) {
                    groupTotals[groupKey] = {};
                    sortedMethods.forEach(method => {
                        groupTotals[groupKey][method] = 0;
                    });
                }

                // Cộng dồn vào tổng của nhóm
                sortedMethods.forEach(method => {
                    groupTotals[groupKey][method] += teacher.methodCounts[method] || 0;
                });

                currentGroup = groupKey;

                // Render hàng giáo viên
                tableHTML += `<tr data-teacher-uid="${uid}" data-group="${groupKey}"><td>${teacher.teacherName}</td>`;
                sortedMethods.forEach(method => {
                    tableHTML += `<td class="count-cell" data-method="${method}">0</td>`;
                });
                tableHTML += `<td class="total-cell">0</td></tr>`;
            });

            // Thêm tổng cộng cho nhóm cuối cùng
            if (currentGroup) {
                tableHTML += `<tr class="group-total-row"><td>${currentGroup} - Tổng cộng</td>`;
                sortedMethods.forEach(method => {
                    tableHTML += `<td>${groupTotals[currentGroup][method] || 0}</td>`;
                });
                const groupTotal = Object.values(groupTotals[currentGroup]).reduce((sum, val) => sum + val, 0);
                tableHTML += `<td>${groupTotal}</td></tr>`;
            }
        } else {
            // Render bình thường
            sortedTeachers.forEach(([uid, teacher]) => {
                tableHTML += `<tr data-teacher-uid="${uid}"><td>${teacher.teacherName}</td>`;
                sortedMethods.forEach(method => {
                    tableHTML += `<td class="count-cell" data-method="${method}">0</td>`;
                });
                tableHTML += `<td class="total-cell">0</td></tr>`;
            });
        }

        tableHTML += `<tr class="total-row"><td>Tổng cộng</td>`;
        sortedMethods.forEach(method => {
            tableHTML += `<td class="total-cell" data-method="${method}">0</td>`;
        });
        tableHTML += `<td class="grand-total-cell">0</td></tr>`;
        tableHTML += `</tbody></table>`;

        reportContainer.innerHTML = `
            <div class="report-layout">
                <div id="detailed-report-table" class="report-table-container">
                    ${tableHTML}
                </div>
                <div class="report-chart-container">
                    <h4 class="report-subtitle">Biểu đồ tổng quan</h4>
                    <canvas id="methods-pie-chart"></canvas>
                </div>
            </div>
        `;

        return new Promise(resolve => setTimeout(resolve, 0));
    };

    const updateDetailedReportData = (detailedData, allMethodsTemplate) => {
        const sortedMethods = Object.keys(allMethodsTemplate).sort();
        const sortedTeachers = sortTeachersData(detailedData);

        sortedTeachers.forEach(([uid, teacher]) => {
            const row = document.querySelector(`tr[data-teacher-uid="${uid}"]`);
            if (row) {
                sortedMethods.forEach(method => {
                    const count = teacher.methodCounts[method] || 0;
                    const cell = row.querySelector(`td.count-cell[data-method="${method}"]`);
                    if (cell) cell.textContent = count;
                });
                const totalCell = row.querySelector('td.total-cell');
                if (totalCell) totalCell.textContent = teacher.total;
            }
        });

        const totalRow = document.querySelector('tr.total-row');
        if (totalRow) {
            let grandTotal = 0;
            sortedMethods.forEach(method => {
                let methodTotal = 0;
                sortedTeachers.forEach(([uid, teacher]) => {
                    methodTotal += teacher.methodCounts[method] || 0;
                });
                const cell = totalRow.querySelector(`td.total-cell[data-method="${method}"]`);
                if (cell) cell.textContent = methodTotal;
                grandTotal += methodTotal;
            });
            const grandTotalCell = totalRow.querySelector('td.grand-total-cell');
            if (grandTotalCell) grandTotalCell.textContent = grandTotal;
        }
    };

    const renderPieChart = (methodCounts, sortedMethods) => {
        const chartCanvas = document.getElementById('methods-pie-chart');
        if (!chartCanvas) return;
        const ctx = chartCanvas.getContext('2d');
        const labels = sortedMethods;
        const data = sortedMethods.map(method => methodCounts[method]);

        const professionalColors = [
            '#3498db', '#2ecc71', '#e74c3c', '#f1c40f', '#9b59b6',
            '#34495e', '#1abc9c', '#e67e22', '#ecf0f1', '#7f8c8d'
        ];
        const backgroundColors = labels.map((_, index) => professionalColors[index % professionalColors.length]);

        if (Chart.getChart(ctx)) {
            Chart.getChart(ctx).destroy();
        }

        pieChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Số tiết đã đăng ký',
                    data: data,
                    backgroundColor: backgroundColors,
                    borderColor: '#fff',
                    borderWidth: 3,
                    hoverOffset: 15
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
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
                    datalabels: {
                        formatter: (value, ctx) => {
                            const sum = ctx.chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
                            const percentage = (value * 100 / sum).toFixed(1) + '%';
                            return sum > 0 && value > 0 ? percentage : '';
                        },
                        color: '#fff',
                        font: { weight: 'bold', size: 12 }
                    }
                }
            }
        });
    };

    // Event Listeners
    groupFilterSelect.addEventListener('change', () => {
        populateTeacherFilter(groupFilterSelect.value);
        generateReport();
    });

    teacherFilterSelect.addEventListener('change', generateReport);
    subjectFilterSelect.addEventListener('change', generateReport);

    filterTypeSelect.addEventListener('change', () => {
        updateFilterValueOptions();
        generateReport();
    });

    filterValueSelect.addEventListener('change', generateReport);

    sortTypeSelect.addEventListener('change', async () => {
        if (cachedDetailedData && cachedMethodsTemplate) {
            // Tạo lại cấu trúc bảng với sắp xếp mới
            await createDetailedReportStructure(cachedDetailedData, cachedMethodsTemplate);
            updateDetailedReportData(cachedDetailedData, cachedMethodsTemplate);
        }
    });

    // Khởi tạo bộ lọc giáo viên ban đầu
    populateTeacherFilter('all');

    // Khởi chạy
    initializePage();
});
