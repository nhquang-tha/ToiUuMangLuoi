const db = require('../models/db');

// Render trang giao diện KPI Analytics
exports.getKpiAnalyticsPage = async (req, res) => {
    // Thuật toán lấy user an toàn
    const activeUser = res.locals.currentUser || req.session.user || req.user;
    
    res.render('kpi_analytics', {
        title: 'Phân Tích KPI',
        page: 'KPI Analytics',
        currentUser: activeUser
    });
};

// API trả về dữ liệu KPI dưới dạng JSON cho biểu đồ Chart.js
exports.getKpiData = async (req, res) => {
    const network = req.query.network || '4g';
    const cellName = req.query.cellName ? req.query.cellName.trim() : '';
    
    let tableName = `kpi_${network}`;
    let cellColumn = 'Cell_name'; // Mặc định cho 4G
    
    if (network === '3g') cellColumn = 'Ten_CELL';
    if (network === '5g') cellColumn = 'Ten_CELL';

    try {
        let query = `SELECT * FROM ${tableName}`;
        let params = [];

        // Nếu người dùng có nhập tên Cell để tìm kiếm
        if (cellName) {
            query += ` WHERE ${cellColumn} LIKE ?`;
            params.push(`%${cellName}%`);
        }

        const [rows] = await db.query(query, params);
        res.json(rows);
    } catch (error) {
        console.error("Lỗi khi lấy dữ liệu KPI Analytics:", error);
        res.status(500).json({ error: "Lỗi truy xuất cơ sở dữ liệu." });
    }
};

// Hàm Reset toàn bộ dữ liệu KPI của 1 mạng (Dành cho Admin)
exports.resetData = async (req, res) => {
    const network = req.params.network;
    try {
        await db.query(`TRUNCATE TABLE kpi_${network}`);
        res.redirect('/import-data');
    } catch (error) {
        console.error("Lỗi khi reset KPI:", error);
        res.status(500).send("Lỗi hệ thống khi xóa dữ liệu.");
    }
};
