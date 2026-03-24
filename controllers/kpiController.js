const db = require('../models/db');

// Hiển thị giao diện trang KPI Analytics
exports.getKpiAnalyticsPage = (req, res) => {
    // Trích xuất role của user đang đăng nhập (để ẩn/hiện nút Reset)
    const userRole = req.session && req.session.user ? req.session.user.role : 'user';
    res.render('kpi_analytics', { title: 'KPI Analytics', page: 'KPI Analytics', userRole: userRole });
};

// API trả về dữ liệu dạng JSON cho biểu đồ
exports.getKpiData = async (req, res) => {
    const { network, cellName } = req.query;
    if (!network || !cellName) {
        return res.status(400).json({ error: 'Vui lòng nhập đầy đủ thông tin!' });
    }

    try {
        let tableName = '';
        let cellColumn = 'Ten_CELL'; // Tên cột mặc định cho 3G và 5G
        
        if (network === '3g') { 
            tableName = 'kpi_3g'; 
        } else if (network === '4g') { 
            tableName = 'kpi_4g'; 
            cellColumn = 'Cell_name'; // 4G dùng cột Cell_name
        } else if (network === '5g') { 
            tableName = 'kpi_5g'; 
        } else { 
            return res.status(400).json({ error: 'Loại mạng không hợp lệ' }); 
        }

        // Lấy tất cả dữ liệu của Cell đó
        const [rows] = await db.query(`SELECT * FROM ${tableName} WHERE ${cellColumn} = ?`, [cellName]);
        
        res.json(rows);
    } catch (error) {
        console.error("Lỗi khi lấy dữ liệu KPI:", error);
        res.status(500).json({ error: 'Lỗi server khi tải dữ liệu KPI' });
    }
};

// Chức năng Reset toàn bộ Database KPI (Dành riêng cho Admin)
exports.resetData = async (req, res) => {
    const { network } = req.params;
    const tableName = `kpi_${network}`;
    try {
        // Lệnh TRUNCATE xóa sạch dữ liệu và đưa ID về lại 1
        await db.query(`TRUNCATE TABLE ${tableName}`);
        // Trả về một script hiện thông báo Alert và điều hướng lại trang KPI
        res.send(`<script>alert('Đã xóa sạch toàn bộ dữ liệu bảng ${tableName.toUpperCase()} thành công! Bạn có thể tiến hành Import lại từ đầu.'); window.location.href='/kpi-analytics';</script>`);
    } catch (error) {
        console.error(error);
        res.status(500).send("Lỗi reset dữ liệu KPI. Vui lòng thử lại sau.");
    }
};
