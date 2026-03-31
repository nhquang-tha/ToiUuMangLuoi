const db = require('../models/db');

exports.getKpiAnalyticsPage = async (req, res) => {
    const activeUser = res.locals.currentUser || req.session.user || req.user;
    res.render('kpi_analytics', { title: 'Phân Tích KPI', page: 'KPI Analytics', currentUser: activeUser });
};

exports.getKpiData = async (req, res) => {
    // Đảm bảo network luôn được viết thường và mặc định là 4g
    const network = req.query.network ? req.query.network.toLowerCase() : '4g';
    const type = req.query.type || 'keyword';
    const value = req.query.value ? req.query.value.trim() : '';

    // Lớp xác thực an toàn: Chặn lỗi HTTP 500 nếu truyền sai mạng
    if (!['3g', '4g', '5g'].includes(network)) {
        return res.status(400).json({ error: "Loại mạng không được hỗ trợ." });
    }

    let tableName = `kpi_${network}`;
    let cellColumn = (network === '4g') ? 'Cell_name' : 'Ten_CELL';

    try {
        let query = `SELECT * FROM ${tableName}`;
        let params = [];

        if (type === 'keyword' && value) {
            const values = value.split(',').map(s => s.trim()).filter(s => s);
            if (values.length === 1) {
                let siteColumn = (network === '4g') ? 'Site_name' : ((network === '5g') ? 'Ten_GNODEB' : 'Ten_RNC');
                query += ` WHERE ${cellColumn} LIKE ? OR ${siteColumn} LIKE ?`;
                params.push(`%${values[0]}%`, `%${values[0]}%`);
            } else {
                const placeholders = values.map(() => '?').join(',');
                query += ` WHERE ${cellColumn} IN (${placeholders})`;
                params.push(...values);
            }
        } else if (type === 'poi' && value) {
            if (network === '3g') return res.json([]); 
            
            const [poiCells] = await db.query(`SELECT Cell_Code FROM poi_${network} WHERE POI = ?`, [value]);
            const cellCodes = poiCells.map(c => c.Cell_Code);

            if (cellCodes.length === 0) return res.json([]);

            const placeholders = cellCodes.map(() => '?').join(',');
            query += ` WHERE ${cellColumn} IN (${placeholders})`;
            params.push(...cellCodes);
        } else {
            return res.json([]);
        }

        query += ` LIMIT 10000`; 
        
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

// ==========================================
// CÁC HÀM XỬ LÝ CHO POI REPORT
// ==========================================

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
// CÁC HÀM XỬ LÝ CHO WORST CELLS (4G)
// ==========================================

exports.getWorstCellsPage = async (req, res) => {
    const activeUser = res.locals.currentUser || req.session.user || req.user;
    res.render('worst_cells', { title: 'Worst Cells 4G', page: 'Worst Cells', currentUser: activeUser });
};

exports.getWorstCellsData = async (req, res) => {
    const days = parseInt(req.query.days) || 1;

    try {
        const [dateRows] = await db.query('SELECT DISTINCT Thoi_gian FROM kpi_4g WHERE Thoi_gian IS NOT NULL');
        if (dateRows.length === 0) return res.json([]);

        const parseDate = (d) => {
            const p = d.split('/');
            return p.length === 3 ? new Date(`${p[2]}-${p[1]}-${p[0]}`).getTime() : 0;
        };

        const validDates = dateRows.map(r => r.Thoi_gian).sort((a, b) => parseDate(b) - parseDate(a));
        const targetDates = validDates.slice(0, days);
        if (targetDates.length === 0) return res.json([]);

        const placeholders = targetDates.map(() => '?').join(',');
        
        // CHỈ LỌC CÁC CELL CÓ CELLTYPE LÀ L1800
        const query = `
            SELECT Cell_name, Thoi_gian, User_DL_Avg_Throughput_Kbps, RB_Util_Rate_DL, CQI_4G, Service_Drop_all 
            FROM kpi_4g 
            WHERE CellType LIKE '%L1800%' AND Thoi_gian IN (${placeholders})
        `;
        const [data] = await db.query(query, targetDates);

        const cellMap = {};
        data.forEach(row => {
            if (!cellMap[row.Cell_name]) cellMap[row.Cell_name] = [];
            cellMap[row.Cell_name].push(row);
        });

        const worstCells = [];
        const latestDateStr = targetDates[0];

        for (const cell in cellMap) {
            const records = cellMap[cell];
            if (records.length !== days) continue;
            
            // YÊU CẦU: Phải có mặt ở ngày mới nhất
            if (!records.some(r => r.Thoi_gian === latestDateStr)) continue;

            let isWorstAllDays = true;
            for (const row of records) {
                let rawThput = row.User_DL_Avg_Throughput_Kbps !== undefined ? row.User_DL_Avg_Throughput_Kbps : row.User_DL_Avg_Throughput_kbps;
                const thput = parseFloat(rawThput);
                const prb = parseFloat(row.RB_Util_Rate_DL);
                const cqi = parseFloat(row.CQI_4G);
                const drop = parseFloat(row.Service_Drop_all);

                const cond1 = !isNaN(thput) && thput < 7000;
                const cond2 = !isNaN(prb) && prb > 20;
                const cond3 = !isNaN(cqi) && cqi < 93;
                const cond4 = !isNaN(drop) && drop > 0.3;

                if (!(cond1 || cond2 || cond3 || cond4)) {
                    isWorstAllDays = false;
                    break; 
                }
            }

            if (isWorstAllDays) {
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
    } catch (error) { res.status(500).json({ error: "Lỗi xử lý DB" }); }
};

// ==========================================
// CÁC HÀM XỬ LÝ CHO CONGESTION 3G
// ==========================================

exports.getCongestion3gPage = async (req, res) => {
    const activeUser = res.locals.currentUser || req.session.user || req.user;
    res.render('congestion_3g', { title: 'Congestion 3G', page: 'Congestion 3G', currentUser: activeUser });
};

exports.getCongestion3gData = async (req, res) => {
    const days = parseInt(req.query.days) || 3;

    try {
        const [dateRows] = await db.query('SELECT DISTINCT Thoi_gian FROM kpi_3g WHERE Thoi_gian IS NOT NULL');
        if (dateRows.length === 0) return res.json([]);

        const parseDate = (d) => {
            const p = d.split('/');
            return p.length === 3 ? new Date(`${p[2]}-${p[1]}-${p[0]}`).getTime() : 0;
        };

        const validDates = dateRows.map(r => r.Thoi_gian).sort((a, b) => parseDate(b) - parseDate(a));
        const targetDates = validDates.slice(0, days);
        if (targetDates.length === 0) return res.json([]);

        const placeholders = targetDates.map(() => '?').join(',');
        const query = `
            SELECT Ten_CELL, Thoi_gian, CSCONGES, CS_SO_ATT, PSCONGES, PS_SO_ATT
            FROM kpi_3g 
            WHERE Thoi_gian IN (${placeholders})
        `;
        const [data] = await db.query(query, targetDates);

        const cellMap = {};
        data.forEach(row => {
            if (!cellMap[row.Ten_CELL]) cellMap[row.Ten_CELL] = [];
            cellMap[row.Ten_CELL].push(row);
        });

        const congestedCells = [];
        const latestDateStr = targetDates[0];

        for (const cell in cellMap) {
            const records = cellMap[cell];
            if (records.length !== days) continue;
            
            // YÊU CẦU: Có trong ngày mới nhất
            if (!records.some(r => r.Thoi_gian === latestDateStr)) continue;

            let isCongestedAllDays = true;
            for (const row of records) {
                const csCong = parseFloat(row.CSCONGES);
                const csAtt = parseFloat(row.CS_SO_ATT);
                const psCong = parseFloat(row.PSCONGES);
                const psAtt = parseFloat(row.PS_SO_ATT);

                const condCS = (!isNaN(csCong) && csCong > 2) && (!isNaN(csAtt) && csAtt > 100);
                const condPS = (!isNaN(psCong) && psCong > 2) && (!isNaN(psAtt) && psAtt > 500);

                if (!(condCS || condPS)) {
                    isCongestedAllDays = false;
                    break;
                }
            }

            if (isCongestedAllDays) {
                const latestRecord = records.sort((a, b) => parseDate(b.Thoi_gian) - parseDate(a.Thoi_gian))[0];
                const csCong = parseFloat(latestRecord.CSCONGES);
                const csAtt = parseFloat(latestRecord.CS_SO_ATT);
                const psCong = parseFloat(latestRecord.PSCONGES);
                const psAtt = parseFloat(latestRecord.PS_SO_ATT);

                let reasons = [];
                if ((!isNaN(csCong) && csCong > 2) && (!isNaN(csAtt) && csAtt > 100)) reasons.push(`CS CONG > 2% & CS ATT > 100`);
                if ((!isNaN(psCong) && psCong > 2) && (!isNaN(psAtt) && psAtt > 500)) reasons.push(`PS CONG > 2% & PS ATT > 500`);

                congestedCells.push({
                    Cell_name: cell,
                    Latest_Date: latestRecord.Thoi_gian,
                    CSCONGES: isNaN(csCong) ? '-' : csCong.toFixed(2),
                    CS_SO_ATT: isNaN(csAtt) ? '-' : csAtt.toFixed(0),
                    PSCONGES: isNaN(psCong) ? '-' : psCong.toFixed(2),
                    PS_SO_ATT: isNaN(psAtt) ? '-' : psAtt.toFixed(0),
                    Violations: reasons.join(' HOẶC ')
                });
            }
        }
        res.json(congestedCells);
    } catch (error) { res.status(500).json({ error: "Lỗi xử lý DB" }); }
};

// ==========================================
// CÁC HÀM XỬ LÝ CHO TRAFFIC DOWN (SUY GIẢM LƯU LƯỢNG 4G)
// ==========================================

exports.getTrafficDownPage = async (req, res) => {
    const activeUser = res.locals.currentUser || req.session.user || req.user;
    res.render('traffic_down', { title: 'Traffic Down', page: 'Traffic Down', currentUser: activeUser });
};

exports.getTrafficDownData = async (req, res) => {
    try {
        const [dateRows] = await db.query('SELECT DISTINCT Thoi_gian FROM kpi_4g WHERE Thoi_gian IS NOT NULL');
        if (dateRows.length === 0) return res.json({ error: "Không có dữ liệu 4G trong CSDL" });

        const parseDate = (d) => {
            const p = d.split('/');
            return p.length === 3 ? new Date(`${p[2]}-${p[1]}-${p[0]}`).getTime() : 0;
        };
        const formatDate = (ts) => {
            const d = new Date(ts);
            return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
        };

        const validDates = dateRows.map(r => r.Thoi_gian).sort((a, b) => parseDate(b) - parseDate(a));
        const t0_str = validDates[0];
        const t0_ts = parseDate(t0_str);

        const t7_ts = t0_ts - 7 * 86400000;
        const t7_str = formatDate(t7_ts);

        const last7DaysStrings = [];
        for (let i = 1; i <= 7; i++) {
            last7DaysStrings.push(formatDate(t0_ts - i * 86400000));
        }

        const neededDates = [t0_str, ...last7DaysStrings];
        const placeholders = neededDates.map(() => '?').join(',');

        const [kpiData] = await db.query(`
            SELECT Cell_name, CellType, Thoi_gian, Total_Data_Traffic_Volume_GB 
            FROM kpi_4g 
            WHERE Thoi_gian IN (${placeholders})
        `, neededDates);

        const [poiData] = await db.query(`SELECT Cell_Code, POI FROM poi_4g WHERE POI IS NOT NULL AND POI != ''`);
        const cellToPoi = {};
        poiData.forEach(p => cellToPoi[p.Cell_Code] = p.POI);

        const cellStats = {};
        kpiData.forEach(row => {
            const cell = row.Cell_name;
            if (!cellStats[cell]) cellStats[cell] = { t0: 0, t7: 0, sum7: 0, isL1800: false, presentInT0: false };
            
            if (row.CellType && row.CellType.includes('L1800')) {
                cellStats[cell].isL1800 = true;
            }

            const traffic = parseFloat(row.Total_Data_Traffic_Volume_GB) || 0;
            if (row.Thoi_gian === t0_str) {
                cellStats[cell].t0 = traffic;
                cellStats[cell].presentInT0 = true;
            } else {
                if (row.Thoi_gian === t7_str) {
                    cellStats[cell].t7 = traffic;
                }
                cellStats[cell].sum7 += traffic;
            }
        });

        const zeroTrafficCells = [];
        const droppedTrafficCells = [];
        const poiStats = {};

        for (const cell in cellStats) {
            const stats = cellStats[cell];
            const t0 = stats.t0;
            const t7 = stats.t7;
            const avg7 = stats.sum7 / 7; 

            // CHỈ XÉT CELL TỒN TẠI VÀ THUỘC L1800
            if (stats.presentInT0 && stats.isL1800) {
                if (t0 < 0.1 && avg7 > 2) {
                    zeroTrafficCells.push({ Cell_name: cell, t0: t0.toFixed(2), avg7: avg7.toFixed(2) });
                }
                if (t0 < 0.7 * t7 && t7 > 1) {
                    droppedTrafficCells.push({ Cell_name: cell, t0: t0.toFixed(2), t7: t7.toFixed(2), ratio: ((t0 / t7) * 100).toFixed(1) });
                }
            }

            const poi = cellToPoi[cell];
            if (poi) {
                if (!poiStats[poi]) poiStats[poi] = { t0: 0, t7: 0 };
                poiStats[poi].t0 += t0;
                poiStats[poi].t7 += t7;
            }
        }

        const droppedTrafficPOIs = [];
        for (const poi in poiStats) {
            const t0 = poiStats[poi].t0;
            const t7 = poiStats[poi].t7;
            
            if (t7 > 0 && t0 < 0.7 * t7) {
                droppedTrafficPOIs.push({ POI: poi, t0: t0.toFixed(2), t7: t7.toFixed(2), ratio: ((t0 / t7) * 100).toFixed(1) });
            }
        }

        zeroTrafficCells.sort((a,b) => b.avg7 - a.avg7);
        droppedTrafficCells.sort((a,b) => a.ratio - b.ratio);
        droppedTrafficPOIs.sort((a,b) => a.ratio - b.ratio);

        res.json({
            latestDate: t0_str,
            lastWeekDate: t7_str,
            zeroTrafficCells,
            droppedTrafficCells,
            droppedTrafficPOIs
        });

    } catch (error) { res.status(500).json({ error: "Lỗi xử lý DB" }); }
};
