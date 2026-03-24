const db = require('../models/db');
const xlsx = require('xlsx');

exports.renderPage = (pageName) => {
    return async (req, res) => {
        try { res.render('dashboard', { title: pageName, page: pageName }); } 
        catch (error) { res.status(500).send('Lỗi máy chủ khi tải trang'); }
    };
};

exports.getImportPage = (req, res) => {
    res.render('import_data', { title: 'Import Data', page: 'Import Data', message: null, error: null });
};

exports.handleImportData = async (req, res) => {
    try {
        if (!req.file) {
            return res.render('import_data', { title: 'Import Data', page: 'Import Data', message: null, error: 'Vui lòng chọn một file!' });
        }

        const networkType = req.body.networkType; // rf_3g, rf_4g, kpi_4g...
        
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        
        let data = [];
        if (networkType === 'kpi_4g') {
            data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { range: 1 });
        } else {
            data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
        }

        if (data.length === 0) {
            return res.render('import_data', { title: 'Import Data', page: 'Import Data', message: null, error: 'File rỗng hoặc không đúng định dạng!' });
        }

        // ===================== LOGIC KIỂM TRA ĐÚNG CHỦNG LOẠI FILE =====================
        // Danh sách các cột "đặc trưng" bắt buộc phải có của từng loại file
        const requiredHeaders = {
            'rf_3g': ['CSHT_code', 'PSC', 'DL_UARFCN'],
            'rf_4g': ['CSHT_code', 'ENodeBID', 'PCI'],
            'rf_5g': ['CSHT_code', 'gNodeB ID', 'nrarfcn'],
            'kpi_3g': ['Tên RNC', 'CSVOICECSSR', 'CS_SO_ATT'],
            'kpi_4g': ['District code', 'UL Traffic VoLTE (GB)'],
            'kpi_5g': ['Tên GNODEB', 'CQI_5G', 'A User Uplink Average Throughput']
        };

        const headersInFile = Object.keys(data[0]); // Lấy danh sách tên cột của file được Upload
        const expectedHeaders = requiredHeaders[networkType];

        // Kiểm tra xem MỌI cột đặc trưng có tồn tại trong file upload hay không
        const isValidFile = expectedHeaders.every(header => headersInFile.includes(header));
        
        if (!isValidFile) {
            return res.render('import_data', { 
                title: 'Import Data', 
                page: 'Import Data', 
                message: null, 
                error: `⚠️ PHÁT HIỆN SAI FILE! Bạn đang chọn import vào bảng ${networkType.toUpperCase()} nhưng cấu trúc file tải lên không chứa các cột đặc trưng của mạng này. Vui lòng chọn đúng file.` 
            });
        }
        // ===============================================================================

        let sql = '';
        let values = [];

        // MAPPING DỮ LIỆU BẢNG RF
        if (networkType === 'rf_3g') {
            sql = `INSERT INTO rf_3g (CSHT_code, CELL_NAME, Cell_code, Site_code, Latitude, Longitude, Equipment, Frenquency, PSC, DL_UARFCN, BSC_LAC, CI, Anten_height, Azimuth, M_T, E_T, Total_tilt, Hang_SX, Antena, Swap, Start_day, Ghi_chu) VALUES ?`;
            values = data.map(row => [
                row['CSHT_code'], row['CELL_NAME'], row['Cell_code'], row['Site_code'], row['Latitude'], row['Longitude'], row['Equipment'], row['Frenquency'], row['PSC'], row['DL_UARFCN'], row['BSC_LAC'], row['CI'], row['Anten_height'], row['Azimuth'], row['M_T'], row['E_T'], row['Total_tilt'], row['Hãng_SX'], row['Antena'], row['Swap'], row['Start_day'], row['Ghi_chú']
            ]);
        } else if (networkType === 'rf_4g') {
            sql = `INSERT INTO rf_4g (CSHT_code, CELL_NAME, Cell_code, Site_code, Latitude, Longitude, Equipment, Frenquency, DL_UARFCN, PCI, TAC, ENodeBID, Lcrid, Anten_height, Azimuth, M_T, E_T, Total_tilt, MIMO, Hang_SX, Antena, Swap, Start_day, Ghi_chu) VALUES ?`;
            values = data.map(row => [
                row['CSHT_code'], row['CELL_NAME'], row['Cell_code'], row['Site_code'], row['Latitude'], row['Longitude'], row['Equipment'], row['Frenquency'], row['DL_UARFCN'], row['PCI'], row['TAC'], row['ENodeBID'], row['Lcrid'], row['Anten_height'], row['Azimuth'], row['M_T'], row['E_T'], row['Total_tilt'], row['MIMO'], row['Hãng_SX'], row['Antena'], row['Swap'], row['Start_day'], row['Ghi_chú']
            ]);
        } else if (networkType === 'rf_5g') {
            sql = `INSERT INTO rf_5g (CSHT_code, SITE_NAME, Cell_code, Site_code, Latitude, Longitude, Equipment, Frenquency, nrarfcn, PCI, TAC, gNodeB_ID, Lcrid, Anten_height, Azimuth, M_T, E_T, Total_tilt, MIMO, Hang_SX, Antena, Dong_bo, Start_day, Ghi_chu) VALUES ?`;
            values = data.map(row => [
                row['CSHT_code'], row['SITE_NAME'], row['Cell_code'], row['Site_code'], row['Latitude'], row['Longitude'], row['Equipment'], row['Frenquency'], row['nrarfcn'], row['PCI'], row['TAC'], row['gNodeB ID'], row['Lcrid'], row['Anten_height'], row['Azimuth'], row['M_T'], row['E_T'], row['Total_tilt'], row['MIMO'], row['Hãng_SX'], row['Antena'], row['Đồng_bộ'], row['Start_day'], row['Ghi_chú']
            ]);
        } 
        // MAPPING DỮ LIỆU BẢNG KPI
        else if (networkType === 'kpi_3g') {
            sql = `INSERT INTO kpi_3g (STT, Nha_cung_cap, Tinh, Ten_RNC, Ten_CELL, Ma_VNP, Loai_NE, LAC, CI, Thoi_gian, CS_SO_ATT, CS_IF_ATT, CS_IR_ATT, PS_IF_ATT, PS_IR_ATT, PS_SO_ATT, CSVOICECSSR, DLTRAFFICPS, CSIRATHOSRWEIGHT, PSHSPACALLDROPRATE, TRAFFIC, CSVIDEODROPCALLRATE, PSTRAFFIC, CSINTERFREQHOSR, ULTRAFFICPS, CSVIDEOTRAFFIC, PSR99CALLSETUPSR, CSVOICEDROPCALLRATE, PSHSDPATPKBPS, SOFTHOSR, PSR99UPLINKTRAFFICGB, TRAFFICACTIVESETCS64, PSR99TRAFFICGB, CALLVOLUME, PSHSPATRAFFICGB, PSCONGES, DCR, PSCSSR, CSSR, IRATHOSR, PSDCR, CSSRVIDEOPHONE, PSIRATHOSR, SOFTHOSRPS, CSCONGES, V2INTERFREQHOSRPS, R99DLTHROUGHPUT, HSDPATHROUGHPUT, PSR99CALLDROPRATE, PSHSUPATPKBPS, PSR99DLTRAFFICGB, PSHSUPATRAFFICGB, PSHSDPATRAFFICGB, PSHSPACSSR, R99ULTHROUGHPUT) VALUES ?`;
            values = data.map(row => [
                row['STT'], row['Nhà cung cấp'], row['Tỉnh'], row['Tên RNC'], row['Tên CELL'], row['Mã VNP'], row['Loại NE'], row['LAC'], row['CI'], row['Thời gian'], row['CS_SO_ATT'], row['CS_IF_ATT'], row['CS_IR_ATT'], row['PS_IF_ATT'], row['PS_IR_ATT'], row['PS_SO_ATT'], row['CSVOICECSSR'], row['DLTRAFFICPS'], row['CSIRATHOSRWEIGHT'], row['PSHSPACALLDROPRATE'], row['TRAFFIC'], row['CSVIDEODROPCALLRATE'], row['PSTRAFFIC'], row['CSINTERFREQHOSR'], row['ULTRAFFICPS'], row['CSVIDEOTRAFFIC'], row['PSR99CALLSETUPSR'], row['CSVOICEDROPCALLRATE'], row['PSHSDPATPKBPS'], row['SOFTHOSR'], row['PSR99UPLINKTRAFFICGB'], row['TRAFFICACTIVESETCS64'], row['PSR99TRAFFICGB'], row['CALLVOLUME'], row['PSHSPATRAFFICGB'], row['PSCONGES'], row['DCR'], row['PSCSSR'], row['CSSR'], row['IRATHOSR'], row['PSDCR'], row['CSSRVIDEOPHONE'], row['PSIRATHOSR'], row['SOFTHOSRPS'], row['CSCONGES'], row['V2INTERFREQHOSRPS'], row['R99DLTHROUGHPUT'], row['HSDPATHROUGHPUT'], row['PSR99CALLDROPRATE'], row['PSHSUPATPKBPS'], row['PSR99DLTRAFFICGB'], row['PSHSUPATRAFFICGB'], row['PSHSDPATRAFFICGB'], row['PSHSPACSSR'], row['R99ULTHROUGHPUT']
            ]);
        } else if (networkType === 'kpi_4g') {
            sql = `INSERT INTO kpi_4g (District_code, Site_name, CellType, Cell_name, MIMO, Thoi_gian, UL_Traffic_VoLTE_GB, Avg_UL_throughput_QCI_1, VoLTE_Traffic_Erl, Total_Traffic_VoLTE_GB, VoLTE_ERAB_Call_Setup_SR, Intra_freq_HO_SR_VoLTE, Inter_freq_HO_SR_VoLTE, DL_Traffic_VoLTE_GB, Avg_DL_throughput_QCI_1, Call_Drop_Rate_VoLTE, SRVCC_SR_LTE_to_WCDMA, SRVCC_SR_LTE_to_GSM, User_UL_Avg_Throughput_Kbps, User_DL_Avg_Throughput_kbps, User_DL_Avg_Throughput_kbps_New, Unavailable, Uplink_Latency, Traffic_Volume_UL_GB, Traffic_Volumn_DL_GB, Total_Data_Traffic_Volume_GB, Total_UE, Service_Drop_all, RRC_Conn_Estab_SR, RRC_Conn_User_Max, RRC_Conn_User_Avg, RB_Util_Rate_UL, RB_Util_Rate_DL, INTRA_HOSR_ATT, Intra_frequency_HO, Intra_eNB_HO_SR_total, Inter_frequency_HO, HO_SR_via_S1, Inter_RAT_Total_HO_SR, Other_Metrics) VALUES ?`;
            values = data.map(row => [
                row['District code'], row['Site name'], row['CellType (L900, L1800, L2600..)'], row['Cell name'], row['MIMO'], row['Thời gian'], row['UL Traffic VoLTE (GB)'], row['Average UL throughput of services with a QCI of 1 (kbit/s)'], row['VoLTE Traffic (Erl)'], row['Total Traffic VoLTE (GB)'], row['VoLTE E-RAB Call Setup Success Rate'], row['Intra-frequency HO Success Rates (VoLTE)'], row['Inter-frequency HO Success Rates (VoLTE)'], row['DL Traffic VoLTE (GB)'], row['Average DL throughput of services with a QCI of 1 (kbit/s)'], row['Call Drop Rate (VoLTE)'], row['SRVCC Success Rate (LTE to WCDMA)'], row['SRVCC Success Rate (LTE to GSM)'], row['User Uplink Average Throughput (Kbps)'], row['User Downlink Average Throughput (kbps)'], row['User Downlink Average Throughput (kbps) New'], row['Unavailable'], row['Uplink Latency'], row['Traffic Volume UL (GB)'], row['Traffic Volumn DL (GB)'], row['Total Data Traffic Volume (GB)'], row['Total UE'], row['Service Drop (all service)'], row['RRC Connection Establishment Success Rate (All Service)'], row['RRC Connected User_Max (Cell)'], row['RRC Connected User_Avg (Cell)'], row['Resource Block Untilizing Rate Uplink (%)'], row['Resource Block Untilizing Rate Downlink (%)'], row['INTRA_HOSR_ATT (Attemp intra hosr (exe phrase))'], row['Intra-frequency HO (%)'], row['Intra eNB HO SR total'], row['Inter-frequency HO (%)'], row['Handover Success Rate via S1 (%)'], row['Inter RAT Total HO SR (from HO preparation start until successful HO execution)'], null
            ]);
        } else if (networkType === 'kpi_5g') {
            sql = `INSERT INTO kpi_5g (Nha_cung_cap, Tinh, Ten_GNODEB, Ten_CELL, Ma_VNP, Loai_NE, GNODEB_ID, CELL_ID, Thoi_gian, A_User_UL_Avg_Throughput, CQI_5G, Intra_SgNB_PScell_Change, Average_User_Number, DL_RB_Ultilization, UL_RB_Ultilization, Cell_avaibility_rate, Maximum_User_Number, UL_Traffic_Volume_GB, DL_Traffic_Volume_GB, Cell_UL_Avg_Throughput, Cell_DL_Avg_Throughput, SgNB_Abnormal_Release_Rate, SgNB_Addition_SR, A_User_DL_Avg_Throughput, Total_Data_Traffic_Volume_GB, Inter_SgNB_PScell_Change_2) VALUES ?`;
            values = data.map(row => [
                row['Nhà cung cấp'], row['Tỉnh'], row['Tên GNODEB'], row['Tên CELL'], row['Mã VNP'], row['Loại NE'], row['GNODEB_ID'], row['CELL_ID'], row['Thời gian'], row['A User Uplink Average Throughput'], row['CQI_5G'], row['Intra-SgNB PScell Change'], row['Average User Number'], row['Downlink Resource Block Ultilization'], row['Uplink Resource Block Ultilization'], row['Cell avaibility rate'], row['Maximum User Number'], row['UL Traffic Volume (GB)'], row['DL Traffic Volume (GB)'], row['Cell Uplink Average Throughput'], row['Cell Downlink Average Throughput'], row['SgNB Abnormal Release Rate'], row['SgNB Addition Success Rate'], row['A User Downlink Average Throughput'], row['Total Data Traffic Volume (GB)'], row['Inter-SgNB PScell Change']
            ]);
        }

        // Thực thi Bulk Insert
        await db.query(sql, [values]);

        res.render('import_data', { 
            title: 'Import Data', page: 'Import Data', 
            message: `Import thành công ${values.length} dòng vào cơ sở dữ liệu ${networkType.toUpperCase()}!`, error: null 
        });

    } catch (error) {
        console.error("Lỗi khi import file:", error);
        res.render('import_data', { 
            title: 'Import Data', page: 'Import Data', message: null, 
            error: 'Có lỗi xảy ra trong quá trình xử lý. (File lỗi, thiếu cột, hoặc định dạng không hỗ trợ).' 
        });
    }
};
