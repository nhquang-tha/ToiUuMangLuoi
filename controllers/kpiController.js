const db = require('../models/db');

exports.getKpiAnalyticsPage = async (req, res) => {
    const activeUser = res.locals.currentUser || req.session.user || req.user;
    res.render('kpi_analytics', { title: 'Phân Tích KPI', page: 'KPI Analytics', currentUser: activeUser });
};

// API MỚI: Xử lý siêu truy vấn cho Biểu đồ (Hỗ trợ Đa Cell, Trạm, POI)
exports.getKpiData = async (req, res) => {
    const network = req.query.network || '4g';
    const type = req.query.type || 'keyword'; // 'keyword' hoặc 'poi'
    const value = req.query.value ? req.query.value.trim() : '';

    let tableName = `kpi_${network}`;
    let cellColumn = (network === '4g') ? 'Cell_name' : 'Ten_CELL';

    try {
        let query = `SELECT * FROM ${tableName}`;
        let params = [];

        if (type === 'keyword' && value) {
            const values = value.split(',').map(s => s.trim()).filter(s => s);
            if (values.length === 1) {
                // Nhập 1 mã -> Tìm theo Trạm (Site) hoặc Cell bằng LIKE
                let siteColumn = (network === '4g') ? 'Site_name' : ((network === '5g') ? 'Ten_GNODEB' : 'Ten_RNC');
                query += ` WHERE ${cellColumn} LIKE ? OR ${siteColumn} LIKE ?`;
                params.push(`%${values[0]}%`, `%${values[0]}%`);
            } else {
                // Nhập nhiều mã cách nhau dấu phẩy -> Tìm bằng IN
                const placeholders = values.map(() => '?').join(',');
                query += ` WHERE ${cellColumn} IN (${placeholders})`;
                params.push(...values);
            }
        } else if (type === 'poi' && value) {
            // Lấy danh sách Cell từ bảng POI
            if (network === '3g') return res.json([]); // 3G không có POI
            
            const [poiCells] = await db.query(`SELECT Cell_Code FROM poi_${network} WHERE POI = ?`, [value]);
            const cellCodes = poiCells.map(c => c.Cell_Code);

            if (cellCodes.length === 0) return res.json([]);

            const placeholders = cellCodes.map(() => '?').join(',');
            query += ` WHERE ${cellColumn} IN (${placeholders})`;
            params.push(...cellCodes);
        } else {
            return res.json([]); // Trả về rỗng nếu không có dữ liệu đầu vào
        }

        const [rows] = await db.query(query, params);
        res.json(rows);

    } catch (error) {
        console.error("Lỗi lấy dữ liệu KPI Analytics:", error);
        res.status(500).json({ error: "Lỗi truy xuất CSDL." });
    }
};

exports.resetData = async (req, res) => {
    const network = req.params.network;
    try {
        await db.query(`TRUNCATE TABLE kpi_${network}`);
        res.redirect('/import-data');
    } catch (error) { res.status(500).send("Lỗi xóa dữ liệu."); }
};

// --- CÁC HÀM XỬ LÝ CHO TRANG POI REPORT ---
exports.getPoiReportPage = async (req, res) => {
    const activeUser = res.locals.currentUser || req.session.user || req.user;
    res.render('poi_report', { title: 'POI Report', page: 'POI Report', currentUser: activeUser });
};

exports.getPoiList = async (req, res) => {
    try {
        const [poi4g] = await db.query('SELECT DISTINCT POI FROM poi_4g WHERE POI IS NOT NULL AND POI != ""');
        const [poi5g] = await db.query('SELECT DISTINCT POI FROM poi_5g WHERE POI IS NOT NULL AND POI != ""');
        
        const poiSet = new Set();
        poi4g.forEach(r => poiSet.add(r.POI));
        poi5g.forEach(r => poiSet.add(r.POI));
        res.json(Array.from(poiSet).sort());
    } catch (error) { res.status(500).json({ error: "Lỗi lấy danh sách POI" }); }
};

exports.getPoiData = async (req, res) => {
    const poiName = req.query.poi;
    if (!poiName) return res.json({ has4g: false, has5g: false, data: [] });

    try {
        const [cells4g] = await db.query('SELECT Cell_Code FROM poi_4g WHERE POI = ?', [poiName]);
        const [cells5g] = await db.query('SELECT Cell_Code FROM poi_5g WHERE POI = ?', [poiName]);

        const codes4g = cells4g.map(c => c.Cell_Code);
        const codes5g = cells5g.map(c => c.Cell_Code);

        let data4g = [], data5g = [];

        if (codes4g.length > 0) {
            const placeholders = codes4g.map(() => '?').join(',');
            const [rows] = await db.query(`SELECT Thoi_gian, SUM(Total_Data_Traffic_Volume_GB) as traffic, AVG(User_DL_Avg_Throughput_Kbps) as throughput FROM kpi_4g WHERE Cell_name IN (${placeholders}) GROUP BY Thoi_gian`, codes4g);
            data4g = rows;
        }

        if (codes5g.length > 0) {
            const placeholders = codes5g.map(() => '?').join(',');
            const [rows] = await db.query(`SELECT Thoi_gian, SUM(Total_Data_Traffic_Volume_GB) as traffic, AVG(A_User_DL_Avg_Throughput) as throughput FROM kpi_5g WHERE Ten_CELL IN (${placeholders}) GROUP BY Thoi_gian`, codes5g);
            data5g = rows;
        }

        const map = {};
        data4g.forEach(r => { map[r.Thoi_gian] = { Thoi_gian: r.Thoi_gian, traffic_4g: r.traffic, thput_4g: r.throughput, traffic_5g: null, thput_5g: null }; });
        data5g.forEach(r => {
            if (!map[r.Thoi_gian]) map[r.Thoi_gian] = { Thoi_gian: r.Thoi_gian, traffic_4g: null, thput_4g: null };
            map[r.Thoi_gian].traffic_5g = r.traffic; map[r.Thoi_gian].thput_5g = r.throughput;
        });

        res.json({ has4g: codes4g.length > 0, has5g: codes5g.length > 0, data: Object.values(map) });
    } catch (error) { res.status(500).json({ error: "Lỗi xử lý dữ liệu POI" }); }
};

// ==========================================
// CÁC HÀM XỬ LÝ CHO WORST CELLS (MẠNG 4G)
// ==========================================

exports.getWorstCellsPage = async (req, res) => {
    const activeUser = res.locals.currentUser || req.session.user || req.user;
    res.render('worst_cells', { title: 'Worst Cells 4G', page: 'Worst Cells', currentUser: activeUser });
};

exports.getWorstCellsData = async (req, res) => {
    const days = parseInt(req.query.days) || 1;

    try {
        // 1. Quét tìm danh sách các Ngày có trong DB và sắp xếp Mới nhất -> Cũ nhất
        const [dateRows] = await db.query('SELECT DISTINCT Thoi_gian FROM kpi_4g WHERE Thoi_gian IS NOT NULL');
        if (dateRows.length === 0) return res.json([]);

        const parseDate = (d) => {
            const p = d.split('/');
            return p.length === 3 ? new Date(`${p[2]}-${p[1]}-${p[0]}`).getTime() : 0;
        };

        const validDates = dateRows.map(r => r.Thoi_gian).sort((a, b) => parseDate(b) - parseDate(a));
        
        // Cắt lấy N ngày mới nhất theo lựa chọn
        const targetDates = validDates.slice(0, days);
        if (targetDates.length === 0) return res.json([]);

        // 2. Chỉ query dữ liệu của N ngày này để tối ưu RAM
        const placeholders = targetDates.map(() => '?').join(',');
        const query = `
            SELECT Cell_name, Thoi_gian, 
                   User_DL_Avg_Throughput_Kbps, RB_Util_Rate_DL, CQI_4G, Service_Drop_all 
            FROM kpi_4g 
            WHERE Thoi_gian IN (${placeholders})
        `;
        const [data] = await db.query(query, targetDates);

        // 3. Gom nhóm dữ liệu theo từng Cell
        const cellMap = {};
        data.forEach(row => {
            if (!cellMap[row.Cell_name]) cellMap[row.Cell_name] = [];
            cellMap[row.Cell_name].push(row);
        });

        // 4. Thuật toán Lọc Worst Cell
        const worstCells = [];
        for (const cell in cellMap) {
            const records = cellMap[cell];
            
            // Nếu Cell không xuất hiện đủ N ngày -> Loại bỏ
            if (records.length !== days) continue;

            let isWorstAllDays = true;
            for (const row of records) {
                // Hỗ trợ cả 2 định dạng chữ K hoa và thường để chống lỗi
                let rawThput = row.User_DL_Avg_Throughput_Kbps !== undefined ? row.User_DL_Avg_Throughput_Kbps : row.User_DL_Avg_Throughput_kbps;
                
                const thput = parseFloat(rawThput);
                const prb = parseFloat(row.RB_Util_Rate_DL);
                const cqi = parseFloat(row.CQI_4G);
                const drop = parseFloat(row.Service_Drop_all);

                // KIỂM TRA 4 ĐIỀU KIỆN KÉM CHẤT LƯỢNG
                const cond1 = !isNaN(thput) && thput < 7000;
                const cond2 = !isNaN(prb) && prb > 20;
                const cond3 = !isNaN(cqi) && cqi < 93;
                const cond4 = !isNaN(drop) && drop > 0.3;

                // Nếu có 1 ngày KHÔNG dính bất kỳ lỗi nào -> Không tính là Worst Cell liên tiếp
                if (!(cond1 || cond2 || cond3 || cond4)) {
                    isWorstAllDays = false;
                    break; 
                }
            }

            // Nếu thỏa mãn liên tục N ngày, thêm vào danh sách
            if (isWorstAllDays) {
                // Lấy bản ghi của ngày mới nhất để hiển thị số liệu lên bảng
                const latestRecord = records.sort((a, b) => parseDate(b.Thoi_gian) - parseDate(a.Thoi_gian))[0];
                let rawThput = latestRecord.User_DL_Avg_Throughput_Kbps !== undefined ? latestRecord.User_DL_Avg_Throughput_Kbps : latestRecord.User_DL_Avg_Throughput_kbps;
                
                const thput = parseFloat(rawThput);
                const prb = parseFloat(latestRecord.RB_Util_Rate_DL);
                const cqi = parseFloat(latestRecord.CQI_4G);
                const drop = parseFloat(latestRecord.Service_Drop_all);

                let reasons = [];
                if (!isNaN(thput) && thput < 7000) reasons.push(`Thput thấp (${thput.toFixed(2)})`);
                if (!isNaN(prb) && prb > 20) reasons.push(`PRB cao (${prb.toFixed(2)}%)`);
                if (!isNaN(cqi) && cqi < 93) reasons.push(`CQI thấp (${cqi.toFixed(2)}%)`);
                if (!isNaN(drop) && drop > 0.3) reasons.push(`Drop cao (${drop.toFixed(2)}%)`);

                worstCells.push({
                    Cell_name: cell,
                    Latest_Date: latestRecord.Thoi_gian,
                    User_DL_Avg_Throughput_Kbps: isNaN(thput) ? '-' : thput.toFixed(2),
                    RB_Util_Rate_DL: isNaN(prb) ? '-' : prb.toFixed(2),
                    CQI_4G: isNaN(cqi) ? '-' : cqi.toFixed(2),
                    Service_Drop_all: isNaN(drop) ? '-' : drop.toFixed(3),
                    Violations: reasons.join(' | ')
                });
            }
        }

        res.json(worstCells);

    } catch (error) {
        console.error("Lỗi lấy Worst Cells:", error);
        res.status(500).json({ error: "Lỗi xử lý DB" });
    }
};
