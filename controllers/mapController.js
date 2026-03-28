const db = require('../models/db');

exports.getMapPage = (req, res) => {
    res.render('gis_map', { title: 'Bản Đồ GIS', page: 'GIS Map' });
};

// API Lấy dữ liệu Cell RF gốc
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

// API Lấy dữ liệu TA_Query join với RF_4G
exports.getTAData = async (req, res) => {
    try {
        const q = `
            SELECT t.*, r.Latitude, r.Longitude, r.Azimuth, r.CELL_NAME, r.Site_code 
            FROM TA_Query t 
            JOIN rf_4g r ON t.Cell_Code = r.Cell_code 
            WHERE r.Latitude IS NOT NULL AND r.Longitude IS NOT NULL AND r.Latitude != '' AND r.Longitude != ''
        `;
        const [rows] = await db.query(q);
        res.json(rows);
    } catch (error) {
        console.error("Lỗi lấy dữ liệu TA:", error);
        res.status(500).json({ error: 'Lỗi máy chủ lấy dữ liệu TA' });
    }
};
