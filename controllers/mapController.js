const db = require('../models/db');

exports.getMapPage = (req, res) => {
    res.render('gis_map', { title: 'Bản Đồ GIS', page: 'GIS Map' });
};

exports.getMapData = async (req, res) => {
    try {
        // Lấy tọa độ, Azimuth và các trường RF từ 3 mạng. Ép kiểu đảm bảo ko bị NULL
        const q3g = `SELECT '3G' as network, CELL_NAME as cell_name, Site_code, Latitude, Longitude, Azimuth, Anten_height, Total_tilt, Equipment FROM rf_3g WHERE Latitude IS NOT NULL AND Longitude IS NOT NULL`;
        const q4g = `SELECT '4G' as network, CELL_NAME as cell_name, Site_code, Latitude, Longitude, Azimuth, Anten_height, Total_tilt, Equipment FROM rf_4g WHERE Latitude IS NOT NULL AND Longitude IS NOT NULL`;
        const q5g = `SELECT '5G' as network, SITE_NAME as cell_name, Site_code, Latitude, Longitude, Azimuth, Anten_height, Total_tilt, Equipment FROM rf_5g WHERE Latitude IS NOT NULL AND Longitude IS NOT NULL`;

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
