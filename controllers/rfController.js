const db = require('../models/db');

// Khai báo cấu trúc các cột tương ứng với Database để tự động sinh Form
const rfSchema = {
    '3g': ['CSHT_code', 'CELL_NAME', 'Cell_code', 'Site_code', 'Latitude', 'Longitude', 'Equipment', 'Frenquency', 'PSC', 'DL_UARFCN', 'BSC_LAC', 'CI', 'Anten_height', 'Azimuth', 'M_T', 'E_T', 'Total_tilt', 'Hang_SX', 'Antena', 'Swap', 'Start_day', 'Ghi_chu'],
    '4g': ['CSHT_code', 'CELL_NAME', 'Cell_code', 'Site_code', 'Latitude', 'Longitude', 'Equipment', 'Frenquency', 'DL_UARFCN', 'PCI', 'TAC', 'ENodeBID', 'Lcrid', 'Anten_height', 'Azimuth', 'M_T', 'E_T', 'Total_tilt', 'MIMO', 'Hang_SX', 'Antena', 'Swap', 'Start_day', 'Ghi_chu'],
    '5g': ['CSHT_code', 'SITE_NAME', 'Cell_code', 'Site_code', 'Latitude', 'Longitude', 'Equipment', 'Frenquency', 'nrarfcn', 'PCI', 'TAC', 'gNodeB_ID', 'Lcrid', 'Anten_height', 'Azimuth', 'M_T', 'E_T', 'Total_tilt', 'MIMO', 'Hang_SX', 'Antena', 'Dong_bo', 'Start_day', 'Ghi_chu']
};

// 1. Hiển thị danh sách dữ liệu
exports.getList = async (req, res) => {
    const network = req.query.network || '3g'; 
    const tableName = `rf_${network}`;
    
    try {
        const [rows] = await db.query(`SELECT * FROM ${tableName} ORDER BY id DESC LIMIT 100`);
        res.render('rf_database', {
            title: 'RF Database', page: 'RF Database', network: network, data: rows
        });
    } catch (error) {
        console.error(error); res.status(500).send("Lỗi tải dữ liệu");
    }
};

// 2. Hiển thị Form
exports.getForm = async (req, res) => {
    const { network, action, id } = req.params;
    const tableName = `rf_${network}`;
    const columns = rfSchema[network];
    let recordData = {}; 
    
    try {
        if (action === 'edit' || action === 'detail') {
            const [rows] = await db.query(`SELECT * FROM ${tableName} WHERE id = ?`, [id]);
            if (rows.length > 0) recordData = rows[0];
        }
        let titleMap = { 'add': 'Thêm Mới RF', 'edit': 'Sửa RF', 'detail': 'Chi Tiết RF' };
        res.render('rf_form', {
            title: titleMap[action] + ` (${network.toUpperCase()})`, page: 'RF Database',
            network: network, action: action, id: id, columns: columns, data: recordData
        });
    } catch (error) {
        console.error(error); res.status(500).send("Lỗi tải form");
    }
};

// 3. Xử lý lưu dữ liệu
exports.saveData = async (req, res) => {
    const { network, action, id } = req.params;
    const tableName = `rf_${network}`;
    const data = req.body; 
    
    try {
        if (action === 'add') { await db.query(`INSERT INTO ${tableName} SET ?`, data); } 
        else if (action === 'edit') { await db.query(`UPDATE ${tableName} SET ? WHERE id = ?`, [data, id]); }
        res.redirect(`/rf-database?network=${network}`);
    } catch (error) {
        console.error(error); res.status(500).send("Lỗi lưu dữ liệu");
    }
};

// 4. Xử lý Xóa dữ liệu 1 dòng
exports.deleteData = async (req, res) => {
    const { network, id } = req.params;
    const tableName = `rf_${network}`;
    try {
        await db.query(`DELETE FROM ${tableName} WHERE id = ?`, [id]);
        res.redirect(`/rf-database?network=${network}`);
    } catch (error) {
        console.error(error); res.status(500).send("Lỗi xóa dữ liệu");
    }
};

// 5. Chức năng Reset toàn bộ Database (Dành riêng cho Admin)
exports.resetData = async (req, res) => {
    const { network } = req.params;
    const tableName = `rf_${network}`;
    try {
        // Lệnh TRUNCATE xóa sạch dữ liệu và đưa ID về lại 1, nhanh hơn DELETE
        await db.query(`TRUNCATE TABLE ${tableName}`);
        res.redirect(`/rf-database?network=${network}`);
    } catch (error) {
        console.error(error);
        res.status(500).send("Lỗi reset dữ liệu. Vui lòng thử lại sau.");
    }
};
