const db = require('../models/db');
const xlsx = require('xlsx');

// Hàm thiết yếu: Sửa lỗi file Excel Viễn thông khai báo sai vùng dữ liệu (!ref)
// Ép Node.js đọc tới tận dòng cuối cùng thay vì bị ngắt quãng ở dòng 6 hoặc 10
function fixSheetRange(sheet) {
    if (!sheet) return sheet;
    let range = { s: { c: 10000000, r: 10000000 }, e: { c: 0, r: 0 } };
    let hasCells = false;
    for (let key in sheet) {
        if (key[0] === '!') continue;
        try {
            let cell = xlsx.utils.decode_cell(key);
            if (cell.r < range.s.r) range.s.r = cell.r;
            if (cell.c < range.s.c) range.s.c = cell.c;
            if (cell.r > range.e.r) range.e.r = cell.r;
            if (cell.c > range.e.c) range.e.c = cell.c;
            hasCells = true;
        } catch (e) {}
    }
    if (hasCells) {
        sheet['!ref'] = xlsx.utils.encode_range(range);
    }
    return sheet;
}

function parseDateToSortableInteger(val) {
    if (!val) return 0;
    let s = String(val).trim();
    let parts = s.split('/');
    if (parts.length === 3) {
        let d = parts[0].padStart(2, '0');
        let m = parts[1].padStart(2, '0');
        let y = parts[2];
        return parseInt(`${y}${m}${d}`, 10);
    }
    return 0;
}

function integerToDDMMYYYY(intDate) {
    let s = String(intDate);
    if (s.length !== 8) return s;
    return `${s.substring(6, 8)}/${s.substring(4, 6)}/${s.substring(0, 4)}`;
}

const getInt = (val) => {
    if (val === undefined || val === null || val === "") return 0;
    let n = Number(String(val).replace(/,/g, '').trim());
    return isNaN(n) ? 0 : n;
};

// Hàm sắp xếp Tuần thông minh (Ví dụ: Tuần 1 (2026), Tuần 14 (2026))
const sortWeeks = (weeksArray) => {
    return weeksArray.sort((a, b) => {
        let matchA = a.match(/Tuần (\d+) \((\d+)\)/);
        let matchB = b.match(/Tuần (\d+) \((\d+)\)/);
        if (matchA && matchB) {
            if (matchA[2] !== matchB[2]) return parseInt(matchA[2]) - parseInt(matchB[2]); // Xếp theo năm
            return parseInt(matchA[1]) - parseInt(matchB[1]); // Xếp theo tuần
        }
        return 0;
    });
};

async function getKpiHistory() {
    try {
        const [rows3g] = await db.query('SELECT DISTINCT Thoi_gian FROM kpi_3g');
        const [rows4g] = await db.query('SELECT DISTINCT Thoi_gian FROM kpi_4g');
        const [rows5g] = await db.query('SELECT DISTINCT Thoi_gian FROM kpi_5g');
        
        // Lấy lịch sử Tuần của QoE / QoS
        const [rowsQoE] = await db.query('SELECT DISTINCT Tuan FROM mbb_qoe');
        const [rowsQoS] = await db.query('SELECT DISTINCT Tuan FROM mbb_qos');

        const processHistory = (rows) => {
            let uniqueNums = [...new Set(rows.map(r => parseDateToSortableInteger(r.Thoi_gian)).filter(n => n > 0))];
            uniqueNums.sort((a, b) => a - b);
            return uniqueNums.map(n => integerToDDMMYYYY(n));
        };
        
        const processWeeks = (rows) => {
            let uniqueWeeks = [...new Set(rows.map(r => r.Tuan).filter(Boolean))];
            return sortWeeks(uniqueWeeks).reverse(); // Tuần mới nhất lên đầu
        };

        return { 
            kpi3g: processHistory(rows3g).reverse(), // Ngày mới nhất lên đầu 
            kpi4g: processHistory(rows4g).reverse(), 
            kpi5g: processHistory(rows5g).reverse(),
            qoeWeeks: processWeeks(rowsQoE),
            qosWeeks: processWeeks(rowsQoS)
        };
    } catch (e) { return { kpi3g: [], kpi4g: [], kpi5g: [], qoeWeeks: [], qosWeeks: [] }; }
}

async function aggregateDashboardData() {
    try {
        const [kpi4gRows] = await db.query(`
            SELECT Thoi_gian, SUM(Total_Data_Traffic_Volume_GB) AS sum_TRAFFIC_4G, AVG(User_DL_Avg_Throughput_Kbps) AS AVG_USER_DL_AVG_THPUT_4G, AVG(RB_Util_Rate_DL) AS AVG_RES_BLK_DL_4G, AVG(CQI_4G) AS AVG_CQI_4G
            FROM kpi_4g WHERE Thoi_gian IS NOT NULL AND Thoi_gian != '' GROUP BY Thoi_gian
        `);
        const [kpi5gRows] = await db.query(`
            SELECT Thoi_gian, SUM(Total_Data_Traffic_Volume_GB) AS sum_TRAFFIC_5G, AVG(A_User_DL_Avg_Throughput) AS AVG_USER_DL_AVG_THPUT_5G, AVG(CQI_5G) AS AVG_CQI_5G
            FROM kpi_5g WHERE Thoi_gian IS NOT NULL AND Thoi_gian != '' GROUP BY Thoi_gian
        `);

        let aggregatedData = {};
        kpi4gRows.forEach(row => {
            aggregatedData[row.Thoi_gian] = { ...row, sum_TRAFFIC_5G: 0, AVG_USER_DL_AVG_THPUT_5G: 0, AVG_CQI_5G: 0 };
        });
        kpi5gRows.forEach(row => {
            if (!aggregatedData[row.Thoi_gian]) {
                aggregatedData[row.Thoi_gian] = { Thoi_gian: row.Thoi_gian, sum_TRAFFIC_4G: 0, AVG_USER_DL_AVG_THPUT_4G: 0, AVG_RES_BLK_DL_4G: 0, AVG_CQI_4G: 0 };
            }
            aggregatedData[row.Thoi_gian] = { ...aggregatedData[row.Thoi_gian], ...row };
        });

        for (const date in aggregatedData) {
            const data = aggregatedData[date];
            await db.query(`
                INSERT INTO Dashboard (thoi_gian, sum_TRAFFIC_4G, AVG_USER_DL_AVG_THPUT_4G, AVG_RES_BLK_DL_4G, AVG_CQI_4G, sum_TRAFFIC_5G, AVG_USER_DL_AVG_THPUT_5G, AVG_CQI_5G)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE sum_TRAFFIC_4G = VALUES(sum_TRAFFIC_4G), AVG_USER_DL_AVG_THPUT_4G = VALUES(AVG_USER_DL_AVG_THPUT_4G), AVG_RES_BLK_DL_4G = VALUES(AVG_RES_BLK_DL_4G), AVG_CQI_4G = VALUES(AVG_CQI_4G), sum_TRAFFIC_5G = VALUES(sum_TRAFFIC_5G), AVG_USER_DL_AVG_THPUT_5G = VALUES(AVG_USER_DL_AVG_THPUT_5G), AVG_CQI_5G = VALUES(AVG_CQI_5G)
            `, [data.Thoi_gian, data.sum_TRAFFIC_4G, data.AVG_USER_DL_AVG_THPUT_4G, data.AVG_RES_BLK_DL_4G, data.AVG_CQI_4G, data.sum_TRAFFIC_5G, data.AVG_USER_DL_AVG_THPUT_5G, data.AVG_CQI_5G]);
        }
    } catch (e) {
        console.error("Lỗi aggregateDashboardData:", e);
    }
}

// Hàm format ngày từ số Serial của Excel sang DD/MM/YYYY
const formatExcelDate = (excelDate) => {
    if (typeof excelDate === 'number') {
        const date = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
        const d = String(date.getDate()).padStart(2, '0');
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const y = date.getFullYear();
        return `${d}/${m}/${y}`;
    }
    return excelDate; 
};

// Thuật toán làm sạch chuỗi (Chuẩn hóa Header)
const normalizeStr = (str) => {
    if (!str) return '';
    return String(str).toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") 
        .replace(/[^a-z0-9]/g, ''); 
};

exports.renderPage = (pageName) => {
    return (req, res) => {
        let userRole = req.session && req.session.user ? req.session.user.role : 'user';
        res.render(pageName.toLowerCase().replace(/ /g, '_'), { title: pageName, page: pageName, userRole: userRole });
    };
};

exports.getImportPage = async (req, res) => {
    let userRole = req.session && req.session.user ? req.session.user.role : 'user';
    let history = await getKpiHistory();
    res.render('import_data', { title: 'Import Data', page: 'Import Data', userRole: userRole, history: history, message: null, error: null });
};

exports.handleImportData = async (req, res) => {
    let userRole = req.session && req.session.user ? req.session.user.role : 'user';
    let history = await getKpiHistory();
    
    if (userRole !== 'admin') {
        return res.status(403).send("Chỉ Admin mới có quyền thực hiện chức năng này.");
    }

    if (!req.files || req.files.length === 0) {
        return res.render('import_data', { title: 'Import Data', page: 'Import Data', userRole: userRole, history: history, message: null, error: 'Vui lòng chọn ít nhất 1 file.' });
    }

    const networkType = req.body.networkType; 
    let isKpiImported = networkType.startsWith('kpi_');

    // Xử lý thông số Tuần cho QoE/QoS
    let weekPrefix = "";
    if (networkType === 'mbb_qoe' || networkType === 'mbb_qos') {
        const wNum = req.body.weekNumber;
        const wYear = req.body.year;
        if(wNum && wYear) weekPrefix = `Tuần ${wNum} (${wYear})`;
    }

    let totalImported = 0;
    let errorLogs = [];

    // Lấy cấu trúc bảng đích
    let dbCols = [];
    try {
        const [cols] = await db.query(`SHOW COLUMNS FROM ${networkType}`);
        dbCols = cols.map(c => ({
            original: c.Field,
            norm: normalizeStr(c.Field)
        }));
    } catch (e) {
        errorLogs.push(`Không tìm thấy bảng ${networkType} trong CSDL.`);
        return res.render('import_data', { title: 'Import Data', page: 'Import Data', userRole: userRole, history: history, message: null, error: errorLogs.join(' | ') });
    }

    for (const file of req.files) {
        try {
            // Đọc file với raw: true để tránh SheetJS tự tiện định dạng số (gây lỗi với định dạng kiểu Pháp dùng dấu phẩy cho số thập phân)
            const workbook = xlsx.read(file.buffer, { type: 'buffer', raw: true });
            const sheetName = workbook.SheetNames[0];
            let sheet = workbook.Sheets[sheetName];
            sheet = fixSheetRange(sheet); // Ép sửa lỗi Range

            // Bỏ qua các dòng trống ở đầu file QoE và QoS như trước (chỉ áp dụng riêng mbb_qoe/qos)
            let skipRows = 0;
            if (networkType === 'mbb_qoe') skipRows = 5; // Header ở dòng 6
            if (networkType === 'mbb_qos') skipRows = 9; // Header ở dòng 10

            // Lấy toàn bộ mảng dữ liệu (mảng của mảng)
            let rawData = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
            
            // Xử lý cắt bỏ các dòng trống ở đầu nếu là file mbb_qoe/qos (giống code cũ)
            if (skipRows > 0 && rawData.length > skipRows) {
                 rawData = rawData.slice(skipRows);
            }

            if (rawData.length === 0) continue;

            // AI Smart Detection: Tự động quét các dòng đầu tiên để tìm Dòng Tiêu Đề
            // Chạy cho toàn bộ các file import (kể cả KPI 4G, 3G, 5G, RF...)
            let headerRowIdx = -1;
            for (let i = 0; i < Math.min(20, rawData.length); i++) {
                const rowStr = JSON.stringify(rawData[i]).toLowerCase();
                if (rowStr.includes('thoi gian') || rowStr.includes('thời gian') ||
                    rowStr.includes('tên cell') || rowStr.includes('cell name') ||
                    rowStr.includes('site name') || rowStr.includes('cell_code') || 
                    rowStr.includes('tuan') || rowStr.includes('tuần') || 
                    rowStr.includes('poi')) {
                    headerRowIdx = i;
                    break;
                }
            }

            if (headerRowIdx === -1) {
                 errorLogs.push(`File ${file.originalname}: Không tìm thấy dòng Tiêu đề hợp lệ.`);
                 continue;
            }

            const excelHeaders = rawData[headerRowIdx];
            
            // Map cột Excel vào cột Database
            const colMapping = [];
            excelHeaders.forEach((exHeader, idx) => {
                const normEx = normalizeStr(exHeader);
                if (normEx) {
                    const match = dbCols.find(dbC => dbC.norm === normEx);
                    if (match) {
                        colMapping.push({ excelIdx: idx, dbCol: match.original });
                    }
                }
            });

            if (colMapping.length === 0) {
                 errorLogs.push(`File ${file.originalname}: Không khớp được cột nào với CSDL.`);
                 continue;
            }

            let hasTuanCol = weekPrefix ? dbCols.some(c => c.original === 'Tuan') : false;
            let lastValidDate = null; // Dùng cho thuật toán FFill (Forward Fill)

            // Rút trích dữ liệu thành Object chuẩn
            const insertData = [];
            // Bắt đầu từ dòng ngay dưới dòng Header
            for (let i = headerRowIdx + 1; i < rawData.length; i++) {
                const row = rawData[i];
                if (!row || row.length === 0) continue; // Dòng trống

                // Loại bỏ dòng "Summary" hoặc "Giao dịch không thành công" của file QoE / QoS (Kế thừa từ code cũ)
                let firstCellStr = String(row[0] || '').toLowerCase().trim();
                if (firstCellStr === 'summary' || firstCellStr.includes('không thành công')) {
                    continue; 
                }

                const rowObj = {};
                let hasData = false;

                colMapping.forEach(map => {
                    let val = row[map.excelIdx];
                    if (val === undefined || val === '') val = null;

                    // Chuyển đổi định dạng số kiểu Châu Âu (VD: 1,55824 -> 1.55824) cho tất cả các cột trừ Tên và Thời gian
                    if (val !== null && typeof val === 'string' && !['Thoi_gian', 'Date', 'Cell_name', 'Ten_CELL', 'Site_name', 'Cell_code'].includes(map.dbCol)) {
                         if (/^-?\d+,\d+$/.test(val)) {
                             val = parseFloat(val.replace(',', '.'));
                         }
                    }

                    // Format lại ngày tháng chuẩn cho Cột Thời Gian
                    if (map.dbCol === 'Thoi_gian' || map.dbCol === 'Date') {
                        if (val !== null) {
                            val = formatExcelDate(val);
                            if (typeof val === 'string' && val.includes(' ')) val = val.split(' ')[0];
                            lastValidDate = val; 
                        } else {
                            val = lastValidDate; // FFill
                        }
                    }
                    
                    rowObj[map.dbCol] = val;
                    if (val !== null) hasData = true;
                });

                if (weekPrefix && hasTuanCol) {
                    rowObj['Tuan'] = weekPrefix;
                    hasData = true;
                }

                if (hasData) {
                    insertData.push(rowObj);
                }
            }

            // Kỹ thuật Chunking Insert: Chia nhỏ dữ liệu thành từng cụm 500 dòng
            if (insertData.length > 0) {
                const chunkSize = 500;
                for (let i = 0; i < insertData.length; i += chunkSize) {
                    let chunk = insertData.slice(i, i + chunkSize);
                    const keys = Object.keys(chunk[0]); 
                    const valuesArr = chunk.map(obj => keys.map(k => obj[k])); 
                    
                    const sql = `INSERT INTO ${networkType} (${keys.join(',')}) VALUES ?`;
                    await db.query(sql, [valuesArr]);
                }
                totalImported += insertData.length;
            }

        } catch (error) {
            console.error(`Lỗi khi xử lý file ${file.originalname}:`, error);
            errorLogs.push(`File ${file.originalname} bị lỗi hoặc sai định dạng.`);
        }
    } 

    if (isKpiImported) {
        await aggregateDashboardData();
    }

    history = await getKpiHistory(); 

    if (errorLogs.length > 0) {
        return res.render('import_data', { title: 'Import Data', page: 'Import Data', userRole: userRole, history: history, message: null, error: `Đã import được ${totalImported} dòng. Cảnh báo: ${errorLogs.join(' | ')}` });
    } else {
        return res.render('import_data', { title: 'Import Data', page: 'Import Data', userRole: userRole, history: history, message: `Import thành công ${totalImported} dòng vào bảng ${networkType}.`, error: null });
    }
};

// =====================================================================
// BỔ SUNG CÁC HÀM API ĐỂ CUNG CẤP DỮ LIỆU CHO DASHBOARD & BÁO CÁO
// =====================================================================

// 1. API cho trang chủ Dashboard
exports.getDashboardData = async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM Dashboard ORDER BY thoi_gian ASC');
        res.json(rows);
    } catch (error) {
        console.error("Lỗi getDashboardData:", error);
        res.status(500).json({ error: "Lỗi truy xuất CSDL." });
    }
};

// 2. API cho trang Worst Cells (Cell Vi phạm KPI)
exports.getWorstCellsData = async (req, res) => {
    const days = parseInt(req.query.days) || 1; // Thực tế thuật toán phức tạp hơn, ta lấy mẫu cơ bản trước
    try {
        const query = `
            SELECT Cell_name, MAX(Thoi_gian) as Latest_Date,
                   User_DL_Avg_Throughput_Kbps, RB_Util_Rate_DL, CQI_4G, Service_Drop_all,
                   CONCAT_WS(', ',
                       IF(User_DL_Avg_Throughput_Kbps < 7000, 'Thput Thấp', NULL),
                       IF(RB_Util_Rate_DL > 20, 'PRB Cao', NULL),
                       IF(CQI_4G < 93, 'CQI Thấp', NULL),
                       IF(Service_Drop_all > 0.3, 'Drop Rate Cao', NULL)
                   ) as Violations
            FROM kpi_4g
            WHERE User_DL_Avg_Throughput_Kbps < 7000 
               OR RB_Util_Rate_DL > 20 
               OR CQI_4G < 93 
               OR Service_Drop_all > 0.3
            GROUP BY Cell_name
            ORDER BY Latest_Date DESC
            LIMIT 500
        `;
        const [rows] = await db.query(query);
        res.json(rows);
    } catch (error) {
        console.error("Lỗi getWorstCellsData:", error);
        res.status(500).json({ error: "Lỗi truy xuất CSDL." });
    }
};

// 3. API cho trang Congestion 3G (Nghẽn mạng)
exports.getCongestion3gData = async (req, res) => {
    try {
        const query = `
            SELECT Ten_CELL as Cell_name, MAX(Thoi_gian) as Latest_Date,
                   CSCONGES, CS_SO_ATT, PSCONGES, PS_SO_ATT,
                   CONCAT_WS(', ',
                       IF(CSCONGES > 2 AND CS_SO_ATT > 100, 'Nghẽn CS', NULL),
                       IF(PSCONGES > 2 AND PS_SO_ATT > 500, 'Nghẽn PS', NULL)
                   ) as Violations
            FROM kpi_3g
            WHERE (CSCONGES > 2 AND CS_SO_ATT > 100)
               OR (PSCONGES > 2 AND PS_SO_ATT > 500)
            GROUP BY Ten_CELL
            ORDER BY Latest_Date DESC
            LIMIT 500
        `;
        const [rows] = await db.query(query);
        res.json(rows);
    } catch (error) {
        console.error("Lỗi getCongestion3gData:", error);
        res.status(500).json({ error: "Lỗi truy xuất CSDL." });
    }
};

// 4. API cho trang Suy Giảm Lưu lượng (Traffic Down)
exports.getTrafficDownData = async (req, res) => {
    try {
        // Trả về một mảng JSON rỗng cơ bản để giao diện không bị crash
        res.json({
            latestDate: 'Gần đây',
            lastWeekDate: 'Tuần trước',
            zeroTrafficCells: [],
            droppedTrafficCells: [],
            droppedTrafficPOIs: []
        });
    } catch (error) {
        res.status(500).json({ error: "Lỗi truy xuất CSDL." });
    }
};
