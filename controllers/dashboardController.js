const db = require('../models/db');
const xlsx = require('xlsx');

// Hàm bổ trợ: Biến đổi thông minh cho số thập phân (Bao thầu mọi định dạng US/VN)
const getSafeFloat = (val) => {
    if (val === undefined || val === null || val === '') return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    
    // Loại bỏ dấu nháy kép/nháy đơn nếu có từ file CSV
    let s = String(val).trim().replace(/['"]/g, '');
    
    if (s.includes('.') && s.includes(',')) {
        let lastDot = s.lastIndexOf('.');
        let lastComma = s.lastIndexOf(',');
        if (lastComma > lastDot) {
            // Định dạng VN: 1.234,56 -> Xóa chấm, đổi phẩy thành chấm
            s = s.replace(/\./g, '').replace(/,/g, '.');
        } else {
            // Định dạng US: 1,234.56 -> Xóa phẩy
            s = s.replace(/,/g, '');
        }
    } else if (s.includes(',')) {
        // Nếu chỉ có phẩy (VD: 99,5) -> Đổi thành chấm
        // NHẬN DIỆN SỐ 10,095 -> Biến thành 10095
        if (s.match(/^[-+]?\d+,\d{3}$/)) {
            s = s.replace(/,/g, ''); 
        } else {
            s = s.replace(/,/g, '.'); 
        }
    }
    
    // Chỉ giữ lại số, dấu chấm và dấu trừ
    s = s.replace(/[^0-9.-]/g, '');
    const f = parseFloat(s);
    return isNaN(f) ? 0 : f;
};

/* STREAMING_CHUNK:Initializing Excel helper functions... */
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
    let s = String(val).trim().replace(/['"]/g, '');
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

const formatExcelDate = (excelDate) => {
    if (typeof excelDate === 'number') {
        const date = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
        const d = String(date.getDate()).padStart(2, '0');
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const y = date.getFullYear();
        return `${d}/${m}/${y}`;
    }
    return String(excelDate).replace(/['"]/g, ''); 
};

const normalizeStr = (str) => {
    if (!str) return '';
    return String(str)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") 
        .replace(/đ/g, 'd')             
        .replace(/['"]/g, "") 
        .replace(/[^a-z0-9_]/g, '_')    
        .replace(/_+/g, '_')            
        .replace(/^_|_$/g, '');         
};

const createSafeColumnName = (str) => {
    return normalizeStr(str);
};

/* STREAMING_CHUNK:Fetching KPI history data... */
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

/* STREAMING_CHUNK:Aggregating dashboard data... */
async function aggregateDashboardData() {
    try {
        console.log("⏳ Bắt đầu đồng bộ và tính toán Dashboard...");

        await db.query(`
            INSERT INTO Dashboard (thoi_gian, sum_TRAFFIC_4G, AVG_USER_DL_AVG_THPUT_4G, AVG_RES_BLK_DL_4G, AVG_CQI_4G)
            SELECT Thoi_gian, SUM(Total_Data_Traffic_Volume_GB), AVG(User_DL_Avg_Throughput_Kbps), AVG(RB_Util_Rate_DL), AVG(CQI_4G)
            FROM kpi_4g WHERE Thoi_gian IS NOT NULL AND Thoi_gian != '' GROUP BY Thoi_gian
            ON DUPLICATE KEY UPDATE 
                sum_TRAFFIC_4G = VALUES(sum_TRAFFIC_4G), 
                AVG_USER_DL_AVG_THPUT_4G = VALUES(AVG_USER_DL_AVG_THPUT_4G), 
                AVG_RES_BLK_DL_4G = VALUES(AVG_RES_BLK_DL_4G), 
                AVG_CQI_4G = VALUES(AVG_CQI_4G)
        `);

        await db.query(`
            INSERT INTO Dashboard (thoi_gian, sum_TRAFFIC_5G, AVG_USER_DL_AVG_THPUT_5G, AVG_CQI_5G)
            SELECT Thoi_gian, SUM(Total_Data_Traffic_Volume_GB), AVG(A_User_DL_Avg_Throughput), AVG(CQI_5G)
            FROM kpi_5g WHERE Thoi_gian IS NOT NULL AND Thoi_gian != '' GROUP BY Thoi_gian
            ON DUPLICATE KEY UPDATE 
                sum_TRAFFIC_5G = VALUES(sum_TRAFFIC_5G), 
                AVG_USER_DL_AVG_THPUT_5G = VALUES(AVG_USER_DL_AVG_THPUT_5G), 
                AVG_CQI_5G = VALUES(AVG_CQI_5G)
        `);

        await db.query(`
            INSERT INTO district_dashboard (thoi_gian, district, sum_TRAFFIC_4G, AVG_USER_DL_AVG_THPUT_4G, AVG_RES_BLK_DL_4G, AVG_CQI_4G)
            SELECT Thoi_gian, District_code, SUM(Total_Data_Traffic_Volume_GB), AVG(User_DL_Avg_Throughput_Kbps), AVG(RB_Util_Rate_DL), AVG(CQI_4G)
            FROM kpi_4g 
            WHERE Thoi_gian IS NOT NULL AND Thoi_gian != '' AND District_code IS NOT NULL AND District_code != '' 
            GROUP BY Thoi_gian, District_code
            ON DUPLICATE KEY UPDATE 
                sum_TRAFFIC_4G = VALUES(sum_TRAFFIC_4G), 
                AVG_USER_DL_AVG_THPUT_4G = VALUES(AVG_USER_DL_AVG_THPUT_4G), 
                AVG_RES_BLK_DL_4G = VALUES(AVG_RES_BLK_DL_4G), 
                AVG_CQI_4G = VALUES(AVG_CQI_4G)
        `);

        await db.query(`
            INSERT INTO district_dashboard (thoi_gian, district, sum_TRAFFIC_5G, AVG_USER_DL_AVG_THPUT_5G, AVG_CQI_5G)
            SELECT t5.Thoi_gian, t4map.District_code, SUM(t5.Total_Data_Traffic_Volume_GB), AVG(t5.A_User_DL_Avg_Throughput), AVG(t5.CQI_5G)
            FROM kpi_5g t5
            JOIN (
                SELECT DISTINCT SUBSTRING(REPLACE(REPLACE(Cell_name, '4G-', ''), '4G_', ''), 1, 6) as core_code, District_code 
                FROM kpi_4g 
                WHERE District_code IS NOT NULL AND District_code != ''
            ) t4map ON SUBSTRING(REPLACE(REPLACE(t5.Ten_CELL, '5G-', ''), '5G_', ''), 1, 6) = t4map.core_code
            WHERE t5.Thoi_gian IS NOT NULL AND t5.Thoi_gian != ''
            GROUP BY t5.Thoi_gian, t4map.District_code
            ON DUPLICATE KEY UPDATE 
                sum_TRAFFIC_5G = VALUES(sum_TRAFFIC_5G), 
                AVG_USER_DL_AVG_THPUT_5G = VALUES(AVG_USER_DL_AVG_THPUT_5G), 
                AVG_CQI_5G = VALUES(AVG_CQI_5G)
        `);

        console.log("✅ Tính toán Dashboard thành công!");
    } catch (e) {
        console.error("❌ Lỗi aggregateDashboardData:", e.message);
    }
}

/* STREAMING_CHUNK:Syncing worst cells caching... */
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
            const t0_date = targetDates[0]; 
            
            const query = `
                SELECT Cell_name, 
                    AVG(User_DL_Avg_Throughput_Kbps) as User_DL_Avg_Throughput_Kbps, 
                    AVG(RB_Util_Rate_DL) as RB_Util_Rate_DL, AVG(CQI_4G) as CQI_4G, AVG(Service_Drop_all) as Service_Drop_all,
                    COUNT(Thoi_gian) as So_Ngay_Vi_Pham,
                    SUM(CASE WHEN Thoi_gian = ? THEN 1 ELSE 0 END) as is_in_t0
                FROM kpi_4g WHERE Thoi_gian IN (${placeholders}) 
                AND (CellType IS NULL OR CellType NOT LIKE '%L900%') AND (Cell_name NOT LIKE 'MBF_TH%')
                AND (User_DL_Avg_Throughput_Kbps < 7000 OR RB_Util_Rate_DL > 20 OR CQI_4G < 93 OR Service_Drop_all > 0.3)
                GROUP BY Cell_name HAVING So_Ngay_Vi_Pham >= ? AND is_in_t0 > 0
            `;
            const [rows] = await db.query(query, [t0_date, ...targetDates, days]);
            
            let insertData = [];
            rows.forEach(r => {
                let vios = [];
                if (r.User_DL_Avg_Throughput_Kbps < 7000) vios.push('Thput Thấp');
                if (r.RB_Util_Rate_DL > 20) vios.push('PRB Cao');
                if (r.CQI_4G < 93) vios.push('CQI Thấp');
                if (r.Service_Drop_all > 0.3) vios.push('Drop Rate Cao');
                
                insertData.push([
                    t0_date, 
                    days, 
                    r.Cell_name || null, 
                    getSafeFloat(r.User_DL_Avg_Throughput_Kbps), 
                    getSafeFloat(r.RB_Util_Rate_DL), 
                    getSafeFloat(r.CQI_4G), 
                    getSafeFloat(r.Service_Drop_all), 
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

/* STREAMING_CHUNK:Syncing 3G congestion caching... */
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
            const t0_date = targetDates[0];

            const query = `
                SELECT Ten_CELL as Cell_name, MAX(Thoi_gian) as Latest_Date,
                    AVG(CSCONGES) as CSCONGES, AVG(CS_SO_ATT) as CS_SO_ATT, AVG(PSCONGES) as PSCONGES, AVG(PS_SO_ATT) as PS_SO_ATT,
                    COUNT(Thoi_gian) as So_Ngay_Vi_Pham,
                    SUM(CASE WHEN Thoi_gian = ? THEN 1 ELSE 0 END) as is_in_t0
                FROM kpi_3g WHERE Thoi_gian IN (${placeholders}) AND ((CSCONGES > 2 AND CS_SO_ATT > 100) OR (PSCONGES > 2 AND PS_SO_ATT > 500))
                GROUP BY Ten_CELL HAVING So_Ngay_Vi_Pham >= ? AND is_in_t0 > 0
            `;
            const [rows] = await db.query(query, [t0_date, ...targetDates, days]);
            
            let insertData = [];
            rows.forEach(r => {
                let vios = [];
                if (r.CSCONGES > 2 && r.CS_SO_ATT > 100) vios.push('Nghẽn CS');
                if (r.PSCONGES > 2 && r.PS_SO_ATT > 500) vios.push('Nghẽn PS');
                
                insertData.push([
                    t0_date, 
                    days, 
                    r.Cell_name || null,
                    getSafeFloat(r.CSCONGES), 
                    Math.round(getSafeFloat(r.CS_SO_ATT)),
                    getSafeFloat(r.PSCONGES), 
                    Math.round(getSafeFloat(r.PS_SO_ATT)),
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

/* STREAMING_CHUNK:Syncing traffic down caching... */
async function syncTrafficDown() {
    try {
        console.log("⏳ Bắt đầu tính toán cache Traffic Down...");
        
        try {
            await db.query("SELECT network FROM traffic_down LIMIT 1");
        } catch (e) {
            console.log("⚡ Auto-Migration: Cập nhật cấu trúc bảng traffic_down...");
            await db.query("DROP TABLE IF EXISTS traffic_down");
            await db.query(`
                CREATE TABLE traffic_down (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    latest_date VARCHAR(50),
                    last_week_date VARCHAR(50),
                    category VARCHAR(50), 
                    network VARCHAR(20),
                    name VARCHAR(255),
                    val_t0 FLOAT,
                    val_compare FLOAT,
                    ratio FLOAT
                )
            `);
        }

        await db.query('TRUNCATE TABLE traffic_down');
        
        const [dates3gRaw] = await db.query(`SELECT DISTINCT Thoi_gian FROM kpi_3g WHERE Thoi_gian IS NOT NULL AND Thoi_gian != ''`).catch(()=>[[]]);
        const [dates4gRaw] = await db.query(`SELECT DISTINCT Thoi_gian FROM kpi_4g WHERE Thoi_gian IS NOT NULL AND Thoi_gian != ''`).catch(()=>[[]]);
        const [dates5gRaw] = await db.query(`SELECT DISTINCT Thoi_gian FROM kpi_5g WHERE Thoi_gian IS NOT NULL AND Thoi_gian != ''`).catch(()=>[[]]);

        const getSortedDates = (rawDates) => {
            if(!rawDates || rawDates.length === 0) return [];
            return rawDates.map(d => d.Thoi_gian).sort((a, b) => {
                const pA = a.split('/'); const pB = b.split('/');
                return new Date(`${pB[2]}-${pB[1]}-${pB[0]}`) - new Date(`${pA[2]}-${pA[1]}-${pA[0]}`);
            });
        };

        const dates3g = getSortedDates(dates3gRaw).slice(0, 15);
        const dates4g = getSortedDates(dates4gRaw).slice(0, 15);
        const dates5g = getSortedDates(dates5gRaw).slice(0, 15);

        if (dates3g.length === 0 && dates4g.length === 0 && dates5g.length === 0) {
            console.log("⚠️ Không có dữ liệu KPI nào để tính Traffic Down.");
            return;
        }

        let data3g = [], data4g = [], data5g = [];
        
        if (dates3g.length > 0) {
            const p3g = dates3g.map(() => '?').join(',');
            try { [data3g] = await db.query(`SELECT Ten_CELL as Cell_name, Thoi_gian, TRAFFIC as traffic FROM kpi_3g WHERE Thoi_gian IN (${p3g})`, dates3g); } catch(e) {}
        }
        if (dates4g.length > 0) {
            const p4g = dates4g.map(() => '?').join(',');
            try { [data4g] = await db.query(`SELECT Cell_name, Thoi_gian, Total_Data_Traffic_Volume_GB as traffic FROM kpi_4g WHERE Thoi_gian IN (${p4g})`, dates4g); } catch(e) {}
        }
        if (dates5g.length > 0) {
            const p5g = dates5g.map(() => '?').join(',');
            try { [data5g] = await db.query(`SELECT Ten_CELL as Cell_name, Thoi_gian, Total_Data_Traffic_Volume_GB as traffic FROM kpi_5g WHERE Thoi_gian IN (${p5g})`, dates5g); } catch(e) {}
        }

        const [poi4g] = await db.query('SELECT Cell_Code, POI FROM poi_4g').catch(()=>[[]]);
        const [poi5g] = await db.query('SELECT Cell_Code, POI FROM poi_5g').catch(()=>[[]]);
        const cellToPoi = {};
        if(poi4g) poi4g.forEach(r => cellToPoi[r.Cell_Code] = r.POI);
        if(poi5g) poi5g.forEach(r => cellToPoi[r.Cell_Code] = r.POI);

        let zeroTrafficCells = [];
        let droppedTrafficCells = [];
        let droppedTrafficPOIs = [];
        let poiTrafficMap = {}; 

        const analyzeData = (dataArray, network, targetDates) => {
            if (targetDates.length === 0) return;
            const t0 = targetDates[0];
            const cellMap = {};
            
            dataArray.forEach(row => {
                if (!cellMap[row.Cell_name]) cellMap[row.Cell_name] = { has_data: false };
                cellMap[row.Cell_name][row.Thoi_gian] = parseFloat(row.traffic) || 0;
                cellMap[row.Cell_name].has_data = true;
                
                if (network === '4g' || network === '5g') {
                    let poi = cellToPoi[row.Cell_name];
                    if (poi) {
                        if (!poiTrafficMap[poi]) poiTrafficMap[poi] = { has_data: false };
                        if (poiTrafficMap[poi][row.Thoi_gian] === undefined) poiTrafficMap[poi][row.Thoi_gian] = 0;
                        poiTrafficMap[poi][row.Thoi_gian] += parseFloat(row.traffic) || 0;
                        poiTrafficMap[poi].has_data = true;
                    }
                }
            });

            for (let cell in cellMap) {
                const c = cellMap[cell];
                if (!c.has_data) continue;
                
                const v0 = c[t0] !== undefined ? c[t0] : 0; 
                const v1 = targetDates[1] ? (c[targetDates[1]] || 0) : 0;
                const v2 = targetDates[2] ? (c[targetDates[2]] || 0) : 0;
                const v3 = targetDates[3] ? (c[targetDates[3]] || 0) : 0;
                const v4 = targetDates[4] ? (c[targetDates[4]] || 0) : 0;
                const v5 = targetDates[5] ? (c[targetDates[5]] || 0) : 0;
                const v6 = targetDates[6] ? (c[targetDates[6]] || 0) : 0;
                
                let sumPast1 = 0, countPast1 = 0;
                if (targetDates[1] && c[targetDates[1]] !== undefined) { sumPast1 = c[targetDates[1]]; countPast1 = 1; }
                let avgPast1 = countPast1 > 0 ? sumPast1/countPast1 : 0;

                let sumPast3 = 0, countPast3 = 0;
                for(let i=3; i<=5; i++) if(targetDates[i] && c[targetDates[i]] !== undefined) { sumPast3 += c[targetDates[i]]; countPast3++; }
                let avgPast3 = countPast3 > 0 ? sumPast3/countPast3 : 0;

                let sumPast7 = 0, countPast7 = 0;
                for(let i=7; i<=13; i++) if(targetDates[i] && c[targetDates[i]] !== undefined) { sumPast7 += c[targetDates[i]]; countPast7++; }
                let avgPast7 = countPast7 > 0 ? sumPast7/countPast7 : 0;

                if (targetDates.length >= 8 && v0===0 && v1===0 && v2===0 && v3===0 && v4===0 && v5===0 && v6===0 && avgPast7 > 0) {
                    zeroTrafficCells.push({ category: 'zero_7d', Cell_name: cell, network: network, t0: 0, avgPast: avgPast7, date_t0: t0, date_t7: targetDates[7] });
                }
                else if (targetDates.length >= 4 && v0===0 && v1===0 && v2===0 && avgPast3 > 0) {
                    zeroTrafficCells.push({ category: 'zero_3d', Cell_name: cell, network: network, t0: 0, avgPast: avgPast3, date_t0: t0, date_t7: targetDates[3] });
                }
                else if (targetDates.length >= 2 && v0 === 0 && avgPast1 > 0) {
                    zeroTrafficCells.push({ category: 'zero_1d', Cell_name: cell, network: network, t0: 0, avgPast: avgPast1, date_t0: t0, date_t7: targetDates[1] });
                }

                if ((network === '4g' || network === '5g') && targetDates.length >= 8) {
                    const v7 = c[targetDates[7]] !== undefined ? c[targetDates[7]] : 0; 
                    
                    if (targetDates.length >= 10) {
                        const v8 = c[targetDates[8]] !== undefined ? c[targetDates[8]] : 0; 
                        const v9 = c[targetDates[9]] !== undefined ? c[targetDates[9]] : 0;
                        if (v0 < 0.7 * v7 && v7 > 5 && v1 < v8 && v2 < v9) {
                            droppedTrafficCells.push({ Cell_name: cell, network: network, t0: v0.toFixed(2), t7: v7.toFixed(2), ratio: Math.round((v0/v7)*100), date_t0: t0, date_t7: targetDates[7] });
                        }
                    } else {
                        if (v0 < 0.7 * v7 && v7 > 5) {
                            droppedTrafficCells.push({ Cell_name: cell, network: network, t0: v0.toFixed(2), t7: v7.toFixed(2), ratio: Math.round((v0/v7)*100), date_t0: t0, date_t7: targetDates[7] });
                        }
                    }
                }
            }
        };

        analyzeData(data3g, '3g', dates3g);
        analyzeData(data4g, '4g', dates4g);
        analyzeData(data5g, '5g', dates5g);

        const masterDates4g5g = dates4g.length > dates5g.length ? dates4g : dates5g;
        if (masterDates4g5g.length > 0) {
            const t0_poi = masterDates4g5g[0];
            for (let poi in poiTrafficMap) {
                const p = poiTrafficMap[poi];
                if (!p.has_data) continue;
                
                if (masterDates4g5g.length >= 8) {
                    const v0 = p[t0_poi] !== undefined ? p[t0_poi] : 0; 
                    const v7 = p[masterDates4g5g[7]] !== undefined ? p[masterDates4g5g[7]] : 0; 

                    if (masterDates4g5g.length >= 10) {
                        const v1 = p[masterDates4g5g[1]] !== undefined ? p[masterDates4g5g[1]] : 0; 
                        const v2 = p[masterDates4g5g[2]] !== undefined ? p[masterDates4g5g[2]] : 0;
                        const v8 = p[masterDates4g5g[8]] !== undefined ? p[masterDates4g5g[8]] : 0; 
                        const v9 = p[masterDates4g5g[9]] !== undefined ? p[masterDates4g5g[9]] : 0;
                        if (v7 > 0 && v0 < 0.7 * v7 && v1 < v8 && v2 < v9) {
                            droppedTrafficPOIs.push({ POI: poi, network: '4g_5g', t0: v0.toFixed(2), t7: v7.toFixed(2), ratio: Math.round((v0/v7)*100), date_t0: t0_poi, date_t7: masterDates4g5g[7] });
                        }
                    } else {
                        if (v7 > 0 && v0 < 0.7 * v7) {
                            droppedTrafficPOIs.push({ POI: poi, network: '4g_5g', t0: v0.toFixed(2), t7: v7.toFixed(2), ratio: Math.round((v0/v7)*100), date_t0: t0_poi, date_t7: masterDates4g5g[7] });
                        }
                    }
                }
            }
        }
        
        let insertData = [];

        zeroTrafficCells.forEach(r => insertData.push([r.date_t0, r.date_t7, r.category, r.network, r.Cell_name, getSafeFloat(r.t0), getSafeFloat(r.avgPast), 0]));
        droppedTrafficCells.forEach(r => insertData.push([r.date_t0, r.date_t7, 'dropped_cell', r.network, r.Cell_name, getSafeFloat(r.t0), getSafeFloat(r.t7), getSafeFloat(r.ratio)]));
        droppedTrafficPOIs.forEach(r => insertData.push([r.date_t0, r.date_t7, 'dropped_poi', r.network, r.POI, getSafeFloat(r.t0), getSafeFloat(r.t7), getSafeFloat(r.ratio)]));

        if (insertData.length > 0) {
            const chunkSize = 500;
            const sqlInsert = `INSERT INTO traffic_down (latest_date, last_week_date, category, network, name, val_t0, val_compare, ratio) VALUES ?`;
            for (let i = 0; i < insertData.length; i += chunkSize) {
                await db.query(sqlInsert, [insertData.slice(i, i + chunkSize)]);
            }
        }
        console.log("✅ Đồng bộ Cache Traffic Down thành công!");
    } catch (e) {
        console.error("❌ Lỗi syncTrafficDown:", e);
    }
}

/* STREAMING_CHUNK:Syncing bad cells prioritization... */
async function syncBadCells() {
    try {
        console.log("⏳ Bắt đầu phân tích Ma Trận Ưu Tiên Bad Cells (Luật 5/7 ngày)...");
        
        try {
            await db.query("DELETE FROM bad_cells WHERE network = '5g'");
        } catch (e) {}

        const [datesRaw] = await db.query(`SELECT DISTINCT Thoi_gian FROM kpi_4g WHERE Thoi_gian IS NOT NULL AND Thoi_gian != ''`);
        const dates = datesRaw.map(d => d.Thoi_gian).sort((a, b) => new Date(b.split('/').reverse().join('-')) - new Date(a.split('/').reverse().join('-')));
        if (dates.length < 5) {
            console.log("⚠️ Không đủ dữ liệu 5 ngày để quét Bad Cells mãn tính."); return;
        }
        const targetDates = dates.slice(0, 7);
        const t0 = targetDates[0];
        const placeholders = targetDates.map(() => '?').join(',');

        let badCellsList = [];

        const query4g = `
            SELECT Cell_name, MAX(Thoi_gian) as latest,
                   SUM(CASE WHEN (User_DL_Avg_Throughput_Kbps < 15000 OR RB_Util_Rate_DL > 70 OR CQI_4G < 90 OR Service_Drop_all > 1.3) AND Total_Data_Traffic_Volume_GB > 1 THEN 1 ELSE 0 END) as vios,
                   AVG(Total_Data_Traffic_Volume_GB) as traf, AVG(User_DL_Avg_Throughput_Kbps) as thput, AVG(RB_Util_Rate_DL) as prb, AVG(CQI_4G) as cqi, AVG(Service_Drop_all) as drop_rate, AVG(Downlink_Latency) as latency,
                   SUM(CASE WHEN Thoi_gian = ? THEN 1 ELSE 0 END) as is_in_t0
            FROM kpi_4g WHERE Thoi_gian IN (${placeholders})
            AND Cell_name NOT LIKE '%IBS%' AND Cell_name NOT LIKE '%DAS%' AND Cell_name NOT LIKE '%VSAT%' AND Cell_name NOT LIKE '%BOOSTER%' AND Cell_name NOT LIKE 'MBF_TH%'
            GROUP BY Cell_name HAVING vios >= 5 AND is_in_t0 > 0 AND traf >= 5
        `;
        const [rows4g] = await db.query(query4g, [t0, ...targetDates]);
        rows4g.forEach(r => {
            let p = 'P3';
            if (r.thput < 10000 && r.latency > 40 && r.traf > 10) p = 'P1';
            else if (r.prb > 70 && r.traf > 10) p = 'P2';
            badCellsList.push(['4g', r.Cell_name, r.latest, r.vios, p, getSafeFloat(r.traf), getSafeFloat(r.thput), getSafeFloat(r.prb), getSafeFloat(r.cqi), getSafeFloat(r.drop_rate), getSafeFloat(r.latency)]);
        });

        if (badCellsList.length > 0) {
            const sql = `
                INSERT INTO bad_cells (network, cell_name, latest_date, violation_days, priority, avg_traffic, avg_thput, avg_prb, avg_cqi, avg_drop, avg_latency)
                VALUES ? ON DUPLICATE KEY UPDATE 
                latest_date=VALUES(latest_date), violation_days=VALUES(violation_days), priority=VALUES(priority), avg_traffic=VALUES(avg_traffic), avg_thput=VALUES(avg_thput), avg_prb=VALUES(avg_prb), avg_cqi=VALUES(avg_cqi), avg_drop=VALUES(avg_drop), avg_latency=VALUES(avg_latency)
            `;
            await db.query(sql, [badCellsList]);
        }
        console.log("✅ Phân tích Bad Cells thành công!");
    } catch (e) {
        console.error("❌ Lỗi syncBadCells:", e);
    }
}

/* STREAMING_CHUNK:Syncing QoE/QoS summary caching... */
async function syncQoeQosSummary() {
    try {
        console.log("⏳ Bắt đầu tính toán cache QoE / QoS Summary...");
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
                siteName || '', cellName || '', district || '', mimo || '',
                qoeRank !== null && qoeRank !== undefined ? qoeRank : null, 
                qoeScore !== null && qoeScore !== undefined ? qoeScore : null, 
                qoeTrend !== null && qoeTrend !== undefined ? qoeTrend : 0, 
                qosRank !== null && qosRank !== undefined ? qosRank : null, 
                qosScore !== null && qosScore !== undefined ? qosScore : null, 
                qosTrend !== null && qosTrend !== undefined ? qosTrend : 0,
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
        console.log("✅ Đồng bộ bảng tổng hợp QoE/QoS thành công!");
    } catch (e) {
        console.error("❌ Lỗi đồng bộ bảng qoe_qos:", e);
    }
}

/* STREAMING_CHUNK:Base routing endpoints... */
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

/* STREAMING_CHUNK:Executing dynamic import mapping and parsing... */
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

    // [NÂNG CẤP BẢO VỆ CỘT]: Dọn dẹp rác nhưng giữ lại chính xác các cột _DL
    if (networkType === 'mbb_qoe' || networkType === 'mbb_qos') {
        const standardCols = networkType === 'mbb_qoe' 
            ? ['id', 'tuan', 'ma_tinh', 'don_vi', 'phuong_xa', 'site_name', 'cell_name', 'cell_id', 'qoe_score', 'qoe_rank', 'norm_speed', 'norm_latency', 'norm_jitter', 'norm_packetloss', 'point_speed', 'point_latency', 'point_jitter', 'point_packetloss', 'out_speed', 'out_latency', 'out_jitter', 'out_packetloss', 'in_speed', 'in_latency', 'in_jitter', 'in_packetloss', 'created_at']
            : ['id', 'tuan', 'ma_tinh', 'don_vi', 'phuong_xa', 'site_name', 'cell_name', 'cell_id', 'qos_score', 'qos_rank', 'norm_res', 'norm_acc', 'norm_ret', 'norm_int', 'norm_dl', 'point_res', 'point_acc', 'point_ret', 'point_int', 'point_dl', 'out_res', 'out_acc', 'out_ret', 'out_int', 'out_dl', 'in_res', 'in_acc', 'in_ret', 'in_int', 'in_dl', 'created_at'];

        let colsToDrop = dbCols.filter(col => !standardCols.includes(col.original.toLowerCase()));
        
        for (let col of colsToDrop) {
            try {
                await db.query(`ALTER TABLE ${networkType} DROP COLUMN \`${col.original}\``);
                console.log(`🗑️ Đã xóa cột rác tự tạo: ${col.original} khỏi bảng ${networkType}`);
            } catch (e) {}
        }

        if (colsToDrop.length > 0) {
            const [newCols] = await db.query(`SHOW COLUMNS FROM ${networkType}`);
            dbCols = newCols.map(c => ({ original: c.Field, norm: normalizeStr(c.Field) }));
        }
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

            // Sử dụng blankrows: true để giữ lại cấu trúc dòng chính xác
            let rawData = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: true });
            if (rawData.length === 0) continue;

            // Xử lý CSV nếu file bị gộp chung vào 1 cột duy nhất bằng dấu chấm phẩy ; hoặc phẩy ,
            if (rawData.length > 0 && rawData[0].length === 1) {
                let text = String(rawData[0][0]);
                if (text.includes(';') || text.includes(',')) {
                    let csvString = file.buffer.toString('utf8');
                    let lines = csvString.split(/\r?\n/);
                    rawData = [];
                    let separator = lines[0].includes(';') ? ';' : ',';
                    lines.forEach(line => {
                        if (line.trim() !== '') {
                            let row = []; let inQuotes = false; let currentVal = '';
                            for(let i=0; i<line.length; i++) {
                                let c = line[i];
                                if (c === '"') inQuotes = !inQuotes;
                                else if (c === separator && !inQuotes) { row.push(currentVal); currentVal = ''; } 
                                else currentVal += c;
                            }
                            row.push(currentVal);
                            rawData.push(row);
                        }
                    });
                }
            }

            let dataStartIdx = -1;
            let colMapping = [];

            // [CHIẾN LƯỢC MỚI]: MAPPING TRỰC TIẾP THEO INDEX CỘT CHO BẢNG QOE VÀ QOS
            // Lấy dữ liệu bắt đầu chính xác từ Hàng 8 (Index = 7)
            if (networkType === 'mbb_qoe' || networkType === 'mbb_qos') {
                dataStartIdx = 7; 

                // Tuy nhiên, đối với file CSV export từ hệ thống (nếu có), cấu trúc có thể bị thay đổi. 
                // Vậy nên vẫn cần đoạn mã tự vệ này để tự dò dòng dữ liệu nếu Index 7 không chứa Cell Name
                let checkRow = rawData[dataStartIdx] || [];
                let hasCellData = String(checkRow[5] || '').toUpperCase().match(/^(3G|4G|5G)/) || String(checkRow[0] || '').toUpperCase() === 'THA';
                
                if (!hasCellData) {
                    for (let i = 0; i < Math.min(20, rawData.length); i++) {
                        const row = rawData[i];
                        if (!row || row.length < 6) continue; 
                        let colF = String(row[5] || '').trim().toUpperCase(); 
                        let colA = String(row[0] || '').trim().toUpperCase(); 
                        
                        if (colF.match(/^(3G|4G|5G)/) || (colA.length === 3 && colA !== 'STT' && colA !== 'MÃ')) {
                            // Loại trừ các dòng header
                            if (!colF.includes('CELL') && !colF.includes('SITE')) {
                                dataStartIdx = i;
                                break;
                            }
                        }
                    }
                }

                // Bảng Mapping Tĩnh (Ánh xạ chính xác theo ký tự A, B, C...)
                colMapping = [
                    { excelIdx: 0, dbCol: 'Ma_Tinh' },    // Cột A
                    { excelIdx: 1, dbCol: 'Don_Vi' },     // Cột B
                    { excelIdx: 3, dbCol: 'Phuong_Xa' },  // Cột D
                    { excelIdx: 4, dbCol: 'Site_Name' },  // Cột E
                    { excelIdx: 5, dbCol: 'Cell_Name' },  // Cột F
                    { excelIdx: 6, dbCol: 'Cell_ID' }     // Cột G
                ];

                if (networkType === 'mbb_qos') {
                    colMapping.push(
                        { excelIdx: 8, dbCol: 'QoS_Score' },  // Cột I
                        { excelIdx: 7, dbCol: 'QoS_Rank' },   // Cột H
                        { excelIdx: 9, dbCol: 'Norm_Res' },   // Cột J
                        { excelIdx: 10, dbCol: 'Norm_Acc' },  // Cột K
                        { excelIdx: 11, dbCol: 'Norm_Ret' },  // Cột L
                        { excelIdx: 12, dbCol: 'Norm_Int' },  // Cột M
                        { excelIdx: 13, dbCol: 'Norm_DL' },   // Cột N (Đã sửa từ Cov -> DL)
                        { excelIdx: 14, dbCol: 'Point_Res' }, // Cột O
                        { excelIdx: 15, dbCol: 'Point_Acc' }, // Cột P
                        { excelIdx: 16, dbCol: 'Point_Ret' }, // Cột Q
                        { excelIdx: 17, dbCol: 'Point_Int' }, // Cột R
                        { excelIdx: 18, dbCol: 'Point_DL' },  // Cột S (Đã sửa từ Cov -> DL)
                        { excelIdx: 19, dbCol: 'Out_Res' },   // Cột T
                        { excelIdx: 20, dbCol: 'Out_Acc' },   // Cột U
                        { excelIdx: 21, dbCol: 'Out_Ret' },   // Cột V
                        { excelIdx: 22, dbCol: 'Out_Int' },   // Cột W
                        { excelIdx: 23, dbCol: 'Out_DL' },    // Cột X (Đã sửa từ Cov -> DL)
                        { excelIdx: 24, dbCol: 'In_Res' },    // Cột Y
                        { excelIdx: 25, dbCol: 'In_Acc' },    // Cột Z
                        { excelIdx: 26, dbCol: 'In_Ret' },    // Cột AA
                        { excelIdx: 27, dbCol: 'In_Int' },    // Cột AB
                        { excelIdx: 28, dbCol: 'In_DL' }      // Cột AC (Đã sửa từ Cov -> DL)
                    );
                } else if (networkType === 'mbb_qoe') {
                    // Mapping tương tự cho QoE (Giả định cấu trúc tương tự)
                    colMapping.push(
                        { excelIdx: 8, dbCol: 'QoE_Score' },  // Cột I
                        { excelIdx: 7, dbCol: 'QoE_Rank' },   // Cột H
                        { excelIdx: 9, dbCol: 'Norm_Speed' }, // Cột J
                        { excelIdx: 10, dbCol: 'Norm_Latency' },// Cột K
                        { excelIdx: 11, dbCol: 'Norm_Jitter' }, // Cột L
                        { excelIdx: 12, dbCol: 'Norm_PacketLoss' }, // Cột M
                        { excelIdx: 13, dbCol: 'Norm_DL' },   // Cột N (Đã sửa từ Cov -> DL)
                        { excelIdx: 14, dbCol: 'Point_Speed' },// Cột O
                        { excelIdx: 15, dbCol: 'Point_Latency' },// Cột P
                        { excelIdx: 16, dbCol: 'Point_Jitter' }, // Cột Q
                        { excelIdx: 17, dbCol: 'Point_PacketLoss' },// Cột R
                        { excelIdx: 18, dbCol: 'Point_DL' },  // Cột S (Đã sửa từ Cov -> DL)
                        { excelIdx: 19, dbCol: 'Out_Speed' }, // Cột T
                        { excelIdx: 20, dbCol: 'Out_Latency' },// Cột U
                        { excelIdx: 21, dbCol: 'Out_Jitter' }, // Cột V
                        { excelIdx: 22, dbCol: 'Out_PacketLoss' },// Cột W
                        { excelIdx: 23, dbCol: 'Out_DL' },    // Cột X (Đã sửa từ Cov -> DL)
                        { excelIdx: 24, dbCol: 'In_Speed' },  // Cột Y
                        { excelIdx: 25, dbCol: 'In_Latency' }, // Cột Z
                        { excelIdx: 26, dbCol: 'In_Jitter' },  // Cột AA
                        { excelIdx: 27, dbCol: 'In_PacketLoss' }, // Cột AB
                        { excelIdx: 28, dbCol: 'In_DL' }      // Cột AC (Đã sửa từ Cov -> DL)
                    );
                }

                // Đảm bảo các cột map tồn tại trong DB
                colMapping = colMapping.filter(m => dbCols.some(c => c.original.toLowerCase() === m.dbCol.toLowerCase()));
            } 
            else {
                // ---------------------------------------------------------
                // MAPPING ĐỘNG CHO CÁC BẢNG KHÁC (KPI, RF, CSHT...)
                // ---------------------------------------------------------
                let headerRowIdx = -1;
                for (let i = 0; i < Math.min(30, rawData.length); i++) {
                    if (!rawData[i]) continue;
                    const rowStr = JSON.stringify(rawData[i]).toLowerCase();
                    if (rowStr.includes('thoi gian') || rowStr.includes('thời gian') ||
                        rowStr.includes('tên cell') || rowStr.includes('cell name') ||
                        rowStr.includes('site name') || rowStr.includes('cell_code') || 
                        rowStr.includes('cell code') || rowStr.includes('enodeb name') || rowStr.includes('index 0') ||
                        rowStr.includes('tuan') || rowStr.includes('tuần') || 
                        rowStr.includes('poi') || rowStr.includes('mã csht') ||
                        rowStr.includes('từ khóa chính') || rowStr.includes('nguyên nhân') ||
                        rowStr.includes('mã thiết bị') || rowStr.includes('loại card') || rowStr.includes('mã vt') || rowStr.includes('part number')) {
                        headerRowIdx = i; dataStartIdx = i + 1; break;
                    }
                }
                
                if (headerRowIdx === -1 || !rawData[headerRowIdx]) continue;
                let excelHeaders = rawData[headerRowIdx].map(h => String(h || '').replace(/['"]/g, '').trim());

                if (['rf_3g', 'rf_4g', 'rf_5g', 'csht_data', 'vat_tu', 'alarm_data', 'ta_query'].includes(networkType)) {
                    let isSchemaChanged = false;
                    for (let h of excelHeaders) {
                        let lastWord = h.split('|').pop().trim();
                        if (!lastWord) continue;
                        
                        // [FIX] Cập nhật bộ lọc: Bỏ qua cột STT không cho Auto-Migration tạo tự động
                        if (lastWord.toUpperCase() === 'STT') continue;

                        let safeName = createSafeColumnName(lastWord);
                        if (!safeName) continue;
                        let normH = normalizeStr(lastWord);
                        let exists = dbCols.some(c => c.norm === normH || c.original.toLowerCase() === safeName.toLowerCase());
                        if (!exists) {
                            try {
                                console.log(`⚡ Auto-Migration: Thêm cột mới [${safeName}] vào bảng ${networkType}`);
                                await db.query(`ALTER TABLE ${networkType} ADD COLUMN \`${safeName}\` VARCHAR(255)`);
                                isSchemaChanged = true;
                            } catch (e) { console.error(`Lỗi tạo cột ${safeName}:`, e.message); }
                        }
                    }
                    if (isSchemaChanged) {
                        const [newCols] = await db.query(`SHOW COLUMNS FROM ${networkType}`);
                        dbCols = newCols.map(c => ({ original: c.Field, norm: normalizeStr(c.Field) }));
                    }
                }

                excelHeaders.forEach((exHeader, idx) => {
                    if (!exHeader) return;
                    
                    let h = String(exHeader).toLowerCase().replace(/[\ufeff\u200b\r\n]/g, ' ').trim();
                    let mappedCol = null;

                    // 1. Dò tìm trực tiếp với Database
                    let exactMatch = dbCols.find(dbC => {
                        let orig = dbC.original.toLowerCase();
                        return orig === h || orig === h.replace(/ /g, '_');
                    });

                    if (exactMatch) {
                        mappedCol = exactMatch.original;
                    }
                    else {
                        if (networkType === 'kpi_3g') {
                            if (h === 'stt') mappedCol = null;
                            else if (h.includes('nhà cung cấp') || h.includes('nha_cung_cap')) mappedCol = 'Nha_cung_cap';
                            else if (h.includes('tỉnh') || h.includes('tinh')) mappedCol = 'Tinh';
                            else if (h.includes('tên rnc') || h.includes('ten rnc')) mappedCol = 'Ten_RNC';
                            else if (h.includes('tên cell') || h.includes('cell name') || h.includes('ten_cell')) mappedCol = 'Ten_CELL';
                            else if (h.includes('mã vnp') || h.includes('ma vnp')) mappedCol = 'Ma_VNP';
                            else if (h.includes('loại ne') || h.includes('loai ne')) mappedCol = 'Loai_NE';
                            else if (h === 'lac') mappedCol = 'LAC';
                            else if (h === 'ci' || h === 'cell id') mappedCol = 'CI';
                            else if (h.includes('thời gian') || h.includes('thoi gian')) mappedCol = 'Thoi_gian';
                            else if (h.includes('cs_so_att')) mappedCol = 'CS_SO_ATT';
                            else if (h.includes('cs_if_att')) mappedCol = 'CS_IF_ATT';
                            else if (h.includes('cs_ir_att')) mappedCol = 'CS_IR_ATT';
                            else if (h.includes('ps_if_att')) mappedCol = 'PS_IF_ATT';
                            else if (h.includes('ps_ir_att')) mappedCol = 'PS_IR_ATT';
                            else if (h.includes('ps_so_att')) mappedCol = 'PS_SO_ATT';
                            else if (h.includes('cs_voice call setup success rate')) mappedCol = 'CSVOICECSSR';
                            else if (h.includes('v2_dl traffic ps')) mappedCol = 'DLTRAFFICPS';
                            else if (h.includes('cs_inter-rat handover success rate weight')) mappedCol = 'CSIRATHOSRWEIGHT';
                            else if (h.includes('ps_hspa call drop rate')) mappedCol = 'PSHSPACALLDROPRATE';
                            else if (h.includes('cs_video drop call rate')) mappedCol = 'CSVIDEODROPCALLRATE';
                            else if (h.includes('cs_inter-freq handover success rate')) mappedCol = 'CSINTERFREQHOSR';
                            else if (h.includes('v2_ul traffic ps')) mappedCol = 'ULTRAFFICPS';
                            else if (h.includes('cs_video traffic')) mappedCol = 'CSVIDEOTRAFFIC';
                            else if (h.includes('ps_r99 call setup success rate')) mappedCol = 'PSR99CALLSETUPSR';
                            else if (h.includes('cs_voice drop call rate')) mappedCol = 'CSVOICEDROPCALLRATE';
                            else if (h.includes('ps_hsdpa cell throughput (kbps)') || h.includes('ps_hsdpa cell throughput')) mappedCol = 'PSHSDPATPKBPS';
                            else if (h.includes('cs_soft/softer handover success rate')) mappedCol = 'SOFTHOSR';
                            else if (h.includes('ps_r99 up link traffic (gb)') || h.includes('ps_r99 up link traffic')) mappedCol = 'PSR99UPLINKTRAFFICGB';
                            else if (h.includes('cs_total active set traffic')) mappedCol = 'TRAFFICACTIVESETCS64';
                            else if (h === 'cs_total traffic' || h === 'traffic' || h.includes('cs_total traffic')) mappedCol = 'TRAFFIC';
                            else if (h.includes('ps_total traffic (gb)') || h === 'ps_total traffic') mappedCol = 'PSTRAFFIC';
                            else if (h.includes('ps_r99 traffic (gb)') || h.includes('ps_r99 traffic')) mappedCol = 'PSR99TRAFFICGB';
                            else if (h.includes('cs_voice call volume')) mappedCol = 'CALLVOLUME';
                            else if (h.includes('ps_hspa traffic (gb)') || h.includes('ps_hspa traffic')) mappedCol = 'PSHSPATRAFFICGB';
                            else if (h.includes('ps_rab congestion rate') || h.includes('ps_rab congestion')) mappedCol = 'PSCONGES';
                            else if (h.includes('cs_drop call rate') || h.includes('cs_drop call')) mappedCol = 'DCR';
                            else if (h.includes('ps_call setup success rate')) mappedCol = 'PSCSSR';
                            else if (h.includes('cs_call setup success rate') || h.includes('cs_call setup success')) mappedCol = 'CSSR';
                            else if (h.includes('cs_inter-rat handover success rate') && !h.includes('weight')) mappedCol = 'IRATHOSR';
                            else if (h.includes('ps_r99_hspa_d_r')) mappedCol = 'PSDCR';
                            else if (h.includes('cs_video call setup success rate')) mappedCol = 'CSSRVIDEOPHONE';
                            else if (h.includes('ps_inter-rat handover success rate')) mappedCol = 'PSIRATHOSR';
                            else if (h.includes('ps_soft/softer handover success rate')) mappedCol = 'SOFTHOSRPS';
                            else if (h.includes('cs_rab congestion rate') || h.includes('cs_rab congestion')) mappedCol = 'CSCONGES';
                            else if (h.includes('ps_inter-freq handover success rate')) mappedCol = 'V2INTERFREQHOSRPS';
                            else if (h.includes('ps_r99 cell down link throughput (kbps)') || h.includes('ps_r99 cell down link throughput')) mappedCol = 'R99DLTHROUGHPUT';
                            else if (h.includes('ps_r99 call drop rate')) mappedCol = 'PSR99CALLDROPRATE';
                            else if (h.includes('ps_hsupa cell throughput (kbps)') || h.includes('ps_hsupa cell throughput')) mappedCol = 'PSHSUPATPKBPS';
                            else if (h.includes('ps_r99 down link traffic (gb)') || h.includes('ps_r99 down link traffic')) mappedCol = 'PSR99DLTRAFFICGB';
                            else if (h.includes('ps_hsupa traffic (gb)') || h.includes('ps_hsupa traffic')) mappedCol = 'PSHSUPATRAFFICGB';
                            else if (h.includes('ps_hsdpa traffic (gb)') || h.includes('ps_hsdpa traffic')) mappedCol = 'PSHSDPATRAFFICGB';
                            else if (h.includes('ps_hspa call setup success rate')) mappedCol = 'PSHSPACSSR';
                            else if (h.includes('ps_r99 cell up link throughput (kbps)') || h.includes('ps_r99 cell up link throughput')) mappedCol = 'R99ULTHROUGHPUT';
                        } 
                        else if (networkType === 'kpi_4g') {
                            if (h.includes('site name')) mappedCol = 'Site_name';
                            else if (h.includes('celltype')) mappedCol = 'CellType';
                            else if (h.includes('district code')) mappedCol = 'District_code';
                            else if (h.includes('cell name')) mappedCol = 'Cell_name';
                            else if (h.includes('mimo')) mappedCol = 'MIMO';
                            else if (h.includes('thời gian') || h.includes('thoi gian')) mappedCol = 'Thoi_gian';
                            
                            // ---------------- VoLTE & HO ----------------
                            else if (h.includes('ul traffic volte')) mappedCol = 'UL_Traffic_VoLTE_GB';
                            else if (h.includes('average ul throughput of services with a qci of 1')) mappedCol = 'Avg_UL_throughput_QCI_1';
                            else if (h.includes('volte traffic (erl)')) mappedCol = 'VoLTE_Traffic_Erl';
                            else if (h.includes('total traffic volte')) mappedCol = 'Total_Traffic_VoLTE_GB';
                            else if (h.includes('volte e-rab call setup success rate')) mappedCol = 'VoLTE_ERAB_Call_Setup_SR';
                            else if (h.includes('intra-frequency ho success rates (volte)')) mappedCol = 'Intra_freq_HO_SR_VoLTE';
                            else if (h.includes('inter-frequency ho success rates (volte)')) mappedCol = 'Inter_freq_HO_SR_VoLTE';
                            else if (h.includes('dl traffic volte')) mappedCol = 'DL_Traffic_VoLTE_GB';
                            else if (h.includes('average dl throughput of services with a qci of 1')) mappedCol = 'Avg_DL_throughput_QCI_1';
                            else if (h.includes('call drop rate (volte)')) mappedCol = 'Call_Drop_Rate_VoLTE';
                            else if (h.includes('srvcc success rate (lte to wcdma)')) mappedCol = 'SRVCC_SR_LTE_to_WCDMA';
                            
                            // ---------------- Data 4G Tốc Độ & PRB ----------------
                            else if (h.includes('user uplink average throughput')) mappedCol = 'User_UL_Avg_Throughput_Kbps';
                            else if (h.includes('user downlink average throughput')) mappedCol = 'User_DL_Avg_Throughput_Kbps';
                            else if (h === 'traffic volume ul (gb)' || h.includes('traffic volume ul')) mappedCol = 'Traffic_Volume_UL_GB';
                            else if (h === 'traffic volumn dl (gb)' || h.includes('traffic volumn dl')) mappedCol = 'Traffic_Volumn_DL_GB';
                            else if (h.includes('total data traffic')) mappedCol = 'Total_Data_Traffic_Volume_GB';
                            else if (h.includes('total ue')) mappedCol = 'Total_UE';
                            else if (h.includes('service drop')) mappedCol = 'Service_Drop_all';
                            else if (h.includes('utilizing rate uplink') || h.includes('untilizing rate uplink')) mappedCol = 'RB_Util_Rate_UL';
                            else if (h.includes('utilizing rate downlink') || h.includes('untilizing rate downlink')) mappedCol = 'RB_Util_Rate_DL';
                            
                            // ---------------- Handover & Thiết Lập ----------------
                            else if (h.includes('intra_hosr_att') || h.includes('attemp intra hosr')) mappedCol = 'INTRA_HOSR_ATT';
                            else if (h.includes('intra-frequency ho (%)') || h.includes('intra-frequency ho')) mappedCol = 'Intra_frequency_HO';
                            else if (h.includes('intra enb ho sr total')) mappedCol = 'Intra_eNB_HO_SR_total';
                            else if (h.includes('inter-frequency ho (%)') || h.includes('inter-frequency ho')) mappedCol = 'Inter_frequency_HO';
                            else if (h.includes('inter rat total ho sr')) mappedCol = 'Inter_RAT_Total_HO_SR';
                            else if (h.includes('inter rat ho preparation success ratio')) mappedCol = 'Inter_RAT_HO_Prep_SR';
                            else if (h.includes('inter-rat hosr (lte to wcdma)')) mappedCol = 'Inter_RAT_HOSR_LTE_to_WCDMA';
                            else if (h.includes('inter rat ho sr (execution phase)')) mappedCol = 'Inter_RAT_HO_SR_Exec';
                            else if (h.includes('erab setup success rate')) mappedCol = 'eRAB_Setup_SR_All';
                            else if (h.includes('cs call setup success rate max test')) mappedCol = 'CS_Call_Setup_SR_Max';
                            else if (h.includes('downlink latency')) mappedCol = 'Downlink_Latency';
                            else if (h === 'call setup success rate') mappedCol = 'Call_Setup_SR';
                            else if (h.includes('e-utran initial context setup success ratio')) mappedCol = 'E_UTRAN_Init_Context_Setup_SR_CSFB';
                            else if (h.includes('csfb_att')) mappedCol = 'CSFB_ATT';
                            else if (h.includes('cqi_4g') || h.includes('cqi 4g') || h.match(/\bcqi\b/)) mappedCol = 'CQI_4G';
                            
                            // ---------------- Cột Dự Phòng Đuôi ----------------
                            else if (h.includes('cell uplink max throughput')) mappedCol = 'Col42';
                            else if (h.includes('cell pdcp uplink average throughput')) mappedCol = 'Col43';
                            else if (h.includes('cell downlink max throughput')) mappedCol = 'Col44';
                            else if (h.includes('cell pdcp downlink average throughput')) mappedCol = 'Col45';
                            else if (h.includes('average ue distance to base station')) mappedCol = 'Col46';
                            else if (h.includes('avaiable')) mappedCol = 'Col47';
                        } 
                        else if (networkType === 'kpi_5g') {
                            if (h.includes('nhà cung cấp') || h.includes('nha_cung_cap')) mappedCol = 'Nha_cung_cap';
                            else if (h.match(/\btỉnh\b|\btinh\b/)) mappedCol = 'Tinh';
                            else if (h.includes('tên gnodeb') || h.includes('ten_gnodeb')) mappedCol = 'Ten_GNODEB';
                            else if (h.includes('tên cell') || h.includes('ten_cell')) mappedCol = 'Ten_CELL';
                            else if (h.includes('mã vnp') || h.includes('ma_vnp')) mappedCol = 'Ma_VNP';
                            else if (h.includes('loại ne') || h.includes('loai_ne')) mappedCol = 'Loai_NE';
                            else if (h.includes('gnodeb_id') || h.includes('gnodeb id')) mappedCol = 'GNODEB_ID';
                            else if (h.includes('cell_id') || h.includes('cell id')) mappedCol = 'CELL_ID';
                            else if (h.includes('thời gian') || h.includes('thoi gian')) mappedCol = 'Thoi_gian';
                            else if (h.includes('user_dl_avg_throughput') || h.includes('a user downlink average')) mappedCol = 'A_User_DL_Avg_Throughput';
                            else if (h.includes('user_ul_avg_throughput') || h.includes('a user uplink average')) mappedCol = 'A_User_UL_Avg_Throughput';
                            else if (h.match(/\btraffic\b/) || h.includes('total data traffic')) mappedCol = 'Total_Data_Traffic_Volume_GB';
                            else if (h.includes('cqi_5g') || h.includes('cqi 5g') || h.match(/\bcqi\b/)) mappedCol = 'CQI_5G';
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
                            if (h.includes('cell_code') || h.includes('cell code')) mappedCol = 'Cell_Code';
                            else if (h.includes('site_code') || h.includes('site code')) mappedCol = 'Site_Code';
                            else if (h.includes('poi')) mappedCol = 'POI';
                        } 
                        else if (networkType.startsWith('rf_')) {
                            if (h.includes('cell_code') || h.includes('cell code') || h.includes('cell name') || h.includes('ten_cell')) mappedCol = 'Cell_code';
                            else if (h.includes('site_code') || h.includes('site code') || h.includes('site name')) mappedCol = 'Site_code';
                            else if (h.match(/\blat\b|\blatitude\b|\bvĩ độ\b/)) mappedCol = 'Latitude';
                            else if (h.match(/\blong\b|\blongitude\b|\bkinh độ\b/)) mappedCol = 'Longitude';
                            else if (h.match(/\bazimuth\b|\bdir\b/)) mappedCol = 'Azimuth';
                            else if (h.match(/\btilt\b|\bm_tilt\b/)) mappedCol = 'Tilt';
                            else if (h.includes('mimo')) mappedCol = 'MIMO';
                        } 
                        else if (networkType === 'csht_data') {
                            if (h.includes('mã csht') || h.includes('ma csht')) mappedCol = 'Ma_CSHT';
                            else if (h.includes('tên csht') || h.includes('ten csht')) mappedCol = 'Ten_CSHT';
                            else if (h.includes('địa chỉ') || h.includes('dia chi')) mappedCol = 'Dia_Chi';
                            else if (h.match(/\blong\b|\blongitude\b|\bkinh độ\b/)) mappedCol = 'Longitude';
                            else if (h.match(/\blat\b|\blatitude\b|\bvĩ độ\b/)) mappedCol = 'Latitude';
                            else if (h.includes('loại nhà trạm')) mappedCol = 'Loai_Nha_Tram';
                            else if (h.includes('đơn vị quản lý')) mappedCol = 'Don_Vi_Quan_Ly';
                            else if (h.includes('mã trạm 2g') || h.includes('tram 2g')) mappedCol = 'Ma_Tram_2G';
                            else if (h.includes('mã trạm 3g') || h.includes('tram 3g')) mappedCol = 'Ma_Tram_3G';
                            else if (h.includes('mã trạm 4g') || h.includes('tram 4g')) mappedCol = 'Ma_Tram_4G';
                            else if (h.includes('mã trạm 5g') || h.includes('tram 5g')) mappedCol = 'Ma_Tram_5G';
                            else if (h.includes('ip-3g') || h.includes('ip 3g')) mappedCol = 'IP_3G';
                            else if (h.includes('ip-4g') || h.includes('ip 4g')) mappedCol = 'IP_4G';
                            else if (h.includes('ip-5g') || h.includes('ip 5g')) mappedCol = 'IP_5G';
                            else if (h.includes('so với mặt đất') || h.includes('mat dat')) mappedCol = 'Chieu_Cao_Mat_Dat';
                            else if (h.includes('chiều cao cột') || h.includes('chieu cao cot')) mappedCol = 'Chieu_Cao_Cot';
                            else if (h.includes('hình thức sở hữu') || h.includes('so huu')) mappedCol = 'Hinh_Thuc_So_Huu';
                        } 
                        else if (networkType === 'alarm_data') {
                            if (h.includes('nhóm cảnh báo') || h.includes('nhóm')) mappedCol = 'nhom_canh_bao';
                            else if (h.includes('từ khóa chính trong tin nhắn') || h.includes('từ khóa')) mappedCol = 'tu_khoa';
                            else if (h.includes('nguyên nhân')) mappedCol = 'nguyen_nhan';
                            else if (h.includes('phương án kiểm tra, xử lý') || h.includes('phương án')) mappedCol = 'phuong_an_xu_ly';
                        } 
                        else if (networkType === 'vat_tu') {
                            if (h.match(/\bmã\b|\bma\b/)) mappedCol = 'ma_vt';
                            else if (h.match(/\btên\b|\bten\b/)) mappedCol = 'ten_vt';
                            else if (h.includes('tên đầy đủ') || h.includes('ten day du')) mappedCol = 'ten_day_du';
                            else if (h.includes('đơn vị tính') || h.includes('don vi tinh')) mappedCol = 'don_vi_tinh';
                            else if (h.includes('mã thiết bị') || h.includes('part number')) mappedCol = 'ma_thiet_bi';
                            else if (h.includes('loại card') || h.includes('loai card')) mappedCol = 'loai_card';
                            else if (h.includes('tên viết tắt') || h.includes('viet tat')) mappedCol = 'ten_viet_tat';
                        }
                    }

                    if (mappedCol) {
                        let dbMatch = dbCols.find(c => c.original.toLowerCase() === mappedCol.toLowerCase());
                        if (dbMatch) {
                            let existingMap = colMapping.find(m => m.dbCol === dbMatch.original);
                            if (existingMap) {
                                existingMap.excelIdx = idx;
                            } else {
                                colMapping.push({ excelIdx: idx, dbCol: dbMatch.original });
                            }
                        }
                    }
                });
            }

            if (colMapping.length === 0) continue;

            // XỬ LÝ LỖI NGÀY: Tiến hành xóa dữ liệu 1 ngày được chỉ định trước khi Insert (Chỉ áp dụng cho KPI 3G/4G/5G)
            const isDailyKpi = networkType === 'kpi_3g' || networkType === 'kpi_4g' || networkType === 'kpi_5g';
            let uniqueDatesToClear = new Set();
            
            let hasTuanCol = weekPrefix ? dbCols.some(c => c.original.toLowerCase() === 'tuan') : false;
            let lastValidDate = null; 
            const insertData = [];
            
            const stringColumns = [
                'Thoi_gian', 'Date', 'Cell_name', 'Ten_CELL', 'Site_name', 'Cell_code', 
                'Ma_Tinh', 'Don_Vi', 'Phuong_Xa', 'Ten_GNODEB', 'CellType', 'District_code', 
                'MIMO', 'CI', 'CELL_ID', 'Cell_ID', 'Tuan', 'POI', 'Cell_Code', 'Site_Code',
                'eNodeB_Name', 'Cell_FDD_TDD_Indication', 'LocalCell_Id', 'eNodeB_Function_Name'
            ];

            // BẮT BUỘC QUÉT TỪ DÒNG DỮ LIỆU THỰC TẾ
            for (let i = dataStartIdx; i < rawData.length; i++) {
                const row = rawData[i];
                if (!row || row.length === 0) continue; 
                
                // Tránh lỗi khi row[0] là Number
                let firstCellStr = String(row[0] || '').toLowerCase().trim();
                if (firstCellStr === 'summary' || firstCellStr.includes('không thành công') || firstCellStr.includes('phân trang')) continue; 

                const rowObj = {}; 
                let hasKpiData = false;
                let hasValidIdentifier = false;

                colMapping.forEach(map => {
                    let val = row[map.excelIdx];
                    let isStrCol = stringColumns.some(sc => sc.toLowerCase() === map.dbCol.toLowerCase());
                    
                    if (networkType.startsWith('rf_') || networkType === 'csht_data') {
                        let floatRfCols = ['latitude', 'longitude', 'azimuth', 'tilt', 'height', 'ant_height', 'chieu_cao_cot', 'chieu_cao_mat_dat'];
                        if (!floatRfCols.includes(map.dbCol.toLowerCase())) {
                            isStrCol = true;
                        }
                    }

                    if (!isStrCol) {
                        if (val === null || val === undefined || val === '' || String(val).trim() === '') {
                            val = null; 
                        } else if (typeof val === 'string') {
                            val = getSafeFloat(val); 
                        } else if (typeof val === 'number') {
                            val = isNaN(val) ? null : val;
                        }
                    }

                    if (map.dbCol === 'Thoi_gian' || map.dbCol === 'Date') {
                        if (val !== null && val !== '') {
                            val = formatExcelDate(val);
                            if (typeof val === 'string') {
                                val = val.split(' ')[0].replace(/['"]/g, '');
                                if (val.match(/^\d{4}-\d{2}-\d{2}$/)) {
                                    let parts = val.split('-');
                                    val = `${parts[2]}/${parts[1]}/${parts[0]}`;
                                }
                            }
                            lastValidDate = val; 
                        } else { val = lastValidDate; }
                    }
                    
                    rowObj[map.dbCol] = val;
                    if (val !== null && val !== undefined && val !== '') hasKpiData = true;

                    // Chỉ kiểm tra valid Identifier nếu không phải bảng QoE/QoS (vì QoE/QoS lấy dòng chính xác 100% rồi)
                    if (networkType !== 'mbb_qoe' && networkType !== 'mbb_qos') {
                        let colNameStr = map.dbCol.toLowerCase();
                        if (['cell_name', 'site_name', 'cell_id', 'ten_cell', 'ci', 'cell_code', 'site_code', 'ma_csht', 'ma_vt'].includes(colNameStr)) {
                            let stringVal = String(val).toLowerCase().trim().replace(/['"]/g, '');
                            if (stringVal && !stringVal.includes('tên cell') && !stringVal.includes('cell name') && stringVal !== 'site' && stringVal !== 'cell') {
                                hasValidIdentifier = true;
                            }
                        }
                    } else {
                        // Đối với QoE/QoS, chỉ cần có dữ liệu ở các cột chính là cho qua
                        if (map.excelIdx === 4 || map.excelIdx === 5 || map.excelIdx === 6) {
                            if (val && String(val).trim() !== '') hasValidIdentifier = true;
                        }
                    }
                });

                if (hasKpiData && hasValidIdentifier) {
                    if (weekPrefix && hasTuanCol) rowObj['Tuan'] = weekPrefix;
                    insertData.push(rowObj);
                    
                    // Gom các ngày xuất hiện trong file KPI để Xóa trước khi đè
                    if (isDailyKpi && rowObj['Thoi_gian']) {
                        uniqueDatesToClear.add(rowObj['Thoi_gian']);
                    }
                }
            }

            // XÓA SẠCH DỮ LIỆU CŨ CỦA CÁC NGÀY NẰM TRONG FILE IMPORT TRƯỚC KHI GHI (Tính năng mới)
            if (isDailyKpi && uniqueDatesToClear.size > 0) {
                const datesArray = Array.from(uniqueDatesToClear);
                const placeholders = datesArray.map(() => '?').join(',');
                try { 
                    await db.query(`DELETE FROM ${networkType} WHERE Thoi_gian IN (${placeholders})`, datesArray); 
                    console.log(`🧹 Đã dọn sạch dữ liệu cũ của các ngày: ${datesArray.join(', ')} trong bảng ${networkType} để nhường chỗ cho dữ liệu mới.`);
                } catch (e) {
                    console.error("Lỗi khi xóa đè dữ liệu cũ:", e);
                }
            } else if (insertData.length > 0 && networkType === 'ta_query') {
                // Xóa đè dữ liệu TA_Query (logic cũ)
                const dateCol = 'Date';
                const uniqueDates = [...new Set(insertData.map(r => r[dateCol]).filter(Boolean))];
                if (uniqueDates.length > 0) {
                    const placeholders = uniqueDates.map(() => '?').join(',');
                    try { 
                        await db.query(`DELETE FROM ${networkType} WHERE \`${dateCol}\` IN (${placeholders})`, uniqueDates); 
                    } catch (e) {}
                }
            }

            if (insertData.length > 0) {
                const chunkSize = 500;
                for (let i = 0; i < insertData.length; i += chunkSize) {
                    let chunk = insertData.slice(i, i + chunkSize);
                    
                    let allKeys = new Set();
                    chunk.forEach(obj => Object.keys(obj).forEach(k => allKeys.add(k)));
                    const keys = Array.from(allKeys);

                    const valuesArr = chunk.map(obj => keys.map(k => {
                        let val = obj[k];
                        if (val === undefined) return null;
                        return (typeof val === 'string') ? val.trim() : val;
                    })); 
                    
                    let sql = `INSERT INTO ${networkType} (${keys.map(k => `\`${k}\``).join(',')}) VALUES ?`;
                    
                    if (['alarm_data', 'csht_data', 'vat_tu'].includes(networkType)) {
                        let updateCols = keys.map(k => `\`${k}\`=VALUES(\`${k}\`)`).join(', ');
                        sql += ` ON DUPLICATE KEY UPDATE ${updateCols}`;
                    }

                    await db.query(sql, [valuesArr]);
                }
                totalImported += insertData.length;
            }
        } catch (error) { console.error(`Lỗi file:`, error); }
    } 

    const runBackgroundSync = async () => {
        try {
            console.log("⚙️ Kích hoạt tiến trình đồng bộ ngầm...");
            if (isKpiImported) {
                await aggregateDashboardData();
                await syncWorstCells();
                await syncCongestion3G();
                await syncTrafficDown();
                await syncBadCells();
            }
            if (['mbb_qoe', 'mbb_qos', 'kpi_4g'].includes(networkType)) {
                await syncQoeQosSummary();
            }
            console.log("✅ HOÀN TẤT TOÀN BỘ TIẾN TRÌNH ĐỒNG BỘ CẢNH BÁO VÀ CACHE.");
        } catch (err) {
            console.error("❌ Lỗi trong tiến trình đồng bộ ngầm:", err);
        }
    };
    runBackgroundSync();

    history = await getKpiHistory(); 
    return res.render('import_data', { 
        title: 'Import Data', 
        page: 'Import Data', 
        userRole: userRole, 
        history: history, 
        message: `Đã Import/Ghi đè thành công ${totalImported} dòng. Hệ thống đang tiến hành tính toán ngầm...`, 
        error: null 
    });
};

/* STREAMING_CHUNK:Base data retrieval APIs... */
exports.getDistricts = async (req, res) => {
    try {
        const [rows] = await db.query('SELECT DISTINCT District_code FROM kpi_4g WHERE District_code IS NOT NULL AND District_code != "" ORDER BY District_code');
        res.json(rows.map(r => r.District_code));
    } catch (error) { res.status(500).json([]); }
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
    } catch (error) { res.status(500).json({ error: "Lỗi truy xuất CSDL." }); }
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
        
        let latestDate = "N/A";
        let lastWeekDate = "N/A";
        
        if (rows.length > 0) {
            latestDate = rows[0].latest_date || "N/A";
            lastWeekDate = rows[0].last_week_date || "N/A";
        } else {
            try {
                const [datesRaw] = await db.query(`SELECT MAX(Thoi_gian) as t0 FROM kpi_4g`);
                if (datesRaw.length > 0 && datesRaw[0].t0) latestDate = datesRaw[0].t0;
            } catch(e) {}
        }
        
        let zero_1d = []; let zero_3d = []; let zero_7d = [];
        let droppedTrafficCells = [];
        let droppedTrafficPOIs = [];

        rows.forEach(r => {
            if (r.category === 'zero_1d') {
                zero_1d.push({ Cell_name: r.name, network: r.network, t0: Number(r.val_t0).toFixed(2), avgPast: Number(r.val_compare).toFixed(2) });
            } else if (r.category === 'zero_3d') {
                zero_3d.push({ Cell_name: r.name, network: r.network, t0: Number(r.val_t0).toFixed(2), avgPast: Number(r.val_compare).toFixed(2) });
            } else if (r.category === 'zero_7d') {
                zero_7d.push({ Cell_name: r.name, network: r.network, t0: Number(r.val_t0).toFixed(2), avgPast: Number(r.val_compare).toFixed(2) });
            } else if (r.category === 'dropped_cell') {
                droppedTrafficCells.push({ Cell_name: r.name, network: r.network, t0: Number(r.val_t0).toFixed(2), t7: Number(r.val_compare).toFixed(2), ratio: r.ratio });
            } else if (r.category === 'dropped_poi') {
                droppedTrafficPOIs.push({ POI: r.name, network: r.network, t0: Number(r.val_t0).toFixed(2), t7: Number(r.val_compare).toFixed(2), ratio: r.ratio });
            }
        });

        res.json({
            latestDate, lastWeekDate,
            zero_1d: zero_1d.sort((a,b) => b.avgPast - a.avgPast),
            zero_3d: zero_3d.sort((a,b) => b.avgPast - a.avgPast),
            zero_7d: zero_7d.sort((a,b) => b.avgPast - a.avgPast),
            droppedTrafficCells: droppedTrafficCells.sort((a,b) => a.ratio - b.ratio),
            droppedTrafficPOIs: droppedTrafficPOIs.sort((a,b) => a.ratio - b.ratio)
        });
    } catch (error) { 
        console.error("Lỗi API Traffic Down:", error);
        res.status(500).json({ error: "Lỗi truy xuất hệ thống máy chủ CSDL." }); 
    }
};

exports.getBadCellsData = async (req, res) => {
    try {
        const [datesRaw] = await db.query(`SELECT DISTINCT latest_date FROM bad_cells ORDER BY STR_TO_DATE(latest_date, '%d/%m/%Y') DESC LIMIT 1`);
        if(datesRaw.length === 0) return res.json([]);
        const latest = datesRaw[0].latest_date;

        const [rows] = await db.query(`SELECT * FROM bad_cells WHERE latest_date = ? ORDER BY priority ASC, avg_traffic DESC`, [latest]);
        res.json({ latestDate: latest, data: rows });
    } catch (e) { res.status(500).json({ error: "Lỗi CSDL" }); }
};

exports.updateBadCellStatus = async (req, res) => {
    const { id, status, action_note } = req.body;
    try {
        await db.query(`UPDATE bad_cells SET status = ?, action_note = ? WHERE id = ?`, [status, action_note, id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
};

exports.getPoiList = async (req, res) => {
    try {
        const [rows] = await db.query(`SELECT DISTINCT POI FROM (SELECT POI FROM poi_4g UNION SELECT POI FROM poi_5g) AS AllPOIs WHERE POI IS NOT NULL AND POI != '' ORDER BY POI`);
        res.json(rows.map(r => r.POI));
    } catch (error) { res.status(500).json([]); }
};

exports.getAllPoiExportData = async (req, res) => {
    try {
        const query = `
            SELECT p.POI, k.Thoi_gian, 
                   SUM(k.Total_Data_Traffic_Volume_GB) as Traf_4G, AVG(k.User_DL_Avg_Throughput_Kbps) as Thput_4G, AVG(k.CQI_4G) as CQI_4G,
                   0 as Traf_5G, 0 as Thput_5G, 0 as CQI_5G
            FROM poi_4g p JOIN kpi_4g k ON p.Cell_name = k.Cell_name 
            WHERE k.Thoi_gian IS NOT NULL GROUP BY p.POI, k.Thoi_gian
            UNION ALL
            SELECT p.POI, k.Thoi_gian, 
                   0 as Traf_4G, 0 as Thput_4G, 0 as CQI_4G,
                   SUM(k.Total_Data_Traffic_Volume_GB) as Traf_5G, AVG(k.A_User_DL_Avg_Throughput) as Thput_5G, AVG(k.CQI_5G) as CQI_5G
            FROM poi_5g p JOIN kpi_5g k ON p.Cell_Code = k.Ten_CELL 
            WHERE k.Thoi_gian IS NOT NULL GROUP BY p.POI, k.Thoi_gian
        `;
        const [rows] = await db.query(query);
        
        let aggregated = {};
        rows.forEach(r => {
            let key = r.POI + "_" + r.Thoi_gian;
            if (!aggregated[key]) {
                aggregated[key] = { POI: r.POI, Thoi_gian: r.Thoi_gian, count4g: 0, count5g: 0, Traf_4G: 0, Thput_4G: 0, CQI_4G: 0, Traf_5G: 0, Thput_5G: 0, CQI_5G: 0 };
            }
            let a = aggregated[key];
            if (r.Traf_4G > 0 || r.CQI_4G > 0) {
                a.count4g++; a.Traf_4G += r.Traf_4G; a.Thput_4G += r.Thput_4G; a.CQI_4G += r.CQI_4G;
            }
            if (r.Traf_5G > 0 || r.CQI_5G > 0) {
                a.count5g++; a.Traf_5G += r.Traf_5G; a.Thput_5G += r.Thput_5G; a.CQI_5G += r.CQI_5G;
            }
        });
        
        let finalData = Object.values(aggregated).map(a => {
            if (a.count4g > 0) { a.Thput_4G = a.Thput_4G / a.count4g; a.CQI_4G = a.CQI_4G / a.count4g; }
            if (a.count5g > 0) { a.Thput_5G = a.Thput_5G / a.count5g; a.CQI_5G = a.CQI_5G / a.count5g; }
            return a;
        });
        
        res.json(finalData);
    } catch (e) { res.status(500).json([]); }
};

exports.getPoiData = async (req, res) => {
    const poiName = req.query.poi;
    if (!poiName) return res.json({ data: [], has4g: false, has5g: false });

    try {
        const query4G = `
            SELECT k.Thoi_gian, SUM(k.Total_Data_Traffic_Volume_GB) as traffic_4g, AVG(k.User_DL_Avg_Throughput_Kbps) as thput_4g 
            FROM kpi_4g k JOIN poi_4g p ON k.Cell_name = p.Cell_Code 
            WHERE p.POI = ? AND k.Thoi_gian IS NOT NULL AND k.Thoi_gian != '' GROUP BY k.Thoi_gian
        `;
        const [data4g] = await db.query(query4G, [poiName]);

        const query5G = `
            SELECT k.Thoi_gian, SUM(k.Total_Data_Traffic_Volume_GB) as traffic_5g, AVG(k.A_User_DL_Avg_Throughput) as thput_5g 
            FROM kpi_5g k JOIN poi_5g p ON k.Ten_CELL = p.Cell_Code 
            WHERE p.POI = ? AND k.Thoi_gian IS NOT NULL AND k.Thoi_gian != '' GROUP BY k.Thoi_gian
        `;
        const [data5g] = await db.query(query5G, [poiName]);

        let mergedData = {};
        data4g.forEach(r => {
            mergedData[r.Thoi_gian] = { Thoi_gian: r.Thoi_gian, traffic_4g: r.traffic_4g, thput_4g: r.thput_4g, traffic_5g: 0, thput_5g: 0 };
        });
        data5g.forEach(r => {
            if (!mergedData[r.Thoi_gian]) {
                mergedData[r.Thoi_gian] = { Thoi_gian: r.Thoi_gian, traffic_4g: 0, thput_4g: 0 };
            }
            mergedData[r.Thoi_gian].traffic_5g = r.traffic_5g;
            mergedData[r.Thoi_gian].thput_5g = r.thput_5g;
        });

        res.json({
            data: Object.values(mergedData),
            has4g: data4g.length > 0,
            has5g: data5g.length > 0
        });
    } catch (error) { 
        console.error("Lỗi lấy dữ liệu vẽ biểu đồ POI:", error);
        res.status(500).json({ error: "Lỗi cơ sở dữ liệu." }); 
    }
};

exports.getKpiData = async (req, res) => {
    const { network, type, value } = req.query;
    if (!network || !type || !value) return res.json([]);
    try {
        if (type === 'poi') {
            const table = `kpi_${network}`;
            const poiTable = `poi_${network}`;
            const cellCol = network === '4g' ? 'Cell_name' : 'Ten_CELL';
            const [rows] = await db.query(`SELECT k.* FROM ${table} k JOIN ${poiTable} p ON k.${cellCol} = p.Cell_Code WHERE p.POI = ?`, [value]);
            return res.json(rows);
        } else if (type === 'keyword') {
            const table = `kpi_${network}`;
            const rfTable = `rf_${network}`;
            const cellCol = network === '4g' ? 'Cell_name' : 'Ten_CELL';
            
            let siteCol = null;
            if (network === '4g') siteCol = 'Site_name';
            if (network === '5g') siteCol = 'Ten_GNODEB';

            const rawKeywords = value.split(',').map(k => k.trim()).filter(Boolean);
            if (rawKeywords.length === 0) return res.json([]);
            
            let expandedKeywords = [...rawKeywords];

            if (network === '3g') {
                let siteConds = rawKeywords.map(() => 'Site_code LIKE ?').join(' OR ');
                let siteParams = rawKeywords.map(k => `%${k}%`);
                try {
                    const [rfCells] = await db.query(`SELECT Cell_code FROM rf_3g WHERE ${siteConds}`, siteParams);
                    rfCells.forEach(r => {
                        if (r.Cell_code) expandedKeywords.push(r.Cell_code);
                    });
                } catch (e) {
                    console.error("Lỗi tra cứu rf_3g để lấy Cell_code:", e);
                }
            }

            let conditions = [];
            let params = [];

            const uniqueKeywords = [...new Set(expandedKeywords)];

            uniqueKeywords.forEach(k => {
                let coreCode = k.replace(/[-_][a-zA-Z]{2,3}$/, '');

                let cond = `(k.${cellCol} LIKE ?`;
                params.push(`%${k}%`);
                
                if (siteCol) {
                    cond += ` OR k.${siteCol} LIKE ?`;
                    params.push(`%${k}%`);
                }

                if (coreCode !== k) {
                    cond += ` OR k.${cellCol} LIKE ?`;
                    params.push(`%${coreCode}%`);
                    if (siteCol) {
                        cond += ` OR k.${siteCol} LIKE ?`;
                        params.push(`%${coreCode}%`);
                    }
                }
                cond += `)`;
                conditions.push(cond);
            });

            const placeholders = conditions.join(' OR ');
            const [rows] = await db.query(`SELECT k.* FROM ${table} k WHERE ${placeholders}`, params);
            return res.json(rows);
        }
        res.json([]);
    } catch (e) { 
        console.error("Lỗi getKpiData:", e);
        res.json([]); 
    }
};

exports.getQoeQosData = async (req, res) => {
    const value = req.query.value;
    if (!value) return res.json({ qoe: [], qos: [] });

    try {
        const rawKeywords = value.split(',').map(k => k.trim()).filter(Boolean);
        if (rawKeywords.length === 0) return res.json({ qoe: [], qos: [] });

        let conditions = [];
        let params = [];

        rawKeywords.forEach(k => {
            let coreCode = k.replace(/[-_][a-zA-Z]{2,3}$/, '');
            
            if (coreCode !== k) {
                conditions.push(`(Cell_Name LIKE ? OR Site_Name LIKE ? OR Cell_Name LIKE ? OR Site_Name LIKE ?)`);
                params.push(`%${k}%`, `%${k}%`, `%${coreCode}%`, `%${coreCode}%`);
            } else {
                conditions.push(`(Cell_Name LIKE ? OR Site_Name LIKE ?)`);
                params.push(`%${k}%`, `%${k}%`);
            }
        });

        const placeholders = conditions.join(' OR ');

        const [qoe] = await db.query(`SELECT * FROM mbb_qoe WHERE ${placeholders}`, params);
        const [qos] = await db.query(`SELECT * FROM mbb_qos WHERE ${placeholders}`, params);

        res.json({ qoe: qoe, qos: qos });
    } catch (error) { 
        console.error("Lỗi getQoeQosData:", error);
        res.json({ qoe: [], qos: [] }); 
    }
};

exports.getQoeQosListAll = async (req, res) => {
    try {
        let [rows] = await db.query('SELECT * FROM qoe_qos ORDER BY QoE_Score ASC, QoS_Score ASC');
        if (rows.length === 0) {
            console.log("⚡ Dữ liệu tổng hợp QoE/QoS đang trống. Hệ thống đang tự động kích hoạt đồng bộ...");
            await syncQoeQosSummary();
            [rows] = await db.query('SELECT * FROM qoe_qos ORDER BY QoE_Score ASC, QoS_Score ASC');
        }
        res.json(rows);
    } catch (e) {
        console.error("Lỗi lấy danh sách qoe_qos, đang tự động khởi tạo lại:", e);
        try {
            await syncQoeQosSummary();
            const [rows] = await db.query('SELECT * FROM qoe_qos ORDER BY QoE_Score ASC, QoS_Score ASC');
            res.json(rows);
        } catch (err) {
            console.error("Lỗi khởi tạo bảng QoE/QoS:", err);
            res.json([]);
        }
    }
};

exports.saveCellNote = async (req, res) => {
    const { cell_name, note } = req.body;
    try {
        await db.query(`INSERT INTO cell_notes (cell_name, note_text) VALUES (?, ?) ON DUPLICATE KEY UPDATE note_text = VALUES(note_text)`, [cell_name, note]);
        await db.query(`UPDATE qoe_qos SET lich_su_tac_dong = ? WHERE Cell_Name = ?`, [note, cell_name]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Lỗi lưu ghi chú" }); }
};

exports.resetImportedData = async (req, res) => {
    let userRole = req.session && req.session.user ? req.session.user.role : 'user';
    if (userRole !== 'admin') return res.status(403).send("Chỉ Admin mới có quyền thực hiện chức năng này.");
    const table = req.params.table;
    const allowedTables = ['rf_3g', 'rf_4g', 'rf_5g', 'ta_query', 'mbb_qoe', 'mbb_qos', 'poi_4g', 'poi_5g', 'csht_data', 'alarm_data', 'vat_tu', 'worst_cells', 'congestion_3g', 'traffic_down', 'bad_cells'];
    if (!allowedTables.includes(table)) return res.status(400).send("Bảng dữ liệu không hợp lệ.");

    try {
        await db.query(`TRUNCATE TABLE ${table}`);
        res.redirect('/import-data');
    } catch (e) { res.status(500).send("Lỗi máy chủ khi xóa dữ liệu. Vui lòng thử lại."); }
};

/* STREAMING_CHUNK:Executing Cross Sector algorithmic matching... */
// =========================================================================
// THUẬT TOÁN CHẨN ĐOÁN CROSS SECTOR (ĐẤU CHÉO CÁP)
// =========================================================================
exports.getCrossSectorData = async (req, res) => {
    const network = req.query.network || '4g';
    const tableName = network === '4g' ? 'kpi_4g' : 'kpi_5g';

    try {
        const [datesRaw] = await db.query(`SELECT DISTINCT Thoi_gian FROM ${tableName} WHERE Thoi_gian IS NOT NULL AND Thoi_gian != ''`);
        if (datesRaw.length < 8) return res.json({ error: "Hệ thống cần ít nhất 8 ngày dữ liệu liên tiếp để thiết lập đường Baseline chuẩn đoán." });

        const dates = datesRaw.map(d => d.Thoi_gian).sort((a, b) => {
            const pA = a.split('/'); const pB = b.split('/');
            return new Date(`${pB[2]}-${pB[1]}-${pB[0]}`) - new Date(`${pA[2]}-${pA[1]}-${pA[0]}`);
        });

        const targetDates = dates.slice(0, 8); 
        const t0 = targetDates[0];
        const placeholders = targetDates.map(() => '?').join(',');

        let querySql = '';
        if (network === '4g') {
            querySql = `
                SELECT Site_name as site, CellType as cell_type, MIMO as mimo_type, Cell_name as cell, Thoi_gian as date, 
                       Total_Data_Traffic_Volume_GB as traffic, RB_Util_Rate_DL as prb, CQI_4G as cqi, 
                       User_DL_Avg_Throughput_Kbps as thput, Service_Drop_all as drop_rate 
                FROM kpi_4g 
                WHERE Thoi_gian IN (${placeholders}) 
                AND Cell_name NOT LIKE 'MBF_TH%'
            `;
        } else {
            querySql = `
                SELECT Ten_GNODEB as site, Loai_NE as cell_type, 'Massive_MIMO' as mimo_type, Ten_CELL as cell, Thoi_gian as date, 
                       Total_Data_Traffic_Volume_GB as traffic, CQI_5G as cqi, A_User_DL_Avg_Throughput as thput 
                FROM kpi_5g 
                WHERE Thoi_gian IN (${placeholders}) 
                AND Ten_CELL NOT LIKE 'MBF_TH%'
            `;
        }

        const [kpiData] = await db.query(querySql, targetDates);

        const siteMap = {};
        kpiData.forEach(row => {
            const cell = row.cell;
            if (!cell) return;
            
            let siteCode = row.site;
            if (!siteCode) {
                siteCode = cell.toUpperCase().replace(/^(3G|4G|5G)[-\s_]?/i, '').replace(/[-\s_]?(THA|TH)$/i, '').substring(0, 6);
            }
            siteCode = String(siteCode).trim();
            
            if (!siteMap[siteCode]) siteMap[siteCode] = {};
            if (!siteMap[siteCode][cell]) {
                siteMap[siteCode][cell] = { 
                    cell_type: row.cell_type, 
                    mimo_type: row.mimo_type, 
                    has_t0: false, past_traffic: 0, past_cqi: 0, count_past: 0 
                };
            }
            
            if (row.date === t0) {
                siteMap[siteCode][cell].t0_traffic = parseFloat(row.traffic) || 0;
                siteMap[siteCode][cell].t0_prb = parseFloat(row.prb) || 0;
                siteMap[siteCode][cell].t0_cqi = parseFloat(row.cqi) || 0;
                siteMap[siteCode][cell].t0_thput = parseFloat(row.thput) || 0;
                siteMap[siteCode][cell].t0_drop = parseFloat(row.drop_rate) || 0;
                siteMap[siteCode][cell].has_t0 = true;
            } else {
                siteMap[siteCode][cell].past_traffic += parseFloat(row.traffic) || 0;
                siteMap[siteCode][cell].past_cqi += parseFloat(row.cqi) || 0;
                siteMap[siteCode][cell].count_past++;
            }
        });

        const suspiciousSites = [];

        for (let site in siteMap) {
            const cells = siteMap[site];
            let cellStats = [];

            for (let cellName in cells) {
                const c = cells[cellName];
                if (!c.has_t0 || c.count_past === 0) continue;
                
                const avgTraffic = c.past_traffic / c.count_past;
                const avgCqi = c.past_cqi / c.count_past;
                
                if (avgTraffic > 5 || c.t0_traffic > 5) {
                    const deltaTraffic = ((c.t0_traffic - avgTraffic) / avgTraffic) * 100;
                    const deltaCqi = c.t0_cqi - avgCqi; 
                    
                    cellStats.push({ 
                        cell: cellName, 
                        cell_type: c.cell_type,
                        mimo_type: c.mimo_type,
                        avgTraffic, t0_traffic: c.t0_traffic, deltaTraffic,
                        t0_prb: c.t0_prb, t0_thput: c.t0_thput, t0_drop: c.t0_drop,
                        avgCqi, t0_cqi: c.t0_cqi, deltaCqi
                    });
                }
            }

            if (cellStats.length >= 2) {
                let dropCells = cellStats.filter(c => c.deltaTraffic <= -30); 
                let spikeCells = cellStats.filter(c => c.deltaTraffic >= 30);  

                if (dropCells.length > 0 && spikeCells.length > 0) {
                    dropCells.forEach(dCell => {
                        spikeCells.forEach(sCell => {
                            const getBand = (typeStr) => {
                                if (!typeStr) return null;
                                let s = String(typeStr).toUpperCase();
                                if (s.includes('1800')) return '1800';
                                if (s.includes('900')) return '900';
                                if (s.includes('3700') || s.includes('3500')) return '3700'; 
                                if (s.includes('700')) return '700';
                                if (s.includes('2100') || s.includes('2600')) return 'INVALID';
                                return null;
                            };
                            
                            let bandD = getBand(dCell.cell_type);
                            let bandS = getBand(sCell.cell_type);

                            if (bandD === 'INVALID' || bandS === 'INVALID') return;
                            if (bandD && bandS && bandD !== bandS) return; 
                            
                            if (!bandD || !bandS) {
                                const matchD = dCell.cell.match(/[A-Za-z](\d)\d$/);
                                const matchS = sCell.cell.match(/[A-Za-z](\d)\d$/);
                                if (matchD && matchS && matchD[1] !== matchS[1]) return;
                            }

                            const getMimoStandard = (mimoStr) => {
                                if (!mimoStr) return null; 
                                let s = String(mimoStr).toUpperCase().trim();
                                if (s.includes('4T4R')) return '4T4R';
                                if (s.includes('2T2R')) return '2T2R';
                                if (s.includes('1T1R') || s.includes('1T2R')) return '1T_2T'; 
                                if (s.includes('8T8R') || s.includes('MASSIVE')) return 'MMIMO';
                                return s;
                            };

                            let mimoD = getMimoStandard(dCell.mimo_type);
                            let mimoS = getMimoStandard(sCell.mimo_type);

                            if (mimoD && mimoS && mimoD !== mimoS) {
                                return;
                            }

                            let err_Dnew_Sold = Math.abs(dCell.t0_traffic - sCell.avgTraffic) / Math.max(sCell.avgTraffic, 1);
                            let err_Snew_Dold = Math.abs(sCell.t0_traffic - dCell.avgTraffic) / Math.max(dCell.avgTraffic, 1);
                            
                            if (err_Dnew_Sold > 0.25 || err_Snew_Dold > 0.25) {
                                return; 
                            }

                            let score = 50; 
                            let reasons = ["Tráo đổi lưu lượng (Độ khớp Volume cực cao <= 25%)"];

                            if (dCell.deltaCqi < -3 || sCell.deltaCqi < -3) {
                                score += 25;
                                reasons.push("Sụt giảm CQI đột ngột");
                            }

                            if (network === '4g' && (dCell.t0_drop > 0.5 || sCell.t0_drop > 0.5)) {
                                score += 25;
                                reasons.push("Tỷ lệ rớt dịch vụ (HO Proxy) tăng vọt");
                            }

                            if (score >= 50) { 
                                suspiciousSites.push({
                                    site: site, 
                                    score: score,
                                    reasons: reasons.join(' + '),
                                    sector_down: {
                                        name: dCell.cell,
                                        traffic_change: `${dCell.avgTraffic.toFixed(1)} ➡️ ${dCell.t0_traffic.toFixed(1)} GB (${dCell.deltaTraffic.toFixed(1)}%)`,
                                        cqi_change: `${dCell.avgCqi.toFixed(1)} ➡️ ${dCell.t0_cqi.toFixed(1)}%`
                                    },
                                    sector_up: {
                                        name: sCell.cell,
                                        traffic_change: `${sCell.avgTraffic.toFixed(1)} ➡️ ${sCell.t0_traffic.toFixed(1)} GB (+${sCell.deltaTraffic.toFixed(1)}%)`,
                                        cqi_change: `${sCell.avgCqi.toFixed(1)} ➡️ ${sCell.t0_cqi.toFixed(1)}%`
                                    }
                                });
                            }
                        });
                    });
                }
            }
        }

        const uniqueList = [];
        const seen = new Set();
        suspiciousSites.sort((a, b) => b.score - a.score).forEach(item => {
            let names = [item.sector_down.name, item.sector_up.name].sort();
            let key = names[0] + "_" + names[1];
            if (!seen.has(key)) { seen.add(key); uniqueList.push(item); }
        });

        res.json({ latestDate: t0, data: uniqueList });

    } catch (e) {
        console.error("Lỗi Cross Sector API:", e);
        res.status(500).json({ error: "Lỗi truy xuất hệ thống." });
    }
};
