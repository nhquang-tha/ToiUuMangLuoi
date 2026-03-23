const db = require('../models/db');

// Khai báo cấu trúc các cột tương ứng với Database để tự động sinh Form
const rfSchema = {
    '3g': ['CSHT_code', 'CELL_NAME', 'Cell_code', 'Site_code', 'Latitude', 'Longitude', 'Equipment', 'Frenquency', 'PSC', 'DL_UARFCN', 'BSC_LAC', 'CI', 'Anten_height', 'Azimuth', 'M_T', 'E_T', 'Total_tilt', 'Hang_SX', 'Antena', 'Swap', 'Start_day', 'Ghi_chu'],
    '4g': ['CSHT_code', 'CELL_NAME', 'Cell_code', 'Site_code', 'Latitude', 'Longitude', 'Equipment', 'Frenquency', 'DL_UARFCN', 'PCI', 'TAC', 'ENodeBID', 'Lcrid', 'Anten_height', 'Azimuth', 'M_T', 'E_T', 'Total_tilt', 'MIMO', 'Hang_SX', 'Antena', 'Swap', 'Start_day', 'Ghi_chu'],
    '5g': ['CSHT_code', 'SITE_NAME', 'Cell_code', 'Site_code', 'Latitude', 'Longitude', 'Equipment', 'Frenquency', 'nrarfcn', 'PCI', 'TAC', 'gNodeB_ID', 'Lcrid', 'Anten_height', 'Azimuth', 'M_T', 'E_T', 'Total_tilt', 'MIMO', 'Hang_SX', 'Antena', 'Dong_bo', 'Start_day', 'Ghi_chu']
};

// 1. Hiển thị danh sách dữ liệu
exports.getList = async (req, res) => {
    const network = req.query.network || '3g'; // Mặc định là 3G
    const tableName = `rf_${network}`;
    
    try {
        // Lấy 100 bản ghi mới nhất để tránh lag trình duyệt
        const [rows] = await db.query(`SELECT * FROM ${tableName} ORDER BY id DESC LIMIT 100`);
        
        res.render('rf_database', {
            title: 'RF Database',
            page: 'RF Database',
            network: network,
            data: rows
        });
    } catch (error) {
        console.error(error);
        res.status(500).send("Lỗi tải dữ liệu");
    }
};

// 2. Hiển thị Form (Chi tiết / Thêm mới / Cập nhật)
exports.getForm = async (req, res) => {
    const { network, action, id } = req.params;
    const tableName = `rf_${network}`;
    const columns = rfSchema[network];
    
    let recordData = {}; // Data rỗng nếu là Add
    
    try {
        if (action === 'edit' || action === 'detail') {
            const [rows] = await db.query(`SELECT * FROM ${tableName} WHERE id = ?`, [id]);
            if (rows.length > 0) recordData = rows[0];
        }
        
        let titleMap = { 'add': 'Thêm Mới RF', 'edit': 'Sửa RF', 'detail': 'Chi Tiết RF' };

        res.render('rf_form', {
            title: titleMap[action] + ` (${network.toUpperCase()})`,
            page: 'RF Database',
            network: network,
            action: action, // 'add', 'edit', 'detail'
            id: id,
            columns: columns,
            data: recordData
        });
    } catch (error) {
        console.error(error);
        res.status(500).send("Lỗi tải form");
    }
};

// 3. Xử lý lưu dữ liệu (Thêm hoặc Sửa)
exports.saveData = async (req, res) => {
    const { network, action, id } = req.params;
    const tableName = `rf_${network}`;
    const data = req.body; // Dữ liệu từ form
    
    try {
        if (action === 'add') {
            await db.query(`INSERT INTO ${tableName} SET ?`, data);
        } else if (action === 'edit') {
            await db.query(`UPDATE ${tableName} SET ? WHERE id = ?`, [data, id]);
        }
        res.redirect(`/rf-database?network=${network}`);
    } catch (error) {
        console.error(error);
        res.status(500).send("Lỗi lưu dữ liệu");
    }
};

// 4. Xử lý Xóa dữ liệu
exports.deleteData = async (req, res) => {
    const { network, id } = req.params;
    const tableName = `rf_${network}`;
    try {
        await db.query(`DELETE FROM ${tableName} WHERE id = ?`, [id]);
        res.redirect(`/rf-database?network=${network}`);
    } catch (error) {
        console.error(error);
        res.status(500).send("Lỗi xóa dữ liệu");
    }
};
