const db = require('../models/db');

exports.getKpiAnalyticsPage = (req, res) => {
    const activeUser = res.locals.currentUser || req.session.user || req.user;
    res.render('kpi_analytics', { title: 'KPI Analytics', page: 'KPI Analytics', currentUser: activeUser });
};

exports.getQoeQosAnalyticsPage = (req, res) => {
    const activeUser = res.locals.currentUser || req.session.user || req.user;
    res.render('qoe_qos_analytics', { title: 'QoE/QoS Analytics', page: 'QoE/QoS Analytics', currentUser: activeUser });
};

// HÀM BỔ TRỢ LÀM SẠCH TỪ KHÓA (TỰ ĐỘNG GỌT BỎ TIỀN TỐ/HẬU TỐ)
const cleanKeyword = (str) => {
    if (!str) return '';
    return String(str).toUpperCase()
                      .replace(/^(3G|4G|5G)[-\s_]?/i, '') // Xóa 3G-, 4G-, 5G-
                      .replace(/-(THA|TH)$/i, '')         // Xóa đuôi -THA
                      .trim();
};

exports.getKpiData = async (req, res) => {
    const network = req.query.network || '4g';
    const type = req.query.type || 'keyword';
    const value = req.query.value ? req.query.value.trim() : '';
    
    if (!value) return res.json([]);

    try {
        let query = `SELECT * FROM kpi_${network}`;
        let params = [];

        if (type === 'keyword') {
            const rawValues = value.split(',').map(s => s.trim()).filter(s => s);
            let conditions = [];
            
            // SỬ DỤNG 'LIKE' VÀ TỪ KHÓA LÕI ĐỂ TÌM KIẾM MỞ RỘNG
            rawValues.forEach(v => {
                const cleanV = cleanKeyword(v); // Gọt râu ria lấy tên lõi Trạm

                if (network === '4g') {
                    conditions.push(`(Cell_name LIKE ? OR Site_name LIKE ?)`);
                    params.push(`%${cleanV}%`, `%${cleanV}%`);
                } else if (network === '3g') {
                    conditions.push(`(Ten_CELL LIKE ? OR Ma_VNP LIKE ? OR Ten_RNC LIKE ?)`);
                    params.push(`%${cleanV}%`, `%${cleanV}%`, `%${cleanV}%`);
                } else { // 5G
                    conditions.push(`(Ten_CELL LIKE ?)`);
                    params.push(`%${cleanV}%`);
                }
            });

            query += ` WHERE ` + conditions.join(' OR ');
            
        } else if (type === 'poi') {
            let poiCellCol = network === '4g' ? 'Cell_name' : 'Ten_CELL';
            query += ` JOIN poi_${network} ON kpi_${network}.${poiCellCol} = poi_${network}.Cell_Code WHERE poi_${network}.POI = ?`;
            params = [value];
        }
        
        query += ` ORDER BY id ASC LIMIT 5000`; 
        const [rows] = await db.query(query, params);
        res.json(rows);

    } catch (error) {
        console.error("Lỗi lấy dữ liệu KPI:", error);
        res.status(500).json({ error: "Lỗi truy xuất CSDL." });
    }
};

exports.getQoeQosData = async (req, res) => {
    const value = req.query.value ? req.query.value.trim() : '';
    if (!value) return res.json({ qoe: [], qos: [] });

    try {
        const rawValues = value.split(',').map(s => s.trim()).filter(s => s);
        let conditions = [];
        let params = [];

        // ÁP DỤNG TÌM KIẾM TỪ KHÓA LÕI TƯƠNG TỰ CHO QOE/QOS
        rawValues.forEach(v => {
            const cleanV = cleanKeyword(v);
            conditions.push(`(Cell_Name LIKE ? OR Site_Name LIKE ?)`);
            params.push(`%${cleanV}%`, `%${cleanV}%`);
        });

        const queryStr = ` WHERE ` + conditions.join(' OR ') + ` ORDER BY id ASC LIMIT 5000`;

        const [qoeRows] = await db.query(`SELECT * FROM mbb_qoe` + queryStr, params);
        const [qosRows] = await db.query(`SELECT * FROM mbb_qos` + queryStr, params);

        res.json({
            qoe: qoeRows,
            qos: qosRows
        });
    } catch (error) {
        console.error("Lỗi lấy dữ liệu QoE/QoS:", error);
        res.status(500).json({ error: "Lỗi truy xuất CSDL QoE/QoS." });
    }
};

exports.resetData = async (req, res) => {
    let userRole = req.session && req.session.user ? req.session.user.role : 'user';
    if (userRole !== 'admin') return res.status(403).send("Chỉ Admin mới có quyền thực hiện chức năng này.");
    
    const network = req.params.network;
    try {
        await db.query(`TRUNCATE TABLE kpi_${network}`);
        res.redirect('/import-data');
    } catch (error) {
        console.error("Lỗi xóa dữ liệu:", error);
        res.status(500).send("Lỗi xóa dữ liệu.");
    }
};

exports.getPoiList = async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT DISTINCT POI FROM poi_4g
            UNION
            SELECT DISTINCT POI FROM poi_5g
        `);
        const poiList = rows.map(r => r.POI).filter(Boolean);
        res.json(poiList);
    } catch (error) {
        console.error("Lỗi lấy danh sách POI:", error);
        res.json([]);
    }
};

exports.getPoiData = async (req, res) => {
    const poi = req.query.poi;
    if (!poi) return res.json({ data: [], has4g: false, has5g: false });

    try {
        const [kpi4g] = await db.query(`
            SELECT k.Thoi_gian, SUM(k.Total_Data_Traffic_Volume_GB) as traffic_4g, AVG(k.User_DL_Avg_Throughput_Kbps) as thput_4g
            FROM kpi_4g k JOIN poi_4g p ON k.Cell_name = p.Cell_Code
            WHERE p.POI = ? GROUP BY k.Thoi_gian
        `, [poi]);

        const [kpi5g] = await db.query(`
            SELECT k.Thoi_gian, SUM(k.Total_Data_Traffic_Volume_GB) as traffic_5g, AVG(k.A_User_DL_Avg_Throughput) as thput_5g
            FROM kpi_5g k JOIN poi_5g p ON k.Ten_CELL = p.Cell_Code
            WHERE p.POI = ? GROUP BY k.Thoi_gian
        `, [poi]);

        let combinedData = {};
        
        kpi4g.forEach(row => {
            combinedData[row.Thoi_gian] = { Thoi_gian: row.Thoi_gian, traffic_4g: row.traffic_4g, thput_4g: row.thput_4g };
        });

        kpi5g.forEach(row => {
            if (!combinedData[row.Thoi_gian]) {
                combinedData[row.Thoi_gian] = { Thoi_gian: row.Thoi_gian, traffic_4g: 0, thput_4g: 0 };
            }
            combinedData[row.Thoi_gian].traffic_5g = row.traffic_5g;
            combinedData[row.Thoi_gian].thput_5g = row.thput_5g;
        });

        const sortedData = Object.values(combinedData).sort((a, b) => {
            const dateA = a.Thoi_gian.split('/').reverse().join('');
            const dateB = b.Thoi_gian.split('/').reverse().join('');
            return dateA.localeCompare(dateB);
        });

        res.json({
            data: sortedData,
            has4g: kpi4g.length > 0,
            has5g: kpi5g.length > 0
        });

    } catch (error) {
        console.error("Lỗi lấy dữ liệu POI Chart:", error);
        res.status(500).json({ error: "Lỗi CSDL khi load POI Data." });
    }
};

// =====================================================================
// CHỨC NĂNG: TỐI ƯU QOE / QOS 5 BƯỚC KHÉP KÍN
// =====================================================================

exports.getOptimizingPage = async (req, res) => {
    const activeUser = res.locals.currentUser || req.session.user || req.user;
    try {
        const [qoeWeeks] = await db.query('SELECT DISTINCT Tuan FROM mbb_qoe WHERE Tuan IS NOT NULL');
        const [qosWeeks] = await db.query('SELECT DISTINCT Tuan FROM mbb_qos WHERE Tuan IS NOT NULL');
        
        let uniqueWeeks = [...new Set([...qoeWeeks.map(r => r.Tuan), ...qosWeeks.map(r => r.Tuan)])];
        uniqueWeeks.sort((a, b) => {
            let matchA = a.match(/Tuần (\d+) \((\d+)\)/);
            let matchB = b.match(/Tuần (\d+) \((\d+)\)/);
            if (matchA && matchB) {
                if (matchA[2] !== matchB[2]) return parseInt(matchB[2]) - parseInt(matchA[2]);
                return parseInt(matchB[1]) - parseInt(matchA[1]);
            }
            return 0;
        }).reverse(); 

        res.render('optimizing_qoe_qos', { 
            title: 'Tối Ưu QoE/QoS', 
            page: 'Optimizing QoE/QoS', 
            weeks: uniqueWeeks,
            currentUser: activeUser
        });
    } catch (error) {
        res.render('optimizing_qoe_qos', { title: 'Tối Ưu', page: 'Optimizing QoE/QoS', weeks: [], currentUser: activeUser });
    }
};

exports.getOptimizingData = async (req, res) => {
    const week = req.query.week;
    const filterBlacklist = req.query.filterBlacklist === 'true';

    if (!week) return res.json({ error: "Vui lòng chọn Tuần cần phân tích." });

    try {
        // BƯỚC 1: TÌM VÙNG TRŨNG (BAD CELLS - Sử dụng cột Rank/Sao thay vì điểm Score phần trăm)
        const queryBadCells = `
            SELECT Cell_Name, QoE_Rank as Score, 'Vi phạm QoE' as Type FROM mbb_qoe WHERE Tuan = ? AND QoE_Rank < 3
            UNION
            SELECT Cell_Name, QoS_Rank as Score, 'Vi phạm QoS' as Type FROM mbb_qos WHERE Tuan = ? AND QoS_Rank < 3
        `;
        const [badCellsRaw] = await db.query(queryBadCells, [week, week]);

        if (badCellsRaw.length === 0) {
            return res.json({ message: "Mạng lưới rất tốt! Không tìm thấy Cell nào có điểm QoE/QoS < 3 trong tuần này.", data: null });
        }

        // BƯỚC 2: ĐỐI SOÁT BLACKLIST (SÀNG LỌC)
        let blacklistedCount = 0;
        let validCellsObj = {};
        
        badCellsRaw.forEach(row => {
            const cell = row.Cell_Name;
            if (!cell) return;
            
            const upperCell = cell.toUpperCase();
            const isBlacklisted = upperCell.includes('IBS') || 
                                  upperCell.includes('DAS') || 
                                  upperCell.includes('VSAT') || 
                                  upperCell.includes('BOOSTER') ||
                                  upperCell.startsWith('MBF_TH') ||
                                  upperCell.startsWith('VNP-4G');
            
            if (filterBlacklist && isBlacklisted) {
                blacklistedCount++;
                return;
            }

            if (!validCellsObj[cell]) validCellsObj[cell] = { Cell_Name: cell, issues: [] };
            if (!validCellsObj[cell].issues.includes(row.Type)) {
                validCellsObj[cell].issues.push(row.Type);
            }
        });

        const targetCells = Object.keys(validCellsObj);
        if (targetCells.length === 0) {
             return res.json({ message: `Đã lọc ${blacklistedCount} trạm Blacklist bất khả kháng. Hiện không còn trạm nào cần phân tích khẩn cấp.`, data: null });
        }

        // BƯỚC 3: PHÂN TÍCH VI MÔ (ÁNH XẠ SANG BẢNG KPI 4G ĐỂ BẮT BỆNH)
        const placeholders = targetCells.map(() => '?').join(',');
        const queryKpi = `
            SELECT Cell_name,
                   AVG(User_DL_Avg_Throughput_Kbps) as thput,
                   AVG(Downlink_Latency) as latency,
                   AVG(RB_Util_Rate_DL) as prb,
                   AVG(CQI_4G) as cqi,
                   AVG(eRAB_Setup_SR_All) as erab,
                   AVG(Service_Drop_all) as drop_rate
            FROM kpi_4g
            WHERE Cell_name IN (${placeholders})
            GROUP BY Cell_name
        `;
        const [kpiData] = await db.query(queryKpi, targetCells);

        let group1 = []; // Core/Truyền dẫn
        let group2 = []; // Nghẽn Vô tuyến
        let group3 = []; // Nhiễu/Phần cứng/Vùng phủ
        let groupUnknown = []; // Cần theo dõi thêm

        kpiData.forEach(row => {
            const thput = parseFloat(row.thput) || 0;
            const latency = parseFloat(row.latency) || 0;
            const prb = parseFloat(row.prb) || 0;
            const cqi = parseFloat(row.cqi) || 0;
            const erab = parseFloat(row.erab) || 100;
            const drop_rate = parseFloat(row.drop_rate) || 0;

            const cellInfo = {
                Cell_Name: row.Cell_name,
                Type: validCellsObj[row.Cell_name].issues.join(' & '),
                metrics: { 
                    thput: (thput/1000).toFixed(2), 
                    latency: latency.toFixed(1), 
                    prb: prb.toFixed(1), 
                    cqi: cqi.toFixed(1), 
                    erab: erab.toFixed(2), 
                    drop_rate: drop_rate.toFixed(2) 
                }
            };

            // THUẬT TOÁN CHẨN ĐOÁN BỆNH
            if (thput < 15000 && latency > 100) {
                group1.push(cellInfo);
            } 
            else if (prb > 65) {
                group2.push(cellInfo);
            } 
            else if (cqi < 90 || erab < 98.5 || drop_rate > 1) {
                group3.push(cellInfo);
            } 
            else {
                groupUnknown.push(cellInfo);
            }
            
            const idx = targetCells.indexOf(row.Cell_name);
            if (idx > -1) targetCells.splice(idx, 1);
        });

        targetCells.forEach(cell => {
            groupUnknown.push({
                Cell_Name: cell,
                Type: validCellsObj[cell].issues.join(' & '),
                metrics: { thput: '-', latency: '-', prb: '-', cqi: '-', erab: '-', drop_rate: '-' },
                note: "Chưa có dữ liệu KPI 4G để bắt bệnh"
            });
        });

        res.json({
            stats: { totalBad: badCellsRaw.length, blacklisted: blacklistedCount, analyzed: Object.keys(validCellsObj).length },
            data: { group1, group2, group3, groupUnknown }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Lỗi truy xuất hệ thống máy chủ CSDL." });
    }
};
