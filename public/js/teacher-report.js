import {
    collection,
    getDocs,
    query,
    orderBy,
    where,
    limit,
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { firestore, auth } from "./firebase-config.js";
import { showToast } from "./toast.js";
import { canViewReport } from "./utils.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('report-page')) return;

    // DOM Elements
    const reportTypeSelect = document.getElementById('report-type-select');
    const reportValueSelect = document.getElementById('report-value-select');
    const viewReportBtn = document.getElementById('view-report-btn');
    const exportWordBtn = document.getElementById('export-word-btn');
    const printReportBtn = document.getElementById('print-report-btn');
    const exportPdfBtn = document.getElementById('export-pdf-btn');
    const reportPage = document.getElementById('report-page');

    // State
    let currentSchoolYear = null;
    let timePlan = [];
    let timePlanConfig = { reportDay: 23, semester1EndWeek: 19 };
    let allHolidays = [];
    let currentTeacherId = null;
    let currentTeacherName = '';
    let currentTeacherGroup = '';
    let currentGroupId = '';
    let allTeachersInGroup = [];

    // Wait for auth state to be ready
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentTeacherId = user.uid;
            await initializePage();
        } else {
            reportPage.innerHTML = '<p>Vui lòng đăng nhập để xem báo cáo.</p>';
        }
    });

    const initializePage = async () => {
        try {
            // 1. Get current school year
            const yearsQuery = query(collection(firestore, 'schoolYears'), orderBy('schoolYear', 'desc'), limit(1));
            const yearsSnapshot = await getDocs(yearsQuery);
            if (yearsSnapshot.empty) {
                reportPage.innerHTML = '<p>Chưa có dữ liệu năm học.</p>';
                return;
            }
            currentSchoolYear = yearsSnapshot.docs[0].data().schoolYear;

            // 2. Load time plan (weeks)
            await loadTimePlan();

            // 3. Load holidays
            await loadHolidays();

            // 4. Load teacher info and check permission
            const hasPermission = await loadTeacherInfo();
            if (!hasPermission) {
                return; // Stop if no permission
            }

            // 5. Set up initial filter options
            reportTypeSelect.value = 'month';
            updateFilterValueOptions();

            // 6. Chọn tháng hiện tại làm mặc định
            const currentMonth = new Date().getMonth() + 1;
            reportValueSelect.value = currentMonth;

            if (!reportValueSelect.value && reportValueSelect.options.length > 0) {
                reportValueSelect.selectedIndex = 0;
            }

            // 7. Tự động tạo báo cáo khi tải trang
            await generateReport();
        } catch (error) {
            console.error("Lỗi khởi tạo trang báo cáo:", error);
            showToast('Không thể tải dữ liệu khởi tạo.', 'error');
        }
    };

    const loadTimePlan = async () => {
        const planQuery = query(collection(firestore, 'timePlans'), where("schoolYear", "==", currentSchoolYear));
        const planSnapshot = await getDocs(planQuery);
        if (planSnapshot.empty) {
            timePlan = [];
            return;
        }

        const planDoc = planSnapshot.docs[0];
        const planDocId = planDoc.id;
        timePlanConfig = { reportDay: planDoc.data().reportDay || 23, semester1EndWeek: planDoc.data().semester1EndWeek || 19 };
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

    const loadTeacherInfo = async () => {
        try {
            const teacherQuery = query(collection(firestore, 'teachers'), where('uid', '==', currentTeacherId));
            const teacherSnapshot = await getDocs(teacherQuery);

            if (teacherSnapshot.empty) {
                reportPage.innerHTML = '<p class="error-message">Không tìm thấy thông tin giáo viên.</p>';
                return false;
            }

            const teacherData = teacherSnapshot.docs[0].data();
            currentTeacherName = teacherData.teacher_name || 'Giáo viên';
            const teacherOrder = teacherData.order !== undefined ? teacherData.order : 999;
            currentGroupId = teacherData.group_id || '';

            // Load group name
            if (currentGroupId) {
                const groupQuery = query(collection(firestore, 'groups'), where('group_id', '==', currentGroupId));
                const groupSnapshot = await getDocs(groupQuery);
                if (!groupSnapshot.empty) {
                    currentTeacherGroup = groupSnapshot.docs[0].data().group_name || '';
                }

                // Load all teachers in the same group
                const teachersInGroupQuery = query(
                    collection(firestore, 'teachers'),
                    where('group_id', '==', currentGroupId),
                    where('status', '==', 'active'),
                    orderBy('order')
                );
                const teachersInGroupSnapshot = await getDocs(teachersInGroupQuery);
                allTeachersInGroup = teachersInGroupSnapshot.docs.map(doc => ({
                    id: doc.id,
                    uid: doc.data().uid,
                    teacher_name: doc.data().teacher_name,
                    order: doc.data().order,
                    subject: doc.data().subject || ''
                }));
            }

            // Kiểm tra quyền xem báo cáo
            if (!canViewReport(teacherOrder, currentTeacherGroup)) {
                reportPage.innerHTML = `
                    <div class="error-message" style="text-align: center; padding: 40px;">
                        <i class="fas fa-lock" style="font-size: 48px; color: #e74c3c; margin-bottom: 20px;"></i>
                        <h3>Không có quyền truy cập</h3>
                        <p>Chức năng này chỉ dành cho Tổ trưởng và Tổ phó của tổ chuyên môn ghép.</p>
                        <p style="margin-top: 10px; color: #7f8c8d;">
                            <strong>Ghi chú:</strong> Tổ phó của tổ chuyên môn đơn (ví dụ: Toán, Lý, Hóa, ...) không có quyền truy cập trang này.
                        </p>
                    </div>
                `;

                // Disable all controls
                const controls = document.querySelectorAll('.filter-container select, .filter-container button, .report-actions button');
                controls.forEach(control => control.disabled = true);

                return false;
            }

            return true;
        } catch (error) {
            console.error("Lỗi khi tải thông tin giáo viên:", error);
            return false;
        }
    };

    const updateFilterValueOptions = () => {
        const filterType = reportTypeSelect.value;
        reportValueSelect.innerHTML = '';

        switch (filterType) {
            case 'month':
                const months = new Set();
                timePlan.forEach(week => {
                    months.add(new Date(week.startDate).getMonth() + 1);
                    months.add(new Date(week.endDate).getMonth() + 1);
                });
                [...months].sort((a, b) => a - b).forEach(month => {
                    const option = document.createElement('option');
                    option.value = month;
                    option.textContent = `Tháng ${month}`;
                    reportValueSelect.appendChild(option);
                });
                break;
            case 'semester':
                reportValueSelect.innerHTML = `
                    <option value="1">Học kỳ I</option>
                    <option value="2">Học kỳ II</option>
                `;
                break;
            case 'year':
                const option = document.createElement('option');
                option.value = currentSchoolYear;
                option.textContent = `Năm học ${currentSchoolYear}`;
                reportValueSelect.appendChild(option);
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
        const filterType = reportTypeSelect.value;
        const filterValue = reportValueSelect.value;
        let startDate, endDate, reportTitle, reportSubtitle;

        if (timePlan.length === 0) {
            if (allHolidays.length === 0) showToast('Chưa có dữ liệu ngày nghỉ cho năm học này.', 'info');
            showToast('Chưa có kế hoạch thời gian cho năm học này.', 'error');
            return;
        }

        // Determine date range and title
        switch (filterType) {
            case 'month':
                const month = parseInt(filterValue);
                const reportDay = timePlanConfig.reportDay;

                let currentReportingMonth;
                let currentReportingYear;
                const firstWeekDate = new Date(timePlan[0].startDate);
                const firstWeekCutoff = new Date(firstWeekDate.getFullYear(), firstWeekDate.getMonth(), reportDay);

                if (firstWeekDate <= firstWeekCutoff) {
                    currentReportingMonth = firstWeekDate.getMonth() + 1;
                    currentReportingYear = firstWeekDate.getFullYear();
                } else {
                    currentReportingMonth = firstWeekDate.getMonth() + 2;
                    if (currentReportingMonth > 12) { currentReportingMonth = 1; currentReportingYear = firstWeekDate.getFullYear() + 1; }
                    else { currentReportingYear = firstWeekDate.getFullYear(); }
                }

                const weeksInMonth = [];
                timePlan.forEach(week => {
                    const weekStartDate = new Date(week.startDate);
                    const cutoffDate = new Date(currentReportingYear, currentReportingMonth - 1, reportDay);
                    if (weekStartDate > cutoffDate) {
                        currentReportingMonth++;
                        if (currentReportingMonth > 12) { currentReportingMonth = 1; currentReportingYear++; }
                    }
                    if (currentReportingMonth === month) {
                        weeksInMonth.push(week);
                    }
                });

                if (weeksInMonth.length > 0) {
                    startDate = weeksInMonth[0].startDate;
                    endDate = weeksInMonth[weeksInMonth.length - 1].endDate;
                    const startWeek = weeksInMonth[0];
                    const endWeek = weeksInMonth[weeksInMonth.length - 1];
                    reportSubtitle = `Tháng ${month} (Từ Tuần ${startWeek.weekNumber} ngày ${formatDate(startWeek.startDate)} đến Tuần ${endWeek.weekNumber} ngày ${formatDate(endWeek.endDate)})`;
                }
                reportTitle = `BÁO CÁO`;
                break;
            case 'semester':
                const semester1EndWeek = timePlanConfig.semester1EndWeek;
                if (filterValue === '1') {
                    startDate = timePlan[0].startDate;
                    endDate = timePlan[semester1EndWeek - 1]?.endDate || timePlan[timePlan.length - 1].endDate;
                    reportTitle = 'BÁO CÁO';
                    reportSubtitle = 'Học kỳ I';
                } else {
                    startDate = timePlan[semester1EndWeek]?.startDate || timePlan[timePlan.length - 1].startDate;
                    endDate = timePlan[timePlan.length - 1].endDate;
                    reportTitle = 'BÁO CÁO';
                    reportSubtitle = 'Học kỳ II';
                }
                break;
            case 'year':
                startDate = timePlan[0].startDate;
                endDate = timePlan[timePlan.length - 1].endDate;
                reportTitle = `BÁO CÁO`;
                reportSubtitle = `Năm học ${currentSchoolYear}`;
                break;
        }

        if (!startDate || !endDate) {
            reportPage.innerHTML = `<p>Không tìm thấy dữ liệu thời gian cho lựa chọn này.</p>`;
            return;
        }

        reportPage.innerHTML = '<p>Đang tổng hợp dữ liệu...</p>';

        try {
            // Collect teacher UIDs from the group
            const teacherUids = allTeachersInGroup.map(t => t.uid).filter(uid => uid);

            if (teacherUids.length === 0) {
                showToast('Không tìm thấy giáo viên nào trong tổ chuyên môn này.', 'warning');
                reportPage.innerHTML = '<p class="error-message">Không có giáo viên nào trong tổ.</p>';
                return;
            }

            // Initialize data structure for each teacher
            const teacherData = new Map();
            allTeachersInGroup.forEach(teacher => {
                if (teacher.uid) {
                    teacherData.set(teacher.uid, {
                        name: teacher.teacher_name,
                        order: teacher.order,
                        subject: teacher.subject,
                        cnttCount: 0,
                        tbdhCount: 0,
                        thCount: 0
                    });
                }
            });

            let holidayRegsCount = 0;

            // Query registrations for ALL teachers in the group
            const regsQuery = query(
                collection(firestore, 'registrations'),
                where('schoolYear', '==', currentSchoolYear),
                where('date', '>=', startDate),
                where('date', '<=', endDate)
            );
            const snapshot = await getDocs(regsQuery);

            // Count teaching methods for each teacher
            snapshot.forEach(doc => {
                const reg = doc.data();

                // Only count if teacher is in the group
                if (!teacherUids.includes(reg.teacherId)) {
                    return;
                }

                // Check if the registration date is a holiday and skip if it is
                if (isHoliday(reg.date)) {
                    holidayRegsCount++;
                    return;
                }

                // Count for each teacher
                if (teacherData.has(reg.teacherId)) {
                    const teacher = teacherData.get(reg.teacherId);
                    if (reg.teachingMethod && Array.isArray(reg.teachingMethod)) {
                        if (reg.teachingMethod.includes('Công nghệ thông tin')) {
                            teacher.cnttCount++;
                        }
                        if (reg.teachingMethod.includes('Thiết bị dạy học')) {
                            teacher.tbdhCount++;
                        }
                        if (reg.teachingMethod.includes('Thực hành')) {
                            teacher.thCount++;
                        }
                    }
                }
            });

            // Render report
            renderReport(reportTitle, reportSubtitle, teacherData, endDate, holidayRegsCount);

        } catch (error) {
            console.error("Lỗi khi tạo báo cáo:", error);
            showToast('Lỗi khi tạo báo cáo. Kiểm tra Firestore Index.', 'error');
            reportPage.innerHTML = '<p class="error-message">Đã có lỗi xảy ra.</p>';
        }
    };

    const renderReport = (title, subtitle, teacherData, reportEndDate, holidayRegsCount) => {
        // Build teacher table rows
        let teacherTableRows = '';
        let teacherIndex = 1;
        let totalCntt = 0, totalTbdh = 0, totalTh = 0;

        // Sort teachers by total count (descending)
        const sortedTeachers = [...teacherData.values()].sort((a, b) => {
            const totalA = a.cnttCount + a.tbdhCount + a.thCount;
            const totalB = b.cnttCount + b.tbdhCount + b.thCount;
            return totalB - totalA;
        });

        sortedTeachers.forEach(teacher => {
            totalCntt += teacher.cnttCount;
            totalTbdh += teacher.tbdhCount;
            totalTh += teacher.thCount;

            const teacherTotal = teacher.cnttCount + teacher.tbdhCount + teacher.thCount;

            teacherTableRows += `
                <tr>
                    <td style="text-align: center;">${teacherIndex++}</td>
                    <td style="white-space: nowrap;">${teacher.name}</td>
                    <td style="text-align: center;">${teacher.subject || ''}</td>
                    <td style="text-align: center;">${teacher.cnttCount}</td>
                    <td style="text-align: center;">${teacher.tbdhCount}</td>
                    <td style="text-align: center;">${teacher.thCount}</td>
                    <td style="text-align: center; font-weight: bold;">${teacherTotal}</td>
                    <td></td>
                </tr>
            `;
        });

        const totalCount = totalCntt + totalTbdh + totalTh;

        const [year, month, day] = reportEndDate.split('-');
        const signatureDate = `Hiếu Giang, ngày ${day} tháng ${parseInt(month, 10)} năm ${year}`;

        const reportHTML = `
            <div class="report-header-nd30">
                <div class="header-left">
                    <p style="font-size: 13pt; text-transform: uppercase;">SỞ GD&ĐT QUẢNG TRỊ</p>
                    <p style="font-size: 13pt; font-weight: bold; text-transform: uppercase; word-break: break-word;"><span class="underline-2-3">TRƯỜNG THPT CHẾ LAN VIÊN</span></p>
                </div>
                <div class="header-right">
                    <p style="font-size: 13pt; font-weight: bold;">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</p>
                    <p style="font-size: 14pt; font-weight: bold;"><span class="underline-full">Độc lập - Tự do - Hạnh phúc</span></p>
                </div>
            </div>

            <div class="report-title-container">
                <h2 class="report-main-title">${title}</h2>
                <h3 class="report-sub-title">Tình hình sử dụng thiết bị dạy học</h3>
                <p class="report-time-range">${subtitle}</p>
            </div>

            ${holidayRegsCount > 0 ? `
                <div class="report-note">
                    <p><i class="fas fa-info-circle"></i> <strong>Ghi chú:</strong> Đã loại trừ <strong>${holidayRegsCount}</strong> lượt đăng ký diễn ra trong các ngày nghỉ lễ, tết đã được cấu hình.</p>
                </div>
            ` : ''}

            <div style="margin: 20px 0;">
                <p><strong>Tổ chuyên môn:</strong> ${currentTeacherGroup}</p>
            </div>

            <h4>1. Tình hình sử dụng thiết bị theo giáo viên</h4>
            <table class="report-table" id="teacher-report-table">
                <thead>
                    <tr>
                        <th rowspan="2" style="width: 5%;">STT</th>
                        <th rowspan="2" style="width: 25%;">Giáo viên</th>
                        <th rowspan="2" style="width: 25%;">Môn dạy</th>
                        <th colspan="3">PPDH</th>
                        <th rowspan="2" style="width: 10%;">Tổng (lượt)</th>
                        <th rowspan="2" style="width: 15%;">Ghi chú</th>
                    </tr>
                    <tr>
                        <th style="width: 5%;">CNTT</th>
                        <th style="width: 5%;">TBDH</th>
                        <th style="width: 5%;">TH</th>
                    </tr>
                </thead>
                <tbody>
                    ${teacherTableRows}
                    <tr class="total-row">
                        <td colspan="3" style="text-align: center; font-weight: bold;">Tổng cộng</td>
                        <td style="text-align: center; font-weight: bold;">${totalCntt}</td>
                        <td style="text-align: center; font-weight: bold;">${totalTbdh}</td>
                        <td style="text-align: center; font-weight: bold;">${totalTh}</td>
                        <td style="text-align: center; font-weight: bold;">${totalCount}</td>
                        <td></td>
                    </tr>
                </tbody>
            </table>

            <h4>2. Tình hình sử dụng thiết bị dạy học</h4>
            <table class="report-table">
                <thead>
                    <tr>
                        <th rowspan="2" style="width: 50%;">Phương pháp dạy học</th>
                        <th colspan="2">Số lượt sử dụng</th>
                        <th rowspan="2" style="width: 20%;">Ghi chú</th>
                    </tr>
                    <tr>
                        <th style="width: 15%;">Số lần</th>
                        <th style="width: 15%;">Tỷ lệ (%)</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Công nghệ thông tin</td>
                        <td style="text-align: center;">${totalCntt}</td>
                        <td style="text-align: center;">${totalCount > 0 ? ((totalCntt / totalCount) * 100).toFixed(1) : 0}%</td>
                        <td></td>
                    </tr>
                    <tr>
                        <td>Thiết bị dạy học</td>
                        <td style="text-align: center;">${totalTbdh}</td>
                        <td style="text-align: center;">${totalCount > 0 ? ((totalTbdh / totalCount) * 100).toFixed(1) : 0}%</td>
                        <td></td>
                    </tr>
                    <tr>
                        <td>Thực hành</td>
                        <td style="text-align: center;">${totalTh}</td>
                        <td style="text-align: center;">${totalCount > 0 ? ((totalTh / totalCount) * 100).toFixed(1) : 0}%</td>
                        <td></td>
                    </tr>
                    <tr class="total-row">
                        <td style="font-weight: bold;">Tổng cộng</td>
                        <td style="text-align: center; font-weight: bold;">${totalCount}</td>
                        <td style="text-align: center; font-weight: bold;">100%</td>
                        <td></td>
                    </tr>
                </tbody>
            </table>

            <div class="report-signature">
                <div class="signature-block">
                    <p class="signature-date"><i>${signatureDate}</i></p>
                    <p class="signature-title"><b>NGƯỜI LÀM BÁO CÁO</b></p>
                    <br><br><br><br><br><br>
                    <p class="signature-name"><b>${currentTeacherName}</b></p>
                </div>
            </div>
        `;
        reportPage.innerHTML = reportHTML;
    };

    // Event Listeners
    reportTypeSelect.addEventListener('change', updateFilterValueOptions);
    viewReportBtn.addEventListener('click', generateReport);

    if (printReportBtn) {
        printReportBtn.addEventListener('click', () => {
            showToast('Đang mở hộp thoại in...', 'info');
            window.print();
        });
    }

    const formatDate = (dateString) => {
        if (!dateString) return '';
        const [year, month, day] = dateString.split('-');
        return `${day}/${month}/${year}`;
    };

    exportWordBtn.addEventListener('click', () => {
        const header = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>Export HTML to Word</title></head><body>`;
        const footer = "</body></html>";
        const sourceHTML = header + reportPage.innerHTML + footer;

        const source = 'data:application/vnd.ms-word;charset=utf-8,' + encodeURIComponent(sourceHTML);
        const fileDownload = document.createElement("a");
        document.body.appendChild(fileDownload);
        fileDownload.href = source;
        fileDownload.download = 'bao-cao.doc';
        fileDownload.click();
        document.body.removeChild(fileDownload);
        showToast('Đang tải file Word...', 'info');
    });

    exportPdfBtn.addEventListener('click', async () => {
        showToast('Đang chuẩn bị file PDF...', 'info');
        const reportContent = document.getElementById('report-page');

        if (!reportContent) {
            showToast('Không tìm thấy nội dung báo cáo để xuất.', 'error');
            return;
        }

        const canvas = await html2canvas(reportContent, {
            scale: 2,
            useCORS: true,
            logging: false,
        });

        const imgData = canvas.toDataURL('image/png');
        const { jsPDF } = window.jspdf;

        const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4',
        });

        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        const imgWidth = canvas.width;
        const imgHeight = canvas.height;
        const ratio = imgWidth / imgHeight;

        const imgHeightInPdf = pdfWidth / ratio;

        let heightLeft = imgHeightInPdf;
        let position = 0;

        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeightInPdf);
        heightLeft -= pdfHeight;

        pdf.save('bao-cao.pdf');
        showToast('Đã xuất file PDF thành công!', 'success');
    });
});
