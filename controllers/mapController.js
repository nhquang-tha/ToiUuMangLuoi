const db = require('../models/db');

exports.getMapPage = async (req, res) => {
    const activeUser = res.locals.currentUser || req.session.user || req.user;
    res.render('gis_map', { title: 'Bản Đồ GIS', page: 'GIS Map', currentUser: activeUser });
};

exports.getMapData = async (req, res) => {
    const network = req.query.network || '4g';
    let tableName = `rf_${network}`;
    
    try {
        // Lấy TOÀN BỘ dữ liệu của trạm thay vì chỉ lấy tọa độ
        const query = `
            SELECT * FROM ${tableName} 
            WHERE Latitude IS NOT NULL AND Longitude IS NOT NULL 
              AND Latitude != '' AND Longitude != ''
        `;
        const [rows] = await db.query(query);
        
        // Chuẩn hóa dữ liệu trả về cho Frontend vẽ bản đồ
        const cleanedData = rows.map(r => {
            const lat = parseFloat(r.Latitude);
            const lng = parseFloat(r.Longitude);
            const azimuth = parseFloat(r.Azimuth) || 0;
            
            return {
                cell: r.Cell_code || r.CELL_NAME || r.SITE_NAME || 'Unknown',
                site: r.Site_code || r.SITE_NAME || '',
                lat: lat,
                lng: lng,
                azimuth: azimuth,
                rfData: r // Gói toàn bộ dữ liệu RF Database vào Object này
            };
        }).filter(r => !isNaN(r.lat) && !isNaN(r.lng));

        res.json(cleanedData);
    } catch (error) {
        console.error("Lỗi lấy dữ liệu GIS:", error);
        res.status(500).json({ error: "Lỗi truy xuất CSDL." });
    }
};

exports.getTAData = async (req, res) => {
    try {
        const [rows] = await db.query(`SELECT * FROM TA_Query LIMIT 1000`);
        res.json(rows);
    } catch (error) {
        console.error("Lỗi lấy dữ liệu TA:", error);
        res.status(500).json({ error: "Lỗi truy xuất CSDL TA." });
    }
};
