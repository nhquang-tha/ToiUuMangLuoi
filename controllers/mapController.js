const db = require('../models/db');

exports.getMapPage = (req, res) => {
    res.render('gis_map', { title: 'Bản Đồ GIS', page: 'GIS Map' });
};

exports.getMapData = async (req, res) => {
    try {
        const q3g = `SELECT '3G' as network, rf_3g.* FROM rf_3g WHERE Latitude IS NOT NULL AND Longitude IS NOT NULL AND Latitude != '' AND Longitude != ''`;
        const q4g = `SELECT '4G' as network, rf_4g.* FROM rf_4g WHERE Latitude IS NOT NULL AND Longitude IS NOT NULL AND Latitude != '' AND Longitude != ''`;
        const q5g = `SELECT '5G' as network, rf_5g.* FROM rf_5g WHERE Latitude IS NOT NULL AND Longitude IS NOT NULL AND Latitude != '' AND Longitude != ''`;

        const [rows3g] = await db.query(q3g);
        const [rows4g] = await db.query(q4g);
        const [rows5g] = await db.query(q5g);

        const allData = [...rows3g, ...rows4g, ...rows5g];
        res.json(allData);

    } catch (error) {
        console.error("Lỗi lấy dữ liệu MAP:", error);
        res.status(500).json({ error: 'Lỗi máy chủ lấy dữ liệu bản đồ' });
    }
};
