// D:\Project\clvProject\linter.js

const fs = require('fs');
const path = require('path');

// --- Cấu hình ---
const projectRoot = __dirname; // Thư mục gốc của dự án
const publicDir = path.join(projectRoot, 'public');
const cssDir = path.join(publicDir, 'css');
const MAX_SELECTOR_DEPTH = 3; // Độ sâu tối đa cho phép của selector (ví dụ: .a .b .c)
const IGNORE_FILES_CSS_CONTENT = ['login-effects.css', 'style.css']; // Các file CSS bỏ qua kiểm tra nội dung
const IGNORE_CONSOLE_LOG_IN_FILES = ['auth-guard.js']; // Bỏ qua kiểm tra console.log trong các file này
const DEPRECATED_HTML_TAGS = ['b', 'i', 'font', 'center']; // Các thẻ HTML không nên dùng để định dạng

// --- Biến toàn cục ---
let violations = [];
let fileCount = { html: 0, css: 0, js: 0, total: 0 };
let definedCssClasses = new Map(); // Map: className -> filePath
let usedClasses = new Set();
let definedCssVariables = new Map(); // Map: variableName -> filePath
let usedCssVariables = new Set();
let cssRuleHashes = new Map(); // Map: hash -> { files: Set<string>, content: string }
let jsFunctionHashes = new Map(); // Map: hash -> { files: Set<string>, content: string }

// --- Các hàm kiểm tra ---

/**
 * Kiểm tra thứ tự các tệp CSS trong một tệp HTML.
 * @param {string} filePath Đường dẫn đến tệp HTML.
 * @param {string} fileContent Nội dung tệp HTML.
 */

/**
 * Xác định mức độ ưu tiên sửa lỗi dựa trên tên tệp.
 * @param {string} filePath 
 * @returns {number} 0 (thấp), 1 (trung bình), 2 (cao)
 */
function getFilePriority(filePath) {
    const fileName = path.basename(filePath);
    // Cấp 0: Lõi, dùng chung toàn hệ thống
    if (['shared-layout.css', 'toast.js', 'auth-guard.js', 'firebase-config.js', 'main.js'].includes(fileName)) {
        return 0; // Ưu tiên thấp
    }
    // Cấp 1: Layout hoặc nav theo vai trò
    if (/(manager|teacher|supervisory)-(layout\.css|nav\.js)$/.test(fileName)) {
        return 1; // Ưu tiên trung bình
    }
    // Cấp 2: Các file còn lại, dành riêng cho từng trang
    return 2; // Ưu tiên cao
}

/**
 * Kiểm tra thứ tự các tệp CSS trong một tệp HTML.
 * @param {string} filePath Đường dẫn đến tệp HTML.
 * @param {string} fileContent Nội dung tệp HTML.
 */
function checkCssOrderInHtml(filePath, fileContent) {
    // Lấy tất cả các link CSS trỏ đến thư mục /css/
    const cssLinks = [...fileContent.matchAll(/<link.*rel="stylesheet".*href="([^"]*css\/[^"]+\.css)".*>/g)]
        .map(m => path.basename(m[1].split('?')[0])); // Chỉ lấy tên file

    if (cssLinks.length === 0) return;

    const sharedLayoutIndex = cssLinks.indexOf('shared-layout.css');

    // Nếu không tìm thấy shared-layout.css thì không cần kiểm tra
    if (sharedLayoutIndex === -1) return;
    
    // Tìm file CSS "riêng" đầu tiên (không phải shared-layout.css)
    const firstSpecificCssIndex = cssLinks.findIndex(link => link !== 'shared-layout.css');
    
    // Nếu có file riêng và file chung được đặt sau file riêng đầu tiên -> Báo lỗi
    if (firstSpecificCssIndex !== -1 && sharedLayoutIndex > firstSpecificCssIndex) {
        const specificCssFile = cssLinks[firstSpecificCssIndex];
            violations.push({
                file: filePath,
                type: 'CSS Order',
                line: null,
                priority: getFilePriority(filePath),
                message: `Thứ tự CSS sai: file chung 'shared-layout.css' phải được đặt trước file riêng '${specificCssFile}'.`
            });
    }
}

/**
 * Kiểm tra nội dung của một tệp CSS.
 * @param {string} filePath Đường dẫn đến tệp CSS.
 */
function processCssFile(filePath, fileContent) {
    const fileName = path.basename(filePath);
    // Trích xuất class và biến từ nội dung gốc (bao gồm cả comment)
    extractUsedClasses(filePath, fileContent);
    extractCssVariables(filePath, fileContent);
    
    // Loại bỏ tất cả các khối comment (/* ... */) trước khi phân tích
    const contentWithoutComments = fileContent.replace(/\/\*[\s\S]*?\*\//g, '');
    findCssDuplicates(filePath, contentWithoutComments); // Tìm trùng lặp trên code sạch
    if (IGNORE_FILES_CSS_CONTENT.includes(fileName)) return;

    const lines = contentWithoutComments.split('\n');

    // Trích xuất tất cả các class được định nghĩa trong file này
    // Cải tiến regex: class phải bắt đầu bằng chữ cái, theo sau là chữ, số, gạch dưới, gạch ngang.
    const classRegex = /\.([a-zA-Z][a-zA-Z0-9_-]*)/g;
    let match;
    while ((match = classRegex.exec(contentWithoutComments)) !== null) {
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
                priority: getFilePriority(filePath),
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
                    priority: getFilePriority(filePath),
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
                            priority: getFilePriority(filePath),
                            message: `Selector lồng nhau quá sâu (độ sâu ${depth}). Cân nhắc đơn giản hóa: "${trimmedSelector}"`
                        });
                    }
                });
            }
        }
    });
}

/**
 * Kiểm tra nội dung của một tệp HTML.
 * @param {string} filePath Đường dẫn đến tệp HTML.
 * @param {string} fileContent Nội dung tệp HTML.
 */
function processHtmlFile(filePath, fileContent) {
    // Các hàm này cần quét nội dung gốc để tìm class và thứ tự file
    checkCssOrderInHtml(filePath, fileContent);
    extractUsedClasses(filePath, fileContent);

    const lines = fileContent.replace(/<!--[\s\S]*?-->/g, '').split('\n'); // Xóa comment HTML trước khi kiểm tra
    lines.forEach((line, index) => {
        const lineNumber = index + 1;

        // 1. Kiểm tra inline style
        if (line.match(/style\s*=\s*"/)) {
            violations.push({
                file: filePath, type: 'HTML Best Practice', line: lineNumber, priority: getFilePriority(filePath),
                message: `Phát hiện inline style. Nên chuyển vào file CSS.`
            });
        }

        // 2. Kiểm tra thẻ không nên dùng
        DEPRECATED_HTML_TAGS.forEach(tag => {
            const regex = new RegExp(`<${tag}[>\\s]`, 'i');
            if (regex.test(line)) {
                violations.push({
                    file: filePath, type: 'HTML Deprecated Tag', line: lineNumber, priority: getFilePriority(filePath),
                    message: `Thẻ <${tag}> không nên dùng để định dạng. Sử dụng CSS hoặc thẻ ngữ nghĩa (<strong>, <em>).`
                });
            }
        });

        // 3. Kiểm tra thiếu 'alt' cho <img>
        const imgMatches = [...line.matchAll(/<img\s+[^>]*>/gi)];
        imgMatches.forEach(match => {
            if (!/alt\s*=\s*"/i.test(match[0])) {
                violations.push({
                    file: filePath, type: 'Accessibility', line: lineNumber, priority: getFilePriority(filePath),
                    message: `Thẻ <img> thiếu thuộc tính 'alt'.`
                });
            }
        });

        // 4. Kiểm tra thiếu 'title' cho nút icon
        const iconButtonMatches = [...line.matchAll(/<button[^>]+class="[^"]*icon-button[^"]*"[^>]*>/gi)];
        iconButtonMatches.forEach(match => {
            if (!/title\s*=\s*"/i.test(match[0]) && match[0].includes('<i')) {
                violations.push({
                    file: filePath, type: 'Accessibility', line: lineNumber, priority: getFilePriority(filePath),
                    message: `Nút chỉ có icon cần thuộc tính 'title' để giải thích chức năng.`
                });
            }
        });
    });
}

/**
 * Kiểm tra nội dung của một tệp JavaScript.
 * @param {string} filePath Đường dẫn đến tệp JS.
 * @param {string} fileContent Nội dung tệp JS.
 */
function processJsFile(filePath, fileContent) {
    // Trích xuất class từ nội dung gốc
    extractUsedClasses(filePath, fileContent);
    
    // Xóa comment trước khi tìm hàm trùng lặp và các lỗi khác
    const contentWithoutComments = fileContent.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
    findJsDuplicates(filePath, contentWithoutComments);

    const fileName = path.basename(filePath);
    if (IGNORE_CONSOLE_LOG_IN_FILES.includes(fileName)) return;

    const lines = contentWithoutComments.split('\n');
    lines.forEach((line, index) => {
        // 1. Kiểm tra console.log, console.warn, console.error
        if (line.match(/console\.(log|warn|error|info|debug)\s*\(/)) {
            violations.push({
                file: filePath, type: 'Code Smell', line: index + 1, priority: getFilePriority(filePath),
                message: `Phát hiện '${line.match(/console\.\w+/)[0]}'. Cần xóa trước khi deploy.`
            });
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
                priority: getFilePriority(filePath),
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
                priority: getFilePriority(filePath),
                message: `Biến CSS '${varName}' được định nghĩa nhưng không được sử dụng.`
            });
        }
    }
}

/**
 * Kiểm tra mã CSS bị lặp lại.
 */
function checkForCssDuplicates() {
    for (const [hash, data] of cssRuleHashes.entries()) {
        if (data.files.size > 1) {
            const fileList = [...data.files].map(f => path.relative(projectRoot, f)).join(', ');
            violations.push({
                file: [...data.files][0], // Báo cáo ở file đầu tiên tìm thấy
                type: 'Duplicated CSS',
                line: null,
                priority: 1, // Lỗi trùng lặp có ưu tiên trung bình
                message: `Khối CSS sau bị lặp lại trong các tệp: ${fileList}. Đề xuất tạo một class dùng chung trong 'shared-layout.css'.\n   Block: ${data.content.replace(/\n/g, ' ')}`
            });
        }
    }
}

/**
 * Kiểm tra mã JS bị lặp lại.
 */
function checkForJsDuplicates() {
    for (const [hash, data] of jsFunctionHashes.entries()) {
        if (data.files.size > 1) {
            const fileList = [...data.files].map(f => path.relative(projectRoot, f)).join(', ');
            // Sử dụng tên hàm đã được lưu từ trước
            const functionName = data.name; 
            violations.push({ 
                file: [...data.files][0], 
                type: 'Duplicated JS', 
                line: null, priority: 1, 
                message: `Hàm '${functionName}' bị lặp lại trong các tệp: ${fileList}. Đề xuất chuyển vào một tệp helper chung (ví dụ: 'utils.js').` 
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
 * Tìm các khối CSS trùng lặp.
 * @param {string} filePath Đường dẫn đến tệp.
 * @param {string} fileContent Nội dung tệp.
 */
function findCssDuplicates(filePath, fileContent) {
    const ruleRegex = /\{([^}]+)\}/g;
    let match;
    while ((match = ruleRegex.exec(fileContent)) !== null) {
        const content = match[1].trim();
        if (!content) continue;

        // Chuẩn hóa: xóa khoảng trắng thừa, sắp xếp thuộc tính
        const normalizedContent = content.split(';')
            .map(s => s.trim())
            .filter(Boolean)
            .sort()
            .join(';');

        if (!cssRuleHashes.has(normalizedContent)) {
            cssRuleHashes.set(normalizedContent, { files: new Set(), content: `{ ${content} }` });
        }
        cssRuleHashes.get(normalizedContent).files.add(filePath);
    }
}

/**
 * Tìm các hàm JS trùng lặp.
 * @param {string} filePath Đường dẫn đến tệp.
 * @param {string} fileContent Nội dung tệp.
 */
function findJsDuplicates(filePath, fileContent) {
    // Regex mới:
    // 1. (const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(async\s*)?\([^)]*\)\s*=>\s*\{[\s\S]*?\}
    //    - Bắt các arrow function được gán cho biến (const, let, var).
    // 2. (async\s+)?function\s+([a-zA-Z0-9_]+)\s*\([^)]*\)\s*\{[\s\S]*?\}
    //    - Bắt các function declaration thông thường.
    const funcRegex = /(?:(const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(async\s*)?\([^)]*\)\s*=>\s*\{[\s\S]*?\}|(async\s+)?function\s+([a-zA-Z0-9_]+)\s*\([^)]*\)\s*\{[\s\S]*?\})/g;
    let match;
    while ((match = funcRegex.exec(fileContent)) !== null) {
        const fullFunctionString = match[0];
        // Lấy tên hàm từ các capturing group khác nhau của regex
        const functionName = match[2] || match[6] || 'anonymous'; 

        // Chuẩn hóa bằng cách xóa khoảng trắng thừa để so sánh chính xác hơn
        const normalizedContent = fullFunctionString.replace(/\s+/g, ' '); 

        if (!jsFunctionHashes.has(normalizedContent)) {
            jsFunctionHashes.set(normalizedContent, { files: new Set(), content: fullFunctionString, name: functionName });
        }
        jsFunctionHashes.get(normalizedContent).files.add(filePath);
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
            fileCount.total++;
            if (path.extname(fullPath) === '.html') {
                fileCount.html++;
                processHtmlFile(fullPath, content);
            } else if (path.extname(fullPath) === '.css') {
                fileCount.css++;
                processCssFile(fullPath, content);
            } else if (path.extname(fullPath) === '.js') {
                fileCount.js++;
                processJsFile(fullPath, content);
            }
        }
    }
}

/**
 * In báo cáo ra console.
 */
function printReport(targetFile = null) {
    // Sắp xếp các vi phạm theo mức độ ưu tiên (cao đến thấp), sau đó theo tên tệp
    violations.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.file.localeCompare(b.file);
    });

    if (targetFile) {
        // --- CHẾ ĐỘ KIỂM TRA FILE CỤ THỂ ---
        const relativeTargetPath = path.relative(projectRoot, targetFile);
        const fileViolations = violations.filter(v => path.relative(projectRoot, v.file) === relativeTargetPath);

        if (fileViolations.length === 0) {
            console.log(`\n\x1b[32m✅ SUCCESS!\x1b[0m File \x1b[33m${relativeTargetPath}\x1b[0m đã được refactor thành công.`);
            
            // Tìm file tiếp theo cần sửa (file không phải là file vừa sửa xong)
            const nextViolation = violations.find(v => path.relative(projectRoot, v.file) !== relativeTargetPath);
            if (nextViolation) {
                const nextFileToFix = path.relative(projectRoot, nextViolation.file);
                console.log('\nTiếp theo, hãy xử lý file này:');
                console.log(`\x1b[36mnode linter.js ${nextFileToFix}\x1b[0m`);
            } else {
                console.log('\n\x1b[1m\x1b[32m✨✨✨ CHÚC MỪNG! Toàn bộ dự án đã được dọn dẹp! ✨✨✨\x1b[0m');
            }
        } else {
            console.log(`\n\x1b[31m❌ RECHECK:\x1b[0m File \x1b[33m${relativeTargetPath}\x1b[0m vẫn còn \x1b[31m${fileViolations.length}\x1b[0m lỗi:`);
            fileViolations.forEach((v, index) => {
                const lineInfo = v.line ? ` (Dòng ${v.line})` : '';
                console.log(`  ${index + 1}. [\x1b[36m${v.type}\x1b[0m][Ưu tiên: ${v.priority}]${lineInfo}: ${v.message}`);
            });
            console.log('\nSau khi sửa, hãy chạy lại lệnh sau để kiểm tra:');
            console.log(`\x1b[36mnode linter.js ${relativeTargetPath}\x1b[0m`);
        }

    } else {
        // --- CHẾ ĐỘ TÌM LỖI (MẶC ĐỊNH) ---
        console.log(`\n--- BÁO CÁO KIỂM TRA MÃ NGUỒN (Đã quét ${fileCount.total} files) ---`);
        if (violations.length === 0) {
            console.log('\x1b[32m%s\x1b[0m', '✅ Tuyệt vời! Không tìm thấy vi phạm nào.');
            return;
        }

        // Chỉ lấy file đầu tiên trong danh sách đã sắp xếp
        const highestPriorityFile = path.relative(projectRoot, violations[0].file);
        const violationsForFile = violations.filter(v => path.relative(projectRoot, v.file) === highestPriorityFile);

        console.log(`\n\x1b[33m⚠️ File cần refactor tiếp theo (ưu tiên cao nhất):\x1b[0m \x1b[1m${highestPriorityFile}\x1b[0m`);
        console.log(`Tìm thấy \x1b[31m${violationsForFile.length}\x1b[0m lỗi trong file này:`);

        violationsForFile.forEach((v, index) => {
            const lineInfo = v.line ? ` (Dòng ${v.line})` : '';
            console.log(`  ${index + 1}. [\x1b[36m${v.type}\x1b[0m][Ưu tiên: ${v.priority}]${lineInfo}: ${v.message}`);
        });

        // Thêm dòng prompt gợi ý cho AI
        const aiPrompt = `[PROMPT_SUGGESTION]Dựa vào các vi phạm trên, hãy refactor file ${highestPriorityFile}`;
        console.log(`\n  \x1b[35m${aiPrompt}\x1b[0m`); // In màu tím cho dễ nhận biết

        console.log('\nSau khi refactor file này, hãy chạy lệnh sau để kiểm tra lại:');
        console.log(`\x1b[36mnode linter.js ${highestPriorityFile}\x1b[0m`);
    }
}

// --- Chạy chương trình ---
const targetFile = process.argv[2] ? path.join(projectRoot, process.argv[2]) : null;

if (targetFile && !fs.existsSync(targetFile)) {
    console.error(`\x1b[31m Lỗi: Không tìm thấy file '${process.argv[2]}'. Vui lòng kiểm tra lại đường dẫn.\x1b[0m`);
    return;
}

console.log('Bắt đầu quét dự án...');
scanDirectory(publicDir);
checkForUnusedClasses(); // Chạy kiểm tra class không sử dụng sau khi đã quét hết
checkForUnusedVariables(); // Chạy kiểm tra biến CSS không sử dụng
checkForCssDuplicates(); // Chạy kiểm tra CSS trùng lặp
checkForJsDuplicates(); // Chạy kiểm tra JS trùng lặp
printReport(targetFile);
