const db = require('../models/db');
const xlsx = require('xlsx');

function fixSheetRange(sheet) {
    if (!sheet) return sheet;
    let range = { s: { c: 10000000, r: 10000000 }, e: { c: 0, r: 0 } };
    let hasCells = false;
    for (let key in sheet) {
        if (key[0] === '!') continue;
        try {
            let cell = xlsx.utils.decode_cell(key);
            if (cell.r < range.s.r) range.s.r = cell.r;
            if (cell.c < range.s.c) range.s.c = cell.c;
            if (cell.r > range.e.r) range.e.r = cell.r;
            if (cell.c > range.e.c) range.e.c = cell.c;
            hasCells = true;
        } catch (e) {}
    }
    if (hasCells) {
        sheet['!ref'] = xlsx.utils.encode_range(range);
    }
    return sheet;
}

function parseDateToSortableInteger(val) {
    if (!val) return 0;
    let s = String(val).trim();
    let parts = s.split('/');
    if (parts.length === 3) {
        let d = parts[0].padStart(2, '0');
        let m = parts[1].padStart(2, '0');
        let y = parts[2];
        return parseInt(`${y}${m}${d}`, 10);
    }
    return 0;
}

function integerToDDMMYYYY(intDate) {
    let s = String(intDate);
    if (s.length !== 8) return s;
    return `${s.substring(6, 8)}/${s.substring(4, 6)}/${s.substring(0, 4)}`;
}

const getInt = (val) => {
    if (val === undefined || val === null || val === "") return 0;
    let n = Number(String(val).replace(/,/g, '').trim());
    return isNaN(n) ? 0 : n;
};

const sortWeeks = (weeksArray) => {
    return weeksArray.sort((a, b) => {
        let matchA = a.match(/Tuần (\d+) \((\d+)\)/);
        let matchB = b.match(/Tuần (\d+) \((\d+)\)/);
        if (matchA && matchB) {
            if (matchA[2] !== matchB[2]) return parseInt(matchA[2]) - parseInt(matchB[2]);
            return parseInt(matchA[1]) - parseInt(matchB[1]);
        }
        return 0;
    });
};

async function getKpiHistory() {
    try {
        const [rows3g] = await db.query('SELECT DISTINCT Thoi_gian FROM kpi_3g');
        const [rows4g] = await db.query('SELECT DISTINCT Thoi_gian FROM kpi_4g');
        const [rows5g] = await db.query('SELECT DISTINCT Thoi_gian FROM kpi_5g');
        
        const [rowsQoE] = await db.query('SELECT DISTINCT Tuan FROM mbb_qoe');
        const [rowsQoS] = await db.query('SELECT DISTINCT Tuan FROM mbb_qos');

        const processHistory = (rows) => {
            let uniqueNums = [...new Set(rows.map(r => parseDateToSortableInteger(r.Thoi_gian)).filter(n => n > 0))];
            uniqueNums.sort((a, b) => a - b);
            return uniqueNums.map(n => integerToDDMMYYYY(n));
        };
        
        const processWeeks = (rows) => {
            let uniqueWeeks = [...new Set(rows.map(r => r.Tuan).filter(Boolean))];
            return sortWeeks(uniqueWeeks).reverse(); 
        };

        return { 
            kpi3g: processHistory(rows3g).reverse(), 
            kpi4g: processHistory(rows4g).reverse(), 
            kpi5g: processHistory(rows5g).reverse(),
            qoeWeeks: processWeeks(rowsQoE),
            qosWeeks: processWeeks(rowsQoS)
        };
    } catch (e) { return { kpi3g: [], kpi4g: [], kpi5g: [], qoeWeeks: [], qosWeeks: [] }; }
}

async function aggregateDashboardData() {
    try {
        console.log("⏳ Bắt đầu tính toán Dashboard bằng Node.js RAM (Cực Nhanh)...");

        const [kpi4g] = await db.query(`SELECT Thoi_gian, District_code, Cell_name, Total_Data_Traffic_Volume_GB, User_DL_Avg_Throughput_Kbps, RB_Util_Rate_DL, CQI_4G FROM kpi_4g WHERE Thoi_gian IS NOT NULL AND Thoi_gian != ''`);
        const [kpi5g] = await db.query(`SELECT Thoi_gian, Ten_CELL, Total_Data_Traffic_Volume_GB, A_User_DL_Avg_Throughput, CQI_5G FROM kpi_5g WHERE Thoi_gian IS NOT NULL AND Thoi_gian != ''`);

        const getCore = (name) => {
            if(!name) return '';
            return String(name).toUpperCase().replace(/^(3G|4G|5G)[-\s_]?/i, '').substring(0, 7);
        };

        let mapCoreToDistrict = {};
        kpi4g.forEach(r => {
            if (r.District_code) {
                mapCoreToDistrict[getCore(r.Cell_name)] = r.District_code;
            }
        });

        let globalDash = {}; 
        let distDash = {};   

        kpi4g.forEach(r => {
            let date = r.Thoi_gian;
            let dist = r.District_code;

            const add4G = (target) => {
                target.t4 += parseFloat(r.Total_Data_Traffic_Volume_GB) || 0;
                if (r.User_DL_Avg_Throughput_Kbps !== null) {
                    target.th4 += parseFloat(r.User_DL_Avg_Throughput_Kbps) || 0;
                    target.c4_th++;
                }
                if (r.RB_Util_Rate_DL !== null) {
                    target.prb4 += parseFloat(r.RB_Util_Rate_DL) || 0;
                    target.c4_prb++;
                }
                if (r.CQI_4G !== null) {
                    target.cqi4 += parseFloat(r.CQI_4G) || 0;
                    target.c4_cqi++;
                }
            };

            if (!globalDash[date]) globalDash[date] = { date, t4:0, th4:0, prb4:0, cqi4:0, c4_th:0, c4_prb:0, c4_cqi:0, t5:0, th5:0, cqi5:0, c5_th:0, c5_cqi:0 };
            add4G(globalDash[date]);

            if (dist) {
                let key = `${date}_${dist}`;
                if (!distDash[key]) distDash[key] = { date, dist, t4:0, th4:0, prb4:0, cqi4:0, c4_th:0, c4_prb:0, c4_cqi:0, t5:0, th5:0, cqi5:0, c5_th:0, c5_cqi:0 };
                add4G(distDash[key]);
            }
        });

        kpi5g.forEach(r => {
            let date = r.Thoi_gian;
            let core = getCore(r.Ten_CELL);
            let dist = mapCoreToDistrict[core]; 

            const add5G = (target) => {
                target.t5 += parseFloat(r.Total_Data_Traffic_Volume_GB) || 0;
                if (r.A_User_DL_Avg_Throughput !== null) {
                    target.th5 += parseFloat(r.A_User_DL_Avg_Throughput) || 0;
                    target.c5_th++;
                }
                if (r.CQI_5G !== null) {
                    target.cqi5 += parseFloat(r.CQI_5G) || 0;
                    target.c5_cqi++;
                }
            };

            if (!globalDash[date]) globalDash[date] = { date, t4:0, th4:0, prb4:0, cqi4:0, c4_th:0, c4_prb:0, c4_cqi:0, t5:0, th5:0, cqi5:0, c5_th:0, c5_cqi:0 };
            add5G(globalDash[date]);

            if (dist) {
                let key = `${date}_${dist}`;
                if (!distDash[key]) distDash[key] = { date, dist, t4:0, th4:0, prb4:0, cqi4:0, c4_th:0, c4_prb:0, c4_cqi:0, t5:0, th5:0, cqi5:0, c5_th:0, c5_cqi:0 };
                add5G(distDash[key]);
            }
        });

        const avg = (sum, count) => count > 0 ? (sum / count) : 0;

        let insertGlobal = [];
        for (let d in globalDash) {
            let row = globalDash[d];
            insertGlobal.push([
                row.date,
                row.t4, avg(row.th4, row.c4_th), avg(row.prb4, row.c4_prb), avg(row.cqi4, row.c4_cqi),
                row.t5, avg(row.th5, row.c5_th), avg(row.cqi5, row.c5_cqi)
            ]);
        }

        let insertDist = [];
        for (let k in distDash) {
            let row = distDash[k];
            insertDist.push([
                row.date, row.dist,
                row.t4, avg(row.th4, row.c4_th), avg(row.prb4, row.c4_prb), avg(row.cqi4, row.c4_cqi),
                row.t5, avg(row.th5, row.c5_th), avg(row.cqi5, row.c5_cqi)
            ]);
        }

        if (insertGlobal.length > 0) {
            await db.query(`
                INSERT INTO Dashboard (thoi_gian, sum_TRAFFIC_4G, AVG_USER_DL_AVG_THPUT_4G, AVG_RES_BLK_DL_4G, AVG_CQI_4G, sum_TRAFFIC_5G, AVG_USER_DL_AVG_THPUT_5G, AVG_CQI_5G)
                VALUES ?
                ON DUPLICATE KEY UPDATE 
                    sum_TRAFFIC_4G=VALUES(sum_TRAFFIC_4G), AVG_USER_DL_AVG_THPUT_4G=VALUES(AVG_USER_DL_AVG_THPUT_4G), 
                    AVG_RES_BLK_DL_4G=VALUES(AVG_RES_BLK_DL_4G), AVG_CQI_4G=VALUES(AVG_CQI_4G),
                    sum_TRAFFIC_5G=VALUES(sum_TRAFFIC_5G), AVG_USER_DL_AVG_THPUT_5G=VALUES(AVG_USER_DL_AVG_THPUT_5G), AVG_CQI_5G=VALUES(AVG_CQI_5G)
            `, [insertGlobal]);
        }

        if (insertDist.length > 0) {
            await db.query(`
                INSERT INTO district_dashboard (thoi_gian, district, sum_TRAFFIC_4G, AVG_USER_DL_AVG_THPUT_4G, AVG_RES_BLK_DL_4G, AVG_CQI_4G, sum_TRAFFIC_5G, AVG_USER_DL_AVG_THPUT_5G, AVG_CQI_5G)
                VALUES ?
                ON DUPLICATE KEY UPDATE 
                    sum_TRAFFIC_4G=VALUES(sum_TRAFFIC_4G), AVG_USER_DL_AVG_THPUT_4G=VALUES(AVG_USER_DL_AVG_THPUT_4G), 
                    AVG_RES_BLK_DL_4G=VALUES(AVG_RES_BLK_DL_4G), AVG_CQI_4G=VALUES(AVG_CQI_4G),
                    sum_TRAFFIC_5G=VALUES(sum_TRAFFIC_5G), AVG_USER_DL_AVG_THPUT_5G=VALUES(AVG_USER_DL_AVG_THPUT_5G), AVG_CQI_5G=VALUES(AVG_CQI_5G)
            `, [insertDist]);
        }
        console.log("✅ Đồng bộ Dashboard thành công!");
    } catch (e) {
        console.error("❌ Lỗi aggregateDashboardData:", e);
    }
}

// ========================================================
// [CÔNG CỤ MỚI] ĐỒNG BỘ CACHE BẢNG CẢNH BÁO
// Tự động tính toán các kịch bản lỗi và lưu sẵn vào DB
// ========================================================

async function syncWorstCells() {
    try {
        console.log("⏳ Bắt đầu tính toán cache Worst Cells 4G...");
        await db.query('TRUNCATE TABLE worst_cells');
        const [datesRaw] = await db.query('SELECT DISTINCT Thoi_gian FROM kpi_4g WHERE Thoi_gian IS NOT NULL AND Thoi_gian != ""');
        if (datesRaw.length === 0) return;
        
        let uniqueDates = datesRaw.map(r => r.Thoi_gian).sort((a, b) => new Date(b.split('/').reverse().join('-')) - new Date(a.split('/').reverse().join('-')));
        
        const daysList = [1, 3, 7, 15, 30];
        for (let days of daysList) {
            const targetDates = uniqueDates.slice(0, days);
            if (targetDates.length === 0) continue;
            const placeholders = targetDates.map(() => '?').join(',');
            
            const query = `
                SELECT Cell_name, MAX(Thoi_gian) as Latest_Date,
                    AVG(User_DL_Avg_Throughput_Kbps) as User_DL_Avg_Throughput_Kbps, 
                    AVG(RB_Util_Rate_DL) as RB_Util_Rate_DL, AVG(CQI_4G) as CQI_4G, AVG(Service_Drop_all) as Service_Drop_all,
                    COUNT(Thoi_gian) as So_Ngay_Vi_Pham,
                    SUM(CASE WHEN Thoi_gian = ? THEN 1 ELSE 0 END) as is_in_t0
                FROM kpi_4g WHERE Thoi_gian IN (${placeholders}) 
                AND (CellType IS NULL OR CellType NOT LIKE '%L900%') AND (Cell_name NOT LIKE 'MBF_TH%')
                AND (User_DL_Avg_Throughput_Kbps < 7000 OR RB_Util_Rate_DL > 20 OR CQI_4G < 93 OR Service_Drop_all > 0.3)
                GROUP BY Cell_name HAVING So_Ngay_Vi_Pham >= ? AND is_in_t0 > 0
            `;
            const [rows] = await db.query(query, [targetDates[0], ...targetDates, days]);
            
            let insertData = [];
            rows.forEach(r => {
                let vios = [];
                if (r.User_DL_Avg_Throughput_Kbps < 7000) vios.push('Thput Thấp');
                if (r.RB_Util_Rate_DL > 20) vios.push('PRB Cao');
                if (r.CQI_4G < 93) vios.push('CQI Thấp');
                if (r.Service_Drop_all > 0.3) vios.push('Drop Rate Cao');
                
                insertData.push([
                    r.Latest_Date, days, r.Cell_name, 
                    parseFloat(r.User_DL_Avg_Throughput_Kbps), 
                    parseFloat(r.RB_Util_Rate_DL), 
                    parseFloat(r.CQI_4G), 
                    parseFloat(r.Service_Drop_all), 
                    vios.join(', ') || 'Vi phạm KPI'
                ]);
            });
            
            if (insertData.length > 0) {
                const chunkSize = 500;
                for (let i = 0; i < insertData.length; i += chunkSize) {
                    await db.query(`INSERT INTO worst_cells (latest_date, days_filter, cell_name, thput, prb, cqi, drop_rate, violations) VALUES ?`, [insertData.slice(i, i + chunkSize)]);
                }
            }
        }
        console.log("✅ Đồng bộ Cache Worst Cells thành công!");
    } catch (e) {
        console.error("❌ Lỗi syncWorstCells:", e);
    }
}

async function syncCongestion3G() {
    try {
        console.log("⏳ Bắt đầu tính toán cache Congestion 3G...");
        await db.query('TRUNCATE TABLE congestion_3g');
        const [datesRaw] = await db.query('SELECT DISTINCT Thoi_gian FROM kpi_3g WHERE Thoi_gian IS NOT NULL AND Thoi_gian != ""');
        if(datesRaw.length === 0) return;
        
        let uniqueDates = datesRaw.map(r => r.Thoi_gian).sort((a, b) => new Date(b.split('/').reverse().join('-')) - new Date(a.split('/').reverse().join('-'))); 
        
        const daysList = [1, 3, 5, 7];
        for (let days of daysList) {
            const targetDates = uniqueDates.slice(0, days);
            if (targetDates.length === 0) continue;
            const placeholders = targetDates.map(() => '?').join(',');

            const query = `
                SELECT Ten_CELL as Cell_name, MAX(Thoi_gian) as Latest_Date,
                    AVG(CSCONGES) as CSCONGES, AVG(CS_SO_ATT) as CS_SO_ATT, AVG(PSCONGES) as PSCONGES, AVG(PS_SO_ATT) as PS_SO_ATT,
                    COUNT(Thoi_gian) as So_Ngay_Vi_Pham,
                    SUM(CASE WHEN Thoi_gian = ? THEN 1 ELSE 0 END) as is_in_t0
                FROM kpi_3g WHERE Thoi_gian IN (${placeholders}) AND ((CSCONGES > 2 AND CS_SO_ATT > 100) OR (PSCONGES > 2 AND PS_SO_ATT > 500))
                GROUP BY Ten_CELL HAVING So_Ngay_Vi_Pham >= ? AND is_in_t0 > 0
            `;
            const [rows] = await db.query(query, [targetDates[0], ...targetDates, days]);
            
            let insertData = [];
            rows.forEach(r => {
                let vios = [];
                if (r.CSCONGES > 2 && r.CS_SO_ATT > 100) vios.push('Nghẽn CS');
                if (r.PSCONGES > 2 && r.PS_SO_ATT > 500) vios.push('Nghẽn PS');
                
                insertData.push([
                    r.Latest_Date, days, r.Cell_name,
                    parseFloat(r.CSCONGES), Math.round(r.CS_SO_ATT),
                    parseFloat(r.PSCONGES), Math.round(r.PS_SO_ATT),
                    vios.join(', ') || 'Nghẽn mạng'
                ]);
            });

            if (insertData.length > 0) {
                const chunkSize = 500;
                for (let i = 0; i < insertData.length; i += chunkSize) {
                    await db.query(`INSERT INTO congestion_3g (latest_date, days_filter, cell_name, cs_conges, cs_att, ps_conges, ps_att, violations) VALUES ?`, [insertData.slice(i, i + chunkSize)]);
                }
            }
        }
        console.log("✅ Đồng bộ Cache Congestion 3G thành công!");
    } catch (e) {
        console.error("❌ Lỗi syncCongestion3G:", e);
    }
}

async function syncTrafficDown() {
    try {
        console.log("⏳ Bắt đầu tính toán cache Traffic Down...");
        await db.query('TRUNCATE TABLE traffic_down');
        
        const [datesRaw] = await db.query(`SELECT DISTINCT Thoi_gian FROM kpi_4g WHERE Thoi_gian IS NOT NULL`);
        const dates = datesRaw.map(d => d.Thoi_gian).sort((a, b) => {
            const pA = a.split('/'); const pB = b.split('/');
            return new Date(`${pB[2]}-${pB[1]}-${pB[0]}`) - new Date(`${pA[2]}-${pA[1]}-${pA[0]}`);
        });

        if (dates.length < 10) return; 

        const targetDates = dates.slice(0, 10);
        const [t0, t1, t2, t3, t4, t5, t6, t7, t8, t9] = targetDates;
        const placeholders = targetDates.map(() => '?').join(',');

        const [data3g] = await db.query(`SELECT Ten_CELL as Cell_name, Thoi_gian, TRAFFIC as traffic FROM kpi_3g WHERE Thoi_gian IN (${placeholders})`, targetDates);
        const [data4g] = await db.query(`SELECT Cell_name, Thoi_gian, Total_Data_Traffic_Volume_GB as traffic FROM kpi_4g WHERE Thoi_gian IN (${placeholders})`, targetDates);
        const [data5g] = await db.query(`SELECT Ten_CELL as Cell_name, Thoi_gian, Total_Data_Traffic_Volume_GB as traffic FROM kpi_5g WHERE Thoi_gian IN (${placeholders})`, targetDates);

        const [poi4g] = await db.query('SELECT Cell_Code, POI FROM poi_4g');
        const [poi5g] = await db.query('SELECT Cell_Code, POI FROM poi_5g');
        const cellToPoi = {};
        poi4g.forEach(r => cellToPoi[r.Cell_Code] = r.POI);
        poi5g.forEach(r => cellToPoi[r.Cell_Code] = r.POI);

        let zeroTrafficCells = [];
        let droppedTrafficCells = [];
        let poiTrafficMap = {}; 

        const analyzeData = (dataArray, network) => {
            const cellMap = {};
            const activeCellsToday = new Set();
            
            dataArray.forEach(row => {
                if (!cellMap[row.Cell_name]) cellMap[row.Cell_name] = {};
                cellMap[row.Cell_name][row.Thoi_gian] = parseFloat(row.traffic) || 0;
                
                if (row.Thoi_gian === t0) activeCellsToday.add(row.Cell_name);

                if (network === '4g' || network === '5g') {
                    let poi = cellToPoi[row.Cell_name];
                    if (poi) {
                        if (!poiTrafficMap[poi]) poiTrafficMap[poi] = {};
                        if (!poiTrafficMap[poi][row.Thoi_gian]) poiTrafficMap[poi][row.Thoi_gian] = 0;
                        poiTrafficMap[poi][row.Thoi_gian] += parseFloat(row.traffic) || 0;
                    }
                }
            });

            for (let cell of activeCellsToday) {
                const c = cellMap[cell];
                const v0 = c[t0] || 0; const v1 = c[t1] || 0; const v2 = c[t2] || 0;
                const v3 = c[t3] || 0; const v4 = c[t4] || 0; const v5 = c[t5] || 0;
                const v6 = c[t6] || 0; const v7 = c[t7] || 0; const v8 = c[t8] || 0; const v9 = c[t9] || 0;

                const avg7 = (v1 + v2 + v3 + v4 + v5 + v6 + v7) / 7;

                if (v0 === 0 && avg7 > 0) {
                    zeroTrafficCells.push({ Cell_name: cell, network: network, t0: v0.toFixed(2), avg7: avg7.toFixed(2) });
                }

                if ((network === '4g' || network === '5g') && v7 > 5 && v0 < 0.7 * v7 && v1 < 0.7 * v8 && v2 < 0.7 * v9) {
                    droppedTrafficCells.push({ Cell_name: cell, network: network, t0: v0.toFixed(2), t7: v7.toFixed(2), ratio: Math.round((v0/v7)*100) });
                }
            }
        };

        analyzeData(data3g, '3g');
        analyzeData(data4g, '4g');
        analyzeData(data5g, '5g');

        let activePOIsToday = new Set();
        data4g.concat(data5g).forEach(row => {
            if (row.Thoi_gian === t0 && cellToPoi[row.Cell_name]) {
                activePOIsToday.add(cellToPoi[row.Cell_name]);
            }
        });

        let droppedTrafficPOIs = [];
        for (let poi of activePOIsToday) {
            const p = poiTrafficMap[poi];
            const v0 = p[t0] || 0; const v1 = p[t1] || 0; const v2 = p[t2] || 0;
            const v7 = p[t7] || 0; const v8 = p[t8] || 0; const v9 = p[t9] || 0;

            if (v7 > 0 && v0 < 0.7 * v7 && v1 < 0.7 * v8 && v2 < 0.7 * v9) {
                droppedTrafficPOIs.push({ POI: poi, t0: v0.toFixed(2), t7: v7.toFixed(2), ratio: Math.round((v0/v7)*100) });
            }
        }
        
        let insertData = [];
        zeroTrafficCells.forEach(r => insertData.push([t0, t7, 'zero_cell', r.network, r.Cell_name, r.t0, r.avg7, 0]));
        droppedTrafficCells.forEach(r => insertData.push([t0, t7, 'dropped_cell', r.network, r.Cell_name, r.t0, r.t7, r.ratio]));
        droppedTrafficPOIs.forEach(r => insertData.push([t0, t7, 'dropped_poi', '4g_5g', r.POI, r.t0, r.t7, r.ratio]));

        if (insertData.length > 0) {
            const chunkSize = 500;
            for (let i = 0; i < insertData.length; i += chunkSize) {
                await db.query(`INSERT INTO traffic_down (latest_date, last_week_date, category, network, name, val_t0, val_compare, ratio) VALUES ?`, [insertData.slice(i, i + chunkSize)]);
            }
        }
        console.log("✅ Đồng bộ Cache Traffic Down thành công!");
    } catch (e) {
        console.error("❌ Lỗi syncTrafficDown:", e);
    }
}

async function syncQoeQosSummary() {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS qoe_qos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                Site_Name VARCHAR(150), Cell_Name VARCHAR(150) UNIQUE,
                District VARCHAR(100), MIMO VARCHAR(50),
                QoE_Rank FLOAT, QoE_Score FLOAT, QoE_Trend FLOAT,
                QoS_Rank FLOAT, QoS_Score FLOAT, QoS_Trend FLOAT,
                lich_su_tac_dong TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS cell_notes (
                cell_name VARCHAR(255) PRIMARY KEY, note_text TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        const [cellsKpi] = await db.query(`SELECT Cell_name, MAX(District_code) as District_code, MAX(MIMO) as MIMO FROM kpi_4g WHERE Cell_name IS NOT NULL AND Cell_name != '' GROUP BY Cell_name`);
        const kpiMap = {};
        cellsKpi.forEach(c => kpiMap[c.Cell_name] = c);

        const [qoe] = await db.query('SELECT Site_Name, Cell_Name, Tuan, QoE_Rank, QoE_Score FROM mbb_qoe');
        const [qos] = await db.query('SELECT Site_Name, Cell_Name, Tuan, QoS_Rank, QoS_Score FROM mbb_qos');
        const [notes] = await db.query('SELECT cell_name, note_text FROM cell_notes');
        
        const noteMap = {}; notes.forEach(n => noteMap[n.cell_name] = n.note_text);

        let qoeMap = {}; let qoeWeeksSet = new Set();
        qoe.forEach(r => {
            if(!qoeMap[r.Cell_Name]) qoeMap[r.Cell_Name] = {};
            qoeMap[r.Cell_Name][r.Tuan] = { rank: r.QoE_Rank, score: r.QoE_Score };
            qoeWeeksSet.add(r.Tuan);
        });
        
        let sortedQoeWeeks = sortWeeks(Array.from(qoeWeeksSet)).reverse();

        let qosMap = {}; let qosWeeksSet = new Set();
        qos.forEach(r => {
            if(!qosMap[r.Cell_Name]) qosMap[r.Cell_Name] = {};
            qosMap[r.Cell_Name][r.Tuan] = { rank: r.QoS_Rank, score: r.QoS_Score };
            qosWeeksSet.add(r.Tuan);
        });
        
        let sortedQosWeeks = sortWeeks(Array.from(qosWeeksSet)).reverse();

        let latestQoeWeek = sortedQoeWeeks.length > 0 ? sortedQoeWeeks[0] : null;
        let latestQosWeek = sortedQosWeeks.length > 0 ? sortedQosWeeks[0] : null;

        let cellBaseMap = {};
        qoe.forEach(r => {
            if (r.Tuan === latestQoeWeek && r.Cell_Name) {
                cellBaseMap[r.Cell_Name] = r.Site_Name || '';
            }
        });
        qos.forEach(r => {
            if (r.Tuan === latestQosWeek && r.Cell_Name) {
                cellBaseMap[r.Cell_Name] = r.Site_Name || cellBaseMap[r.Cell_Name] || '';
            }
        });

        let insertData = [];
        Object.keys(cellBaseMap).forEach(cellName => {
            let siteName = cellBaseMap[cellName];
            let district = kpiMap[cellName] ? (kpiMap[cellName].District_code || '') : '';
            let mimo = kpiMap[cellName] ? (kpiMap[cellName].MIMO || '') : '';

            let qoeRank = null, qoeScore = null, qoeTrend = 0;
            let qosRank = null, qosScore = null, qosTrend = 0;

            if (qoeMap[cellName] && sortedQoeWeeks.length > 0) {
                let latestData = qoeMap[cellName][sortedQoeWeeks[0]];
                if (latestData) {
                    qoeRank = latestData.rank; qoeScore = parseFloat(latestData.score) || 0;
                    let prevSum = 0; let prevCount = 0;
                    for(let i = 1; i <= 4; i++) {
                        if(sortedQoeWeeks[i] && qoeMap[cellName][sortedQoeWeeks[i]]) {
                            prevSum += parseFloat(qoeMap[cellName][sortedQoeWeeks[i]].score) || 0;
                            prevCount++;
                        }
                    }
                    if (prevCount > 0) qoeTrend = qoeScore - (prevSum / prevCount);
                }
            }

            if (qosMap[cellName] && sortedQosWeeks.length > 0) {
                let latestData = qosMap[cellName][sortedQosWeeks[0]];
                if (latestData) {
                    qosRank = latestData.rank; qosScore = parseFloat(latestData.score) || 0;
                    let prevSum = 0; let prevCount = 0;
                    for(let i = 1; i <= 4; i++) {
                        if(sortedQosWeeks[i] && qosMap[cellName][sortedQosWeeks[i]]) {
                            prevSum += parseFloat(qosMap[cellName][sortedQosWeeks[i]].score) || 0;
                            prevCount++;
                        }
                    }
                    if (prevCount > 0) qosTrend = qosScore - (prevSum / prevCount);
                }
            }

            insertData.push([
                siteName, cellName, district, mimo,
                qoeRank, qoeScore, qoeTrend, qosRank, qosScore, qosTrend,
                noteMap[cellName] || ''
            ]);
        });

        await db.query('TRUNCATE TABLE qoe_qos');
        if (insertData.length > 0) {
            const chunkSize = 500;
            for (let i = 0; i < insertData.length; i += chunkSize) {
                let chunk = insertData.slice(i, i + chunkSize);
                await db.query(`
                    INSERT INTO qoe_qos (Site_Name, Cell_Name, District, MIMO, QoE_Rank, QoE_Score, QoE_Trend, QoS_Rank, QoS_Score, QoS_Trend, lich_su_tac_dong)
                    VALUES ?
                `, [chunk]);
            }
        }
        console.log("Đồng bộ bảng tổng hợp QoE/QoS thành công!");
    } catch (e) {
        console.error("Lỗi đồng bộ bảng qoe_qos:", e);
    }
}

const formatExcelDate = (excelDate) => {
    if (typeof excelDate === 'number') {
        const date = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
        const d = String(date.getDate()).padStart(2, '0');
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const y = date.getFullYear();
        return `${d}/${m}/${y}`;
    }
    return excelDate; 
};

const normalizeStr = (str) => {
    if (!str) return '';
    return String(str).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, ''); 
};

exports.renderPage = (pageName) => {
    return (req, res) => {
        let userRole = req.session && req.session.user ? req.session.user.role : 'user';
        res.render(pageName.toLowerCase().replace(/ /g, '_'), { title: pageName, page: pageName, userRole: userRole });
    };
};

exports.getImportPage = async (req, res) => {
    let userRole = req.session && req.session.user ? req.session.user.role : 'user';
    let history = await getKpiHistory();
    res.render('import_data', { title: 'Import Data', page: 'Import Data', userRole: userRole, history: history, message: null, error: null });
};

exports.handleImportData = async (req, res) => {
    let userRole = req.session && req.session.user ? req.session.user.role : 'user';
    let history = await getKpiHistory();
    
    if (userRole !== 'admin') {
        return res.status(403).send("Chỉ Admin mới có quyền thực hiện chức năng này.");
    }

    if (!req.files || req.files.length === 0) {
        return res.render('import_data', { title: 'Import Data', page: 'Import Data', userRole: userRole, history: history, message: null, error: 'Vui lòng chọn ít nhất 1 file.' });
    }

    const networkType = req.body.networkType; 
    let isKpiImported = networkType.startsWith('kpi_');

    let weekPrefix = "";
    if (networkType === 'mbb_qoe' || networkType === 'mbb_qos') {
        const wNum = req.body.weekNumber;
        const wYear = req.body.year;
        if(wNum && wYear) weekPrefix = `Tuần ${wNum} (${wYear})`;
    }

    let totalImported = 0;
    let errorLogs = [];

    let dbCols = [];
    try {
        const [cols] = await db.query(`SHOW COLUMNS FROM ${networkType}`);
        dbCols = cols.map(c => ({ original: c.Field, norm: normalizeStr(c.Field) }));
    } catch (e) {
        errorLogs.push(`Không tìm thấy bảng ${networkType} trong CSDL.`);
        return res.render('import_data', { title: 'Import Data', page: 'Import Data', userRole: userRole, history: history, message: null, error: errorLogs.join(' | ') });
    }

    if (weekPrefix && (networkType === 'mbb_qoe' || networkType === 'mbb_qos')) {
        try { await db.query(`DELETE FROM ${networkType} WHERE Tuan = ?`, [weekPrefix]); } catch (e) {}
    }

    if (networkType === 'poi_4g' || networkType === 'poi_5g' || networkType === 'csht_data' || networkType === 'alarm_data' || networkType === 'vat_tu') {
        try { await db.query(`TRUNCATE TABLE ${networkType}`); } catch (e) {}
    }

    for (const file of req.files) {
        try {
            const workbook = xlsx.read(file.buffer, { type: 'buffer', raw: true });
            const sheetName = workbook.SheetNames[0];
            let sheet = workbook.Sheets[sheetName];
            sheet = fixSheetRange(sheet); 

            let rawData = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
            if (rawData.length === 0) continue;

            let headerRowIdx = -1;
            let dataStartIdx = -1;

            if (networkType === 'mbb_qoe') {
                headerRowIdx = 4; dataStartIdx = 5;
            } else if (networkType === 'mbb_qos') {
                headerRowIdx = 4; dataStartIdx = 9;
            } else {
                for (let i = 0; i < Math.min(20, rawData.length); i++) {
                    const rowStr = JSON.stringify(rawData[i]).toLowerCase();
                    if (rowStr.includes('thoi gian') || rowStr.includes('thời gian') ||
                        rowStr.includes('tên cell') || rowStr.includes('cell name') ||
                        rowStr.includes('site name') || rowStr.includes('cell_code') || 
                        rowStr.includes('tuan') || rowStr.includes('tuần') || 
                        rowStr.includes('poi') || rowStr.includes('mã csht') ||
                        rowStr.includes('từ khóa chính') || rowStr.includes('nguyên nhân') ||
                        rowStr.includes('mã thiết bị') || rowStr.includes('loại card') || rowStr.includes('mã vt') || rowStr.includes('part number')) {
                        headerRowIdx = i; dataStartIdx = i + 1; break;
                    }
                }
            }

            if (headerRowIdx === -1 || !rawData[headerRowIdx]) continue;

            const excelHeaders = rawData[headerRowIdx];
            const headerString = excelHeaders.map(String).join(' ').toLowerCase();

            let validationError = null;
            if (networkType === 'kpi_3g') {
                if (headerString.includes('cqi') || headerString.includes('enodeb') || headerString.includes('gnodeb')) {
                    validationError = '❌ LỖI: Bạn chọn mục "Import KPI 3G" nhưng lại tải lên file KPI của mạng 4G/5G. Vui lòng kiểm tra lại file!';
                }
            } else if (networkType === 'kpi_4g') {
                if (headerString.includes('cqi 5g') || headerString.includes('cqi_5g') || headerString.includes('gnodeb')) {
                    validationError = '❌ LỖI: Bạn chọn mục "Import KPI 4G" nhưng lại tải lên file KPI của mạng 5G. Vui lòng kiểm tra lại file!';
                } else if (headerString.includes('cs_so_att') || headerString.includes('psconges')) {
                    validationError = '❌ LỖI: Bạn chọn mục "Import KPI 4G" nhưng lại tải lên file KPI của mạng 3G. Vui lòng kiểm tra lại file!';
                }
            } else if (networkType === 'kpi_5g') {
                if (headerString.includes('cqi 4g') || headerString.includes('cqi_4g') || headerString.includes('enodeb') || headerString.includes('celltype')) {
                    validationError = '❌ LỖI: Bạn chọn mục "Import KPI 5G" nhưng lại tải lên file KPI của mạng 4G. Vui lòng kiểm tra lại file!';
                } else if (headerString.includes('cs_so_att') || headerString.includes('psconges')) {
                    validationError = '❌ LỖI: Bạn chọn mục "Import KPI 5G" nhưng lại tải lên file KPI của mạng 3G. Vui lòng kiểm tra lại file!';
                }
            } else if (networkType === 'mbb_qoe') {
                if (headerString.includes('qos_score') || headerString.includes('qos rank') || headerString.includes('qos_rank')) {
                    validationError = '❌ LỖI: Bạn chọn mục "Import Trải nghiệm (QoE)" nhưng lại tải lên file Dịch vụ (QoS). Vui lòng kiểm tra lại file!';
                }
            } else if (networkType === 'mbb_qos') {
                if (headerString.includes('qoe_score') || headerString.includes('qoe rank') || headerString.includes('qoe_rank')) {
                    validationError = '❌ LỖI: Bạn chọn mục "Import Dịch vụ (QoS)" nhưng lại tải lên file Trải nghiệm (QoE). Vui lòng kiểm tra lại file!';
                }
            }

            if (validationError) {
                return res.render('import_data', { 
                    title: 'Import Data', page: 'Import Data', userRole: userRole, history: history, message: null, error: validationError 
                });
            }

            let colMapping = [];

            if (networkType === 'mbb_qoe') {
                colMapping = [
                    { excelIdx: 0, dbCol: 'Ma_Tinh' }, { excelIdx: 1, dbCol: 'Don_Vi' }, { excelIdx: 2, dbCol: 'Phuong_Xa' },
                    { excelIdx: 3, dbCol: 'Site_Name' }, { excelIdx: 4, dbCol: 'Cell_Name' }, { excelIdx: 5, dbCol: 'Cell_ID' },
                    { excelIdx: 6, dbCol: 'QoE_Score' }, { excelIdx: 7, dbCol: 'QoE_Rank' },
                    { excelIdx: 8, dbCol: 'Norm_Speed' }, { excelIdx: 9, dbCol: 'Norm_Latency' }, { excelIdx: 10, dbCol: 'Norm_Jitter' }, { excelIdx: 11, dbCol: 'Norm_PacketLoss' },
                    { excelIdx: 12, dbCol: 'Point_Speed' }, { excelIdx: 13, dbCol: 'Point_Latency' }, { excelIdx: 14, dbCol: 'Point_Jitter' }, { excelIdx: 15, dbCol: 'Point_PacketLoss' },
                    { excelIdx: 16, dbCol: 'Out_Speed' }, { excelIdx: 17, dbCol: 'Out_Latency' }, { excelIdx: 18, dbCol: 'Out_Jitter' }, { excelIdx: 19, dbCol: 'Out_PacketLoss' },
                    { excelIdx: 20, dbCol: 'In_Speed' }, { excelIdx: 21, dbCol: 'In_Latency' }, { excelIdx: 22, dbCol: 'In_Jitter' }, { excelIdx: 23, dbCol: 'In_PacketLoss' }
                ];
            } else if (networkType === 'mbb_qos') {
                colMapping = [
                    { excelIdx: 0, dbCol: 'Ma_Tinh' }, { excelIdx: 1, dbCol: 'Don_Vi' }, { excelIdx: 2, dbCol: 'Phuong_Xa' },
                    { excelIdx: 3, dbCol: 'Site_Name' }, { excelIdx: 4, dbCol: 'Cell_Name' }, { excelIdx: 5, dbCol: 'Cell_ID' },
                    { excelIdx: 6, dbCol: 'QoS_Rank' }, { excelIdx: 7, dbCol: 'QoS_Score' },
                    { excelIdx: 8, dbCol: 'Norm_Res' }, { excelIdx: 9, dbCol: 'Norm_Acc' }, { excelIdx: 10, dbCol: 'Norm_Ret' }, { excelIdx: 11, dbCol: 'Norm_Int' }, { excelIdx: 12, dbCol: 'Norm_Cov' },
                    { excelIdx: 13, dbCol: 'Point_Res' }, { excelIdx: 14, dbCol: 'Point_Acc' }, { excelIdx: 15, dbCol: 'Point_Ret' }, { excelIdx: 16, dbCol: 'Point_Int' }, { excelIdx: 17, dbCol: 'Point_Cov' },
                    { excelIdx: 18, dbCol: 'Out_Res' }, { excelIdx: 19, dbCol: 'Out_Acc' }, { excelIdx: 20, dbCol: 'Out_Ret' }, { excelIdx: 21, dbCol: 'Out_Int' }, { excelIdx: 22, dbCol: 'Out_Cov' },
                    { excelIdx: 23, dbCol: 'In_Res' }, { excelIdx: 24, dbCol: 'In_Acc' }, { excelIdx: 25, dbCol: 'In_Ret' }, { excelIdx: 26, dbCol: 'In_Int' }, { excelIdx: 27, dbCol: 'In_Cov' }
                ];
            } else {
                excelHeaders.forEach((exHeader, idx) => {
                    let h = String(exHeader).toLowerCase().replace(/[\ufeff\u200b]/g, '').trim();
                    let mappedCol = null;

                    if (networkType === 'kpi_3g') {
                        if (h.includes('tên cell') || h === 'tên cell' || h.includes('cell name') || h === 'ten_cell') mappedCol = 'Ten_CELL';
                        else if (h === 'ci' || h === 'cell id') mappedCol = 'CI';
                        else if (h.includes('thời gian') || h.includes('thoi gian')) mappedCol = 'Thoi_gian';
                        else if (h.includes('cs_so_att')) mappedCol = 'CS_SO_ATT';
                        else if (h.includes('ps_so_att')) mappedCol = 'PS_SO_ATT';
                        else if (h.includes('cs_rab congestion')) mappedCol = 'CSCONGES';
                        else if (h.includes('ps_rab congestion')) mappedCol = 'PSCONGES';
                        else if (h.includes('cs_total traffic') || h === 'traffic') mappedCol = 'TRAFFIC';
                        else if (h.includes('cs_call setup success')) mappedCol = 'CSSR';
                        else if (h.includes('cs_drop call')) mappedCol = 'DCR';
                    } 
                    else if (networkType === 'kpi_4g') {
                        if (h.includes('site name')) mappedCol = 'Site_name';
                        else if (h.includes('celltype')) mappedCol = 'CellType';
                        else if (h.includes('district code')) mappedCol = 'District_code';
                        else if (h.includes('cell name')) mappedCol = 'Cell_name';
                        else if (h.includes('mimo')) mappedCol = 'MIMO';
                        else if (h.includes('thời gian') || h.includes('thoi gian')) mappedCol = 'Thoi_gian';
                        else if (h.includes('user downlink average')) mappedCol = 'User_DL_Avg_Throughput_Kbps';
                        else if (h.includes('user uplink average')) mappedCol = 'User_UL_Avg_Throughput_Kbps';
                        else if (h.includes('utilizing rate downlink') || h.includes('untilizing rate downlink')) mappedCol = 'RB_Util_Rate_DL';
                        else if (h.includes('utilizing rate uplink') || h.includes('untilizing rate uplink')) mappedCol = 'RB_Util_Rate_UL';
                        else if (h.includes('total data traffic')) mappedCol = 'Total_Data_Traffic_Volume_GB';
                        else if (h.includes('cqi_4g') || h.includes('cqi 4g') || h === 'cqi') mappedCol = 'CQI_4G';
                        else if (h.includes('service drop')) mappedCol = 'Service_Drop_all';
                        else if (h.includes('erab setup success') || h.includes('e-rab')) mappedCol = 'eRAB_Setup_SR_All';
                        else if (h.includes('downlink latency')) mappedCol = 'Downlink_Latency';
                    } 
                    else if (networkType === 'kpi_5g') {
                        if (h.includes('nhà cung cấp') || h === 'nha_cung_cap') mappedCol = 'Nha_cung_cap';
                        else if (h.includes('tỉnh') || h === 'tinh') mappedCol = 'Tinh';
                        else if (h.includes('tên gnodeb') || h === 'ten_gnodeb') mappedCol = 'Ten_GNODEB';
                        else if (h.includes('tên cell') || h === 'ten_cell') mappedCol = 'Ten_CELL';
                        else if (h.includes('mã vnp') || h === 'ma_vnp') mappedCol = 'Ma_VNP';
                        else if (h.includes('loại ne') || h === 'loai_ne') mappedCol = 'Loai_NE';
                        else if (h.includes('gnodeb_id') || h.includes('gnodeb id')) mappedCol = 'GNODEB_ID';
                        else if (h.includes('cell_id') || h.includes('cell id')) mappedCol = 'CELL_ID';
                        else if (h.includes('thời gian') || h.includes('thoi gian')) mappedCol = 'Thoi_gian';
                        else if (h.includes('user_dl_avg_throughput') || h.includes('a user downlink average')) mappedCol = 'A_User_DL_Avg_Throughput';
                        else if (h.includes('user_ul_avg_throughput') || h.includes('a user uplink average')) mappedCol = 'A_User_UL_Avg_Throughput';
                        else if (h === 'traffic' || h.includes('total data traffic')) mappedCol = 'Total_Data_Traffic_Volume_GB';
                        else if (h.includes('cqi_5g') || h.includes('cqi 5g') || h === 'cqi') mappedCol = 'CQI_5G';
                        else if (h.includes('intra_sgnb_ps_change') || h.includes('intra-sgnb pscell change')) mappedCol = 'Intra_SgNB_PScell_Change';
                        else if (h.includes('user_avg_number') || h.includes('average user number')) mappedCol = 'Average_User_Number';
                        else if (h.includes('dlink_res_blk_ult') || h.includes('downlink resource block')) mappedCol = 'DL_RB_Ultilization';
                        else if (h.includes('ulink_res_blk_ult') || h.includes('uplink resource block')) mappedCol = 'UL_RB_Ultilization';
                        else if (h.includes('cell_avaibility_rate') || h.includes('cell avaibility') || h.includes('cell availability')) mappedCol = 'Cell_avaibility_rate';
                        else if (h.includes('user_max_number') || h.includes('maximum user number')) mappedCol = 'Maximum_User_Number';
                        else if (h.includes('ul_traffic_volume') || h.includes('ul traffic volume')) mappedCol = 'UL_Traffic_Volume_GB';
                        else if (h.includes('dl_traffic_volume') || h.includes('dl traffic volume')) mappedCol = 'DL_Traffic_Volume_GB';
                        else if (h.includes('cell_ul_avg_throughput') || h.includes('cell uplink average')) mappedCol = 'Cell_UL_Avg_Throughput';
                        else if (h.includes('cell_dl_avg_throughput') || h.includes('cell downlink average')) mappedCol = 'Cell_DL_Avg_Throughput';
                        else if (h.includes('sgnb_abn_release_rate') || h.includes('abnormal release rate')) mappedCol = 'SgNB_Abnormal_Release_Rate';
                        else if (h.includes('sgnb_add_success_rate') || h.includes('addition success rate')) mappedCol = 'SgNB_Addition_SR';
                        else if (h.includes('inter_sgnb_ps_change') || h.includes('inter-sgnb pscell change')) mappedCol = 'Inter_SgNB_PScell_Change_2';
                    } 
                    else if (networkType === 'poi_4g' || networkType === 'poi_5g') {
                        if (h.includes('cell_code') || h === 'cell code') mappedCol = 'Cell_Code';
                        else if (h.includes('site_code') || h === 'site code') mappedCol = 'Site_Code';
                        else if (h === 'poi') mappedCol = 'POI';
                    } else if (networkType === 'csht_data') {
                        if (h === 'mã csht' || h.includes('ma csht')) mappedCol = 'Ma_CSHT';
                        else if (h === 'tên csht' || h.includes('ten csht')) mappedCol = 'Ten_CSHT';
                        else if (h === 'địa chỉ' || h.includes('dia chi')) mappedCol = 'Dia_Chi';
                        else if (h === 'long' || h === 'longitude' || h.includes('kinh độ')) mappedCol = 'Longitude';
                        else if (h === 'lat' || h === 'latitude' || h.includes('vĩ độ')) mappedCol = 'Latitude';
                        else if (h.includes('loại nhà trạm')) mappedCol = 'Loai_Nha_Tram';
                        else if (h.includes('đơn vị quản lý')) mappedCol = 'Don_Vi_Quan_Ly';
                        else if (h === 'mã trạm 2g' || h.includes('tram 2g')) mappedCol = 'Ma_Tram_2G';
                        else if (h === 'mã trạm 3g' || h.includes('tram 3g')) mappedCol = 'Ma_Tram_3G';
                        else if (h === 'mã trạm 4g' || h.includes('tram 4g')) mappedCol = 'Ma_Tram_4G';
                        else if (h === 'mã trạm 5g' || h.includes('tram 5g')) mappedCol = 'Ma_Tram_5G';
                        else if (h === 'ip-3g' || h === 'ip 3g') mappedCol = 'IP_3G';
                        else if (h === 'ip-4g' || h === 'ip 4g') mappedCol = 'IP_4G';
                        else if (h === 'ip-5g' || h === 'ip 5g') mappedCol = 'IP_5G';
                        else if (h.includes('so với mặt đất') || h.includes('mat dat')) mappedCol = 'Chieu_Cao_Mat_Dat';
                        else if (h.includes('chiều cao cột') || h.includes('chieu cao cot')) mappedCol = 'Chieu_Cao_Cot';
                        else if (h.includes('hình thức sở hữu') || h.includes('so huu')) mappedCol = 'Hinh_Thuc_So_Huu';
                    } else if (networkType === 'alarm_data') {
                        if (h === 'nhóm cảnh báo' || h.includes('nhóm')) mappedCol = 'nhom_canh_bao';
                        else if (h === 'từ khóa chính trong tin nhắn' || h.includes('từ khóa')) mappedCol = 'tu_khoa';
                        else if (h === 'nguyên nhân' || h.includes('nguyên nhân')) mappedCol = 'nguyen_nhan';
                        else if (h === 'phương án kiểm tra, xử lý' || h.includes('phương án')) mappedCol = 'phuong_an_xu_ly';
                    } else if (networkType === 'vat_tu') {
                        if (h === 'mã' || h === 'ma') mappedCol = 'ma_vt';
                        else if (h === 'tên' || h === 'ten') mappedCol = 'ten_vt';
                        else if (h === 'tên đầy đủ' || h.includes('ten day du') || h.includes('tên đầy đủ')) mappedCol = 'ten_day_du';
                        else if (h === 'đơn vị tính' || h.includes('don vi tinh') || h.includes('đơn vị tính')) mappedCol = 'don_vi_tinh';
                        else if (h.includes('mã thiết bị') || h.includes('part number')) mappedCol = 'ma_thiet_bi';
                        else if (h === 'loại card' || h.includes('loai card') || h.includes('loại card')) mappedCol = 'loai_card';
                        else if (h === 'tên viết tắt' || h.includes('viet tat') || h.includes('viết tắt')) mappedCol = 'ten_viet_tat';
                    }

                    let actualDbCol = null;
                    if (mappedCol) {
                        let dbMatch = dbCols.find(c => c.original.toLowerCase() === mappedCol.toLowerCase());
                        if (dbMatch) actualDbCol = dbMatch.original;
                    }
                    if (!actualDbCol) {
                        const normEx = normalizeStr(exHeader);
                        if (normEx) {
                            const match = dbCols.find(dbC => dbC.norm === normEx);
                            if (match) actualDbCol = match.original;
                        }
                    }
                    if (actualDbCol) colMapping.push({ excelIdx: idx, dbCol: actualDbCol });
                });
            }

            let uniqueMappings = []; let seenDbCols = new Set();
            colMapping.forEach(m => {
                if (!seenDbCols.has(m.dbCol)) { seenDbCols.add(m.dbCol); uniqueMappings.push(m); }
            });
            colMapping = uniqueMappings;

            if (colMapping.length === 0) continue;

            let hasTuanCol = weekPrefix ? dbCols.some(c => c.original.toLowerCase() === 'tuan') : false;
            let lastValidDate = null; 
            const insertData = [];
            const stringColumns = ['Thoi_gian', 'Date', 'Cell_name', 'Ten_CELL', 'Site_name', 'Cell_code', 'Ma_Tinh', 'Don_Vi', 'Phuong_Xa', 'Nha_cung_cap', 'Tinh', 'Ten_RNC', 'Ten_GNODEB', 'Ma_VNP', 'Loai_NE', 'CellType', 'District_code', 'MIMO', 'LAC', 'CI', 'GNODEB_ID', 'CELL_ID', 'Cell_ID', 'Tuan', 'POI', 'Site_Code', 'Cell_Code', 'Ma_CSHT', 'Ten_CSHT', 'Dia_Chi', 'Loai_Nha_Tram', 'Don_Vi_Quan_Ly', 'Ma_Tram_2G', 'Ma_Tram_3G', 'Ma_Tram_4G', 'Ma_Tram_5G', 'IP_3G', 'IP_4G', 'IP_5G', 'Hinh_Thuc_So_Huu', 'nhom_canh_bao', 'tu_khoa', 'nguyen_nhan', 'phuong_an_xu_ly', 'ma_vt', 'ten_vt', 'ten_day_du', 'don_vi_tinh', 'ma_thiet_bi', 'loai_card', 'ten_viet_tat'];

            for (let i = dataStartIdx; i < rawData.length; i++) {
                const row = rawData[i];
                if (!row || row.length === 0) continue; 
                let firstCellStr = String(row[0] || '').toLowerCase().trim();
                if (firstCellStr === 'summary' || firstCellStr.includes('không thành công')) continue; 

                const rowObj = {}; let hasKpiData = false;
                colMapping.forEach(map => {
                    let val = row[map.excelIdx];
                    if (val === undefined || val === '') val = null;
                    let isStrCol = stringColumns.some(sc => sc.toLowerCase() === map.dbCol.toLowerCase());
                    
                    if (val !== null && typeof val === 'string' && !isStrCol) {
                        let parsed = parseFloat(val.replace(/,/g, '.'));
                        if (!isNaN(parsed)) val = parsed; 
                    }

                    if (map.dbCol === 'Thoi_gian' || map.dbCol === 'Date') {
                        if (val !== null) {
                            val = formatExcelDate(val);
                            if (typeof val === 'string' && val.includes(' ')) val = val.split(' ')[0];
                            lastValidDate = val; 
                        } else { val = lastValidDate; }
                    }
                    rowObj[map.dbCol] = val;
                    if (val !== null) hasKpiData = true;
                });

                if (hasKpiData) {
                    if (weekPrefix && hasTuanCol) rowObj['Tuan'] = weekPrefix;
                    insertData.push(rowObj);
                }
            }

            if (insertData.length > 0 && isKpiImported) {
                const uniqueDates = [...new Set(insertData.map(r => r.Thoi_gian).filter(Boolean))];
                if (uniqueDates.length > 0) {
                    const placeholders = uniqueDates.map(() => '?').join(',');
                    try { 
                        await db.query(`DELETE FROM ${networkType} WHERE Thoi_gian IN (${placeholders})`, uniqueDates); 
                        console.log(`🧹 Đã dọn sạch dữ liệu KPI cũ của ngày: ${uniqueDates.join(', ')} để nhường chỗ cho dữ liệu mới.`);
                    } catch (e) {
                        console.error("Lỗi khi xóa đè dữ liệu cũ:", e);
                    }
                }
            }

            if (insertData.length > 0) {
                const chunkSize = 500;
                for (let i = 0; i < insertData.length; i += chunkSize) {
                    let chunk = insertData.slice(i, i + chunkSize);
                    const keys = Object.keys(chunk[0]); 
                    
                    const valuesArr = chunk.map(obj => keys.map(k => {
                        let val = obj[k];
                        return (typeof val === 'string') ? val.trim() : val;
                    })); 
                    
                    let sql = `INSERT INTO ${networkType} (${keys.join(',')}) VALUES ?`;
                    
                    if (networkType === 'alarm_data' || networkType === 'csht_data' || networkType === 'vat_tu') {
                        let updateCols = keys.map(k => `${k}=VALUES(${k})`).join(', ');
                        sql = `INSERT INTO ${networkType} (${keys.join(',')}) VALUES ? ON DUPLICATE KEY UPDATE ${updateCols}`;
                    }

                    await db.query(sql, [valuesArr]);
                }
                totalImported += insertData.length;
            }
        } catch (error) { console.error(`Lỗi file:`, error); }
    } 

    if (isKpiImported) {
        await aggregateDashboardData();
        // TRIGGER BỘ ĐỒNG BỘ CẢNH BÁO SIÊU TỐC
        await syncWorstCells();
        await syncCongestion3G();
        await syncTrafficDown();
    }
    
    if (networkType === 'mbb_qoe' || networkType === 'mbb_qos' || networkType === 'kpi_4g') {
        await syncQoeQosSummary();
    }

    history = await getKpiHistory(); 
    return res.render('import_data', { title: 'Import Data', page: 'Import Data', userRole: userRole, history: history, message: `Đã Import/Ghi đè thành công ${totalImported} dòng.`, error: null });
};

// ========================================================
// API SIÊU TỐC: ĐỌC TỪ CACHE BẢNG CẢNH BÁO
// ========================================================
exports.getDistricts = async (req, res) => {
    try {
        const [rows] = await db.query('SELECT DISTINCT District_code FROM kpi_4g WHERE District_code IS NOT NULL AND District_code != "" ORDER BY District_code');
        res.json(rows.map(r => r.District_code));
    } catch (error) {
        console.error("Lỗi lấy danh sách District:", error);
        res.status(500).json([]);
    }
};

exports.getDashboardData = async (req, res) => {
    const district = req.query.district || 'all';
    try {
        if (district === 'all') {
            const [rows] = await db.query('SELECT * FROM Dashboard');
            res.json(rows);
        } else {
            const [rows] = await db.query('SELECT * FROM district_dashboard WHERE district = ?', [district]);
            res.json(rows);
        }
    } catch (error) { 
        console.error("Lỗi getDashboardData:", error);
        res.status(500).json({ error: "Lỗi truy xuất CSDL." }); 
    }
};

exports.getWorstCellsData = async (req, res) => {
    const days = parseInt(req.query.days) || 1; 
    try {
        const [rows] = await db.query('SELECT * FROM worst_cells WHERE days_filter = ?', [days]);
        const formattedRows = rows.map(r => ({
            Cell_name: r.cell_name, Latest_Date: r.latest_date,
            User_DL_Avg_Throughput_Kbps: Number(r.thput).toFixed(2), 
            RB_Util_Rate_DL: Number(r.prb).toFixed(2),
            CQI_4G: Number(r.cqi).toFixed(2), 
            Service_Drop_all: Number(r.drop_rate).toFixed(2),
            Violations: r.violations
        }));
        res.json(formattedRows);
    } catch (e) { res.status(500).json({ error: "Lỗi CSDL." }); }
};

exports.getCongestion3gData = async (req, res) => {
    const days = parseInt(req.query.days) || 3; 
    try {
        const [rows] = await db.query('SELECT * FROM congestion_3g WHERE days_filter = ?', [days]);
        const formattedRows = rows.map(r => ({
            Cell_name: r.cell_name, Latest_Date: r.latest_date,
            CSCONGES: Number(r.cs_conges).toFixed(2), CS_SO_ATT: r.cs_att,
            PSCONGES: Number(r.ps_conges).toFixed(2), PS_SO_ATT: r.ps_att,
            Violations: r.violations
        }));
        res.json(formattedRows);
    } catch (e) { res.status(500).json({ error: "Lỗi CSDL." }); }
};

exports.getTrafficDownData = async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM traffic_down');
        if (rows.length === 0) {
            return res.json({ error: "Chưa đủ dữ liệu lịch sử (cần ít nhất 10 ngày) hoặc chưa đồng bộ để phân tích đối soát tuần." });
        }
        
        let latestDate = rows[0].latest_date;
        let lastWeekDate = rows[0].last_week_date;
        let zeroTrafficCells = [];
        let droppedTrafficCells = [];
        let droppedTrafficPOIs = [];

        rows.forEach(r => {
            if (r.category === 'zero_cell') {
                zeroTrafficCells.push({ Cell_name: r.name, network: r.network, t0: Number(r.val_t0).toFixed(2), avg7: Number(r.val_compare).toFixed(2) });
            } else if (r.category === 'dropped_cell') {
                droppedTrafficCells.push({ Cell_name: r.name, network: r.network, t0: Number(r.val_t0).toFixed(2), t7: Number(r.val_compare).toFixed(2), ratio: r.ratio });
            } else if (r.category === 'dropped_poi') {
                droppedTrafficPOIs.push({ POI: r.name, t0: Number(r.val_t0).toFixed(2), t7: Number(r.val_compare).toFixed(2), ratio: r.ratio });
            }
        });

        res.json({
            latestDate,
            lastWeekDate,
            zeroTrafficCells: zeroTrafficCells.sort((a,b) => b.avg7 - a.avg7),
            droppedTrafficCells: droppedTrafficCells.sort((a,b) => a.ratio - b.ratio),
            droppedTrafficPOIs: droppedTrafficPOIs.sort((a,b) => a.ratio - b.ratio)
        });
    } catch (error) {
        res.status(500).json({ error: "Lỗi truy xuất hệ thống máy chủ CSDL." });
    }
};

exports.resetImportedData = async (req, res) => {
    let userRole = req.session && req.session.user ? req.session.user.role : 'user';
    if (userRole !== 'admin') return res.status(403).send("Chỉ Admin mới có quyền thực hiện chức năng này.");
    const table = req.params.table;
    const allowedTables = ['rf_3g', 'rf_4g', 'rf_5g', 'ta_query', 'mbb_qoe', 'mbb_qos', 'poi_4g', 'poi_5g', 'csht_data', 'alarm_data', 'vat_tu', 'worst_cells', 'congestion_3g', 'traffic_down'];
    if (!allowedTables.includes(table)) return res.status(400).send("Bảng dữ liệu không hợp lệ.");

    try {
        await db.query(`TRUNCATE TABLE ${table}`);
        res.redirect('/import-data');
    } catch (e) { res.status(500).send("Lỗi máy chủ khi xóa dữ liệu. Vui lòng thử lại."); }
};
