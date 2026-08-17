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

        res.json({ qoe: qoeRows, qos: qosRows });
    } catch (error) {
        console.error("Lỗi lấy dữ liệu QoE/QoS:", error);
        res.status(500).json({ error: "Lỗi truy xuất CSDL QoE/QoS." });
    }
};

exports.getQoeQosListAll = async (req, res) => {
    try {
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
    if (userRole !== 'admin') return res.status(403).send("Chỉ Admin mới có quyền.");
    
    const network = req.params.network;
    try {
        await db.query(`TRUNCATE TABLE kpi_${network}`);
        res.redirect('/import-data');
    } catch (error) {
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
        res.json([]);
    }
};

exports.getPoiData = async (req, res) => {
    const poi = req.query.poi;
    if (!poi) return res.json({ data: [], has4g: false, has5g: false });

    let kpi4g = []; let kpi5g = [];
    try {
        const [rows] = await db.query(`
            SELECT k.Thoi_gian, SUM(k.Total_Data_Traffic_Volume_GB) as traffic_4g, AVG(k.User_DL_Avg_Throughput_Kbps) as thput_4g
            FROM kpi_4g k JOIN poi_4g p ON k.Cell_name = p.Cell_Code
            WHERE p.POI = ? GROUP BY k.Thoi_gian
        `, [poi]);
        kpi4g = rows;
    } catch (error) {}

    try {
        const [rows] = await db.query(`
            SELECT k.Thoi_gian, SUM(k.Total_Data_Traffic_Volume_GB) as traffic_5g, AVG(k.A_User_DL_Avg_Throughput) as thput_5g
            FROM kpi_5g k JOIN poi_5g p ON k.Ten_CELL = p.Cell_Code
            WHERE p.POI = ? GROUP BY k.Thoi_gian
        `, [poi]);
        kpi5g = rows;
    } catch (error) {}

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

    res.json({ data: sortedData, has4g: kpi4g.length > 0, has5g: kpi5g.length > 0 });
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
// TỐI ƯU CEM / QOS THEO QUY TRÌNH & BAREM ĐIỂM SỐ 2304/VNPT-CN 4G
// =====================================================================
exports.getOptimizingData = async (req, res) => {
    const week = req.query.week;
    const filterBlacklist = req.query.filterBlacklist === 'true';

    if (!week) return res.json({ error: "Vui lòng chọn Tuần cần phân tích." });

    try {
        // BƯỚC 1: NHẬN DIỆN BADCELL 4G (QoE_Rank < 3 HOẶC QoS_Rank < 3)
        const queryBadCells = `
            SELECT Site_Name, Cell_Name, District, MIMO, QoE_Rank, QoE_Score, QoS_Rank, QoS_Score 
            FROM qoe_qos 
            WHERE (QoE_Rank IS NOT NULL AND QoE_Rank < 3) 
               OR (QoS_Rank IS NOT NULL AND QoS_Rank < 3)
        `;
        let badCellsRaw = [];
        try {
            const [rows] = await db.query(queryBadCells);
            badCellsRaw = rows;
        } catch (dbError) {
            console.error("Lỗi CSDL Bảng qoe_qos:", dbError);
            return res.json({ error: "Bảng dữ liệu qoe_qos chưa tồn tại hoặc trống. Vui lòng Import dữ liệu QoE/QoS vào hệ thống." });
        }

        if (badCellsRaw.length === 0) {
            return res.json({ message: "Mạng lưới đạt chuẩn 2304/VNPT-CN! Không tìm thấy Badcell 4G nào dưới 3 điểm ở cả CEM và QoS.", data: null });
        }

        let blacklistedCount = 0;
        let validCellsObj = {};

        // BƯỚC 2: LỌC NGOẠI TRỪ (BLACKLIST 4G MIỄN TRỪ 06 THÁNG)
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

            validCellsObj[upperCell] = {
                Cell_Name: upperCell,
                Site_Name: row.Site_Name || '',
                District: row.District || '',
                MIMO: row.MIMO || '2T2R',
                QoE_Rank: row.QoE_Rank,
                QoE_Score: row.QoE_Score,
                QoS_Rank: row.QoS_Rank,
                QoS_Score: row.QoS_Score
            };
        });

        const targetCells = Object.keys(validCellsObj);
        if (targetCells.length === 0) {
            return res.json({ message: `Đã miễn trừ ${blacklistedCount} trạm Blacklist (VSAT, DAS cũ, Biên giới/Hải đảo). Hiện không còn Badcell cần xử lý.`, data: null });
        }

        // BƯỚC 3 & 4: TRUY VẾT DỮ LIỆU KPI 7 NGÀY THEO CÁC BAREM BĂNG THÔNG & MIMO
        const [datesRaw] = await db.query(`SELECT DISTINCT Thoi_gian FROM kpi_4g WHERE Thoi_gian IS NOT NULL AND Thoi_gian != ''`);
        const dates = datesRaw.map(d => d.Thoi_gian).sort((a, b) => {
            const pA = a.split('/'); const pB = b.split('/');
            return new Date(`${pB[2]}-${pB[1]}-${pB[0]}`) - new Date(`${pA[2]}-${pA[1]}-${pA[0]}`);
        });
        const targetDates = dates.slice(0, 7); // 7 ngày gần nhất

        const placeholders = targetCells.map(() => '?').join(',');
        const datePlaceholders = targetDates.map(() => '?').join(',');

        let kpiRows = [];
        if (targetDates.length > 0) {
            try {
                let queryKpi = `
                    SELECT Cell_name, Thoi_gian, CellType, MIMO,
                           User_DL_Avg_Throughput_Kbps as thput,
                           Downlink_Latency as latency,
                           RB_Util_Rate_DL as prb,
                           CQI_4G as cqi,
                           eRAB_Setup_SR_All as erab,
                           Service_Drop_all as drop_rate
                    FROM kpi_4g
                    WHERE UPPER(Cell_name) IN (${placeholders}) AND Thoi_gian IN (${datePlaceholders})
                    ORDER BY UPPER(Cell_name), STR_TO_DATE(Thoi_gian, '%d/%m/%Y') DESC
                `;
                const [r] = await db.query(queryKpi, [...targetCells, ...targetDates]);
                kpiRows = r;
            } catch (kpiError) {
                console.error("Lỗi lấy KPI 4G:", kpiError);
            }
        }

        let cellKpiMap = {};
        kpiRows.forEach(row => {
            const upperCell = String(row.Cell_name).toUpperCase();
            if (!cellKpiMap[upperCell]) cellKpiMap[upperCell] = [];
            cellKpiMap[upperCell].push(row);
        });

        let workOrderList = [];      // Cảnh báo chuỗi 3 ngày (Nguy kịch)
        let cemBreakdownList = [];   // Phân rã CEM MBB (UXI 1, UXI 2, UXI 3)
        let qosBreakdownList = [];   // Phân rã QoS 4G (SQI 1 -> SQI 5)
        let warningList = [];        // Tag "Theo dõi" (Sát ngưỡng)

        targetCells.forEach(cellKey => {
            const cellInfo = validCellsObj[cellKey];
            const rows = cellKpiMap[cellKey] || [];

            let avgThput = 0, avgPrb = 0, avgCqi = 0, avgDrop = 0, avgErab = 100, avgLatency = 0;
            let count = rows.length;

            let dailyCriticalCount = 0;
            let consecutiveCritical = 0;
            let maxConsecutiveCritical = 0;

            let cemIssues = [];
            let qosIssues = [];

            if (count > 0) {
                let sumThput = 0, sumPrb = 0, sumCqi = 0, sumDrop = 0, sumErab = 0, sumLatency = 0;

                rows.forEach((r) => {
                    const thputKbps = parseFloat(r.thput) || 0;
                    const thputMbps = thputKbps / 1000;
                    const prb = parseFloat(r.prb) || 0;
                    const cqi = parseFloat(r.cqi) || 0;
                    const drop = parseFloat(r.drop_rate) || 0;
                    const erab = parseFloat(r.erab) || 100;
                    const latency = parseFloat(r.latency) || 0;
                    const cellType = String(r.CellType || '').toUpperCase();
                    const mimo = String(r.MIMO || cellInfo.MIMO || '').toUpperCase();

                    sumThput += thputKbps;
                    sumPrb += prb;
                    sumCqi += cqi;
                    sumDrop += drop;
                    sumErab += erab;
                    sumLatency += latency;

                    // ĐÁNH GIÁ NGƯỠNG CẢNH BÁO ĐỎ THEO CÔNG VĂN 2304/VNPT-CN
                    let dailyViolations = 0;

                    // 1. UXI 3 Video (< 3 Mbps)
                    if (thputMbps < 3) dailyViolations++;
                    // 2. UXI 2 Upload Latency (> 300 ms)
                    if (latency > 300) dailyViolations++;

                    // 3. SQI 5 Speed Barem:
                    let speedThreshold = 25; // 15-20MHz
                    if (cellType.includes('10M')) speedThreshold = 18;
                    if (cellType.includes('5M') || cellType.includes('L900')) speedThreshold = 6;
                    if (thputMbps < speedThreshold) dailyViolations++;

                    // 4. SQI 4 CQI Barem:
                    let cqiThreshold = 93; // 2T2R
                    if (mimo.includes('4T4R')) cqiThreshold = 95;
                    if (mimo.includes('1T1R') || mimo.includes('1T2R')) cqiThreshold = 92;
                    if (cqi < cqiThreshold) dailyViolations++;

                    // 5. SQI 1 Resource (RB Util >= 70%)
                    if (prb >= 70) dailyViolations++;

                    // 6. SQI 3 Retainability (Service Drop > 1%)
                    if (drop > 1) dailyViolations++;

                    // 7. SQI 2 Accessibility (eRAB < 99%)
                    if (erab < 99) dailyViolations++;

                    // Tag Nguy Kịch khi vi phạm >= 2 ngưỡng trong cùng ngày
                    if (dailyViolations >= 2) {
                        dailyCriticalCount++;
                        consecutiveCritical++;
                        if (consecutiveCritical > maxConsecutiveCritical) {
                            maxConsecutiveCritical = consecutiveCritical;
                        }
                    } else {
                        consecutiveCritical = 0;
                    }
                });

                avgThput = (sumThput / count / 1000).toFixed(2); // Mbps
                avgPrb = (sumPrb / count).toFixed(1);
                avgCqi = (sumCqi / count).toFixed(1);
                avgDrop = (sumDrop / count).toFixed(2);
                avgErab = (sumErab / count).toFixed(2);
                avgLatency = (sumLatency / count).toFixed(1);
            } else {
                avgThput = '-'; avgPrb = '-'; avgCqi = '-'; avgDrop = '-'; avgErab = '-'; avgLatency = '-';
            }

            // PHÂN RÃ NGUYÊN NHÂN CEM MBB
            if (parseFloat(avgThput) < 3) cemIssues.push('UXI 3: Video giật/vỡ nét (< 3 Mbps)');
            if (parseFloat(avgLatency) > 300) cemIssues.push('UXI 2: Độ trễ quá cao (> 300ms)');
            if (parseFloat(avgErab) < 92) cemIssues.push('UXI 1: Tỷ lệ truy cập gửi tin kém (< 92%)');

            // PHÂN RÃ NGUYÊN NHÂN QOS 4G SQI
            if (parseFloat(avgPrb) >= 70) qosIssues.push('SQI 1: Mãn tải tài nguyên (RB Util ≥ 70%)');
            if (parseFloat(avgErab) < 99) qosIssues.push('SQI 2: Lỗi thiết lập kênh (eRAB < 99%)');
            if (parseFloat(avgDrop) > 1) qosIssues.push('SQI 3: Tỷ lệ rớt dịch vụ cao (Drop > 1%)');
            if (parseFloat(avgCqi) < 93) qosIssues.push('SQI 4: Nhiễu sóng / Vùng phủ kém (CQI < 93-95%)');
            if (parseFloat(avgThput) < 18) qosIssues.push('SQI 5: Tốc độ tải xuống thấp (< 18-25 Mbps)');

            const item = {
                Cell_Name: cellInfo.Cell_Name,
                Site_Name: cellInfo.Site_Name,
                District: cellInfo.District,
                MIMO: cellInfo.MIMO,
                QoE_Rank: cellInfo.QoE_Rank !== null ? cellInfo.QoE_Rank : '-',
                QoE_Score: cellInfo.QoE_Score !== null ? Number(cellInfo.QoE_Score).toFixed(2) : '-',
                QoS_Rank: cellInfo.QoS_Rank !== null ? cellInfo.QoS_Rank : '-',
                QoS_Score: cellInfo.QoS_Score !== null ? Number(cellInfo.QoS_Score).toFixed(2) : '-',
                metrics: {
                    thput: avgThput,
                    prb: avgPrb,
                    cqi: avgCqi,
                    drop_rate: avgDrop,
                    erab: avgErab,
                    latency: avgLatency
                },
                cemIssues: cemIssues.join(' | ') || 'Cảnh báo CEM < 3 sao',
                qosIssues: qosIssues.join(' | ') || 'Cảnh báo QoS < 3 sao',
                criticalDays: dailyCriticalCount,
                maxConsecutiveCritical: maxConsecutiveCritical
            };

            // BƯỚC 5: PHÂN LOẠI TAB & CẢNH BÁO CHUỖI 3 NGÀY
            if (maxConsecutiveCritical >= 3 || (cellInfo.QoE_Rank < 2 || cellInfo.QoS_Rank < 2)) {
                workOrderList.push(item);
            }

            if (cellInfo.QoE_Rank !== null && cellInfo.QoE_Rank < 3) {
                cemBreakdownList.push(item);
            }

            if (cellInfo.QoS_Rank !== null && cellInfo.QoS_Rank < 3) {
                qosBreakdownList.push(item);
            }

            if (parseFloat(avgPrb) >= 65 || (parseFloat(avgThput) > 3 && parseFloat(avgThput) < 18)) {
                warningList.push(item);
            }
        });

        res.json({
            stats: {
                totalBad: badCellsRaw.length,
                blacklisted: blacklistedCount,
                analyzed: targetCells.length,
                workOrderCount: workOrderList.length,
                cemCount: cemBreakdownList.length,
                qosCount: qosBreakdownList.length,
                warningCount: warningList.length
            },
            data: {
                workOrderList,
                cemBreakdownList,
                qosBreakdownList,
                warningList
            }
        });

    } catch (error) {
        console.error("Lỗi API getOptimizingData:", error);
        res.status(500).json({ error: "Lỗi truy xuất hệ thống máy chủ CSDL." });
    }
};
