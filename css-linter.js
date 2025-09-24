// D:\Project\clvProject\css-linter.js

const fs = require('fs');
const path = require('path');

// --- Cấu hình ---
const projectRoot = __dirname; // Thư mục gốc của dự án
const publicDir = path.join(projectRoot, 'public');
const cssDir = path.join(publicDir, 'css');
const MAX_SELECTOR_DEPTH = 3; // Độ sâu tối đa cho phép của selector (ví dụ: .a .b .c)
const IGNORE_FILES = ['login-effects.css', 'style.css']; // Các file CSS bỏ qua kiểm tra nội dung

// --- Biến toàn cục ---
let violations = [];
let definedCssClasses = new Map(); // Map: className -> filePath
let usedClasses = new Set();
let definedCssVariables = new Map(); // Map: variableName -> filePath
let usedCssVariables = new Set();

// --- Các hàm kiểm tra ---

/**
 * Kiểm tra thứ tự các tệp CSS trong một tệp HTML.
 * @param {string} filePath Đường dẫn đến tệp HTML.
 * @param {string} fileContent Nội dung tệp HTML.
 */
function checkCssOrderInHtml(filePath, fileContent) {
    const cssLinks = [...fileContent.matchAll(/<link.*rel="stylesheet".*href="(.*?)".*>/g)].map(m => m[1].split('?')[0]); // Bỏ query string nếu có
    if (cssLinks.length === 0) return;

    const sharedLayoutIndex = cssLinks.findIndex(link => /shared-layout\.css$/.test(link));
    const roleLayoutIndex = cssLinks.findIndex(link => /(manager|teacher|supervisory)-layout\.css$/.test(link));

    // Chỉ kiểm tra nếu cả hai file layout đều tồn tại
    if (sharedLayoutIndex !== -1 && roleLayoutIndex !== -1) {
        if (sharedLayoutIndex > roleLayoutIndex) {
            const sharedLayoutFile = cssLinks[sharedLayoutIndex];
            const roleLayoutFile = cssLinks[roleLayoutIndex];

            violations.push({
                file: filePath,
                type: 'CSS Order',
                line: null,
                // Thông báo lỗi mới, rõ ràng hơn
                message: `Thứ tự CSS sai: '${sharedLayoutFile}' (cấp 1) phải được đặt trước '${roleLayoutFile}' (cấp 2).`
            });
        }
    }
}

/**
 * Kiểm tra nội dung của một tệp CSS.
 * @param {string} filePath Đường dẫn đến tệp CSS.
 */
function checkCssContent(filePath) {
    const fileName = path.basename(filePath);
    if (IGNORE_FILES.includes(fileName)) return;

    const fileContent = fs.readFileSync(filePath, 'utf8');
    const lines = fileContent.split('\n');

    // Trích xuất tất cả các class được định nghĩa trong file này
    // Cải tiến regex: class phải bắt đầu bằng chữ cái, theo sau là chữ, số, gạch dưới, gạch ngang.
    const classRegex = /\.([a-zA-Z][a-zA-Z0-9_-]*)/g;
    let match;
    while ((match = classRegex.exec(fileContent)) !== null) {
        const className = match[1];
        // Chỉ thêm nếu class này chưa được định nghĩa ở file khác
        // Điều này giúp xác định file gốc của class
        if (!definedCssClasses.has(className)) {
            definedCssClasses.set(className, filePath);
        }
    }

    lines.forEach((line, index) => {
        const lineNumber = index + 1;

        // 1. Kiểm tra `!important`
        if (line.includes('!important')) {
            violations.push({
                file: filePath,
                type: 'Usage',
                line: lineNumber,
                message: `Phát hiện sử dụng '!important'. Cân nhắc xóa bỏ để tránh ghi đè không mong muốn.`
            });
        }

        // 2. Kiểm tra selector dùng ID (trừ khi nó là một phần của selector thuộc tính)
        if (line.match(/#[a-zA-Z0-9_-]+(?![^\{]*\})/) && !line.includes('href="#')) {
             if (line.trim().startsWith('#')) {
                violations.push({
                    file: filePath,
                    type: 'Specificity',
                    line: lineNumber,
                    message: `Phát hiện selector ID '${line.match(/#[a-zA-Z0-9_-]+/)[0]}'. Hạn chế dùng ID để định kiểu.`
                });
             }
        }

        // 3. Kiểm tra selector lồng nhau quá sâu
        const selectorPart = line.split('{')[0].trim();
        // Chỉ kiểm tra nếu dòng này thực sự chứa một selector (có dấu '{')
        if (line.includes('{')) {
            if (selectorPart && !selectorPart.startsWith('@') && !selectorPart.startsWith('/*')) {
                // Tách các selector được nhóm bởi dấu phẩy để kiểm tra riêng lẻ
                const individualSelectors = selectorPart.split(',');
                individualSelectors.forEach(individualSelector => {
                    const trimmedSelector = individualSelector.trim();
                    // Đếm số lượng phần tử/combinator để xác định độ sâu
                    const depth = (trimmedSelector.split(/[ >+~]/).filter(p => p.trim() !== '').length);
                    if (depth > MAX_SELECTOR_DEPTH) {
                         violations.push({
                            file: filePath,
                            type: 'Specificity',
                            line: lineNumber,
                            message: `Selector lồng nhau quá sâu (độ sâu ${depth}). Cân nhắc đơn giản hóa: "${trimmedSelector}"`
                        });
                    }
                });
            }
        }
    });
}

/**
 * Kiểm tra các class CSS không được sử dụng.
 */
function checkForUnusedClasses() {
    // Một số class được sinh ra bởi JS hoặc có mục đích đặc biệt, cần bỏ qua
    const DYNAMIC_CLASSES_TO_IGNORE = new Set([
        'show', 'active', 'highlight', 'collapsed', 'expanded', 'highlighted', 'dimmed',
        'sortable-ghost', 'sortable-chosen', 'sortable-drag',
        'has-error', 'is-valid'
    ]);

    for (const [className, filePath] of definedCssClasses.entries()) {
        if (!usedClasses.has(className) && !DYNAMIC_CLASSES_TO_IGNORE.has(className)) {
            violations.push({
                file: filePath,
                type: 'Unused CSS',
                line: null, // Khó xác định dòng chính xác, nên để null
                message: `Class '.${className}' được định nghĩa nhưng không được sử dụng trong HTML hoặc JS.`
            });
        }
    }
}

/**
 * Kiểm tra các biến CSS không được sử dụng.
 */
function checkForUnusedVariables() {
    for (const [varName, filePath] of definedCssVariables.entries()) {
        if (!usedCssVariables.has(varName)) {
            violations.push({
                file: filePath,
                type: 'Unused CSS Variable',
                line: null, // Khó xác định dòng chính xác, nên để null
                message: `Biến CSS '${varName}' được định nghĩa nhưng không được sử dụng.`
            });
        }
    }
}

/**
 * Trích xuất các class được sử dụng từ file HTML và JS.
 * @param {string} filePath Đường dẫn đến tệp.
 * @param {string} fileContent Nội dung tệp.
 */
function extractUsedClasses(filePath, fileContent) {
    // Regex cho thuộc tính class="..." trong HTML
    const htmlClassRegex = /class="([^"]+)"/g;
    // Regex cho các chuỗi ký tự trông giống class trong JS
    const jsClassRegex = /['"`]([a-zA-Z0-9_ -]+)['"`]/g;

    const regex = path.extname(filePath) === '.html' ? htmlClassRegex : jsClassRegex;
    let match;
    while ((match = regex.exec(fileContent)) !== null) {
        match[1].split(' ').forEach(cls => cls.trim() && usedClasses.add(cls.trim()));
    }
}

/**
 * Trích xuất các biến CSS được định nghĩa và sử dụng.
 * @param {string} filePath Đường dẫn đến tệp.
 * @param {string} fileContent Nội dung tệp.
 */
function extractCssVariables(filePath, fileContent) {
    const definitionRegex = /(--[a-zA-Z0-9_-]+)\s*:/g;
    const usageRegex = /var\(\s*(--[a-zA-Z0-9_-]+)\s*\)/g; // Cho phép khoảng trắng bên trong var()
    let match;

    // Tìm các định nghĩa
    while ((match = definitionRegex.exec(fileContent)) !== null) {
        const varName = match[1];
        if (!definedCssVariables.has(varName)) {
            definedCssVariables.set(varName, filePath);
        }
    }

    // Tìm các lần sử dụng
    while ((match = usageRegex.exec(fileContent)) !== null) {
        usedCssVariables.add(match[1]);
    }
}

/**
 * Hàm chính để quét toàn bộ dự án.
 * @param {string} dir Đường dẫn thư mục để quét.
 */
function scanDirectory(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            scanDirectory(fullPath);
        } else {
            const content = fs.readFileSync(fullPath, 'utf8');
            if (path.extname(fullPath) === '.html') {
                checkCssOrderInHtml(fullPath, content);
                extractUsedClasses(fullPath, content);
            } else if (path.extname(fullPath) === '.css') {
                extractUsedClasses(fullPath, content);
                extractCssVariables(fullPath, content);
                checkCssContent(fullPath);
            } else if (path.extname(fullPath) === '.js') {
                // Quét cả file JS để tìm các class được sử dụng
                extractUsedClasses(fullPath, content);
            }
        }
    }
}

/**
 * In báo cáo ra console.
 */
function printReport() {
    console.log('\n--- BÁO CÁO KIỂM TRA CSS ---');
    if (violations.length === 0) {
        console.log('\x1b[32m%s\x1b[0m', '✅ Tuyệt vời! Không tìm thấy vi phạm nào.');
        return;
    }

    console.log(`\x1b[31m%s\x1b[0m`, `❌ Tìm thấy tổng cộng ${violations.length} vi phạm:\n`);

    const violationsByFile = violations.reduce((acc, v) => {
        const relativePath = path.relative(projectRoot, v.file);
        if (!acc[relativePath]) {
            acc[relativePath] = [];
        }
        acc[relativePath].push(v);
        return acc;
    }, {});

    for (const file in violationsByFile) {
        console.log(`\x1b[1m\x1b[33mFile: ${file}\x1b[0m`); // In đậm, màu vàng
        violationsByFile[file].forEach(v => {
            const lineInfo = v.line ? ` (Dòng ${v.line})` : '';
            console.log(`  - [\x1b[36m${v.type}\x1b[0m]${lineInfo}: ${v.message}`);
        });
        console.log(''); // Thêm dòng trống cho dễ đọc
    }
}

// --- Chạy chương trình ---
console.log('Bắt đầu quét dự án...');
scanDirectory(publicDir);
checkForUnusedClasses(); // Chạy kiểm tra class không sử dụng sau khi đã quét hết
checkForUnusedVariables(); // Chạy kiểm tra biến CSS không sử dụng
printReport();
