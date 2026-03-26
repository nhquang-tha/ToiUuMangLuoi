const db = require('../models/db');
const xlsx = require('xlsx');

// 1. ENGINE TOÁN HỌC: BIẾN CHUỖI VỀ SỐ YYYYMMDD ĐỂ SORT
function parseDateToSortableInteger(val) {
    if (!val) return 0;
    
    let str = String(val).replace(/["'\r\n]/g, '').trim().split(' ')[0];

    // Xử lý chuỗi VN (DD/MM/YYYY)
    if (str.includes('/')) {
        let parts = str.split('/');
        if (parts.length === 3) {
            let d = parseInt(parts[0], 10);
            let m = parseInt(parts[1], 10);
            let y = parseInt(parts[2], 10);
            
            // Khắc phục rác nếu file bị lộn format Mỹ (Tháng/Ngày/Năm)
            if (m > 12 && d <= 12) { let temp = m; m = d; d = temp; }
            if (y < 100) y += 2000;
            
            if (!isNaN(d) && !isNaN(m) && !isNaN(y)) return (y * 10000) + (m * 100) + d;
        }
    }
    
    // Xử lý ISO DB (YYYY-MM-DD)
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
    let y = s.substring(0, 4);
    let m = s.substring(4, 6);
    let d = s.substring(6, 8);
    return `${d}/${m}/${y}`;
}

async function getKpiHistory() {
    try {
        const [rows3g] = await db.query('SELECT DISTINCT Thoi_gian FROM kpi_3g');
        const [rows4g] = await db.query('SELECT DISTINCT Thoi_gian FROM kpi_4g');
        const [rows5g] = await db.query('SELECT DISTINCT Thoi_gian FROM kpi_5g');

        const processHistory = (rows) => {
            // Lọc ra các số YYYYMMDD hợp lệ và xóa trùng lặp
            let uniqueNums = [...new Set(rows.map(r => parseDateToSortableInteger(r.Thoi_gian)).filter(n => n > 0))];
            
            // Sắp xếp TOÁN HỌC từ bé đến lớn
            uniqueNums.sort((a, b) => a - b);
            
            // Trả về dạng String
            return uniqueNums.map(n => integerToDDMMYYYY(n));
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
            
            // QUAN TRỌNG: raw: false ÉP BUỘC thư viện trả về dạng CHỮ chuẩn nguyên gốc, ko cho tự đoán ngày tháng
            let parseOptions = { raw: false, defval: "" };
            if (networkType === 'kpi_4g') parseOptions.range = 1;
            let data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], parseOptions);

            if (data.length === 0) {
                errorLogs.push(`File ${file.originalname} rỗng.`);
                continue;
            }

            // CHUẨN HÓA THỜI GIAN THEO DD/MM/YYYY TRƯỚC KHI LƯU VÀO DB
            data.forEach(row => {
                let t = row['Thời gian'];
                if (t !== undefined && t !== null) {
                    if (!isNaN(t) && Number(t) > 30000 && typeof t === 'number') { // Serial Number Excel
                        let dateObj = new Date(Math.round((Number(t) - 25569) * 86400 * 1000));
                        let d = String(dateObj.getDate()).padStart(2, '0');
                        let m = String(dateObj.getMonth() + 1).padStart(2, '0');
                        let y = dateObj.getFullYear();
                        row['Thời gian'] = `${d}/${m}/${y}`;
                    } else {
                        // Ép chuỗi text thành định dạng chuẩn nhất bằng Engine Toán học
                        let num = parseDateToSortableInteger(t);
                        if (num > 0) {
                            row['Thời gian'] = integerToDDMMYYYY(num);
                        } else {
                            row['Thời gian'] = String(t).trim();
                        }
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
            errorLogs.push(`File ${file.originalname} bị lỗi.`);
        }
    } // End For loop

    history = await getKpiHistory(); 

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
