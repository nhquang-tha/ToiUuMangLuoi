const db = require('../models/db');

exports.getMapPage = async (req, res) => {
    const activeUser = res.locals.currentUser || req.session.user || req.user;
    res.render('gis_map', { title: 'Bản Đồ GIS', page: 'GIS Map', currentUser: activeUser });
};

exports.getMapData = async (req, res) => {
    const network = req.query.network || '4g';
    let tableName = `rf_${network}`;
    
    try {
        const query = `
            SELECT * FROM ${tableName} 
            WHERE Latitude IS NOT NULL AND Longitude IS NOT NULL 
              AND Latitude != '' AND Longitude != ''
        `;
        const [rows, fields] = await db.query(query);
        
        const columnOrder = fields.map(f => f.name);
        
        const cleanedData = rows.map(r => {
            const lat = parseFloat(r.Latitude);
            const lng = parseFloat(r.Longitude);
            const azimuth = parseFloat(r.Azimuth) || 0;
            
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
        const [rows] = await db.query(`SELECT * FROM TA_Query LIMIT 10000`);
        res.json(rows);
    } catch (error) {
        console.error("Lỗi lấy dữ liệu TA:", error);
        res.status(500).json({ error: "Lỗi truy xuất CSDL TA." });
    }
};

// [MỚI] API lấy dữ liệu Cơ Sở Hạ Tầng (CSHT)
exports.getCshtData = async (req, res) => {
    try {
        const query = `
            SELECT * FROM csht_data 
            WHERE Latitude IS NOT NULL AND Longitude IS NOT NULL 
              AND Latitude != '' AND Longitude != ''
        `;
        const [rows, fields] = await db.query(query);
        
        const columnOrder = fields.map(f => f.name);

        const cleanedData = rows.map(r => {
            const lat = parseFloat(r.Latitude);
            const lng = parseFloat(r.Longitude);
            
            const orderedData = [];
            for (let col of columnOrder) {
                if (col !== 'id' && col !== 'created_at' && r[col] !== null && r[col] !== '') {
                    orderedData.push({ key: col, value: r[col] });
                }
            }
            
            return {
                Ma_CSHT: r.Ma_CSHT || '',
                Ten_CSHT: r.Ten_CSHT || 'Unknown',
                lat: lat,
                lng: lng,
                allData: orderedData
            };
        }).filter(r => !isNaN(r.lat) && !isNaN(r.lng));

        res.json(cleanedData);
    } catch (error) {
        console.error("Lỗi lấy dữ liệu CSHT:", error);
        res.status(500).json({ error: "Lỗi truy xuất CSDL CSHT." });
    }
};

exports.resetTAData = async (req, res) => {
    try {
        await db.query(`TRUNCATE TABLE TA_Query`);
        res.redirect('/import-data');
    } catch (error) {
        console.error(error);
        res.status(500).send("Lỗi xóa dữ liệu TA.");
    }
};
