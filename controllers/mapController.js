const db = require('../models/db');

exports.getMapPage = async (req, res) => {
    const activeUser = res.locals.currentUser || req.session.user || req.user;
    res.render('gis_map', { title: 'Bản Đồ GIS', page: 'GIS Map', currentUser: activeUser });
};

exports.getMapData = async (req, res) => {
    const network = req.query.network || '4g';
    let tableName = `rf_${network}`;
    
    try {
        // Lấy tọa độ, góc azimuth và thông tin cơ bản để vẽ cánh quạt
        const query = `
            SELECT Cell_code, Site_code, Latitude, Longitude, Azimuth 
            FROM ${tableName} 
            WHERE Latitude IS NOT NULL AND Longitude IS NOT NULL 
              AND Latitude != '' AND Longitude != ''
        `;
        const [rows] = await db.query(query);
        
        // Chuẩn hóa kiểu dữ liệu
        const cleanedData = rows.map(r => ({
            cell: r.Cell_code || r.CELL_NAME || 'Unknown',
            site: r.Site_code || r.SITE_NAME || '',
            lat: parseFloat(r.Latitude),
            lng: parseFloat(r.Longitude),
            azimuth: parseFloat(r.Azimuth) || 0
        })).filter(r => !isNaN(r.lat) && !isNaN(r.lng));

        res.json(cleanedData);
    } catch (error) {
        console.error("Lỗi lấy dữ liệu GIS:", error);
        res.status(500).json({ error: "Lỗi truy xuất CSDL." });
    }
};

exports.getTAData = async (req, res) => {
    try {
        // Dành cho tính năng mô phỏng Timing Advance sau này
        const [rows] = await db.query(`SELECT * FROM TA_Query LIMIT 1000`);
        res.json(rows);
    } catch (error) {
        console.error("Lỗi lấy dữ liệu TA:", error);
        res.status(500).json({ error: "Lỗi truy xuất CSDL TA." });
    }
};
