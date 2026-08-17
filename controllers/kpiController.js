const db = require('../models/db');

exports.getKpiAnalyticsPage = (req, res) => {
    const activeUser = res.locals.currentUser || req.session.user || req.user;
    res.render('kpi_analytics', { title: 'KPI Analytics', page: 'KPI Analytics', currentUser: activeUser });
};

exports.getQoeQosAnalyticsPage = (req, res) => {
    const activeUser = res.locals.currentUser || req.session.user || req.user;
    res.render('qoe_qos_analytics', { title: 'QoE/QoS Analytics', page: 'QoE/QoS Analytics', currentUser: activeUser });
};

const cleanKeyword = (str) => {
    if (!str) return '';
    return String(str).toUpperCase()
                      .replace(/^(3G|4G|5G)[-\s_]?/i, '') 
                      .replace(/[-\s_]?(THA|TH)$/i, '')   
                      .trim();
};

exports.getKpiData = async (req, res) => {
    const network = req.query.network || '4g';
    const type = req.query.type || 'keyword';
    const value = req.query.value ? req.query.value.trim() : '';
    
    if (!value) return res.json([]);

    try {
        let query = `SELECT k.* FROM kpi_${network} k`;
        let params = [];

        if (type === 'keyword') {
            const rawValues = value.split(',').map(s => s.trim()).filter(s => s);
            let conditions = [];
            
            rawValues.forEach(v => {
                const cleanV = cleanKeyword(v);

                if (network === '4g') {
                    conditions.push(`(k.Cell_name LIKE ? OR k.Site_name LIKE ?)`);
                    params.push(`%${cleanV}%`, `%${cleanV}%`);
                } else if (network === '3g') {
                    conditions.push(`(k.Ten_CELL LIKE ? OR k.Ten_CELL IN (SELECT Cell_code FROM rf_3g WHERE Site_code LIKE ?) OR k.Ten_CELL IN (SELECT CELL_NAME FROM rf_3g WHERE Site_code LIKE ?))`);
                    params.push(`%${cleanV}%`, `%${cleanV}%`, `%${cleanV}%`);
                } else { 
                    conditions.push(`(k.Ten_CELL LIKE ? OR k.Ten_GNODEB LIKE ?)`);
                    params.push(`%${cleanV}%`, `%${cleanV}%`);
                }
            });

            query += ` WHERE ` + conditions.join(' OR ');
            
        } else if (type === 'poi') {
            let poiCellCol = (network === '4g') ? 'Cell_name' : 'Ten_CELL';
            query += ` JOIN poi_${network} p ON k.${poiCellCol} = p.Cell_Code WHERE p.POI = ?`;
            params = [value];
        }
        
        query += ` ORDER BY k.id ASC LIMIT 5000`; 
        const [rows] = await db.query(query, params);
        res.json(rows);

    } catch (error) {
        console.error("Lỗi lấy dữ liệu KPI:", error.message);
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

exports.getQoeQosListAll = async (req, res) => {
    try {
        // Lấy danh sách siêu tốc từ bảng Cache đã đồng bộ (ép NULL xuống đáy)
        const [rows] = await db.query(`
            SELECT Site_Name, Cell_Name, District, MIMO, 
                   QoE_Rank, QoE_Score, QoE_Trend, 
                   QoS_Rank, QoS_Score, QoS_Trend, lich_su_tac_dong 
            FROM qoe_qos 
            ORDER BY IFNULL(QoE_Rank, 999) ASC, IFNULL(QoS_Rank, 999) ASC
        `);
        res.json(rows);
    } catch (error) {
        console.error("Lỗi lấy danh sách QoE/QoS tĩnh:", error);
        res.status(500).json({error: "Lỗi Server - Hãy chắc chắn bạn đã chạy lệnh tạo bảng qoe_qos trong Database"});
    }
};

exports.saveCellNote = async (req, res) => {
    const { cell_name, note } = req.body;
    if (!cell_name) return res.status(400).json({success: false});
    try {
        // 1. Lưu dự phòng vào bảng cell_notes
        await db.query(`
            INSERT INTO cell_notes (cell_name, note_text) 
            VALUES (?, ?) 
            ON DUPLICATE KEY UPDATE note_text = VALUES(note_text)
        `, [cell_name, note || '']);
        
        // 2. Cập nhật trực tiếp vào bảng tĩnh qoe_qos
        await db.query(`
            UPDATE qoe_qos SET lich_su_tac_dong = ? WHERE Cell_Name = ?
        `, [note || '', cell_name]);

        res.json({success: true});
    } catch (e) {
        console.error("Lỗi lưu note:", e);
        res.status(500).json({success: false});
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

    let kpi4g = [];
    let kpi5g = [];

    try {
        const [rows] = await db.query(`
            SELECT k.Thoi_gian, SUM(k.Total_Data_Traffic_Volume_GB) as traffic_4g, AVG(k.User_DL_Avg_Throughput_Kbps) as thput_4g
            FROM kpi_4g k JOIN poi_4g p ON k.Cell_name = p.Cell_Code
            WHERE p.POI = ? GROUP BY k.Thoi_gian
        `, [poi]);
        kpi4g = rows;
    } catch (error) { console.error("Lỗi POI 4G Fallback:", error.message); }

    try {
        const [rows] = await db.query(`
            SELECT k.Thoi_gian, SUM(k.Total_Data_Traffic_Volume_GB) as traffic_5g, AVG(k.A_User_DL_Avg_Throughput) as thput_5g
            FROM kpi_5g k JOIN poi_5g p ON k.Ten_CELL = p.Cell_Code
            WHERE p.POI = ? GROUP BY k.Thoi_gian
        `, [poi]);
        kpi5g = rows;
    } catch (error) { console.error("Bỏ qua lỗi POI 5G:", error.message); }

    if (kpi4g.length === 0 && kpi5g.length === 0) {
        return res.json({ data: [], has4g: false, has5g: false });
    }

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
};

exports.getOptimizingPage = async (req, res) => {
    const activeUser = res.locals.currentUser || req.session.user || req.user;
    try {
        const [qoeWeeks] = await db.query('SELECT DISTINCT Tuan FROM mbb_qoe WHERE Tuan IS NOT NULL');
        const [qosWeeks] = await db.query('SELECT DISTINCT Tuan FROM mbb_qos WHERE Tuan IS NOT NULL');
        
        let uniqueWeeks = [...new Set([...qoeWeeks.map(r => r.Tuan), ...qosWeeks.map(r => r.Tuan)])];
        // Sắp xếp Giảm dần: Tuần mới nhất lên đầu
        uniqueWeeks.sort((a, b) => {
            let matchA = a.match(/Tuần (\d+) \((\d+)\)/);
            let matchB = b.match(/Tuần (\d+) \((\d+)\)/);
            if (matchA && matchB) {
                if (matchA[2] !== matchB[2]) return parseInt(matchB[2]) - parseInt(matchA[2]);
                return parseInt(matchB[1]) - parseInt(matchA[1]);
            }
            return 0;
        }); 

        res.render('optimizing_qoe_qos', { 
            title: 'Tối Ưu CEM/QoS', 
            page: 'Optimizing QoE/QoS', 
            weeks: uniqueWeeks,
            currentUser: activeUser
        });
    } catch (error) {
        res.render('optimizing_qoe_qos', { title: 'Tối Ưu', page: 'Optimizing QoE/QoS', weeks: [], currentUser: activeUser });
    }
};

// =====================================================================
// QUY TRÌNH PHỄU LỌC 5 BƯỚC RNO THỰC CHIẾN CAO NHẤT (ĐỘ NHIỄU = 0)
// =====================================================================
exports.getOptimizingData = async (req, res) => {
    const week = req.query.week;
    const filterBlacklist = req.query.filterBlacklist === 'true';

    if (!week) return res.json({ error: "Vui lòng chọn Tuần cần phân tích." });

    try {
        // BƯỚC 1: LỌC GIAO THOA "TỘI PHẠM KÉP" (Double-Red Filter)
        // Lấy chính xác những Cell vừa hỏng kỹ thuật (QoS < 4) vừa làm KH phàn nàn (CEM < 4)
        const queryBadCells = `
            SELECT Cell_Name, QoE_Rank, QoS_Rank 
            FROM qoe_qos 
            WHERE QoE_Rank < 4 AND QoS_Rank < 4
        `;
        const [badCellsRaw] = await db.query(queryBadCells);

        if (badCellsRaw.length === 0) {
            return res.json({ message: "Mạng lưới tuyệt vời! Không tìm thấy Cell nào là 'Tội phạm kép' (Cùng lúc đỏ cả CEM và QoS).", data: null });
        }

        let blacklistedCount = 0;
        let validCellsObj = {};
        
        // BƯỚC 3: LỌC NGOẠI TRỪ PHÁP LÝ (Blacklist Filter)
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

            validCellsObj[cell] = { Cell_Name: cell, type: 'Double-Red' };
        });

        const targetCells = Object.keys(validCellsObj);
        if (targetCells.length === 0) {
             return res.json({ message: `Đã gạt bỏ ${blacklistedCount} trạm Blacklist bất khả kháng. Hiện không còn trạm nào cần phân tích.`, data: null });
        }

        // Lấy 7 ngày KPI mới nhất để làm đối chiếu
        const [datesRaw] = await db.query(`SELECT DISTINCT Thoi_gian FROM kpi_4g WHERE Thoi_gian IS NOT NULL AND Thoi_gian != ''`);
        const dates = datesRaw.map(d => d.Thoi_gian).sort((a, b) => new Date(b.split('/').reverse().join('-')) - new Date(a.split('/').reverse().join('-')));
        const targetDates = dates.slice(0, 7);
        
        if (targetDates.length === 0) return res.json({ error: "Chưa có dữ liệu KPI ngày để phân tích quy tắc 5/7." });

        const placeholders = targetCells.map(() => '?').join(',');
        const datePlaceholders = targetDates.map(() => '?').join(',');
        
        let kpiData = [];
        try {
            let queryKpi = `
                SELECT Cell_name,
                       AVG(Total_Data_Traffic_Volume_GB) as avg_traf,
                       AVG(Total_UE) as avg_ue,
                       SUM(CASE WHEN User_DL_Avg_Throughput_Kbps < 15000 THEN 1 ELSE 0 END) as v_thput,
                       SUM(CASE WHEN RB_Util_Rate_DL > 70 THEN 1 ELSE 0 END) as v_prb,
                       SUM(CASE WHEN CQI_4G < 90 THEN 1 ELSE 0 END) as v_cqi,
                       SUM(CASE WHEN Service_Drop_all > 1 THEN 1 ELSE 0 END) as v_drop,
                       SUM(CASE WHEN Downlink_Latency > 50 THEN 1 ELSE 0 END) as v_latency,
                       AVG(User_DL_Avg_Throughput_Kbps) as thput,
                       AVG(Downlink_Latency) as latency,
                       AVG(RB_Util_Rate_DL) as prb,
                       AVG(CQI_4G) as cqi,
                       AVG(Service_Drop_all) as drop_rate
                FROM kpi_4g
                WHERE Cell_name IN (${placeholders}) AND Thoi_gian IN (${datePlaceholders})
                GROUP BY Cell_name
            `;
            [kpiData] = await db.query(queryKpi, [...targetCells, ...targetDates]);
        } catch (error) { console.error("Lỗi lấy dữ liệu KPI 4G cho Tối Ưu:", error); }

        let group1 = []; // Truyền dẫn
        let group2 = []; // Vô tuyến
        let group3 = []; // Nghẽn
        let lowTrafficCount = 0;

        kpiData.forEach(row => {
            // BƯỚC 2: LỌC "RÁC" LƯU LƯỢNG (Traffic Threshold Filter)
            if (row.avg_traf < 5 || row.avg_ue < 30) {
                lowTrafficCount++;
                return;
            }

            // BƯỚC 4: KHẲNG ĐỊNH BỆNH MÃN TÍNH (Quy Tắc 5/7 Ngày)
            if (row.v_thput < 5 && row.v_prb < 5 && row.v_cqi < 5 && row.v_drop < 5) return;

            const cellInfo = {
                Cell_Name: row.Cell_name,
                metrics: { 
                    thput: (parseFloat(row.thput)/1000).toFixed(2), 
                    latency: parseFloat(row.latency).toFixed(1), 
                    prb: parseFloat(row.prb).toFixed(1), 
                    cqi: parseFloat(row.cqi).toFixed(1), 
                    drop_rate: parseFloat(row.drop_rate).toFixed(2) 
                },
                vios: {
                    thput: row.v_thput >= 5, latency: row.v_latency >= 5,
                    prb: row.v_prb >= 5, cqi: row.v_cqi >= 5, drop: row.v_drop >= 5
                }
            };

            // BƯỚC 5: MA TRẬN RA QUYẾT ĐỊNH & GIAO VIỆC
            // 5.1 Nhóm Truyền dẫn (Sóng rỗi nhưng mạng chậm: Thput thấp + Trễ cao + PRB < 50%)
            if (row.v_thput >= 5 && row.v_latency >= 5 && parseFloat(row.prb) < 50) {
                group1.push(cellInfo);
            } 
            // 5.2 Nhóm Nghẽn tài nguyên (PRB > 70%)
            else if (row.v_prb >= 5) {
                group3.push(cellInfo);
            } 
            // 5.3 Nhóm Vô tuyến & Thiết bị (CQI < 90% hoặc Drop > 1%)
            else if (row.v_cqi >= 5 || row.v_drop >= 5) {
                group2.push(cellInfo);
            } 
            // Nếu rớt mẻ cuối, quăng vào nhóm Vô tuyến để check Alarms
            else {
                group2.push(cellInfo);
            }
        });

        let totalAnalyzed = group1.length + group2.length + group3.length;

        res.json({
            stats: { 
                totalBad: badCellsRaw.length, 
                blacklisted: blacklistedCount, 
                lowTraffic: lowTrafficCount,
                analyzed: totalAnalyzed 
            },
            data: { group1, group2, group3 }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Lỗi truy xuất hệ thống máy chủ CSDL." });
    }
};
