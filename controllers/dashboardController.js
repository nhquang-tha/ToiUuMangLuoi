const db = require('../models/db');
const xlsx = require('xlsx');

// 1. ENGINE TOÁN HỌC: BIẾN CHUỖI VỀ SỐ YYYYMMDD ĐỂ SORT
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

// 2. ENGINE HIỂN THỊ: TỪ SỐ NGUYÊN TRẢ LẠI DD/MM/YYYY
function integerToDDMMYYYY(num) {
    if (!num || num === 0) return '';
    let s = String(num); 
    if (s.length !== 8) return '';
    return `${s.substring(6, 8)}/${s.substring(4, 6)}/${s.substring(0, 4)}`;
}

// HÀM CHUYỂN ĐỔI SỐ AN TOÀN TRÁNH LỖI DB
const getFloat = (val) => {
    if (val === undefined || val === null || val === "") return null;
    let n = Number(String(val).replace(/,/g, '').trim());
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

exports.renderPage = (pageName) => {
    return async (req, res) => {
        try { res.render('dashboard', { title: pageName, page: pageName }); } 
        catch (error) { res.status(500).send('Lỗi máy chủ khi tải trang'); }
    };
};

exports.getImportPage = async (req, res) => {
    const userRole = res.locals.currentUser ? res.locals.currentUser.role : 'user';
    const history = await getKpiHistory(); 
    res.render('import_data', { title: 'Import Data', page: 'Import Data', message: null, error: null, userRole: userRole, history: history });
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

    // VÒNG LẶP XỬ LÝ NHIỀU FILE
    for (let file of req.files) {
        try {
            const workbook = xlsx.read(file.buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            
            // THUẬT TOÁN ĐỊNH VỊ HEADER THÔNG MINH (Bỏ qua các hàng rác đầu file như "Lọc KPI 4G theo...")
            let rawData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false });
            let headerRowIndex = 0;
            for (let i = 0; i < Math.min(10, rawData.length); i++) {
                let rowStr = (rawData[i] || []).join('').toLowerCase();
                // Quét tìm từ khóa nhận diện Header
                if (rowStr.includes('district code') || rowStr.includes('province code') || rowStr.includes('site name') || rowStr.includes('tên rnc') || rowStr.includes('cell_code') || rowStr.includes('csht_code') || rowStr.includes('date')) {
                    headerRowIndex = i;
                    break;
                }
            }

            // Đọc lại data chuẩn dựa trên vị trí Header vừa tìm được (Tự động bỏ qua hàng rác phía trên)
            let data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { raw: false, defval: "", range: headerRowIndex });

            if (data.length === 0) {
                errorLogs.push(`File ${file.originalname} rỗng hoặc không đúng định dạng.`);
                continue;
            }

            // CHUẨN HÓA THỜI GIAN
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

            // KIỂM TRA HEADER BẮT BUỘC
            const requiredHeaders = {
                'rf_3g': ['CSHT_code', 'PSC'],
                'rf_4g': ['CSHT_code', 'ENodeBID'],
                'rf_5g': ['CSHT_code', 'nrarfcn'],
                'kpi_3g': ['Tên RNC', 'CSVOICECSSR'],
                'kpi_4g': ['Traffic Volume UL (GB)'], // Chỉ check các cột chung để linh hoạt
                'kpi_5g': ['CQI_5G'],
                'ta_query': ['Date', 'Cell Code'],
                'poi_4g': ['Cell_Code', 'POI'], 
                'poi_5g': ['Cell_Code', 'POI']  
            };

            const headersInFile = Object.keys(data[0]);
            const expectedHeaders = requiredHeaders[networkType];
            const isValidFile = expectedHeaders.every(header => headersInFile.includes(header));
            
            if (!isValidFile) {
                errorLogs.push(`File ${file.originalname} thiếu các cột chuẩn của ${networkType}.`);
                continue;
            }

            // XÓA DỮ LIỆU CŨ ĐỂ GHI ĐÈ 
            if (networkType.startsWith('kpi_')) {
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

            let sql = '';
            let values = [];

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
                const fileHeaders = Object.keys(data[0]); // Đọc chính xác cấu trúc Headers của file Excel

                sql = `INSERT INTO kpi_4g (Site_name, CellType, District_code, Cell_name, MIMO, Thoi_gian, UL_Traffic_VoLTE_GB, Avg_UL_throughput_QCI_1, VoLTE_Traffic_Erl, Total_Traffic_VoLTE_GB, VoLTE_ERAB_Call_Setup_SR, Intra_freq_HO_SR_VoLTE, Inter_freq_HO_SR_VoLTE, DL_Traffic_VoLTE_GB, Avg_DL_throughput_QCI_1, Call_Drop_Rate_VoLTE, SRVCC_SR_LTE_to_WCDMA, User_UL_Avg_Throughput_Kbps, User_DL_Avg_Throughput_Kbps, Traffic_Volume_UL_GB, Traffic_Volumn_DL_GB, Total_Data_Traffic_Volume_GB, Total_UE, Service_Drop_all, RB_Util_Rate_UL, RB_Util_Rate_DL, INTRA_HOSR_ATT, Intra_frequency_HO, Intra_eNB_HO_SR_total, Inter_frequency_HO, Inter_RAT_Total_HO_SR, Inter_RAT_HO_Prep_SR, Inter_RAT_HOSR_LTE_to_WCDMA, Inter_RAT_HO_SR_Exec, eRAB_Setup_SR_All, CS_Call_Setup_SR_Max, Downlink_Latency, Call_Setup_SR, E_UTRAN_Init_Context_Setup_SR_CSFB, CSFB_ATT, CQI_4G, Col42, Col43, Col44, Col45, Col46, Col47) VALUES ?`;
                
                values = data.map(row => {
                    let rowVals = [
                        row['Site name'] || '', 
                        row['CellType (L900, L1800, L2600..)'] || '', 
                        row['District code'] || row['Province code'] || '', 
                        row['Cell name'] || '', 
                        row['MIMO'] || '', 
                        row['Thời gian'] || '', 
                        getFloat(row['UL Traffic VoLTE (GB)']), 
                        getFloat(row['Average UL throughput of services with a QCI of 1 (kbit/s)']), 
                        getFloat(row['VoLTE Traffic (Erl)']), 
                        getFloat(row['Total Traffic VoLTE (GB)']), 
                        getFloat(row['VoLTE E-RAB Call Setup Success Rate']), 
                        getFloat(row['Intra-frequency HO Success Rates (VoLTE)']), 
                        getFloat(row['Inter-frequency HO Success Rates (VoLTE)']), 
                        getFloat(row['DL Traffic VoLTE (GB)']), 
                        getFloat(row['Average DL throughput of services with a QCI of 1 (kbit/s)']), 
                        getFloat(row['Call Drop Rate (VoLTE)']), 
                        getFloat(row['SRVCC Success Rate (LTE to WCDMA)']), 
                        getFloat(row['User Uplink Average Throughput (Kbps)']), 
                        getFloat(row['User Downlink Average Throughput (Kbps)']), 
                        getFloat(row['Traffic Volume UL (GB)']), 
                        getFloat(row['Traffic Volumn DL (GB)']), 
                        getFloat(row['Total Data Traffic Volume (GB)']), 
                        getFloat(row['Total UE']), 
                        getFloat(row['Service Drop (all service)']), 
                        getFloat(row['Resource Block Untilizing Rate Uplink (%)']), 
                        getFloat(row['Resource Block Untilizing Rate Downlink (%)']), 
                        getFloat(row['INTRA_HOSR_ATT (Attemp intra hosr (exe phrase))']), 
                        getFloat(row['Intra-frequency HO (%)']), 
                        getFloat(row['Intra eNB HO SR total']), 
                        getFloat(row['Inter-frequency HO (%)']), 
                        getFloat(row['Inter RAT Total HO SR (from HO preparation start until successful HO execution)']),
                        getFloat(row['Inter RAT HO Preparation Success Ratio (preparation phase)']),
                        getFloat(row['Inter-RAT HOSR (LTE to WCDMA) (%)']),
                        getFloat(row['Inter RAT HO SR (execution phase)']),
                        getFloat(row['eRAB Setup Success Rate (all services) (%)']),
                        getFloat(row['CS Call Setup Success Rate max Test']),
                        getFloat(row['Downlink Latency']),
                        getFloat(row['Call Setup Success Rate']),
                        getFloat(row['E-UTRAN Initial Context Setup Success Ratio being Subject for CS Fallback (%)']),
                        getFloat(row['CSFB_ATT']),
                        getFloat(row['CQI_4G'])
                    ];

                    // Quét nạp 6 cột còn lại dựa trên vị trí Index của Headers để hoàn thiện đủ 47 trường
                    for (let i = 41; i < 47; i++) {
                        if (i < fileHeaders.length) {
                            rowVals.push(getFloat(row[fileHeaders[i]]));
                        } else {
                            rowVals.push(null);
                        }
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

            await db.query(sql, [values]);
            totalImported += values.length;

        } catch (error) {
            console.error("Lỗi khi xử lý file:", error);
            errorLogs.push(`File ${file.originalname} bị lỗi: ${error.message}`);
        }
    } 

    history = await getKpiHistory(); 

    if (errorLogs.length > 0) {
        return res.render('import_data', { title: 'Import Data', page: 'Import Data', userRole: userRole, history: history, message: null, error: `Đã import được ${totalImported} dòng. Cảnh báo: ${errorLogs.join(' | ')}` });
    } else {
        return res.render('import_data', { title: 'Import Data', page: 'Import Data', userRole: userRole, history: history, error: null, message: `Import thành công tổng cộng ${totalImported} dòng từ ${req.files.length} file vào bảng ${networkType.toUpperCase()}!` });
    }
};
