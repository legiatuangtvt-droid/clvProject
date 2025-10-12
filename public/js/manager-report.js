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
    if (!document.getElementById('report-page')) return;

    // DOM Elements
    const reportTypeSelect = document.getElementById('report-type-select');
    const reportValueSelect = document.getElementById('report-value-select');
    const viewReportBtn = document.getElementById('view-report-btn');
    const exportWordBtn = document.getElementById('export-word-btn');
    const exportPdfBtn = document.getElementById('export-pdf-btn');
    const reportPage = document.getElementById('report-page');

    // State
    let currentSchoolYear = null;
    let timePlan = [];
    let timePlanConfig = { reportDay: 23, semester1EndWeek: 19 }; // Default config
    let allGroups = [];
    let allHolidays = []; // NEW: State for holidays
    let allTeachers = [];

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

            // NEW: 2.5. Load holidays
            await loadHolidays();

            // 3. Load all groups
            await loadAllGroups();

            // 3.5. Load all teachers
            await loadAllTeachers();

            // 4. Set up initial filter options
            reportTypeSelect.value = 'month'; // Đặt mặc định là tháng
            updateFilterValueOptions();

            // 5. Chọn tháng hiện tại làm mặc định
            const currentMonth = new Date().getMonth() + 1;
            reportValueSelect.value = currentMonth;

            // Nếu tháng hiện tại không có trong danh sách (ví dụ: đầu năm học), chọn tháng đầu tiên
            if (!reportValueSelect.value && reportValueSelect.options.length > 0) {
                reportValueSelect.selectedIndex = 0;
            }

            // 6. Tự động tạo báo cáo khi tải trang
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
        allHolidays = holidaysSnapshot.docs.map(doc => doc.data()); // { name, type, startDate, endDate }
    };

    const loadAllGroups = async () => {
        const groupsQuery = query(collection(firestore, 'groups'), where('schoolYear', '==', currentSchoolYear), orderBy('order'));
        const groupsSnapshot = await getDocs(groupsQuery);
        allGroups = groupsSnapshot.docs.map(doc => doc.data());
    };

    const loadAllTeachers = async () => {
        // Sửa lỗi: Collection 'teachers' không có trường 'schoolYear'.
        // Logic mới: Lấy tất cả giáo viên, sau đó lọc dựa trên group_id thuộc năm học hiện tại.
        if (allGroups.length === 0) {
            allTeachers = [];
            return;
        }

        // Lấy danh sách các group_id của năm học hiện tại
        const groupIdsInYear = allGroups.map(g => g.group_id);

        // Lấy tất cả giáo viên có group_id nằm trong danh sách trên
        // Firestore giới hạn 30 giá trị cho toán tử 'in', nếu nhiều hơn cần chia nhỏ query.
        // Với quy mô trường học, 30 tổ là đủ.
        const teachersQuery = query(collection(firestore, 'teachers'), where('group_id', 'in', groupIdsInYear), orderBy('teacher_name'));
        const teachersSnapshot = await getDocs(teachersQuery);
        allTeachers = teachersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    };

    const updateFilterValueOptions = () => {
        const filterType = reportTypeSelect.value;
        reportValueSelect.innerHTML = '';

        switch (filterType) {
            case 'month':
                // Generate month options based on time plan
                const months = new Set();
                timePlan.forEach(week => {
                    // Get month from start and end date of the week
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

    // NEW: Helper function to check if a date is a holiday
    const isHoliday = (dateString) => {
        if (!dateString || allHolidays.length === 0) return false;
        // The dateString is 'YYYY-MM-DD'. We can compare strings directly.
        for (const holiday of allHolidays) {
            if (dateString >= holiday.startDate && dateString <= holiday.endDate) {
                return true;
            }
        }
        return false;
    };

    const generateReport = async () => {
        const filterType = reportTypeSelect.value;
        const filterValue = reportValueSelect.value; // e.g., '9' for month, '1' for semester
        let startDate, endDate, reportTitle, reportSubtitle;

        if (timePlan.length === 0) {
            // NEW: Also check for holidays
            if (allHolidays.length === 0) showToast('Chưa có dữ liệu ngày nghỉ cho năm học này.', 'info');
            showToast('Chưa có kế hoạch thời gian cho năm học này.', 'error');
            return;
        }

        // Determine date range and title
        switch (filterType) {
            case 'month':
                const month = parseInt(filterValue);
                const reportDay = timePlanConfig.reportDay;
                
                // Tính toán lại tháng báo cáo cho mỗi tuần dựa trên cấu hình
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
                if (filterValue === '1') { // Học kỳ I
                    startDate = timePlan[0].startDate;
                    endDate = timePlan[semester1EndWeek - 1]?.endDate || timePlan[timePlan.length - 1].endDate;
                    reportTitle = 'BÁO CÁO';
                    reportSubtitle = 'Học kỳ I';
                } else { // Học kỳ II
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
            // 1. Khởi tạo dữ liệu báo cáo với tất cả giáo viên và tổ chuyên môn
            const groupData = new Map();
            allGroups.forEach(group => {
                groupData.set(group.group_id, { name: group.group_name, count: 0 });
            });

            const teacherData = new Map();
            allTeachers.forEach(teacher => {
                // Find group name for the teacher
                const group = allGroups.find(g => g.group_id === teacher.group_id);
                teacherData.set(teacher.uid, { name: teacher.teacher_name, groupName: group ? group.group_name : 'N/A', count: 0 });
            });

            // 2. Lấy các lượt đăng ký trong khoảng thời gian đã chọn để cập nhật số đếm
            const regsQuery = query(
                collection(firestore, 'registrations'),
                where('schoolYear', '==', currentSchoolYear),
                where('date', '>=', startDate),
                where('date', '<=', endDate)
            );
            const snapshot = await getDocs(regsQuery);

            // 3. Cập nhật số đếm từ dữ liệu đăng ký
            const teacherGroupMap = new Map(allTeachers.map(t => [t.uid, t.group_id]));
            let holidayRegsCount = 0; // NEW: Count registrations on holidays
            snapshot.forEach(doc => {
                const reg = doc.data();

                // NEW: Check if the registration date is a holiday and skip if it is
                if (isHoliday(reg.date)) {
                    holidayRegsCount++;
                    return; // Skip this registration
                }

                let groupIdToCount = reg.group_id;

                // Fallback: If groupId is missing on the registration, find it from the teacher's data
                if (!groupIdToCount && reg.teacherId) {
                    groupIdToCount = teacherGroupMap.get(reg.teacherId);
                }

                // Count for group
                if (groupIdToCount && groupData.has(groupIdToCount)) {
                    groupData.get(groupIdToCount).count++;
                }

                // Count for teacher
                if (teacherData.has(reg.teacherId)) {
                    teacherData.get(reg.teacherId).count++;
                }
            });

            // 4. Render báo cáo với dữ liệu đã được tổng hợp
            renderReport(reportTitle, reportSubtitle, groupData, teacherData, endDate, holidayRegsCount);

        } catch (error) {
            console.error("Lỗi khi tạo báo cáo:", error);
            showToast('Lỗi khi tạo báo cáo. Kiểm tra Firestore Index.', 'error');
            reportPage.innerHTML = '<p class="error-message">Đã có lỗi xảy ra.</p>';
        }
    };

    const renderReport = (title, subtitle, groupData, teacherData, reportEndDate, holidayRegsCount) => {
        // --- Teacher Table ---
        let teacherTableRows = '';
        let teacherTotalCount = 0;
        let teacherIndex = 1;
        const sortedTeachers = [...teacherData.values()].sort((a, b) => b.count - a.count);

        sortedTeachers.forEach(teacher => {
            teacherTableRows += `
                <tr>
                    <td style="text-align: center;">${teacherIndex++}</td>
                    <td>${teacher.name}</td>
                    <td>${teacher.groupName}</td>
                    <td style="text-align: center;">${teacher.count}</td>
                    <td></td>
                </tr>
            `;
            teacherTotalCount += teacher.count;
        });

        // --- Group Table ---
        let groupTableRows = '';
        let groupTotalCount = 0;
        let groupIndex = 1;

        groupData.forEach(group => {
            groupTableRows += `
                <tr>
                    <td style="text-align: center;">${groupIndex++}</td>
                    <td>${group.name}</td>
                    <td style="text-align: center;">${group.count}</td>
                    <td></td>
                </tr>
            `;
            groupTotalCount += group.count;
        });


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


            <h4>1. Tình hình sử dụng thiết bị theo giáo viên</h4>
            <table class="report-table" id="teacher-report-table">
                <thead>
                    <tr>
                        <th style="width: 10%;">STT</th>
                        <th style="width: 30%;">Giáo viên</th>
                        <th style="width: 30%;">Tổ chuyên môn</th>
                        <th style="width: 20%;">Số lượt đăng ký</th>
                        <th style="width: 20%;">Ghi chú</th>
                    </tr>
                </thead>
                <tbody>
                    ${teacherTableRows}
                    <tr class="total-row">
                        <td colspan="3" style="text-align: center; font-weight: bold;">Tổng cộng</td>
                        <td style="text-align: center; font-weight: bold;">${teacherTotalCount}</td>
                        <td></td>
                    </tr>
                </tbody>
            </table>

            <h4>2. Tình hình sử dụng thiết bị theo tổ chuyên môn</h4>
            <table class="report-table" id="group-report-table">
                <thead>
                    <tr>
                        <th style="width: 10%;">STT</th>
                        <th style="width: 60%;">Tổ chuyên môn</th>
                        <th style="width: 20%;">Số lượt đăng ký</th>
                        <th style="width: 20%;">Ghi chú</th>
                    </tr>
                </thead>
                <tbody>
                    ${groupTableRows}
                    <tr class="total-row">
                        <td colspan="2" style="text-align: center; font-weight: bold;">Tổng cộng</td>
                        <td style="text-align: center; font-weight: bold;">${groupTotalCount}</td>
                        <td></td>
                    </tr>
                </tbody>
            </table>

            <div class="report-signature">
                <div class="signature-block">
                    <p class="signature-date"><i>${signatureDate}</i></p>
                    <p class="signature-title"><b>NGƯỜI LÀM BÁO CÁO</b></p>
                    <br><br><br><br><br><br>
                    <p class="signature-name"><b>${document.getElementById('user-name')?.textContent || 'Quản lý'}</b></p>
                </div>
            </div>
        `;
        reportPage.innerHTML = reportHTML;
    };

    // --- Event Listeners ---
    reportTypeSelect.addEventListener('change', updateFilterValueOptions);
    viewReportBtn.addEventListener('click', generateReport);

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
        
        // Sử dụng html2canvas để chụp ảnh chất lượng cao hơn
        const canvas = await html2canvas(reportContent, {
            scale: 2, // Tăng độ phân giải để ảnh nét hơn
            useCORS: true,
            logging: false,
        });

        const imgData = canvas.toDataURL('image/png');
        const { jsPDF } = window.jspdf;

        // Khởi tạo jsPDF với định dạng A4
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

        // Tính toán chiều cao của ảnh trong PDF để giữ đúng tỷ lệ
        const imgHeightInPdf = pdfWidth / ratio;

        let heightLeft = imgHeightInPdf;
        let position = 0;

        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeightInPdf);
        heightLeft -= pdfHeight;

        pdf.save('bao-cao.pdf');
        showToast('Đã xuất file PDF thành công!', 'success');
    });

    // --- Run ---
    initializePage();
});