const db = require('../models/db');

exports.getKpiAnalyticsPage = async (req, res) => {
    const activeUser = res.locals.currentUser || req.session.user || req.user;
    res.render('kpi_analytics', { title: 'Phân Tích KPI', page: 'KPI Analytics', currentUser: activeUser });
};

exports.getKpiData = async (req, res) => {
    const network = req.query.network || '4g';
    const cellName = req.query.cellName ? req.query.cellName.trim() : '';
    
    let tableName = `kpi_${network}`;
    let cellColumn = 'Cell_name'; 
    if (network === '3g') cellColumn = 'Ten_CELL';
    if (network === '5g') cellColumn = 'Ten_CELL';

    try {
        let query = `SELECT * FROM ${tableName}`;
        let params = [];
        if (cellName) { query += ` WHERE ${cellColumn} LIKE ?`; params.push(`%${cellName}%`); }
        const [rows] = await db.query(query, params);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: "Lỗi truy xuất CSDL." }); }
};

exports.resetData = async (req, res) => {
    const network = req.params.network;
    try {
        await db.query(`TRUNCATE TABLE kpi_${network}`);
        res.redirect('/import-data');
    } catch (error) { res.status(500).send("Lỗi xóa dữ liệu."); }
};

// ==========================================
// CÁC HÀM XỬ LÝ CHO POI REPORT
// ==========================================

exports.getPoiReportPage = async (req, res) => {
    const activeUser = res.locals.currentUser || req.session.user || req.user;
    res.render('poi_report', { title: 'POI Report', page: 'POI Report', currentUser: activeUser });
};

// Lấy danh sách toàn bộ POI duy nhất từ DB
exports.getPoiList = async (req, res) => {
    try {
        const [poi4g] = await db.query('SELECT DISTINCT POI FROM poi_4g WHERE POI IS NOT NULL AND POI != ""');
        const [poi5g] = await db.query('SELECT DISTINCT POI FROM poi_5g WHERE POI IS NOT NULL AND POI != ""');
        
        // Gộp danh sách và loại bỏ trùng lặp
        const poiSet = new Set();
        poi4g.forEach(r => poiSet.add(r.POI));
        poi5g.forEach(r => poiSet.add(r.POI));
        
        res.json(Array.from(poiSet).sort());
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Lỗi lấy danh sách POI" });
    }
};

// Truy xuất KPI theo POI (Tổng Traffic, Trung bình Throughput của nhiều Cell)
exports.getPoiData = async (req, res) => {
    const poiName = req.query.poi;
    if (!poiName) return res.json({ has4g: false, has5g: false, data: [] });

    try {
        // 1. Tìm tất cả các Cell thuộc POI này
        const [cells4g] = await db.query('SELECT Cell_Code FROM poi_4g WHERE POI = ?', [poiName]);
        const [cells5g] = await db.query('SELECT Cell_Code FROM poi_5g WHERE POI = ?', [poiName]);

        const codes4g = cells4g.map(c => c.Cell_Code);
        const codes5g = cells5g.map(c => c.Cell_Code);

        let data4g = [], data5g = [];

        // 2. Tính Tổng và Trung bình trực tiếp trên DB cho 4G
        if (codes4g.length > 0) {
            const placeholders = codes4g.map(() => '?').join(',');
            const [rows] = await db.query(`
                SELECT Thoi_gian, 
                       SUM(Total_Data_Traffic_Volume_GB) as traffic, 
                       AVG(User_DL_Avg_Throughput_Kbps) as throughput
                FROM kpi_4g 
                WHERE Cell_name IN (${placeholders})
                GROUP BY Thoi_gian
            `, codes4g);
            data4g = rows;
        }

        // 3. Tính Tổng và Trung bình trực tiếp trên DB cho 5G
        if (codes5g.length > 0) {
            const placeholders = codes5g.map(() => '?').join(',');
            const [rows] = await db.query(`
                SELECT Thoi_gian, 
                       SUM(Total_Data_Traffic_Volume_GB) as traffic, 
                       AVG(A_User_DL_Avg_Throughput) as throughput
                FROM kpi_5g 
                WHERE Ten_CELL IN (${placeholders})
                GROUP BY Thoi_gian
            `, codes5g);
            data5g = rows;
        }

        // 4. Gộp dữ liệu 4G và 5G chung vào một khung thời gian
        const map = {};
        data4g.forEach(r => {
            map[r.Thoi_gian] = { Thoi_gian: r.Thoi_gian, traffic_4g: r.traffic, thput_4g: r.throughput, traffic_5g: null, thput_5g: null };
        });
        
        data5g.forEach(r => {
            if (!map[r.Thoi_gian]) {
                map[r.Thoi_gian] = { Thoi_gian: r.Thoi_gian, traffic_4g: null, thput_4g: null };
            }
            map[r.Thoi_gian].traffic_5g = r.traffic;
            map[r.Thoi_gian].thput_5g = r.throughput;
        });

        res.json({
            has4g: codes4g.length > 0,
            has5g: codes5g.length > 0,
            data: Object.values(map)
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Lỗi xử lý dữ liệu POI" });
    }
};
