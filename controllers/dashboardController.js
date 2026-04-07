const db = require('../models/db');
const xlsx = require('xlsx');

function parseDateToSortableInteger(val) {
    if (!val) return 0;
    let str = String(val).replace(/["'\r\n]/g, '').trim().split(' ')[0];
    if (str.includes('/')) {
        let parts = str.split('/');
        if (parts.length === 3) {
            let d = parseInt(parts[0], 10); let m = parseInt(parts[1], 10); let y = parseInt(parts[2], 10);
            if (m > 12 && d <= 12) { let temp = m; m = d; d = temp; }
            if (y < 100) y += 2000;
            if (!isNaN(d) && !isNaN(m) && !isNaN(y)) return (y * 10000) + (m * 100) + d;
        }
    }
    if (str.includes('-')) {
        let parts = str.split('T')[0].split('-');
        if (parts.length === 3 && parts[0].length === 4) {
            return parseInt(parts[0], 10) * 10000 + parseInt(parts[1], 10) * 100 + parseInt(parts[2], 10);
        }
    }
    return 0;
}

function integerToDDMMYYYY(num) {
    if (!num || num === 0) return '';
    let s = String(num); 
    if (s.length !== 8) return '';
    return `${s.substring(6, 8)}/${s.substring(4, 6)}/${s.substring(0, 4)}`;
}

// BỘ XỬ LÝ SỐ THỰC THÔNG MINH (Chống lỗi Crash do ký tự rác trong Excel)
const getFloat = (val) => {
    if (val === undefined || val === null || val === "") return null;
    let str = String(val).trim();
    
    // Xóa bỏ hoàn toàn các lỗi công thức của Excel
    if (str === '-' || str === 'N/A' || str === '#N/A' || str === '#DIV/0!' || str.toLowerCase() === 'null') return null;
    
    // Xử lý dấu phẩy (Kiểu Mỹ 1,000.54 vs Kiểu Việt 98,54)
    if (str.includes(',') && str.includes('.')) {
        str = str.replace(/,/g, ''); 
    } else if (str.includes(',') && !str.includes('.')) {
        str = str.replace(/,/g, '.');
    }
    
    let n = Number(str);
    return isNaN(n) ? null : n;
};

const getInt = (val) => {
    if (val === undefined || val === null || val === "") return 0;
    let n = Number(String(val).replace(/,/g, '').trim());
    return isNaN(n) ? 0 : n;
};

async function getKpiHistory() {
    try {
        const [rows3g] = await db.query('SELECT DISTINCT Thoi_gian FROM kpi_3g');
        const [rows4g] = await db.query('SELECT DISTINCT Thoi_gian FROM kpi_4g');
        const [rows5g] = await db.query('SELECT DISTINCT Thoi_gian FROM kpi_5g');

        const processHistory = (rows) => {
            let uniqueNums = [...new Set(rows.map(r => parseDateToSortableInteger(r.Thoi_gian)).filter(n => n > 0))];
            uniqueNums.sort((a, b) => a - b);
            return uniqueNums.map(n => integerToDDMMYYYY(n));
        };
        return { kpi3g: processHistory(rows3g), kpi4g: processHistory(rows4g), kpi5g: processHistory(rows5g) };
    } catch (e) { return { kpi3g: [], kpi4g: [], kpi5g: [] }; }
}

async function aggregateDashboardData() {
    const sql = `
        INSERT INTO Dashboard (
            thoi_gian, sum_TRAFFIC_4G, AVG_USER_DL_AVG_THPUT_4G, AVG_RES_BLK_DL_4G, AVG_CQI_4G,
            sum_TRAFFIC_5G, AVG_USER_DL_AVG_THPUT_5G, AVG_CQI_5G
        )
        SELECT 
            d.Thoi_gian,
            COALESCE(t4.sum_TRAFFIC_4G, 0), COALESCE(t4.AVG_USER_DL_AVG_THPUT_4G, 0), COALESCE(t4.AVG_RES_BLK_DL_4G, 0), COALESCE(t4.AVG_CQI_4G, 0),
            COALESCE(t5.sum_TRAFFIC_5G, 0), COALESCE(t5.AVG_USER_DL_AVG_THPUT_5G, 0), COALESCE(t5.AVG_CQI_5G, 0)
        FROM 
            (
                SELECT DISTINCT Thoi_gian FROM kpi_4g WHERE Thoi_gian IS NOT NULL AND Thoi_gian != ''
                UNION 
                SELECT DISTINCT Thoi_gian FROM kpi_5g WHERE Thoi_gian IS NOT NULL AND Thoi_gian != ''
            ) d
        LEFT JOIN 
            (SELECT Thoi_gian, SUM(Total_Data_Traffic_Volume_GB) AS sum_TRAFFIC_4G, AVG(User_DL_Avg_Throughput_Kbps) AS AVG_USER_DL_AVG_THPUT_4G, AVG(RB_Util_Rate_DL) AS AVG_RES_BLK_DL_4G, AVG(CQI_4G) AS AVG_CQI_4G FROM kpi_4g GROUP BY Thoi_gian) t4 ON d.Thoi_gian = t4.Thoi_gian
        LEFT JOIN 
            (SELECT Thoi_gian, SUM(Total_Data_Traffic_Volume_GB) AS sum_TRAFFIC_5G, AVG(A_User_DL_Avg_Throughput) AS AVG_USER_DL_AVG_THPUT_5G, AVG(CQI_5G) AS AVG_CQI_5G FROM kpi_5g GROUP BY Thoi_gian) t5 ON d.Thoi_gian = t5.Thoi_gian
        ON DUPLICATE KEY UPDATE
            sum_TRAFFIC_4G = VALUES(sum_TRAFFIC_4G),
            AVG_USER_DL_AVG_THPUT_4G = VALUES(AVG_USER_DL_AVG_THPUT_4G),
            AVG_RES_BLK_DL_4G = VALUES(AVG_RES_BLK_DL_4G),
            AVG_CQI_4G = VALUES(AVG_CQI_4G),
            sum_TRAFFIC_5G = VALUES(sum_TRAFFIC_5G),
            AVG_USER_DL_AVG_THPUT_5G = VALUES(AVG_USER_DL_AVG_THPUT_5G),
            AVG_CQI_5G = VALUES(AVG_CQI_5G);
    `;
    try { await db.query(sql); } catch (e) { console.error("Lỗi tổng hợp Dashboard:", e); }
}

exports.renderPage = (pageName) => {
    return async (req, res) => {
        try { res.render('dashboard', { title: pageName, page: pageName }); } 
        catch (error) { res.status(500).send('Lỗi tải trang'); }
    };
};

exports.getImportPage = async (req, res) => {
    const userRole = res.locals.currentUser ? res.locals.currentUser.role : 'user';
    const history = await getKpiHistory(); 
    res.render('import_data', { title: 'Import Data', page: 'Import Data', message: null, error: null, userRole: userRole, history: history });
};

exports.getDashboardData = async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM Dashboard');
        res.json(rows);
    } catch (error) { res.status(500).json({ error: "Lỗi dữ liệu Dashboard" }); }
};

exports.handleImportData = async (req, res) => {
    const userRole = res.locals.currentUser ? res.locals.currentUser.role : 'user';
    let history = await getKpiHistory(); 

    if (!req.files || req.files.length === 0) {
        return res.render('import_data', { title: 'Import Data', page: 'Import Data', message: null, error: 'Vui lòng chọn ít nhất 1 file!', userRole: userRole, history: history });
    }

    const networkType = req.body.networkType;
    let totalImported = 0;
    let errorLogs = [];
    let isKpiImported = false;

    const weekNumber = req.body.weekNumber || '1';
    const year = req.body.year || new Date().getFullYear();
    const tuanStr = `Tuần ${weekNumber} (${year})`;

    for (let file of req.files) {
        try {
            const workbook = xlsx.read(file.buffer, { type: 'buffer' });
            
            let data = []; 
            let sql = '';
            let values = [];

            // ============================================
            // 1. NHÓM ĐỌC DATA QOE VÀ QOS (MÔ PHỎNG PANDAS FFILL)
            // ============================================
            if (networkType === 'mbb_qoe' || networkType === 'mbb_qos') {
                
                let dataRows = [];
                
                // Quét qua TẤT CẢ các Sheet
                for (let sheetName of workbook.SheetNames) {
                    let rawDataArray = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false, defval: "" });
                    
                    // Biến nhớ (State) mô phỏng ffill() của Pandas
                    let currentProv = "", currentDist = "", currentWard = "", currentSite = "";

                    for (let i = 0; i < rawDataArray.length; i++) {
                        let row = rawDataArray[i];
                        if (!row || row.length < 5) continue;

                        let col0 = String(row[0] || '').trim();
                        let col1 = String(row[1] || '').trim();
                        let col2 = String(row[2] || '').trim();
                        let col3 = String(row[3] || '').trim();
                        let col4 = String(row[4] || '').trim(); 
                        
                        let col4Lower = col4.toLowerCase();

                        // 1. Bỏ qua dòng Header & Reset biến nhớ
                        if (col4Lower === 'tên cell' || col4Lower === 'cell name' || col4Lower === 'tổng' || col4Lower === 'total' || col4 === '') {
                            if (col4Lower === 'tên cell' || col4Lower === 'cell name') {
                                currentProv = ""; currentDist = ""; currentWard = ""; currentSite = "";
                            }
                            continue;
                        }

                        // 2. Bỏ qua dòng đánh số thứ tự (vd: 1, 2, 4, 5, 6...)
                        if (col0 !== '' && !isNaN(col0) && col0.length < 3 && col4 !== '' && !isNaN(col4)) {
                            continue;
                        }

                        // 3. Thực hiện Fill Down (Kéo dữ liệu gộp ô từ trên xuống)
                        if (col0 !== '') currentProv = col0;
                        if (col1 !== '') currentDist = col1;
                        if (col2 !== '') currentWard = col2;
                        if (col3 !== '') currentSite = col3;

                        // 4. Đưa vào mảng nếu là dòng dữ liệu thực sự (Có Tên Cell hợp lệ)
                        if (currentProv !== '' && col4.length > 3) {
                            // Cập nhật lại các ô rỗng bằng dữ liệu đã Fill
                            row[0] = currentProv;
                            row[1] = currentDist;
                            row[2] = currentWard;
                            row[3] = currentSite;
                            
                            dataRows.push(row);
                        }
                    }
                }

                if (dataRows.length === 0) {
                    errorLogs.push(`File ${file.originalname} không tìm thấy dữ liệu hợp lệ.`);
                    continue;
                }

                // CHUẨN BỊ SQL VÀ TRÍCH XUẤT GIÁ TRỊ TỪ CÁC CỘT (Tránh lỗi Undefined Array)
                if (networkType === 'mbb_qoe') {
                    sql = `INSERT INTO mbb_qoe (Tuan, Ma_Tinh, Don_Vi, Phuong_Xa, Site_Name, Cell_Name, Cell_ID, QoE_Score, QoE_Rank, Norm_Speed, Norm_Latency, Norm_Jitter, Norm_PacketLoss, Point_Speed, Point_Latency, Point_Jitter, Point_PacketLoss, Out_Speed, Out_Latency, Out_Jitter, Out_PacketLoss, In_Speed, In_Latency, In_Jitter, In_PacketLoss) VALUES ?`;
                    
                    values = dataRows.map(row => [
                        tuanStr, row[0], row[1], row[2], row[3], row[4], row[5], 
                        getFloat(row[6]), getFloat(row[7]), 
                        getFloat(row[8]), getFloat(row[9]), getFloat(row[10]), getFloat(row[11]), 
                        getFloat(row[12]), getFloat(row[13]), getFloat(row[14]), getFloat(row[15]), 
                        getFloat(row[16]), getFloat(row[17]), getFloat(row[18]), getFloat(row[19]), 
                        getFloat(row[20]), getFloat(row[21]), getFloat(row[22]), getFloat(row[23] || '')  
                    ]);
                    
                    if(values.length > 0) await db.query('DELETE FROM mbb_qoe WHERE Tuan = ?', [tuanStr]);

                } else if (networkType === 'mbb_qos') {
                    sql = `INSERT INTO mbb_qos (Tuan, Ma_Tinh, Don_Vi, Phuong_Xa, Site_Name, Cell_Name, Cell_ID, QoS_Score, QoS_Rank, Norm_Res, Norm_Acc, Norm_Ret, Norm_Int, Norm_Cov, Point_Res, Point_Acc, Point_Ret, Point_Int, Point_Cov, Out_Res, Out_Acc, Out_Ret, Out_Int, Out_Cov, In_Res, In_Acc, In_Ret, In_Int, In_Cov) VALUES ?`;
                    
                    values = dataRows.map(row => [
                        tuanStr, row[0], row[1], row[2], row[3], row[4], row[5],
                        getFloat(row[6]), getFloat(row[7]), 
                        getFloat(row[8]), getFloat(row[9]), getFloat(row[10]), getFloat(row[11]), getFloat(row[12]), 
                        getFloat(row[13]), getFloat(row[14]), getFloat(row[15]), getFloat(row[16]), getFloat(row[17]), 
                        getFloat(row[18]), getFloat(row[19]), getFloat(row[20]), getFloat(row[21]), getFloat(row[22]), 
                        getFloat(row[23]), getFloat(row[24]), getFloat(row[25]), getFloat(row[26]), getFloat(row[27] || '')  
                    ]);

                    if(values.length > 0) await db.query('DELETE FROM mbb_qos WHERE Tuan = ?', [tuanStr]);
                }

            // ============================================
            // 2. NHÓM ĐỌC DATA RF, KPI, TA, POI (TỰ TÌM HEADER)
            // ============================================
            } else {
                const sheetName = workbook.SheetNames[0]; 
                let rawDataArray = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false, defval: "" });

                let headerRowIndex = 0;
                for (let i = 0; i < Math.min(15, rawDataArray.length); i++) {
                    let rowStr = (rawDataArray[i] || []).join('').toLowerCase();
                    if (rowStr.includes('district code') || rowStr.includes('province code') || rowStr.includes('site name') || rowStr.includes('tên rnc') || rowStr.includes('cell_code') || rowStr.includes('csht_code') || rowStr.includes('date')) {
                        headerRowIndex = i; break;
                    }
                }
                data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { raw: false, defval: "", range: headerRowIndex });

                if (!networkType.startsWith('poi_')) {
                    data.forEach(row => {
                        let timeCol = row['Thời gian'] !== undefined ? 'Thời gian' : (row['Date'] !== undefined ? 'Date' : null);
                        if (timeCol) {
                            let t = row[timeCol];
                            if (t && !isNaN(t) && Number(t) > 30000 && typeof t === 'number') { 
                                let dateObj = new Date(Math.round((Number(t) - 25569) * 86400 * 1000));
                                row[timeCol] = `${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${dateObj.getFullYear()}`;
                            } else {
                                let num = parseDateToSortableInteger(t);
                                if (num > 0) row[timeCol] = integerToDDMMYYYY(num);
                                else row[timeCol] = String(t).trim();
                            }
                        }
                    });
                }

                if (networkType.startsWith('kpi_')) {
                    isKpiImported = true; 
                    const uniqueDates = [...new Set(data.map(row => row['Thời gian']).filter(Boolean))];
                    if (uniqueDates.length > 0) {
                        const placeholders = uniqueDates.map(() => '?').join(',');
                        await db.query(`DELETE FROM ${networkType} WHERE Thoi_gian IN (${placeholders})`, uniqueDates);
                    }
                } else if (networkType === 'ta_query') {
                    const uniqueDates = [...new Set(data.map(row => row['Date']).filter(Boolean))];
                    if (uniqueDates.length > 0) {
                        const placeholders = uniqueDates.map(() => '?').join(',');
                        await db.query(`DELETE FROM TA_Query WHERE \`Date\` IN (${placeholders})`, uniqueDates);
                    }
                } else if (networkType.startsWith('poi_')) {
                    await db.query(`TRUNCATE TABLE ${networkType}`);
                }

                if (networkType === 'rf_3g') {
                    sql = `INSERT INTO rf_3g (CSHT_code, CELL_NAME, Cell_code, Site_code, Latitude, Longitude, Equipment, Frenquency, PSC, DL_UARFCN, BSC_LAC, CI, Anten_height, Azimuth, M_T, E_T, Total_tilt, Hang_SX, Antena, Swap, Start_day, Ghi_chu) VALUES ?`;
                    values = data.map(row => [row['CSHT_code'], row['CELL_NAME'], row['Cell_code'], row['Site_code'], row['Latitude'], row['Longitude'], row['Equipment'], row['Frenquency'], row['PSC'], row['DL_UARFCN'], row['BSC_LAC'], row['CI'], row['Anten_height'], row['Azimuth'], row['M_T'], row['E_T'], row['Total_tilt'], row['Hãng_SX'], row['Antena'], row['Swap'], row['Start_day'], row['Ghi_chú']]);
                } else if (networkType === 'rf_4g') {
                    sql = `INSERT INTO rf_4g (CSHT_code, CELL_NAME, Cell_code, Site_code, Latitude, Longitude, Equipment, Frenquency, DL_UARFCN, PCI, TAC, ENodeBID, Lcrid, Anten_height, Azimuth, M_T, E_T, Total_tilt, MIMO, Hang_SX, Antena, Swap, Start_day, Ghi_chu) VALUES ?`;
                    values = data.map(row => [row['CSHT_code'], row['CELL_NAME'], row['Cell_code'], row['Site_code'], row['Latitude'], row['Longitude'], row['Equipment'], row['Frenquency'], row['DL_UARFCN'], row['PCI'], row['TAC'], row['ENodeBID'], row['Lcrid'], row['Anten_height'], row['Azimuth'], row['M_T'], row['E_T'], row['Total_tilt'], row['MIMO'], row['Hãng_SX'], row['Antena'], row['Swap'], row['Start_day'], row['Ghi_chú']]);
                } else if (networkType === 'rf_5g') {
                    sql = `INSERT INTO rf_5g (CSHT_code, SITE_NAME, Cell_code, Site_code, Latitude, Longitude, Equipment, Frenquency, nrarfcn, PCI, TAC, gNodeB_ID, Lcrid, Anten_height, Azimuth, M_T, E_T, Total_tilt, MIMO, Hang_SX, Antena, Dong_bo, Start_day, Ghi_chu) VALUES ?`;
                    values = data.map(row => [row['CSHT_code'], row['SITE_NAME'], row['Cell_code'], row['Site_code'], row['Latitude'], row['Longitude'], row['Equipment'], row['Frenquency'], row['nrarfcn'], row['PCI'], row['TAC'], row['gNodeB ID'], row['Lcrid'], row['Anten_height'], row['Azimuth'], row['M_T'], row['E_T'], row['Total_tilt'], row['MIMO'], row['Hãng_SX'], row['Antena'], row['Đồng_bộ'], row['Start_day'], row['Ghi_chú']]);
                } else if (networkType === 'kpi_3g') {
                    sql = `INSERT INTO kpi_3g (STT, Nha_cung_cap, Tinh, Ten_RNC, Ten_CELL, Ma_VNP, Loai_NE, LAC, CI, Thoi_gian, CS_SO_ATT, CS_IF_ATT, CS_IR_ATT, PS_IF_ATT, PS_IR_ATT, PS_SO_ATT, CSVOICECSSR, DLTRAFFICPS, CSIRATHOSRWEIGHT, PSHSPACALLDROPRATE, TRAFFIC, CSVIDEODROPCALLRATE, PSTRAFFIC, CSINTERFREQHOSR, ULTRAFFICPS, CSVIDEOTRAFFIC, PSR99CALLSETUPSR, CSVOICEDROPCALLRATE, PSHSDPATPKBPS, SOFTHOSR, PSR99UPLINKTRAFFICGB, TRAFFICACTIVESETCS64, PSR99TRAFFICGB, CALLVOLUME, PSHSPATRAFFICGB, PSCONGES, DCR, PSCSSR, CSSR, IRATHOSR, PSDCR, CSSRVIDEOPHONE, PSIRATHOSR, SOFTHOSRPS, CSCONGES, V2INTERFREQHOSRPS, R99DLTHROUGHPUT, HSDPATHROUGHPUT, PSR99CALLDROPRATE, PSHSUPATPKBPS, PSR99DLTRAFFICGB, PSHSUPATRAFFICGB, PSHSDPATRAFFICGB, PSHSPACSSR, R99ULTHROUGHPUT) VALUES ?`;
                    values = data.map(row => [row['STT'], row['Nhà cung cấp'], row['Tỉnh'], row['Tên RNC'], row['Tên CELL'], row['Mã VNP'], row['Loại NE'], row['LAC'], row['CI'], row['Thời gian'], row['CS_SO_ATT'], row['CS_IF_ATT'], row['CS_IR_ATT'], row['PS_IF_ATT'], row['PS_IR_ATT'], row['PS_SO_ATT'], row['CSVOICECSSR'], row['DLTRAFFICPS'], row['CSIRATHOSRWEIGHT'], row['PSHSPACALLDROPRATE'], row['TRAFFIC'], row['CSVIDEODROPCALLRATE'], row['PSTRAFFIC'], row['CSINTERFREQHOSR'], row['ULTRAFFICPS'], row['CSVIDEOTRAFFIC'], row['PSR99CALLSETUPSR'], row['CSVOICEDROPCALLRATE'], row['PSHSDPATPKBPS'], row['SOFTHOSR'], row['PSR99UPLINKTRAFFICGB'], row['TRAFFICACTIVESETCS64'], row['PSR99TRAFFICGB'], row['CALLVOLUME'], row['PSHSPATRAFFICGB'], row['PSCONGES'], row['DCR'], row['PSCSSR'], row['CSSR'], row['IRATHOSR'], row['PSDCR'], row['CSSRVIDEOPHONE'], row['PSIRATHOSR'], row['SOFTHOSRPS'], row['CSCONGES'], row['V2INTERFREQHOSRPS'], row['R99DLTHROUGHPUT'], row['HSDPATHROUGHPUT'], row['PSR99CALLDROPRATE'], row['PSHSUPATPKBPS'], row['PSR99DLTRAFFICGB'], row['PSHSUPATRAFFICGB'], row['PSHSDPATRAFFICGB'], row['PSHSPACSSR'], row['R99ULTHROUGHPUT']]);
                } else if (networkType === 'kpi_4g') {
                    const fileHeaders = Object.keys(data[0]); 
                    sql = `INSERT INTO kpi_4g (Site_name, CellType, District_code, Cell_name, MIMO, Thoi_gian, UL_Traffic_VoLTE_GB, Avg_UL_throughput_QCI_1, VoLTE_Traffic_Erl, Total_Traffic_VoLTE_GB, VoLTE_ERAB_Call_Setup_SR, Intra_freq_HO_SR_VoLTE, Inter_freq_HO_SR_VoLTE, DL_Traffic_VoLTE_GB, Avg_DL_throughput_QCI_1, Call_Drop_Rate_VoLTE, SRVCC_SR_LTE_to_WCDMA, User_UL_Avg_Throughput_Kbps, User_DL_Avg_Throughput_Kbps, Traffic_Volume_UL_GB, Traffic_Volumn_DL_GB, Total_Data_Traffic_Volume_GB, Total_UE, Service_Drop_all, RB_Util_Rate_UL, RB_Util_Rate_DL, INTRA_HOSR_ATT, Intra_frequency_HO, Intra_eNB_HO_SR_total, Inter_frequency_HO, Inter_RAT_Total_HO_SR, Inter_RAT_HO_Prep_SR, Inter_RAT_HOSR_LTE_to_WCDMA, Inter_RAT_HO_SR_Exec, eRAB_Setup_SR_All, CS_Call_Setup_SR_Max, Downlink_Latency, Call_Setup_SR, E_UTRAN_Init_Context_Setup_SR_CSFB, CSFB_ATT, CQI_4G, Col42, Col43, Col44, Col45, Col46, Col47) VALUES ?`;
                    values = data.map(row => {
                        let rowVals = [
                            row['Site name'] || '', row['CellType (L900, L1800, L2600..)'] || '', row['District code'] || row['Province code'] || '', row['Cell name'] || '', row['MIMO'] || '', row['Thời gian'] || '', 
                            getFloat(row['UL Traffic VoLTE (GB)']), getFloat(row['Average UL throughput of services with a QCI of 1 (kbit/s)']), getFloat(row['VoLTE Traffic (Erl)']), getFloat(row['Total Traffic VoLTE (GB)']), getFloat(row['VoLTE E-RAB Call Setup Success Rate']), getFloat(row['Intra-frequency HO Success Rates (VoLTE)']), getFloat(row['Inter-frequency HO Success Rates (VoLTE)']), getFloat(row['DL Traffic VoLTE (GB)']), getFloat(row['Average DL throughput of services with a QCI of 1 (kbit/s)']), getFloat(row['Call Drop Rate (VoLTE)']), getFloat(row['SRVCC Success Rate (LTE to WCDMA)']), getFloat(row['User Uplink Average Throughput (Kbps)']), getFloat(row['User Downlink Average Throughput (Kbps)']), getFloat(row['Traffic Volume UL (GB)']), getFloat(row['Traffic Volumn DL (GB)']), getFloat(row['Total Data Traffic Volume (GB)']), getFloat(row['Total UE']), getFloat(row['Service Drop (all service)']), getFloat(row['Resource Block Untilizing Rate Uplink (%)']), getFloat(row['Resource Block Untilizing Rate Downlink (%)']), getFloat(row['INTRA_HOSR_ATT (Attemp intra hosr (exe phrase))']), getFloat(row['Intra-frequency HO (%)']), getFloat(row['Intra eNB HO SR total']), getFloat(row['Inter-frequency HO (%)']), getFloat(row['Inter RAT Total HO SR (from HO preparation start until successful HO execution)']), getFloat(row['Inter RAT HO Preparation Success Ratio (preparation phase)']), getFloat(row['Inter-RAT HOSR (LTE to WCDMA) (%)']), getFloat(row['Inter RAT HO SR (execution phase)']), getFloat(row['eRAB Setup Success Rate (all services) (%)']), getFloat(row['CS Call Setup Success Rate max Test']), getFloat(row['Downlink Latency']), getFloat(row['Call Setup Success Rate']), getFloat(row['E-UTRAN Initial Context Setup Success Ratio being Subject for CS Fallback (%)']), getFloat(row['CSFB_ATT']), getFloat(row['CQI_4G'])
                        ];
                        for (let i = 41; i < 47; i++) {
                            if (i < fileHeaders.length) rowVals.push(getFloat(row[fileHeaders[i]]));
                            else rowVals.push(null);
                        }
                        return rowVals;
                    });
                } else if (networkType === 'kpi_5g') {
                    sql = `INSERT INTO kpi_5g (Nha_cung_cap, Tinh, Ten_GNODEB, Ten_CELL, Ma_VNP, Loai_NE, GNODEB_ID, CELL_ID, Thoi_gian, A_User_UL_Avg_Throughput, CQI_5G, Intra_SgNB_PScell_Change, Average_User_Number, DL_RB_Ultilization, UL_RB_Ultilization, Cell_avaibility_rate, Maximum_User_Number, UL_Traffic_Volume_GB, DL_Traffic_Volume_GB, Cell_UL_Avg_Throughput, Cell_DL_Avg_Throughput, SgNB_Abnormal_Release_Rate, SgNB_Addition_SR, A_User_DL_Avg_Throughput, Total_Data_Traffic_Volume_GB, Inter_SgNB_PScell_Change_2) VALUES ?`;
                    values = data.map(row => [row['Nhà cung cấp'], row['Tỉnh'], row['Tên GNODEB'], row['Tên CELL'], row['Mã VNP'], row['Loại NE'], row['GNODEB_ID'] || row['GNODEB ID'], row['CELL_ID'] || row['CELL ID'], row['Thời gian'], row['A User Uplink Average Throughput'] || row['USER_UL_AVG_THROUGHPUT'], row['CQI_5G'], row['Intra-SgNB PScell Change'] || row['INTRA_SGNB_PS_CHANGE'], row['Average User Number'] || row['USER_AVG_NUMBER'], row['Downlink Resource Block Ultilization'] || row['DLINK_RES_BLK_ULT'], row['Uplink Resource Block Ultilization'] || row['ULINK_RES_BLK_ULT'], row['Cell avaibility rate'] || row['CELL_AVAIBILITY_RATE'], row['Maximum User Number'] || row['USER_MAX_NUMBER'], row['UL Traffic Volume (GB)'] || row['UL_TRAFFIC_VOLUME'], row['DL Traffic Volume (GB)'] || row['DL_TRAFFIC_VOLUME'], row['Cell Uplink Average Throughput'] || row['CELL_UL_AVG_THROUGHPUT'], row['Cell Downlink Average Throughput'] || row['CELL_DL_AVG_THROUGHPUT'], row['SgNB Abnormal Release Rate'] || row['SGNB_ABN_RELEASE_RATE'], row['SgNB Addition Success Rate'] || row['SGNB_ADD_SUCCESS_RATE'], row['A User Downlink Average Throughput'] || row['USER_DL_AVG_THROUGHPUT'], row['Total Data Traffic Volume (GB)'] || row['TRAFFIC'], row['Inter-SgNB PScell Change'] || row['INTER_SGNB_PS_CHANGE']]);
                } else if (networkType === 'ta_query') {
                    sql = `INSERT INTO TA_Query (\`Date\`, \`eNodeB_Name\`, \`Cell_FDD_TDD_Indication\`, \`Cell_Code\`, \`LocalCell_Id\`, \`eNodeB_Function_Name\`, \`Integrity\`, \`Index0\`, \`Index1\`, \`Index2\`, \`Index3\`, \`Index4\`, \`Index5\`, \`Index6\`, \`Index7\`, \`Index8\`, \`Index9\`, \`Index10\`, \`Index11\`) VALUES ?`;
                    values = data.map(row => [
                        row['Date'] || '', row['eNodeB Name'] || '', row['Cell FDD TDD Indication'] || '', row['Cell Code'] || '', row['LocalCell Id'] || '', row['eNodeB Function Name'] || '', 
                        getFloat(row['Integrity']), getInt(row['L.RA.TA.UE.Index0']), getInt(row['L.RA.TA.UE.Index1']), getInt(row['L.RA.TA.UE.Index2']), getInt(row['L.RA.TA.UE.Index3']), getInt(row['L.RA.TA.UE.Index4']), getInt(row['L.RA.TA.UE.Index5']), getInt(row['L.RA.TA.UE.Index6']), getInt(row['L.RA.TA.UE.Index7']), getInt(row['L.RA.TA.UE.Index8']), getInt(row['L.RA.TA.UE.Index9']), getInt(row['L.RA.TA.UE.Index10']), getInt(row['L.RA.TA.UE.Index11'])
                    ]);
                } else if (networkType === 'poi_4g' || networkType === 'poi_5g') {
                    sql = `INSERT INTO ${networkType} (Cell_Code, Site_Code, POI) VALUES ?`;
                    values = data.map(row => [row['Cell_Code'] || '', row['Site_Code'] || '', row['POI'] || '']);
                }
            }

            // Kỹ thuật Chunking Insert: Chia nhỏ dữ liệu thành từng cụm 500 dòng
            // Giúp ngăn ngừa lỗi "Packet too large" và Crash CSDL khi nạp hàng chục ngàn dòng
            if (values.length > 0) {
                const chunkSize = 500;
                for (let i = 0; i < values.length; i += chunkSize) {
                    let chunk = values.slice(i, i + chunkSize);
                    await db.query(sql, [chunk]);
                }
                totalImported += values.length;
            }

        } catch (error) {
            console.error("Lỗi khi xử lý file:", error);
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
        return res.render('import_data', { title: 'Import Data', page: 'Import Data', userRole: userRole, history: history, error: null, message: `Import thành công tổng cộng ${totalImported} dòng từ ${req.files.length} file vào bảng ${networkType.toUpperCase()}!` });
    }
};
