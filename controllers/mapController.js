const db = require('../models/db');

exports.getMapPage = (req, res) => {
    res.render('gis_map', { title: 'Bản Đồ GIS', page: 'GIS Map' });
};

exports.getMapData = async (req, res) => {
    try {
        // Sử dụng SELECT * để lấy sạch mọi thông tin RF theo chuẩn cấu trúc bảng
        const q3g = `SELECT '3G' as network, * FROM rf_3g WHERE Latitude IS NOT NULL AND Longitude IS NOT NULL`;
        const q4g = `SELECT '4G' as network, * FROM rf_4g WHERE Latitude IS NOT NULL AND Longitude IS NOT NULL`;
        const q5g = `SELECT '5G' as network, * FROM rf_5g WHERE Latitude IS NOT NULL AND Longitude IS NOT NULL`;

        const [rows3g] = await db.query(q3g);
        const [rows4g] = await db.query(q4g);
        const [rows5g] = await db.query(q5g);

        // Nối mảng trả về cho Frontend vẽ
        const allData = [...rows3g, ...rows4g, ...rows5g];
        res.json(allData);

    } catch (error) {
        console.error("Lỗi lấy dữ liệu MAP:", error);
        res.status(500).json({ error: 'Lỗi máy chủ' });
    }
};
