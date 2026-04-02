const db = require('../models/db');

exports.getMapPage = async (req, res) => {
    const activeUser = res.locals.currentUser || req.session.user || req.user;
    res.render('gis_map', { title: 'Bản Đồ GIS', page: 'GIS Map', currentUser: activeUser });
};

exports.getMapData = async (req, res) => {
    const network = req.query.network || '4g';
    let tableName = `rf_${network}`;
    
    try {
        // Lấy TOÀN BỘ dữ liệu của trạm và lấy cả cấu trúc cột (fields) để giữ đúng thứ tự
        const query = `
            SELECT * FROM ${tableName} 
            WHERE Latitude IS NOT NULL AND Longitude IS NOT NULL 
              AND Latitude != '' AND Longitude != ''
        `;
        const [rows, fields] = await db.query(query);
        
        // Trích xuất danh sách tên cột đúng y hệt thứ tự trong Database
        const columnOrder = fields.map(f => f.name);
        
        // Chuẩn hóa dữ liệu trả về cho Frontend vẽ bản đồ
        const cleanedData = rows.map(r => {
            const lat = parseFloat(r.Latitude);
            const lng = parseFloat(r.Longitude);
            const azimuth = parseFloat(r.Azimuth) || 0;
            
            // Xây dựng mảng dữ liệu dựa trên thứ tự chuẩn của Database
            const orderedRfData = [];
            for (let col of columnOrder) {
                if (col !== 'id' && col !== 'created_at' && r[col] !== null && r[col] !== '') {
                    orderedRfData.push({ key: col, value: r[col] });
                }
            }
            
            return {
                cell: r.Cell_code || r.CELL_NAME || r.SITE_NAME || 'Unknown',
                site: r.Site_code || r.SITE_NAME || '',
                lat: lat,
                lng: lng,
                azimuth: azimuth,
                // TRÍCH XUẤT CÁC ID QUAN TRỌNG ĐỂ NỐI LOG FILE ITS VÀ TA
                lac: String(r.BSC_LAC || '').trim(),
                ci: String(r.CI || '').trim(),
                enodeb: String(r.ENodeBID || '').trim(),
                lcrid: String(r.Lcrid || '').trim(),
                rfData: orderedRfData
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
        // Lấy dữ liệu TA để vẽ lên Map
        const [rows] = await db.query(`SELECT * FROM TA_Query LIMIT 10000`);
        res.json(rows);
    } catch (error) {
        console.error("Lỗi lấy dữ liệu TA:", error);
        res.status(500).json({ error: "Lỗi truy xuất CSDL TA." });
    }
};

// Hàm Reset toàn bộ dữ liệu TA_Query
exports.resetTAData = async (req, res) => {
    try {
        await db.query(`TRUNCATE TABLE TA_Query`);
        res.redirect('/import-data');
    } catch (error) {
        console.error(error);
        res.status(500).send("Lỗi xóa dữ liệu TA.");
    }
};
