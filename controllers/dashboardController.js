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
            // Lật ngược lại để Mới Nhất lên đầu
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
        kpi4gRows.forEach(row => { aggregatedData[row.Thoi_gian] = { ...row, sum_TRAFFIC_5G: 0, AVG_USER_DL_AVG_THPUT_5G: 0, AVG_CQI_5G: 0 }; });
        kpi5gRows.forEach(row => {
            if (!aggregatedData[row.Thoi_gian]) aggregatedData[row.Thoi_gian] = { Thoi_gian: row.Thoi_gian, sum_TRAFFIC_4G: 0, AVG_USER_DL_AVG_THPUT_4G: 0, AVG_RES_BLK_DL_4G: 0, AVG_CQI_4G: 0 };
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

async function syncQoeQosSummary() {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS qoe_qos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                Site_Name VARCHAR(150), Cell_Name VARCHAR(150) UNIQUE,
                District VARCHAR(100), MIMO VARCHAR(50),
                QoE_Rank FLOAT, QoE_Score FLOAT, QoE_Trend FLOAT,
                QoS_Rank FLOAT, QoS_Score FLOAT, QoS_Trend FLOAT,
                lich_su_tac_dong TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS cell_notes (
                cell_name VARCHAR(255) PRIMARY KEY, note_text TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        // Bổ sung lấy District, MIMO từ kpi_4g để làm giàu dữ liệu phụ
        const [cellsKpi] = await db.query(`SELECT Cell_name, MAX(District_code) as District_code, MAX(MIMO) as MIMO FROM kpi_4g WHERE Cell_name IS NOT NULL AND Cell_name != '' GROUP BY Cell_name`);
        const kpiMap = {};
        cellsKpi.forEach(c => kpiMap[c.Cell_name] = c);

        // Lấy danh sách Site_Name và Cell_Name CHÍNH THỨC từ mbb_qoe và mbb_qos
        const [qoe] = await db.query('SELECT Site_Name, Cell_Name, Tuan, QoE_Rank, QoE_Score FROM mbb_qoe');
        const [qos] = await db.query('SELECT Site_Name, Cell_Name, Tuan, QoS_Rank, QoS_Score FROM mbb_qos');
        const [notes] = await db.query('SELECT cell_name, note_text FROM cell_notes');
        
        const noteMap = {}; notes.forEach(n => noteMap[n.cell_name] = n.note_text);

        let qoeMap = {}; let qoeWeeksSet = new Set();
        qoe.forEach(r => {
            if(!qoeMap[r.Cell_Name]) qoeMap[r.Cell_Name] = {};
            qoeMap[r.Cell_Name][r.Tuan] = { rank: r.QoE_Rank, score: r.QoE_Score };
            qoeWeeksSet.add(r.Tuan);
        });
        
        // Sửa lỗi: Lật ngược mảng để index [0] luôn là TUẦN MỚI NHẤT
        let sortedQoeWeeks = sortWeeks(Array.from(qoeWeeksSet)).reverse();

        let qosMap = {}; let qosWeeksSet = new Set();
        qos.forEach(r => {
            if(!qosMap[r.Cell_Name]) qosMap[r.Cell_Name] = {};
            qosMap[r.Cell_Name][r.Tuan] = { rank: r.QoS_Rank, score: r.QoS_Score };
            qosWeeksSet.add(r.Tuan);
        });
        
        // Sửa lỗi: Lật ngược mảng để index [0] luôn là TUẦN MỚI NHẤT
        let sortedQosWeeks = sortWeeks(Array.from(qosWeeksSet)).reverse();

        // CHỈ LẤY DANH SÁCH CELL CỦA TUẦN MỚI NHẤT ĐỂ RENDER RA BẢNG
        let latestQoeWeek = sortedQoeWeeks.length > 0 ? sortedQoeWeeks[0] : null;
        let latestQosWeek = sortedQosWeeks.length > 0 ? sortedQosWeeks[0] : null;

        let cellBaseMap = {};
        qoe.forEach(r => {
            if (r.Tuan === latestQoeWeek && r.Cell_Name) {
                cellBaseMap[r.Cell_Name] = r.Site_Name || '';
            }
        });
        qos.forEach(r => {
            if (r.Tuan === latestQosWeek && r.Cell_Name) {
                cellBaseMap[r.Cell_Name] = r.Site_Name || cellBaseMap[r.Cell_Name] || '';
            }
        });

        let insertData = [];
        Object.keys(cellBaseMap).forEach(cellName => {
            let siteName = cellBaseMap[cellName];
            let district = kpiMap[cellName] ? (kpiMap[cellName].District_code || '') : '';
            let mimo = kpiMap[cellName] ? (kpiMap[cellName].MIMO || '') : '';

            let qoeRank = null, qoeScore = null, qoeTrend = 0;
            let qosRank = null, qosScore = null, qosTrend = 0;

            if (qoeMap[cellName] && sortedQoeWeeks.length > 0) {
                let latestData = qoeMap[cellName][sortedQoeWeeks[0]];
                if (latestData) {
                    qoeRank = latestData.rank; qoeScore = parseFloat(latestData.score) || 0;
                    let prevSum = 0; let prevCount = 0;
                    for(let i = 1; i <= 4; i++) {
                        if(sortedQoeWeeks[i] && qoeMap[cellName][sortedQoeWeeks[i]]) {
                            prevSum += parseFloat(qoeMap[cellName][sortedQoeWeeks[i]].score) || 0;
                            prevCount++;
                        }
                    }
                    if (prevCount > 0) qoeTrend = qoeScore - (prevSum / prevCount);
                }
            }

            if (qosMap[cellName] && sortedQosWeeks.length > 0) {
                let latestData = qosMap[cellName][sortedQosWeeks[0]];
                if (latestData) {
                    qosRank = latestData.rank; qosScore = parseFloat(latestData.score) || 0;
                    let prevSum = 0; let prevCount = 0;
                    for(let i = 1; i <= 4; i++) {
                        if(sortedQosWeeks[i] && qosMap[cellName][sortedQosWeeks[i]]) {
                            prevSum += parseFloat(qosMap[cellName][sortedQosWeeks[i]].score) || 0;
                            prevCount++;
                        }
                    }
                    if (prevCount > 0) qosTrend = qosScore - (prevSum / prevCount);
                }
            }

            insertData.push([
                siteName, cellName, district, mimo,
                qoeRank, qoeScore, qoeTrend, qosRank, qosScore, qosTrend,
                noteMap[cellName] || ''
            ]);
        });

        await db.query('TRUNCATE TABLE qoe_qos');
        if (insertData.length > 0) {
            const chunkSize = 500;
            for (let i = 0; i < insertData.length; i += chunkSize) {
                let chunk = insertData.slice(i, i + chunkSize);
                await db.query(`
                    INSERT INTO qoe_qos (Site_Name, Cell_Name, District, MIMO, QoE_Rank, QoE_Score, QoE_Trend, QoS_Rank, QoS_Score, QoS_Trend, lich_su_tac_dong)
                    VALUES ?
                `, [chunk]);
            }
        }
        console.log("Đồng bộ bảng tổng hợp QoE/QoS thành công!");
    } catch (e) {
        console.error("Lỗi đồng bộ bảng qoe_qos:", e);
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
    return String(str).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, ''); 
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

    let weekPrefix = "";
    if (networkType === 'mbb_qoe' || networkType === 'mbb_qos') {
        const wNum = req.body.weekNumber;
        const wYear = req.body.year;
        if(wNum && wYear) weekPrefix = `Tuần ${wNum} (${wYear})`;
    }

    let totalImported = 0;
    let errorLogs = [];

    let dbCols = [];
    try {
        const [cols] = await db.query(`SHOW COLUMNS FROM ${networkType}`);
        dbCols = cols.map(c => ({ original: c.Field, norm: normalizeStr(c.Field) }));
    } catch (e) {
        errorLogs.push(`Không tìm thấy bảng ${networkType} trong CSDL.`);
        return res.render('import_data', { title: 'Import Data', page: 'Import Data', userRole: userRole, history: history, message: null, error: errorLogs.join(' | ') });
    }

    if (weekPrefix && (networkType === 'mbb_qoe' || networkType === 'mbb_qos')) {
        try { await db.query(`DELETE FROM ${networkType} WHERE Tuan = ?`, [weekPrefix]); } catch (e) {}
    }

    if (networkType === 'poi_4g' || networkType === 'poi_5g' || networkType === 'csht_data') {
        try { await db.query(`TRUNCATE TABLE ${networkType}`); } catch (e) {}
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

            if (networkType === 'mbb_qoe') {
                headerRowIdx = 4; dataStartIdx = 5;
            } else if (networkType === 'mbb_qos') {
                headerRowIdx = 4; dataStartIdx = 9;
            } else {
                for (let i = 0; i < Math.min(20, rawData.length); i++) {
                    const rowStr = JSON.stringify(rawData[i]).toLowerCase();
                    if (rowStr.includes('thoi gian') || rowStr.includes('thời gian') ||
                        rowStr.includes('tên cell') || rowStr.includes('cell name') ||
                        rowStr.includes('site name') || rowStr.includes('cell_code') || 
                        rowStr.includes('tuan') || rowStr.includes('tuần') || 
                        rowStr.includes('poi') || rowStr.includes('mã csht')) {
                        headerRowIdx = i; dataStartIdx = i + 1; break;
                    }
                }
            }

            if (headerRowIdx === -1 || !rawData[headerRowIdx]) continue;

            const excelHeaders = rawData[headerRowIdx];
            let colMapping = [];

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
                excelHeaders.forEach((exHeader, idx) => {
                    let h = String(exHeader).toLowerCase().replace(/[\ufeff\u200b]/g, '').trim();
                    let mappedCol = null;

                    if (networkType === 'kpi_4g') {
                        if (h.includes('site name')) mappedCol = 'Site_name';
                        else if (h.includes('celltype')) mappedCol = 'CellType';
                        else if (h.includes('district code')) mappedCol = 'District_code';
                        else if (h.includes('cell name')) mappedCol = 'Cell_name';
                        else if (h.includes('mimo')) mappedCol = 'MIMO';
                        else if (h.includes('thời gian') || h.includes('thoi gian')) mappedCol = 'Thoi_gian';
                        else if (h.includes('user downlink average')) mappedCol = 'User_DL_Avg_Throughput_Kbps';
                        else if (h.includes('user uplink average')) mappedCol = 'User_UL_Avg_Throughput_Kbps';
                        else if (h.includes('utilizing rate downlink') || h.includes('untilizing rate downlink')) mappedCol = 'RB_Util_Rate_DL';
                        else if (h.includes('utilizing rate uplink') || h.includes('untilizing rate uplink')) mappedCol = 'RB_Util_Rate_UL';
                        else if (h.includes('total data traffic')) mappedCol = 'Total_Data_Traffic_Volume_GB';
                        else if (h.includes('cqi_4g') || h.includes('cqi 4g') || h === 'cqi') mappedCol = 'CQI_4G';
                        else if (h.includes('service drop')) mappedCol = 'Service_Drop_all';
                        else if (h.includes('erab setup success') || h.includes('e-rab')) mappedCol = 'eRAB_Setup_SR_All';
                        else if (h.includes('downlink latency')) mappedCol = 'Downlink_Latency';
                    } else if (networkType === 'kpi_5g') {
                        if (h.includes('nhà cung cấp') || h === 'nha_cung_cap') mappedCol = 'Nha_cung_cap';
                        else if (h.includes('tỉnh') || h === 'tinh') mappedCol = 'Tinh';
                        else if (h.includes('tên gnodeb') || h === 'ten_gnodeb') mappedCol = 'Ten_GNODEB';
                        else if (h.includes('tên cell') || h === 'ten_cell') mappedCol = 'Ten_CELL';
                        else if (h.includes('mã vnp') || h === 'ma_vnp') mappedCol = 'Ma_VNP';
                        else if (h.includes('loại ne') || h === 'loai_ne') mappedCol = 'Loai_NE';
                        else if (h.includes('gnodeb_id') || h.includes('gnodeb id')) mappedCol = 'GNODEB_ID';
                        else if (h.includes('cell_id') || h.includes('cell id')) mappedCol = 'CELL_ID';
                        else if (h.includes('thời gian') || h.includes('thoi gian')) mappedCol = 'Thoi_gian';
                        else if (h.includes('user_dl_avg_throughput') || h.includes('a user downlink average')) mappedCol = 'A_User_DL_Avg_Throughput';
                        else if (h.includes('user_ul_avg_throughput') || h.includes('a user uplink average')) mappedCol = 'A_User_UL_Avg_Throughput';
                        else if (h === 'traffic' || h.includes('total data traffic')) mappedCol = 'Total_Data_Traffic_Volume_GB';
                        else if (h.includes('cqi_5g') || h.includes('cqi 5g') || h === 'cqi') mappedCol = 'CQI_5G';
                        else if (h.includes('intra_sgnb_ps_change') || h.includes('intra-sgnb pscell change')) mappedCol = 'Intra_SgNB_PScell_Change';
                        else if (h.includes('user_avg_number') || h.includes('average user number')) mappedCol = 'Average_User_Number';
                        else if (h.includes('dlink_res_blk_ult') || h.includes('downlink resource block')) mappedCol = 'DL_RB_Ultilization';
                        else if (h.includes('ulink_res_blk_ult') || h.includes('uplink resource block')) mappedCol = 'UL_RB_Ultilization';
                        else if (h.includes('cell_avaibility_rate') || h.includes('cell avaibility') || h.includes('cell availability')) mappedCol = 'Cell_avaibility_rate';
                        else if (h.includes('user_max_number') || h.includes('maximum user number')) mappedCol = 'Maximum_User_Number';
                        else if (h.includes('ul_traffic_volume') || h.includes('ul traffic volume')) mappedCol = 'UL_Traffic_Volume_GB';
                        else if (h.includes('dl_traffic_volume') || h.includes('dl traffic volume')) mappedCol = 'DL_Traffic_Volume_GB';
                        else if (h.includes('cell_ul_avg_throughput') || h.includes('cell uplink average')) mappedCol = 'Cell_UL_Avg_Throughput';
                        else if (h.includes('cell_dl_avg_throughput') || h.includes('cell downlink average')) mappedCol = 'Cell_DL_Avg_Throughput';
                        else if (h.includes('sgnb_abn_release_rate') || h.includes('abnormal release rate')) mappedCol = 'SgNB_Abnormal_Release_Rate';
                        else if (h.includes('sgnb_add_success_rate') || h.includes('addition success rate')) mappedCol = 'SgNB_Addition_SR';
                        else if (h.includes('inter_sgnb_ps_change') || h.includes('inter-sgnb pscell change')) mappedCol = 'Inter_SgNB_PScell_Change_2';
                    } else if (networkType === 'poi_4g' || networkType === 'poi_5g') {
                        if (h.includes('cell_code') || h === 'cell code') mappedCol = 'Cell_Code';
                        else if (h.includes('site_code') || h === 'site code') mappedCol = 'Site_Code';
                        else if (h === 'poi') mappedCol = 'POI';
                    } else if (networkType === 'csht_data') {
                        if (h === 'mã csht' || h.includes('ma csht')) mappedCol = 'Ma_CSHT';
                        else if (h === 'tên csht' || h.includes('ten csht')) mappedCol = 'Ten_CSHT';
                        else if (h === 'địa chỉ' || h.includes('dia chi')) mappedCol = 'Dia_Chi';
                        else if (h === 'long' || h === 'longitude' || h.includes('kinh độ')) mappedCol = 'Longitude';
                        else if (h === 'lat' || h === 'latitude' || h.includes('vĩ độ')) mappedCol = 'Latitude';
                        else if (h.includes('loại nhà trạm')) mappedCol = 'Loai_Nha_Tram';
                        else if (h.includes('đơn vị quản lý')) mappedCol = 'Don_Vi_Quan_Ly';
                        else if (h === 'mã trạm 2g' || h.includes('tram 2g')) mappedCol = 'Ma_Tram_2G';
                        else if (h === 'mã trạm 3g' || h.includes('tram 3g')) mappedCol = 'Ma_Tram_3G';
                        else if (h === 'mã trạm 4g' || h.includes('tram 4g')) mappedCol = 'Ma_Tram_4G';
                        else if (h === 'mã trạm 5g' || h.includes('tram 5g')) mappedCol = 'Ma_Tram_5G';
                        else if (h === 'ip-3g' || h === 'ip 3g') mappedCol = 'IP_3G';
                        else if (h === 'ip-4g' || h === 'ip 4g') mappedCol = 'IP_4G';
                        else if (h === 'ip-5g' || h === 'ip 5g') mappedCol = 'IP_5G';
                        else if (h.includes('so với mặt đất') || h.includes('mat dat')) mappedCol = 'Chieu_Cao_Mat_Dat';
                        else if (h.includes('chiều cao cột') || h.includes('chieu cao cot')) mappedCol = 'Chieu_Cao_Cot';
                        else if (h.includes('hình thức sở hữu') || h.includes('so huu')) mappedCol = 'Hinh_Thuc_So_Huu';
                    }

                    let actualDbCol = null;
                    if (mappedCol) {
                        let dbMatch = dbCols.find(c => c.original.toLowerCase() === mappedCol.toLowerCase());
                        if (dbMatch) actualDbCol = dbMatch.original;
                    }
                    if (!actualDbCol) {
                        const normEx = normalizeStr(exHeader);
                        if (normEx) {
                            const match = dbCols.find(dbC => dbC.norm === normEx);
                            if (match) actualDbCol = match.original;
                        }
                    }
                    if (actualDbCol) colMapping.push({ excelIdx: idx, dbCol: actualDbCol });
                });
            }

            let uniqueMappings = []; let seenDbCols = new Set();
            colMapping.forEach(m => {
                if (!seenDbCols.has(m.dbCol)) { seenDbCols.add(m.dbCol); uniqueMappings.push(m); }
            });
            colMapping = uniqueMappings;

            if (colMapping.length === 0) continue;

            let hasTuanCol = weekPrefix ? dbCols.some(c => c.original.toLowerCase() === 'tuan') : false;
            let lastValidDate = null; 
            const insertData = [];
            const stringColumns = ['Thoi_gian', 'Date', 'Cell_name', 'Ten_CELL', 'Site_name', 'Cell_code', 'Ma_Tinh', 'Don_Vi', 'Phuong_Xa', 'Nha_cung_cap', 'Tinh', 'Ten_RNC', 'Ten_GNODEB', 'Ma_VNP', 'Loai_NE', 'CellType', 'District_code', 'MIMO', 'LAC', 'CI', 'GNODEB_ID', 'CELL_ID', 'Cell_ID', 'Tuan', 'POI', 'Site_Code', 'Cell_Code', 'Ma_CSHT', 'Ten_CSHT', 'Dia_Chi', 'Loai_Nha_Tram', 'Don_Vi_Quan_Ly', 'Ma_Tram_2G', 'Ma_Tram_3G', 'Ma_Tram_4G', 'Ma_Tram_5G', 'IP_3G', 'IP_4G', 'IP_5G', 'Hinh_Thuc_So_Huu'];

            for (let i = dataStartIdx; i < rawData.length; i++) {
                const row = rawData[i];
                if (!row || row.length === 0) continue; 
                let firstCellStr = String(row[0] || '').toLowerCase().trim();
                if (firstCellStr === 'summary' || firstCellStr.includes('không thành công')) continue; 

                const rowObj = {}; let hasKpiData = false;
                colMapping.forEach(map => {
                    let val = row[map.excelIdx];
                    if (val === undefined || val === '') val = null;
                    let isStrCol = stringColumns.some(sc => sc.toLowerCase() === map.dbCol.toLowerCase());
                    if (val !== null && typeof val === 'string' && !isStrCol) {
                         if (/^-?\d+,\d+$/.test(val)) val = parseFloat(val.replace(',', '.')); 
                    }
                    if (map.dbCol === 'Thoi_gian' || map.dbCol === 'Date') {
                        if (val !== null) {
                            val = formatExcelDate(val);
                            if (typeof val === 'string' && val.includes(' ')) val = val.split(' ')[0];
                            lastValidDate = val; 
                        } else { val = lastValidDate; }
                    }
                    rowObj[map.dbCol] = val;
                    if (val !== null) hasKpiData = true;
                });

                if (hasKpiData) {
                    if (weekPrefix && hasTuanCol) rowObj['Tuan'] = weekPrefix;
                    insertData.push(rowObj);
                }
            }

            if (insertData.length > 0 && isKpiImported) {
                const uniqueDates = [...new Set(insertData.map(r => r.Thoi_gian).filter(Boolean))];
                if (uniqueDates.length > 0) {
                    const placeholders = uniqueDates.map(() => '?').join(',');
                    try { await db.query(`DELETE FROM ${networkType} WHERE Thoi_gian IN (${placeholders})`, uniqueDates); } catch (e) {}
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
        } catch (error) { console.error(`Lỗi file:`, error); }
    } 

    if (isKpiImported) await aggregateDashboardData();
    
    // Tự động Đồng bộ bảng QoE/QoS sau khi Import
    if (networkType === 'mbb_qoe' || networkType === 'mbb_qos' || networkType === 'kpi_4g') {
        await syncQoeQosSummary();
    }

    history = await getKpiHistory(); 
    return res.render('import_data', { title: 'Import Data', page: 'Import Data', userRole: userRole, history: history, message: `Đã Import/Ghi đè thành công ${totalImported} dòng.`, error: null });
};

// [MỚI] HÀM LẤY DANH SÁCH DISTRICT
exports.getDistricts = async (req, res) => {
    try {
        const [rows] = await db.query('SELECT DISTINCT District_code FROM kpi_4g WHERE District_code IS NOT NULL AND District_code != "" ORDER BY District_code');
        res.json(rows.map(r => r.District_code));
    } catch (error) {
        console.error("Lỗi lấy danh sách District:", error);
        res.status(500).json([]);
    }
};

// [CẬP NHẬT] HÀM TÍNH TOÁN DASHBOARD TRỰC TIẾP (Thay vì đọc bảng tĩnh)
exports.getDashboardData = async (req, res) => {
    const district = req.query.district || 'all';

    try {
        let params4g = [];
        let params5g = [];
        let filter4g = '';
        let filter5g = '';

        // NẾU CÓ CHỌN DISTRICT, THÊM ĐIỀU KIỆN LỌC
        if (district !== 'all') {
            filter4g = 'AND District_code = ?';
            params4g.push(district);
            
            // Thuật toán gán ghép 5G: Lấy các trạm 5G có phần thân tên giống trạm 4G thuộc District được chọn
            // (Ví dụ: 5G-THA001 sẽ được lọc nếu 4G-THA001 thuộc huyện THA)
            filter5g = 'AND SUBSTRING(Ten_CELL, 4) IN (SELECT SUBSTRING(Cell_name, 4) FROM kpi_4g WHERE District_code = ?)';
            params5g.push(district);
        }

        const query4g = `
            SELECT Thoi_gian as thoi_gian,
                   SUM(Total_Data_Traffic_Volume_GB) AS sum_TRAFFIC_4G,
                   AVG(User_DL_Avg_Throughput_Kbps) AS AVG_USER_DL_AVG_THPUT_4G,
                   AVG(RB_Util_Rate_DL) AS AVG_RES_BLK_DL_4G,
                   AVG(CQI_4G) AS AVG_CQI_4G
            FROM kpi_4g
            WHERE Thoi_gian IS NOT NULL AND Thoi_gian != '' ${filter4g}
            GROUP BY Thoi_gian
        `;

        const query5g = `
            SELECT Thoi_gian as thoi_gian,
                   SUM(Total_Data_Traffic_Volume_GB) AS sum_TRAFFIC_5G,
                   AVG(A_User_DL_Avg_Throughput) AS AVG_USER_DL_AVG_THPUT_5G,
                   AVG(CQI_5G) AS AVG_CQI_5G
            FROM kpi_5g
            WHERE Thoi_gian IS NOT NULL AND Thoi_gian != '' ${filter5g}
            GROUP BY Thoi_gian
        `;

        // Chạy song song 2 luồng truy vấn để tăng tốc
        const [rows4g] = await db.query(query4g, params4g);
        const [rows5g] = await db.query(query5g, params5g);

        // Gộp dữ liệu 4G và 5G lại theo Ngày (Thoi_gian)
        let mergedData = {};
        
        rows4g.forEach(r => {
            mergedData[r.thoi_gian] = { ...r, sum_TRAFFIC_5G: 0, AVG_USER_DL_AVG_THPUT_5G: 0, AVG_CQI_5G: 0 };
        });
        
        rows5g.forEach(r => {
            if (!mergedData[r.thoi_gian]) {
                mergedData[r.thoi_gian] = { 
                    thoi_gian: r.thoi_gian, sum_TRAFFIC_4G: 0, AVG_USER_DL_AVG_THPUT_4G: 0, AVG_RES_BLK_DL_4G: 0, AVG_CQI_4G: 0 
                };
            }
            mergedData[r.thoi_gian].sum_TRAFFIC_5G = r.sum_TRAFFIC_5G;
            mergedData[r.thoi_gian].AVG_USER_DL_AVG_THPUT_5G = r.AVG_USER_DL_AVG_THPUT_5G;
            mergedData[r.thoi_gian].AVG_CQI_5G = r.AVG_CQI_5G;
        });

        // Trả về mảng JSON
        res.json(Object.values(mergedData));

    } catch (error) { 
        console.error("Lỗi tính toán getDashboardData:", error);
        res.status(500).json({ error: "Lỗi CSDL." }); 
    }
};

exports.getWorstCellsData = async (req, res) => {
    const days = parseInt(req.query.days) || 1; 
    try {
        const [datesRaw] = await db.query('SELECT DISTINCT Thoi_gian FROM kpi_4g WHERE Thoi_gian IS NOT NULL AND Thoi_gian != ""');
        if(datesRaw.length === 0) return res.json([]);
        let uniqueDates = datesRaw.map(r => r.Thoi_gian).sort((a, b) => new Date(b.split('/').reverse().join('-')) - new Date(a.split('/').reverse().join('-'))); 
        const targetDates = uniqueDates.slice(0, days);
        if (targetDates.length === 0) return res.json([]);
        const placeholders = targetDates.map(() => '?').join(',');

        const query = `
            SELECT Cell_name, MAX(Thoi_gian) as Latest_Date,
                   AVG(User_DL_Avg_Throughput_Kbps) as User_DL_Avg_Throughput_Kbps, 
                   AVG(RB_Util_Rate_DL) as RB_Util_Rate_DL, AVG(CQI_4G) as CQI_4G, AVG(Service_Drop_all) as Service_Drop_all,
                   COUNT(Thoi_gian) as So_Ngay_Vi_Pham
            FROM kpi_4g WHERE Thoi_gian IN (${placeholders}) 
              AND (CellType IS NULL OR CellType NOT LIKE '%L900%') AND (Cell_name NOT LIKE 'MBF_TH%')
              AND (User_DL_Avg_Throughput_Kbps < 7000 OR RB_Util_Rate_DL > 20 OR CQI_4G < 93 OR Service_Drop_all > 0.3)
            GROUP BY Cell_name HAVING So_Ngay_Vi_Pham >= ? LIMIT 500
        `;
        const [rows] = await db.query(query, [...targetDates, days]);
        const formattedRows = rows.map(r => {
            let vios = [];
            if (r.User_DL_Avg_Throughput_Kbps < 7000) vios.push('Thput Thấp');
            if (r.RB_Util_Rate_DL > 20) vios.push('PRB Cao');
            if (r.CQI_4G < 93) vios.push('CQI Thấp');
            if (r.Service_Drop_all > 0.3) vios.push('Drop Rate Cao');
            r.Violations = vios.join(', ') || 'Vi phạm KPI';
            r.User_DL_Avg_Throughput_Kbps = r.User_DL_Avg_Throughput_Kbps.toFixed(2);
            r.RB_Util_Rate_DL = r.RB_Util_Rate_DL.toFixed(2);
            r.CQI_4G = r.CQI_4G.toFixed(2);
            r.Service_Drop_all = r.Service_Drop_all.toFixed(2);
            return r;
        });
        res.json(formattedRows);
    } catch (e) { res.status(500).json({ error: "Lỗi CSDL." }); }
};

exports.getCongestion3gData = async (req, res) => {
    const days = parseInt(req.query.days) || 3; 
    try {
        const [datesRaw] = await db.query('SELECT DISTINCT Thoi_gian FROM kpi_3g WHERE Thoi_gian IS NOT NULL AND Thoi_gian != ""');
        if(datesRaw.length === 0) return res.json([]);
        let uniqueDates = datesRaw.map(r => r.Thoi_gian).sort((a, b) => new Date(b.split('/').reverse().join('-')) - new Date(a.split('/').reverse().join('-'))); 
        const targetDates = uniqueDates.slice(0, days);
        if (targetDates.length === 0) return res.json([]);
        const placeholders = targetDates.map(() => '?').join(',');

        const query = `
            SELECT Ten_CELL as Cell_name, MAX(Thoi_gian) as Latest_Date,
                   AVG(CSCONGES) as CSCONGES, AVG(CS_SO_ATT) as CS_SO_ATT, AVG(PSCONGES) as PSCONGES, AVG(PS_SO_ATT) as PS_SO_ATT,
                   COUNT(Thoi_gian) as So_Ngay_Vi_Pham
            FROM kpi_3g WHERE Thoi_gian IN (${placeholders}) AND ((CSCONGES > 2 AND CS_SO_ATT > 100) OR (PSCONGES > 2 AND PS_SO_ATT > 500))
            GROUP BY Ten_CELL HAVING So_Ngay_Vi_Pham >= ? LIMIT 500
        `;
        const [rows] = await db.query(query, [...targetDates, days]);
        const formattedRows = rows.map(r => {
            let vios = [];
            if (r.CSCONGES > 2 && r.CS_SO_ATT > 100) vios.push('Nghẽn CS');
            if (r.PSCONGES > 2 && r.PS_SO_ATT > 500) vios.push('Nghẽn PS');
            r.Violations = vios.join(', ') || 'Nghẽn mạng';
            r.CSCONGES = r.CSCONGES.toFixed(2); r.CS_SO_ATT = Math.round(r.CS_SO_ATT);
            r.PSCONGES = r.PSCONGES.toFixed(2); r.PS_SO_ATT = Math.round(r.PS_SO_ATT);
            return r;
        });
        res.json(formattedRows);
    } catch (e) { res.status(500).json({ error: "Lỗi CSDL." }); }
};

exports.getTrafficDownData = async (req, res) => {
    try {
        const [datesRaw] = await db.query('SELECT DISTINCT Thoi_gian FROM kpi_4g WHERE Thoi_gian IS NOT NULL AND Thoi_gian != ""');
        let uniqueDates = datesRaw.map(r => r.Thoi_gian).sort((a, b) => new Date(b.split('/').reverse().join('-')) - new Date(a.split('/').reverse().join('-'))); 
        if(uniqueDates.length < 10) return res.json({ error: "Cần ít nhất 10 ngày dữ liệu." });

        const targetDates = uniqueDates.slice(0, 10);
        const placeholders = targetDates.map(() => '?').join(',');
        const [d0, d1, d2, , , , , d7, d8, d9] = targetDates; 

        const [rows] = await db.query(`SELECT Cell_name, Thoi_gian, Total_Data_Traffic_Volume_GB FROM kpi_4g WHERE Thoi_gian IN (${placeholders})`, targetDates);
        let dataMap = {};
        rows.forEach(r => {
            if (!dataMap[r.Cell_name]) { dataMap[r.Cell_name] = {}; targetDates.forEach(d => dataMap[r.Cell_name][d] = 0); }
            dataMap[r.Cell_name][r.Thoi_gian] = parseFloat(r.Total_Data_Traffic_Volume_GB) || 0;
        });

        let zeroTrafficCells = []; let droppedTrafficCells = [];
        for (let cell in dataMap) {
            let d = dataMap[cell];
            let t0 = d[d0], t1 = d[d1], t2 = d[d2], t7 = d[d7], t8 = d[d8], t9 = d[d9];
            let sum7 = 0; for(let i = 1; i <= 7; i++) sum7 += d[targetDates[i]];
            let avg7 = sum7 / 7;

            if (t0 < 0.1 && avg7 > 2) zeroTrafficCells.push({ Cell_name: cell, t0: t0.toFixed(2), avg7: avg7.toFixed(2) });
            else if (t0 < (0.7 * t7) && t7 > 1 && t1 < t8 && t2 < t9) {
                let ratio = ((t0 / t7) * 100).toFixed(1);
                droppedTrafficCells.push({ Cell_name: cell, t0: t0.toFixed(2), t7: t7.toFixed(2), ratio: ratio });
            }
        }
        zeroTrafficCells.sort((a,b) => b.avg7 - a.avg7); droppedTrafficCells.sort((a,b) => a.ratio - b.ratio);

        const [poiRows] = await db.query(`SELECT p.POI, k.Thoi_gian, SUM(k.Total_Data_Traffic_Volume_GB) as Total_Traffic FROM kpi_4g k JOIN poi_4g p ON k.Cell_name = p.Cell_Code WHERE k.Thoi_gian IN (${placeholders}) GROUP BY p.POI, k.Thoi_gian`, targetDates);
        let poiMap = {};
        poiRows.forEach(r => {
            if (!poiMap[r.POI]) { poiMap[r.POI] = {}; targetDates.forEach(d => poiMap[r.POI][d] = 0); }
            poiMap[r.POI][r.Thoi_gian] = parseFloat(r.Total_Traffic) || 0;
        });
        
        let droppedTrafficPOIs = [];
        for (let poi in poiMap) {
            let p = poiMap[poi];
            let pt0 = p[d0], pt1 = p[d1], pt2 = p[d2], pt7 = p[d7], pt8 = p[d8], pt9 = p[d9];
            if (pt0 < (0.7 * pt7) && pt1 < pt8 && pt2 < pt9) { 
                let ratio = ((pt0 / pt7) * 100).toFixed(1);
                droppedTrafficPOIs.push({ POI: poi, t0: pt0.toFixed(2), t7: pt7.toFixed(2), ratio: ratio });
            }
        }
        droppedTrafficPOIs.sort((a,b) => a.ratio - b.ratio);
        res.json({ latestDate: d0, lastWeekDate: d7, zeroTrafficCells: zeroTrafficCells, droppedTrafficCells: droppedTrafficCells, droppedTrafficPOIs: droppedTrafficPOIs });
    } catch (e) { res.status(500).json({ error: "Lỗi CSDL." }); }
};

exports.resetImportedData = async (req, res) => {
    let userRole = req.session && req.session.user ? req.session.user.role : 'user';
    if (userRole !== 'admin') return res.status(403).send("Chỉ Admin mới có quyền thực hiện chức năng này.");
    const table = req.params.table;
    const allowedTables = ['rf_3g', 'rf_4g', 'rf_5g', 'ta_query', 'mbb_qoe', 'mbb_qos', 'poi_4g', 'poi_5g', 'csht_data'];
    if (!allowedTables.includes(table)) return res.status(400).send("Bảng dữ liệu không hợp lệ.");

    try {
        await db.query(`TRUNCATE TABLE ${table}`);
        res.redirect('/import-data');
    } catch (e) { res.status(500).send("Lỗi máy chủ khi xóa dữ liệu. Vui lòng thử lại."); }
};
