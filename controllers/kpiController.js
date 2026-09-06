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
        // [CẬP NHẬT]: Dùng LEFT JOIN với bảng rf_4g để kéo thông tin Equipment và MIMO về
        const queryBadCells = `
            SELECT q.Site_Name, q.Cell_Name, q.District, q.MIMO, q.QoE_Rank, q.QoE_Score, q.QoS_Rank, q.QoS_Score,
                   r.Equipment, r.MIMO as rf_mimo
            FROM qoe_qos q
            LEFT JOIN (
                SELECT Cell_code, MAX(Equipment) as Equipment, MAX(MIMO) as MIMO 
                FROM rf_4g 
                GROUP BY Cell_code
            ) r ON q.Cell_Name = r.Cell_code
            WHERE (q.QoE_Rank IS NOT NULL AND q.QoE_Rank < 3) 
               OR (q.QoS_Rank IS NOT NULL AND q.QoS_Rank < 3)
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
            
            // Lấy thông tin Phần cứng & MIMO từ bảng RF (nếu có), nếu không dùng dự phòng từ bảng qoe_qos
            const mimo = String(row.rf_mimo || row.MIMO || '').toUpperCase();
            const equip = String(row.Equipment || '').toUpperCase();

            // [CẬP NHẬT LOGIC]: Bổ sung luật lọc MIMO 1T1R và Thiết bị NOKIA
            const isBlacklisted = upperCell.includes('IBS') || 
                                  upperCell.includes('DAS') || 
                                  upperCell.includes('VSAT') || 
                                  upperCell.includes('BOOSTER') ||
                                  upperCell.startsWith('MBF_TH') ||
                                  upperCell.startsWith('VNP-4G') ||
                                  mimo.includes('1T1R') || 
                                  equip.includes('NOKIA');

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

        // BƯỚC 3 & 4: TRUY VẾT DỮ LIỆU KPI 7 NGÀY & DỮ LIỆU CEM
        const [datesRaw] = await db.query(`SELECT DISTINCT Thoi_gian FROM kpi_4g WHERE Thoi_gian IS NOT NULL AND Thoi_gian != ''`);
        const dates = datesRaw.map(d => d.Thoi_gian).sort((a, b) => new Date(b.split('/').reverse().join('-')) - new Date(a.split('/').reverse().join('-')));
        const targetDates = dates.slice(0, 7); 

        const placeholders = targetCells.map(() => '?').join(',');
        const datePlaceholders = targetDates.map(() => '?').join(',');

        // 3.1 Lấy dữ liệu KPI 4G
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
            } catch (kpiError) {}
        }

        // 3.2 Lấy dữ liệu chi tiết từ bảng CEM để phân rã UXI
        let cemRows = [];
        try {
            const [cRows] = await db.query(`SELECT * FROM mbb_cem WHERE Tuan = ? AND UPPER(Cell_Name) IN (${placeholders})`, [week, ...targetCells]);
            cemRows = cRows;
        } catch (e) {}

        const cemMap = {};
        cemRows.forEach(r => cemMap[r.Cell_Name.toUpperCase()] = r);

        // [MỚI] 3.3 Lấy danh sách trạm P1 Tải cao Đã Import từ hệ thống
        let p1Rows = [];
        try {
            const [pRows] = await db.query(`SELECT Cell_Name FROM p1_high_load WHERE Tuan = ?`, [week]);
            p1Rows = pRows;
        } catch (e) {}
        // Chuyển thành tập hợp Set để tra cứu tốc độ cao O(1)
        const p1Set = new Set(p1Rows.map(r => r.Cell_Name.toUpperCase()));

        let cellKpiMap = {};
        kpiRows.forEach(row => {
            const upperCell = String(row.Cell_name).toUpperCase();
            if (!cellKpiMap[upperCell]) cellKpiMap[upperCell] = [];
            cellKpiMap[upperCell].push(row);
        });

        let workOrderList = [];      
        let cemBreakdownList = [];   
        let qosBreakdownList = [];   
        let warningList = [];        

        targetCells.forEach(cellKey => {
            const cellInfo = validCellsObj[cellKey];
            const rows = cellKpiMap[cellKey] || [];
            const cemData = cemMap[cellKey] || {}; // Lấy dữ liệu CEM tương ứng

            let avgThput = 0, avgPrb = 0, avgCqi = 0, avgDrop = 0, avgErab = 100, avgLatency = 0;
            let count = rows.length;

            let dailyCriticalCount = 0;
            let consecutiveCritical = 0;
            let maxConsecutiveCritical = 0;

            let cemIssues = [];
            let qosIssues = [];
            let tier5Tags = [];

            if (count > 0) {
                let sumThput = 0, sumPrb = 0, sumCqi = 0, sumDrop = 0, sumErab = 0, sumLatency = 0;

                rows.forEach((r) => {
                    const thputMbps = (parseFloat(r.thput) || 0) / 1000;
                    const prb = parseFloat(r.prb) || 0;
                    const cqi = parseFloat(r.cqi) || 0;
                    const drop = parseFloat(r.drop_rate) || 0;
                    const erab = parseFloat(r.erab) || 100;
                    const latency = parseFloat(r.latency) || 0;
                    const cellType = String(r.CellType || '').toUpperCase();
                    const mimo = String(r.MIMO || cellInfo.MIMO || '').toUpperCase();

                    sumThput += (parseFloat(r.thput) || 0); sumPrb += prb; sumCqi += cqi; sumDrop += drop; sumErab += erab; sumLatency += latency;

                    let dailyViolations = 0;

                    // ============================================
                    // BAREM ĐÁNH GIÁ ĐỎ THEO CÔNG VĂN 6945/VNPT-CN
                    // ============================================
                    let speedThreshold = 25; 
                    if (cellType.includes('10M')) speedThreshold = 18;
                    if (cellType.includes('5M') || cellType.includes('L900')) speedThreshold = 4;
                    if (thputMbps < speedThreshold) dailyViolations++;

                    let is900 = cellType.includes('L900') || cellKey.includes('U9') || cellKey.includes('L9');
                    let cqiThreshold = 93; 
                    // THUẬT TOÁN CQI ĐỘNG MỚI
                    if (mimo.includes('4T4R')) cqiThreshold = is900 ? 90 : 95;
                    else if (mimo.includes('1T1R') || mimo.includes('1T2R')) cqiThreshold = is900 ? 86 : 92;
                    else cqiThreshold = is900 ? 88 : 93; // Default 2T2R

                    if (cqi < cqiThreshold) dailyViolations++;

                    // Ngưỡng phạt mới
                    if (prb > 60) dailyViolations++;
                    if (drop > 0.5) dailyViolations++;
                    if (erab < 99.5) dailyViolations++;

                    if (dailyViolations >= 2) {
                        dailyCriticalCount++; consecutiveCritical++;
                        if (consecutiveCritical > maxConsecutiveCritical) maxConsecutiveCritical = consecutiveCritical;
                    } else { consecutiveCritical = 0; }
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

            // ============================================
            // TẦNG 3: PHÂN RÃ BỆNH CEM UXI (Dựa trên mbb_cem)
            // ============================================
            let thputCem = parseFloat(cemData.Val_User_Download_Throughput) || 0; 
            let videoBuf = parseFloat(cemData.Val_Video_Buffering_Rate) || 0;
            let initBuf = parseFloat(cemData.Val_Init_Buffering_Time) || 0;
            let packetLoss = parseFloat(cemData.Val_Download_Packet_Loss) || 0;
            let ulLatencyCem = parseFloat(cemData.Val_Upload_Latency) || 0;
            let chatSuccess = parseFloat(cemData.Val_Chat_Success_Sending_Message) || 100;

            if ((thputCem > 0 && thputCem < 15) || videoBuf > 15 || initBuf > 10) {
                cemIssues.push(`UXI 3 (Video): Buffer >15% hoặc Init >10s`);
            } else if (parseFloat(avgThput) < 15) { // Fallback 
                cemIssues.push(`UXI 3 (Video): Tốc độ < 15Mbps`);
            }

            if (packetLoss > 1.6 || ulLatencyCem > 100) {
                cemIssues.push(`UXI 2 (Data): Packet Loss > 1.6% hoặc Độ trễ > 100ms`);
            }

            if (chatSuccess > 0 && chatSuccess < 95) {
                cemIssues.push(`UXI 1 (Chat): Gửi tin thành công < 95%`);
            }

            // ============================================
            // TẦNG 4: CHẨN ĐOÁN KỸ THUẬT QOS SQI
            // ============================================
            const cellType = String(rows[0]?.CellType || '').toUpperCase();
            const mimo = String(rows[0]?.MIMO || cellInfo.MIMO || '').toUpperCase();
            let is900 = cellType.includes('L900') || cellKey.includes('U9') || cellKey.includes('L9');

            let speedThreshold = 25; 
            if (cellType.includes('10M')) speedThreshold = 18;
            if (cellType.includes('5M') || cellType.includes('L900')) speedThreshold = 4;
            if (parseFloat(avgThput) < speedThreshold) qosIssues.push(`SQI 5 (Speed): < ${speedThreshold}Mbps`);

            let cqiThreshold = 93; 
            if (mimo.includes('4T4R')) cqiThreshold = is900 ? 90 : 95;
            else if (mimo.includes('1T1R') || mimo.includes('1T2R')) cqiThreshold = is900 ? 86 : 92;
            else cqiThreshold = is900 ? 88 : 93;
            if (parseFloat(avgCqi) < cqiThreshold) qosIssues.push(`SQI 4 (CQI): < ${cqiThreshold}% (${mimo})`);

            if (parseFloat(avgPrb) > 60) qosIssues.push(`SQI 1 (Resource): PRB > 60%`);
            if (parseFloat(avgErab) < 99.5) qosIssues.push(`SQI 2 (Setup): eRAB < 99.5%`);
            if (parseFloat(avgDrop) > 0.5) qosIssues.push(`SQI 3 (Retainability): Drop > 0.5%`);

            // ============================================
            // TẦNG 5: PHÂN LOẠI RAN SHARING & TẢI CAO (P1)
            // ============================================
            if (cellKey.startsWith('MBF_TH') || cellKey.startsWith('VNP_4G') || cellKey.startsWith('VNP-4G')) {
                tier5Tags.push('RAN Sharing');
            }
            
            // [CẬP NHẬT LỚN]: Tra cứu trực tiếp từ File Báo cáo Tải Cao hệ thống 
            if (p1Set.has(cellKey)) {
                tier5Tags.push('P1 Tải Cao');
            } else if (parseFloat(avgPrb) >= 75) {
                // Fallback dự phòng: Nếu chưa import file P1, hệ thống vẫn gắn mác P1 cho trạm có PRB trung bình 7 ngày > 75%
                tier5Tags.push('P1 Tải Cao');
            }

            let finalCemIssue = cemIssues.length > 0 ? cemIssues.join(' | ') : (cellInfo.QoE_Rank < 4 ? 'Cảnh báo CEM (Ngoài KPI)' : 'Bình thường');
            let finalQosIssue = qosIssues.length > 0 ? qosIssues.join(' | ') : (cellInfo.QoS_Rank < 4 ? 'Cảnh báo QoS (Ngoài KPI)' : 'Bình thường');

            const item = {
                Cell_Name: cellInfo.Cell_Name, Site_Name: cellInfo.Site_Name, District: cellInfo.District, MIMO: cellInfo.MIMO,
                QoE_Rank: cellInfo.QoE_Rank !== null ? cellInfo.QoE_Rank : '-',
                QoE_Score: cellInfo.QoE_Score !== null ? Number(cellInfo.QoE_Score).toFixed(2) : '-',
                QoS_Rank: cellInfo.QoS_Rank !== null ? cellInfo.QoS_Rank : '-',
                QoS_Score: cellInfo.QoS_Score !== null ? Number(cellInfo.QoS_Score).toFixed(2) : '-',
                metrics: { thput: avgThput, prb: avgPrb, cqi: avgCqi, drop_rate: avgDrop, erab: avgErab, latency: avgLatency },
                cemIssues: finalCemIssue,
                qosIssues: finalQosIssue,
                tier5Tags: tier5Tags,
                criticalDays: dailyCriticalCount, maxConsecutiveCritical: maxConsecutiveCritical
            };

            // LỌC ĐẦU RA CHO TỪNG TAB
            if (tier5Tags.includes('P1 Tải Cao') || maxConsecutiveCritical >= 3) workOrderList.push(item);
            if (cellInfo.QoE_Rank !== null && cellInfo.QoE_Rank < 4) cemBreakdownList.push(item);
            if (cellInfo.QoS_Rank !== null && cellInfo.QoS_Rank < 4) qosBreakdownList.push(item);
            if (tier5Tags.includes('RAN Sharing') || (parseFloat(avgPrb) > 60 && parseFloat(avgPrb) < 70)) warningList.push(item);
        });

        res.json({
            stats: { totalBad: badCellsRaw.length, blacklisted: blacklistedCount, analyzed: targetCells.length },
            data: { workOrderList, cemBreakdownList, qosBreakdownList, warningList }
        });

    } catch (error) {
        res.status(500).json({ error: "Lỗi truy xuất hệ thống máy chủ CSDL." });
    }
};
