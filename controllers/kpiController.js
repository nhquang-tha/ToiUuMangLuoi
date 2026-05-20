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

// =====================================================================
// TÍNH NĂNG MỚI: DANH SÁCH TOÀN BỘ CELL KÈM TÍNH TOÁN XU HƯỚNG VÀ NOTE
// =====================================================================
exports.getQoeQosListAll = async (req, res) => {
    try {
        // Tự động khởi tạo bảng Notes nếu chưa có
        try { 
            await db.query('SELECT 1 FROM cell_notes LIMIT 1'); 
        } catch (e) {
            await db.query(`
                CREATE TABLE cell_notes (
                    cell_name VARCHAR(255) PRIMARY KEY,
                    note_text TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )
            `);
        }

        // Lấy dữ liệu cơ sở Cell 4G
        const [cells] = await db.query(`
            SELECT Cell_name, MAX(Site_name) as Site_name, MAX(District_code) as District_code, MAX(MIMO) as MIMO
            FROM kpi_4g
            WHERE Cell_name IS NOT NULL AND Cell_name != ''
            GROUP BY Cell_name
        `);

        // Lấy QoE, QoS và Notes
        const [qoe] = await db.query('SELECT Cell_Name, Tuan, QoE_Rank, QoE_Score FROM mbb_qoe');
        const [qos] = await db.query('SELECT Cell_Name, Tuan, QoS_Rank, QoS_Score FROM mbb_qos');
        const [notes] = await db.query('SELECT cell_name, note_text FROM cell_notes');
        
        const noteMap = {};
        notes.forEach(n => noteMap[n.cell_name] = n.note_text);

        // Sắp xếp Tuần
        const sortWeeks = (arr) => {
            return arr.sort((a, b) => {
                let matchA = a.match(/Tuần (\d+) \((\d+)\)/);
                let matchB = b.match(/Tuần (\d+) \((\d+)\)/);
                if (matchA && matchB) {
                    if (matchA[2] !== matchB[2]) return parseInt(matchB[2]) - parseInt(matchA[2]);
                    return parseInt(matchB[1]) - parseInt(matchA[1]);
                }
                return 0;
            });
        };

        // Gộp dữ liệu QoE
        let qoeMap = {};
        let qoeWeeksSet = new Set();
        qoe.forEach(r => {
            if(!qoeMap[r.Cell_Name]) qoeMap[r.Cell_Name] = {};
            qoeMap[r.Cell_Name][r.Tuan] = { rank: r.QoE_Rank, score: r.QoE_Score };
            qoeWeeksSet.add(r.Tuan);
        });
        let sortedQoeWeeks = sortWeeks(Array.from(qoeWeeksSet));

        // Gộp dữ liệu QoS
        let qosMap = {};
        let qosWeeksSet = new Set();
        qos.forEach(r => {
            if(!qosMap[r.Cell_Name]) qosMap[r.Cell_Name] = {};
            qosMap[r.Cell_Name][r.Tuan] = { rank: r.QoS_Rank, score: r.QoS_Score };
            qosWeeksSet.add(r.Tuan);
        });
        let sortedQosWeeks = sortWeeks(Array.from(qosWeeksSet));

        let result = [];

        cells.forEach(c => {
            let cellName = c.Cell_name;
            let obj = {
                Site_name: c.Site_name || '',
                Cell_name: cellName,
                District_code: c.District_code || '',
                MIMO: c.MIMO || '',
                note: noteMap[cellName] || '',
                qoe: { rank: '-', score: '-', trend: 0 },
                qos: { rank: '-', score: '-', trend: 0 }
            };

            // Tính toán xu hướng QoE (Tuần mới nhất so với TB 4 tuần trước)
            if (qoeMap[cellName] && sortedQoeWeeks.length > 0) {
                let latestW = sortedQoeWeeks[0];
                let latestData = qoeMap[cellName][latestW];
                if (latestData) {
                    obj.qoe.rank = latestData.rank;
                    obj.qoe.score = parseFloat(latestData.score) || 0;

                    let prevSum = 0; let prevCount = 0;
                    for(let i = 1; i <= 4; i++) {
                        if(sortedQoeWeeks[i] && qoeMap[cellName][sortedQoeWeeks[i]]) {
                            prevSum += parseFloat(qoeMap[cellName][sortedQoeWeeks[i]].score) || 0;
                            prevCount++;
                        }
                    }
                    if (prevCount > 0) {
                        let avg = prevSum / prevCount;
                        obj.qoe.trend = obj.qoe.score - avg;
                    }
                }
            }

            // Tính toán xu hướng QoS (Tuần mới nhất so với TB 4 tuần trước)
            if (qosMap[cellName] && sortedQosWeeks.length > 0) {
                let latestW = sortedQosWeeks[0];
                let latestData = qosMap[cellName][latestW];
                if (latestData) {
                    obj.qos.rank = latestData.rank;
                    obj.qos.score = parseFloat(latestData.score) || 0;

                    let prevSum = 0; let prevCount = 0;
                    for(let i = 1; i <= 4; i++) {
                        if(sortedQosWeeks[i] && qosMap[cellName][sortedQosWeeks[i]]) {
                            prevSum += parseFloat(qosMap[cellName][sortedQosWeeks[i]].score) || 0;
                            prevCount++;
                        }
                    }
                    if (prevCount > 0) {
                        let avg = prevSum / prevCount;
                        obj.qos.trend = obj.qos.score - avg;
                    }
                }
            }

            result.push(obj);
        });

        // Sắp xếp những trạm điểm QoE thấp nhất lên trên cùng cho dễ nhìn
        result.sort((a, b) => {
            let aScore = a.qoe.score !== '-' ? a.qoe.score : 999;
            let bScore = b.qoe.score !== '-' ? b.qoe.score : 999;
            return aScore - bScore;
        });

        res.json(result);
    } catch (error) {
        console.error("Lỗi tổng hợp danh sách QoE/QoS:", error);
        res.status(500).json({error: "Lỗi Server"});
    }
};

exports.saveCellNote = async (req, res) => {
    const { cell_name, note } = req.body;
    if (!cell_name) return res.status(400).json({success: false});
    try {
        await db.query(`
            INSERT INTO cell_notes (cell_name, note_text) 
            VALUES (?, ?) 
            ON DUPLICATE KEY UPDATE note_text = VALUES(note_text)
        `, [cell_name, note || '']);
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
        const queryBadCells = `
            SELECT Cell_Name, QoE_Rank as Score, 'Vi phạm QoE' as Type FROM mbb_qoe WHERE Tuan = ? AND QoE_Rank < 3
            UNION
            SELECT Cell_Name, QoS_Rank as Score, 'Vi phạm QoS' as Type FROM mbb_qos WHERE Tuan = ? AND QoS_Rank < 3
        `;
        const [badCellsRaw] = await db.query(queryBadCells, [week, week]);

        if (badCellsRaw.length === 0) {
            return res.json({ message: "Mạng lưới rất tốt! Không tìm thấy Cell nào có điểm QoE/QoS < 3 trong tuần này.", data: null });
        }

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

        const placeholders = targetCells.map(() => '?').join(',');
        let kpiData = [];
        
        try {
            let queryKpi = `
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
            [kpiData] = await db.query(queryKpi, targetCells);
        } catch (error) { console.error("Lỗi lấy dữ liệu KPI 4G cho Tối Ưu:", error); }

        let group1 = []; 
        let group2 = []; 
        let group3 = []; 
        let groupUnknown = []; 

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

            if (thput < 15000 && latency > 100) { group1.push(cellInfo); } 
            else if (prb > 65) { group2.push(cellInfo); } 
            else if (cqi < 90 || erab < 98.5 || drop_rate > 1) { group3.push(cellInfo); } 
            else { groupUnknown.push(cellInfo); }
            
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
