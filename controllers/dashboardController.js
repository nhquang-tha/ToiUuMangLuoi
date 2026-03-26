const db = require('../models/db');
const xlsx = require('xlsx');

// 1. ENGINE CỐT LÕI: ÉP MỌI ĐỊNH DẠNG VỀ SỐ YYYYMMDD ĐỂ SORT
function parseDateToNumber(val) {
    if (!val) return 0;

    // A. Nếu DB trả về Object Date gốc
    if (val instanceof Date && !isNaN(val)) {
        return (val.getFullYear() * 10000) + ((val.getMonth() + 1) * 100) + val.getDate();
    }

    // B. Xử lý chuỗi
    let str = String(val).trim().replace(/["'\r\n]/g, '');

    // Nếu là dạng chuẩn Việt Nam: DD/MM/YYYY
    if (str.includes('/')) {
        let datePart = str.split(' ')[0]; // Bỏ giờ phút
        let parts = datePart.split('/');
        if (parts.length === 3) {
            let d = parseInt(parts[0], 10);
            let m = parseInt(parts[1], 10);
            let y = parseInt(parts[2], 10);
            if (y < 100) y += 2000;
            if (!isNaN(d) && !isNaN(m) && !isNaN(y)) return (y * 10000) + (m * 100) + d;
        }
    }

    // Nếu CSDL trả về chuỗi ISO YYYY-MM-DD
    if (str.includes('-')) {
        let datePart = str.split('T')[0].split(' ')[0];
        let parts = datePart.split('-');
        if (parts.length === 3) {
            let y = parseInt(parts[0], 10);
            let m = parseInt(parts[1], 10);
            let d = parseInt(parts[2], 10);
            if (!isNaN(d) && !isNaN(m) && !isNaN(y)) return (y * 10000) + (m * 100) + d;
        }
    }

    // Fallback
    let fb = new Date(str);
    if (!isNaN(fb)) return (fb.getFullYear() * 10000) + ((fb.getMonth() + 1) * 100) + fb.getDate();

    return 0;
}

// 2. ENGINE HIỂN THỊ: TỪ SỐ YYYYMMDD TRẢ VỀ CHUỖI DD/MM/YYYY CHUẨN
function formatDateToDDMMYYYY(val) {
    let num = parseDateToNumber(val);
    if (num === 0) return String(val); // Lỗi thì trả về chuỗi gốc
    
    let strNum = String(num);
    let y = strNum.substring(0, 4);
    let m = strNum.substring(4, 6);
    let d = strNum.substring(6, 8);
    return `${d}/${m}/${y}`;
}

// LẤY LỊCH SỬ KPI ĐÃ ĐƯỢC LỌC TRÙNG & SẮP XẾP CHUẨN
async function getKpiHistory() {
    try {
        const [rows3g] = await db.query('SELECT DISTINCT Thoi_gian FROM kpi_3g');
        const [rows4g] = await db.query('SELECT DISTINCT Thoi_gian FROM kpi_4g');
        const [rows5g] = await db.query('SELECT DISTINCT Thoi_gian FROM kpi_5g');

        const processHistory = (rows) => {
            // Lấy danh sách số YYYYMMDD hợp lệ
            let nums = rows.map(r => parseDateToNumber(r.Thoi_gian)).filter(n => n > 0);
            // Lọc trùng lặp
            let uniqueNums = [...new Set(nums)];
            // Sắp xếp số học (Bé đến Lớn)
            uniqueNums.sort((a, b) => a - b);
            // Chuyển lại thành chuỗi hiển thị DD/MM/YYYY
            return uniqueNums.map(num => formatDateToDDMMYYYY(num));
        };

        return { kpi3g: processHistory(rows3g), kpi4g: processHistory(rows4g), kpi5g: processHistory(rows5g) };
    } catch (e) {
        console.error("Lỗi lấy lịch sử KPI:", e);
        return { kpi3g: [], kpi4g: [], kpi5g: [] };
    }
}

exports.renderPage = (pageName) => {
    return async (req, res) => {
        try { res.render('dashboard', { title: pageName, page: pageName }); } 
        catch (error) { res.status(500).send('Lỗi máy chủ khi tải trang'); }
    };
};

exports.getImportPage = async (req, res) => {
    const userRole = req.session && req.session.user ? req.session.user.role : 'user';
    const history = await getKpiHistory(); 
    res.render('import_data', { title: 'Import Data', page: 'Import Data', message: null, error: null, userRole: userRole, history: history });
};

exports.handleImportData = async (req, res) => {
    const userRole = req.session && req.session.user ? req.session.user.role : 'user';
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
            
            let data = [];
            if (networkType === 'kpi_4g') {
                data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { range: 1 });
            } else {
                data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
            }

            if (data.length === 0) {
                errorLogs.push(`File ${file.originalname} rỗng.`);
                continue;
            }

            // CHUẨN HÓA VÀ LƯU THỜI GIAN THEO FORMAT DD/MM/YYYY CHUẨN
            data.forEach(row => {
                let t = row['Thời gian'];
                if (t !== undefined && t !== null) {
                    if (typeof t === 'number' || (!isNaN(t) && Number(t) > 30000)) {
                        let dateObj = new Date(Math.round((Number(t) - 25569) * 86400 * 1000));
                        row['Thời gian'] = formatDateToDDMMYYYY(dateObj);
                    } else {
                        row['Thời gian'] = formatDateToDDMMYYYY(t);
                    }
                }
            });

            // LOGIC KIỂM TRA ĐÚNG CHỦNG LOẠI FILE
            const requiredHeaders = {
                'rf_3g': ['CSHT_code', 'PSC', 'DL_UARFCN'],
                'rf_4g': ['CSHT_code', 'ENodeBID', 'PCI'],
                'rf_5g': ['CSHT_code', 'gNodeB ID', 'nrarfcn'],
                'kpi_3g': ['Tên RNC', 'CSVOICECSSR', 'CS_SO_ATT'],
                'kpi_4g': ['District code', 'UL Traffic VoLTE (GB)'],
                'kpi_5g': ['Tên GNODEB', 'CQI_5G', 'USER_UL_AVG_THROUGHPUT']
            };

            const headersInFile = Object.keys(data[0]);
            
            if (networkType === 'kpi_4g') {
                if (headersInFile.includes('Province code')) requiredHeaders['kpi_4g'][0] = 'Province code';
                else if (headersInFile.includes('District code')) requiredHeaders['kpi_4g'][0] = 'District code';
            }
            if (networkType === 'kpi_5g') {
                if (headersInFile.includes('A User Uplink Average Throughput')) requiredHeaders['kpi_5g'][2] = 'A User Uplink Average Throughput';
                else if (headersInFile.includes('USER_UL_AVG_THROUGHPUT')) requiredHeaders['kpi_5g'][2] = 'USER_UL_AVG_THROUGHPUT';
            }

            const expectedHeaders = requiredHeaders[networkType];
            const isValidFile = expectedHeaders.every(header => headersInFile.includes(header));
            
            if (!isValidFile) {
                errorLogs.push(`File ${file.originalname} sai cấu trúc.`);
                continue;
            }

            // XÓA DỮ LIỆU CŨ CỦA CÁC NGÀY CÓ TRONG FILE NÀY ĐỂ GHI ĐÈ
            if (networkType.startsWith('kpi_')) {
                const uniqueDates = [...new Set(data.map(row => row['Thời gian']).filter(Boolean))];
                if (uniqueDates.length > 0) {
                    const placeholders = uniqueDates.map(() => '?').join(',');
                    const deleteSql = `DELETE FROM ${networkType} WHERE Thoi_gian IN (${placeholders})`;
                    await db.query(deleteSql, uniqueDates);
                }
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
                sql = `INSERT INTO kpi_4g (District_code, Site_name, CellType, Cell_name, MIMO, Thoi_gian, UL_Traffic_VoLTE_GB, Avg_UL_throughput_QCI_1, VoLTE_Traffic_Erl, Total_Traffic_VoLTE_GB, VoLTE_ERAB_Call_Setup_SR, Intra_freq_HO_SR_VoLTE, Inter_freq_HO_SR_VoLTE, DL_Traffic_VoLTE_GB, Avg_DL_throughput_QCI_1, Call_Drop_Rate_VoLTE, SRVCC_SR_LTE_to_WCDMA, SRVCC_SR_LTE_to_GSM, User_UL_Avg_Throughput_Kbps, User_DL_Avg_Throughput_kbps, User_DL_Avg_Throughput_kbps_New, Unavailable, Uplink_Latency, Traffic_Volume_UL_GB, Traffic_Volumn_DL_GB, Total_Data_Traffic_Volume_GB, Total_UE, Service_Drop_all, RRC_Conn_Estab_SR, RRC_Conn_User_Max, RRC_Conn_User_Avg, RB_Util_Rate_UL, RB_Util_Rate_DL, INTRA_HOSR_ATT, Intra_frequency_HO, Intra_eNB_HO_SR_total, Inter_frequency_HO, HO_SR_via_S1, Inter_RAT_Total_HO_SR, Other_Metrics) VALUES ?`;
                values = data.map(row => [row['Province code'] || row['District code'], row['Site name'], row['CellType (L900, L1800, L2600..)'], row['Cell name'], row['MIMO'], row['Thời gian'], row['UL Traffic VoLTE (GB)'], row['Average UL throughput of services with a QCI of 1 (kbit/s)'], row['VoLTE Traffic (Erl)'], row['Total Traffic VoLTE (GB)'], row['VoLTE E-RAB Call Setup Success Rate'], row['Intra-frequency HO Success Rates (VoLTE)'], row['Inter-frequency HO Success Rates (VoLTE)'], row['DL Traffic VoLTE (GB)'], row['Average DL throughput of services with a QCI of 1 (kbit/s)'], row['Call Drop Rate (VoLTE)'], row['SRVCC Success Rate (LTE to WCDMA)'], row['SRVCC Success Rate (LTE to GSM)'], row['User Uplink Average Throughput (Kbps)'], row['User Downlink Average Throughput (kbps)'], row['User Downlink Average Throughput (kbps) New'], row['Unavailable'], row['Uplink Latency'], row['Traffic Volume UL (GB)'], row['Traffic Volumn DL (GB)'], row['Total Data Traffic Volume (GB)'], row['Total UE'], row['Service Drop (all service)'], row['RRC Connection Establishment Success Rate (All Service)'], row['RRC Connected User_Max (Cell)'], row['RRC Connected User_Avg (Cell)'], row['Resource Block Untilizing Rate Uplink (%)'], row['Resource Block Untilizing Rate Downlink (%)'], row['INTRA_HOSR_ATT (Attemp intra hosr (exe phrase))'], row['Intra-frequency HO (%)'], row['Intra eNB HO SR total'], row['Inter-frequency HO (%)'], row['Handover Success Rate via S1 (%)'], row['Inter RAT Total HO SR (from HO preparation start until successful HO execution)'], null]);
            } else if (networkType === 'kpi_5g') {
                sql = `INSERT INTO kpi_5g (Nha_cung_cap, Tinh, Ten_GNODEB, Ten_CELL, Ma_VNP, Loai_NE, GNODEB_ID, CELL_ID, Thoi_gian, A_User_UL_Avg_Throughput, CQI_5G, Intra_SgNB_PScell_Change, Average_User_Number, DL_RB_Ultilization, UL_RB_Ultilization, Cell_avaibility_rate, Maximum_User_Number, UL_Traffic_Volume_GB, DL_Traffic_Volume_GB, Cell_UL_Avg_Throughput, Cell_DL_Avg_Throughput, SgNB_Abnormal_Release_Rate, SgNB_Addition_SR, A_User_DL_Avg_Throughput, Total_Data_Traffic_Volume_GB, Inter_SgNB_PScell_Change_2) VALUES ?`;
                values = data.map(row => [row['Nhà cung cấp'], row['Tỉnh'], row['Tên GNODEB'], row['Tên CELL'], row['Mã VNP'], row['Loại NE'], row['GNODEB_ID'] || row['GNODEB ID'], row['CELL_ID'] || row['CELL ID'], row['Thời gian'], row['A User Uplink Average Throughput'] || row['USER_UL_AVG_THROUGHPUT'], row['CQI_5G'], row['Intra-SgNB PScell Change'] || row['INTRA_SGNB_PS_CHANGE'], row['Average User Number'] || row['USER_AVG_NUMBER'], row['Downlink Resource Block Ultilization'] || row['DLINK_RES_BLK_ULT'], row['Uplink Resource Block Ultilization'] || row['ULINK_RES_BLK_ULT'], row['Cell avaibility rate'] || row['CELL_AVAIBILITY_RATE'], row['Maximum User Number'] || row['USER_MAX_NUMBER'], row['UL Traffic Volume (GB)'] || row['UL_TRAFFIC_VOLUME'], row['DL Traffic Volume (GB)'] || row['DL_TRAFFIC_VOLUME'], row['Cell Uplink Average Throughput'] || row['CELL_UL_AVG_THROUGHPUT'], row['Cell Downlink Average Throughput'] || row['CELL_DL_AVG_THROUGHPUT'], row['SgNB Abnormal Release Rate'] || row['SGNB_ABN_RELEASE_RATE'], row['SgNB Addition Success Rate'] || row['SGNB_ADD_SUCCESS_RATE'], row['A User Downlink Average Throughput'] || row['USER_DL_AVG_THROUGHPUT'], row['Total Data Traffic Volume (GB)'] || row['TRAFFIC'], row['Inter-SgNB PScell Change'] || row['INTER_SGNB_PS_CHANGE']]);
            }

            await db.query(sql, [values]);
            totalImported += values.length;

        } catch (error) {
            console.error("Lỗi khi xử lý file:", error);
            errorLogs.push(`File ${file.originalname} bị lỗi không xác định.`);
        }
    } // End For loop

    history = await getKpiHistory(); // Load lại lịch sử sau khi Insert xong tất cả file

    if (errorLogs.length > 0) {
        return res.render('import_data', { 
            title: 'Import Data', page: 'Import Data', userRole: userRole, history: history, message: null,
            error: `Đã import được ${totalImported} dòng. Cảnh báo: ${errorLogs.join(' | ')}`
        });
    } else {
        return res.render('import_data', { 
            title: 'Import Data', page: 'Import Data', userRole: userRole, history: history, error: null,
            message: `Import thành công tổng cộng ${totalImported} dòng từ ${req.files.length} file vào bảng ${networkType.toUpperCase()}!`
        });
    }
};
