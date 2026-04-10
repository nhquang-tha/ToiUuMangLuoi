const db = require('../models/db');
const xlsx = require('xlsx');

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

const sortWeeks = (weeksArray) => {
    return weeksArray.sort((a, b) => {
        let matchA = a.match(/Tuần (\d+) \((\d+)\)/);
        let matchB = b.match(/Tuần (\d+) \((\d+)\)/);
        if (matchA && matchB) {
            if (matchA[2] !== matchB[2]) return parseInt(matchA[2]) - parseInt(matchB[2]);
            return parseInt(matchA[1]) - parseInt(matchB[1]);
        }
        return 0;
    });
};

async function getKpiHistory() {
    try {
        const [rows3g] = await db.query('SELECT DISTINCT Thoi_gian FROM kpi_3g');
        const [rows4g] = await db.query('SELECT DISTINCT Thoi_gian FROM kpi_4g');
        const [rows5g] = await db.query('SELECT DISTINCT Thoi_gian FROM kpi_5g');
        
        const [rowsQoE] = await db.query('SELECT DISTINCT Tuan FROM mbb_qoe');
        const [rowsQoS] = await db.query('SELECT DISTINCT Tuan FROM mbb_qos');

        const processHistory = (rows) => {
            let uniqueNums = [...new Set(rows.map(r => parseDateToSortableInteger(r.Thoi_gian)).filter(n => n > 0))];
            uniqueNums.sort((a, b) => a - b);
            return uniqueNums.map(n => integerToDDMMYYYY(n));
        };
        
        const processWeeks = (rows) => {
            let uniqueWeeks = [...new Set(rows.map(r => r.Tuan).filter(Boolean))];
            return sortWeeks(uniqueWeeks).reverse(); 
        };

        return { 
            kpi3g: processHistory(rows3g).reverse(), 
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

// =====================================================================
// THUẬT TOÁN IMPORT THÔNG MINH (LẤY FULL 100% CỘT QOE VÀ QOS)
// =====================================================================
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

    // [TÍNH NĂNG MỚI]: Ghi đè dữ liệu (Overwrite) khi import lại một Tuần đã có
    if (weekPrefix && (networkType === 'mbb_qoe' || networkType === 'mbb_qos')) {
        try {
            await db.query(`DELETE FROM ${networkType} WHERE Tuan = ?`, [weekPrefix]);
            console.log(`Đã dọn dẹp dữ liệu cũ của ${weekPrefix} trong bảng ${networkType} để chuẩn bị ghi đè.`);
        } catch (delErr) {
            console.error(`Lỗi khi xóa dữ liệu cũ của ${weekPrefix}:`, delErr);
        }
    }

    for (const file of req.files) {
        try {
            const workbook = xlsx.read(file.buffer, { type: 'buffer', raw: true });
            const sheetName = workbook.SheetNames[0];
            let sheet = workbook.Sheets[sheetName];
            sheet = fixSheetRange(sheet); 

            let rawData = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
            if (rawData.length === 0) continue;

            let headerRowIdx = -1;
            let dataStartIdx = -1;

            // XÁC ĐỊNH DÒNG BẮT ĐẦU CỦA HEADER VÀ DỮ LIỆU
            if (networkType === 'mbb_qoe') {
                headerRowIdx = 4; // Dòng 5 trong Excel
                dataStartIdx = 5; // Dòng 6 bắt đầu chứa dữ liệu
            } else if (networkType === 'mbb_qos') {
                headerRowIdx = 4; // Dòng 5 trong Excel
                dataStartIdx = 9; // Dòng 10 bắt đầu chứa dữ liệu
            } else {
                // AI Smart Detection cho KPI / RF
                for (let i = 0; i < Math.min(20, rawData.length); i++) {
                    const rowStr = JSON.stringify(rawData[i]).toLowerCase();
                    if (rowStr.includes('thoi gian') || rowStr.includes('thời gian') ||
                        rowStr.includes('tên cell') || rowStr.includes('cell name') ||
                        rowStr.includes('site name') || rowStr.includes('cell_code') || 
                        rowStr.includes('tuan') || rowStr.includes('tuần') || 
                        rowStr.includes('poi')) {
                        headerRowIdx = i;
                        dataStartIdx = i + 1;
                        break;
                    }
                }
            }

            if (headerRowIdx === -1 || !rawData[headerRowIdx]) {
                 errorLogs.push(`File ${file.originalname}: Không tìm thấy dòng Tiêu đề hợp lệ.`);
                 continue;
            }

            const excelHeaders = rawData[headerRowIdx];
            let colMapping = [];

            // [BẢN VÁ QUAN TRỌNG]: ÉP CỨNG CHỈ MỤC CỘT CHO QOE VÀ QOS ĐỂ LẤY ĐẦY ĐỦ 100% CỘT
            // Do file Excel của VNPT có các dòng trộn ô (Merge Cells) làm AI đọc thiếu cột
            if (networkType === 'mbb_qoe') {
                colMapping = [
                    { excelIdx: 0, dbCol: 'Ma_Tinh' }, { excelIdx: 1, dbCol: 'Don_Vi' }, { excelIdx: 2, dbCol: 'Phuong_Xa' },
                    { excelIdx: 3, dbCol: 'Site_Name' }, { excelIdx: 4, dbCol: 'Cell_Name' }, { excelIdx: 5, dbCol: 'Cell_ID' },
                    { excelIdx: 6, dbCol: 'QoE_Score' }, { excelIdx: 7, dbCol: 'QoE_Rank' },
                    { excelIdx: 8, dbCol: 'Norm_Speed' }, { excelIdx: 9, dbCol: 'Norm_Latency' }, { excelIdx: 10, dbCol: 'Norm_Jitter' }, { excelIdx: 11, dbCol: 'Norm_PacketLoss' },
                    { excelIdx: 12, dbCol: 'Point_Speed' }, { excelIdx: 13, dbCol: 'Point_Latency' }, { excelIdx: 14, dbCol: 'Point_Jitter' }, { excelIdx: 15, dbCol: 'Point_PacketLoss' },
                    { excelIdx: 16, dbCol: 'Out_Speed' }, { excelIdx: 17, dbCol: 'Out_Latency' }, { excelIdx: 18, dbCol: 'Out_Jitter' }, { excelIdx: 19, dbCol: 'Out_PacketLoss' },
                    { excelIdx: 20, dbCol: 'In_Speed' }, { excelIdx: 21, dbCol: 'In_Latency' }, { excelIdx: 22, dbCol: 'In_Jitter' }, { excelIdx: 23, dbCol: 'In_PacketLoss' }
                ];
            } else if (networkType === 'mbb_qos') {
                colMapping = [
                    { excelIdx: 0, dbCol: 'Ma_Tinh' }, { excelIdx: 1, dbCol: 'Don_Vi' }, { excelIdx: 2, dbCol: 'Phuong_Xa' },
                    { excelIdx: 3, dbCol: 'Site_Name' }, { excelIdx: 4, dbCol: 'Cell_Name' }, { excelIdx: 5, dbCol: 'Cell_ID' },
                    { excelIdx: 6, dbCol: 'QoS_Rank' }, { excelIdx: 7, dbCol: 'QoS_Score' },
                    { excelIdx: 8, dbCol: 'Norm_Res' }, { excelIdx: 9, dbCol: 'Norm_Acc' }, { excelIdx: 10, dbCol: 'Norm_Ret' }, { excelIdx: 11, dbCol: 'Norm_Int' }, { excelIdx: 12, dbCol: 'Norm_Cov' },
                    { excelIdx: 13, dbCol: 'Point_Res' }, { excelIdx: 14, dbCol: 'Point_Acc' }, { excelIdx: 15, dbCol: 'Point_Ret' }, { excelIdx: 16, dbCol: 'Point_Int' }, { excelIdx: 17, dbCol: 'Point_Cov' },
                    { excelIdx: 18, dbCol: 'Out_Res' }, { excelIdx: 19, dbCol: 'Out_Acc' }, { excelIdx: 20, dbCol: 'Out_Ret' }, { excelIdx: 21, dbCol: 'Out_Int' }, { excelIdx: 22, dbCol: 'Out_Cov' },
                    { excelIdx: 23, dbCol: 'In_Res' }, { excelIdx: 24, dbCol: 'In_Acc' }, { excelIdx: 25, dbCol: 'In_Ret' }, { excelIdx: 26, dbCol: 'In_Int' }, { excelIdx: 27, dbCol: 'In_Cov' }
                ];
            } else {
                // AI Mapper tự động dò các cột cho KPI và RF
                excelHeaders.forEach((exHeader, idx) => {
                    const normEx = normalizeStr(exHeader);
                    if (normEx) {
                        const match = dbCols.find(dbC => dbC.norm === normEx);
                        if (match) {
                            colMapping.push({ excelIdx: idx, dbCol: match.original });
                        }
                    }
                });
            }

            if (colMapping.length === 0) {
                 errorLogs.push(`File ${file.originalname}: Không khớp được cột nào với CSDL.`);
                 continue;
            }

            let hasTuanCol = weekPrefix ? dbCols.some(c => c.original === 'Tuan') : false;
            let lastValidDate = null; 

            const insertData = [];
            
            // Bắt đầu đọc dữ liệu từ dataStartIdx (Bỏ qua các Sub-header)
            for (let i = dataStartIdx; i < rawData.length; i++) {
                const row = rawData[i];
                if (!row || row.length === 0) continue; 

                // Loại bỏ dòng "Summary" hoặc "Giao dịch không thành công"
                let firstCellStr = String(row[0] || '').toLowerCase().trim();
                if (firstCellStr === 'summary' || firstCellStr.includes('không thành công')) {
                    continue; 
                }

                const rowObj = {};
                let hasData = false;

                colMapping.forEach(map => {
                    let val = row[map.excelIdx];
                    if (val === undefined || val === '') val = null;

                    // Chuyển đổi định dạng số kiểu Châu Âu
                    if (val !== null && typeof val === 'string' && !['Thoi_gian', 'Date', 'Cell_name', 'Ten_CELL', 'Site_name', 'Cell_code'].includes(map.dbCol)) {
                         if (/^-?\d+,\d+$/.test(val)) {
                             val = parseFloat(val.replace(',', '.'));
                         }
                    }

                    // Format Ngày
                    if (map.dbCol === 'Thoi_gian' || map.dbCol === 'Date') {
                        if (val !== null) {
                            val = formatExcelDate(val);
                            if (typeof val === 'string' && val.includes(' ')) val = val.split(' ')[0];
                            lastValidDate = val; 
                        } else {
                            val = lastValidDate; 
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
        return res.render('import_data', { title: 'Import Data', page: 'Import Data', userRole: userRole, history: history, message: `Import và Ghi đè thành công ${totalImported} dòng vào bảng ${networkType}.`, error: null });
    }
};

// =====================================================================
// CÁC HÀM API BÁO CÁO GIỮ NGUYÊN
// =====================================================================
exports.getDashboardData = async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM Dashboard ORDER BY thoi_gian ASC');
        res.json(rows);
    } catch (error) {
        console.error("Lỗi getDashboardData:", error);
        res.status(500).json({ error: "Lỗi truy xuất CSDL." });
    }
};

exports.getWorstCellsData = async (req, res) => {
    const days = parseInt(req.query.days) || 1; 
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
        res.status(500).json({ error: "Lỗi truy xuất CSDL." });
    }
};

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
        res.status(500).json({ error: "Lỗi truy xuất CSDL." });
    }
};

exports.getTrafficDownData = async (req, res) => {
    try {
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

// =====================================================================
// CHỨC NĂNG MỚI: XÓA SẠCH DỮ LIỆU ĐA NĂNG
// =====================================================================
exports.resetImportedData = async (req, res) => {
    let userRole = req.session && req.session.user ? req.session.user.role : 'user';
    
    if (userRole !== 'admin') {
        return res.status(403).send("Chỉ Admin mới có quyền thực hiện chức năng này.");
    }

    const table = req.params.table;
    const allowedTables = ['rf_3g', 'rf_4g', 'rf_5g', 'ta_query', 'mbb_qoe', 'mbb_qos'];

    if (!allowedTables.includes(table)) {
        return res.status(400).send("Bảng dữ liệu không hợp lệ.");
    }

    try {
        await db.query(`TRUNCATE TABLE ${table}`);
        res.redirect('/import-data');
    } catch (error) {
        console.error(`Lỗi xóa dữ liệu bảng ${table}:`, error);
        res.status(500).send("Lỗi máy chủ khi xóa dữ liệu. Vui lòng thử lại.");
    }
};
