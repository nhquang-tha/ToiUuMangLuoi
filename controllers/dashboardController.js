const db = require('../models/db');
const xlsx = require('xlsx');

exports.renderPage = (pageName) => {
    return async (req, res) => {
        try {
            res.render('dashboard', { title: pageName, page: pageName });
        } catch (error) {
            console.error(error);
            res.status(500).send('Lỗi máy chủ khi tải trang');
        }
    };
};

// Hiển thị trang Import
exports.getImportPage = (req, res) => {
    res.render('import_data', { 
        title: 'Import Data', 
        page: 'Import Data',
        message: null,
        error: null
    });
};

// Xử lý Upload và Import
exports.handleImportData = async (req, res) => {
    try {
        if (!req.file) {
            return res.render('import_data', { title: 'Import Data', page: 'Import Data', message: null, error: 'Vui lòng chọn một file!' });
        }

        const networkType = req.body.networkType; // '3g', '4g', '5g'
        
        // Đọc file từ buffer
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        if (data.length === 0) {
            return res.render('import_data', { title: 'Import Data', page: 'Import Data', message: null, error: 'File rỗng hoặc không đúng định dạng!' });
        }

        let sql = '';
        let values = [];

        // Map dữ liệu tùy theo loại mạng
        if (networkType === '3g') {
            sql = `INSERT INTO rf_3g (CSHT_code, CELL_NAME, Cell_code, Site_code, Latitude, Longitude, Equipment, Frenquency, PSC, DL_UARFCN, BSC_LAC, CI, Anten_height, Azimuth, M_T, E_T, Total_tilt, Hang_SX, Antena, Swap, Start_day, Ghi_chu) VALUES ?`;
            values = data.map(row => [
                row['CSHT_code'], row['CELL_NAME'], row['Cell_code'], row['Site_code'], row['Latitude'], row['Longitude'], row['Equipment'], row['Frenquency'], row['PSC'], row['DL_UARFCN'], row['BSC_LAC'], row['CI'], row['Anten_height'], row['Azimuth'], row['M_T'], row['E_T'], row['Total_tilt'], row['Hãng_SX'], row['Antena'], row['Swap'], row['Start_day'], row['Ghi_chú']
            ]);
        } else if (networkType === '4g') {
            sql = `INSERT INTO rf_4g (CSHT_code, CELL_NAME, Cell_code, Site_code, Latitude, Longitude, Equipment, Frenquency, DL_UARFCN, PCI, TAC, ENodeBID, Lcrid, Anten_height, Azimuth, M_T, E_T, Total_tilt, MIMO, Hang_SX, Antena, Swap, Start_day, Ghi_chu) VALUES ?`;
            values = data.map(row => [
                row['CSHT_code'], row['CELL_NAME'], row['Cell_code'], row['Site_code'], row['Latitude'], row['Longitude'], row['Equipment'], row['Frenquency'], row['DL_UARFCN'], row['PCI'], row['TAC'], row['ENodeBID'], row['Lcrid'], row['Anten_height'], row['Azimuth'], row['M_T'], row['E_T'], row['Total_tilt'], row['MIMO'], row['Hãng_SX'], row['Antena'], row['Swap'], row['Start_day'], row['Ghi_chú']
            ]);
        } else if (networkType === '5g') {
            sql = `INSERT INTO rf_5g (CSHT_code, SITE_NAME, Cell_code, Site_code, Latitude, Longitude, Equipment, Frenquency, nrarfcn, PCI, TAC, gNodeB_ID, Lcrid, Anten_height, Azimuth, M_T, E_T, Total_tilt, MIMO, Hang_SX, Antena, Dong_bo, Start_day, Ghi_chu) VALUES ?`;
            values = data.map(row => [
                row['CSHT_code'], row['SITE_NAME'], row['Cell_code'], row['Site_code'], row['Latitude'], row['Longitude'], row['Equipment'], row['Frenquency'], row['nrarfcn'], row['PCI'], row['TAC'], row['gNodeB ID'], row['Lcrid'], row['Anten_height'], row['Azimuth'], row['M_T'], row['E_T'], row['Total_tilt'], row['MIMO'], row['Hãng_SX'], row['Antena'], row['Đồng_bộ'], row['Start_day'], row['Ghi_chú']
            ]);
        }

        // Thực thi Bulk Insert vào TiDB
        await db.query(sql, [values]);

        res.render('import_data', { 
            title: 'Import Data', 
            page: 'Import Data', 
            message: `Import thành công ${values.length} dòng vào cơ sở dữ liệu ${networkType.toUpperCase()}!`, 
            error: null 
        });

    } catch (error) {
        console.error("Lỗi khi import file:", error);
        res.render('import_data', { 
            title: 'Import Data', 
            page: 'Import Data', 
            message: null, 
            error: 'Có lỗi xảy ra khi xử lý file. Vui lòng kiểm tra lại cấu trúc cột của file Excel/CSV.' 
        });
    }
};
