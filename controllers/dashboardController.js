const db = require('../models/db');
const xlsx = require('xlsx');

// Hàm bổ trợ: Biến đổi NaN hoặc undefined thành số 0 an toàn cho MySQL
const getSafeFloat = (val) => {
    const f = parseFloat(val);
    return isNaN(f) ? 0 : f;
};

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
        console.log("⏳ Bắt đầu đồng bộ và tính toán Dashboard (SQL Native 6 Chars)...");

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
                
                // Sử dụng getSafeFloat để chống lỗi NaN
                insertData.push([
                    r.Latest_Date || null, 
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

            // LƯU Ý: Lệnh is_in_t0 > 0 dưới đây chính là chốt chặn ép trạm phải có mặt trong file mới nhất
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
                
                // Sử dụng getSafeFloat để chống lỗi NaN
                insertData.push([
                    r.Latest_Date || null, 
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

async function syncTrafficDown() {
    try {
        console.log("⏳ Bắt đầu tính toán cache Traffic Down...");
        await db.query('TRUNCATE TABLE traffic_down');
        
        const [datesRaw] = await db.query(`SELECT DISTINCT Thoi_gian FROM kpi_4g WHERE Thoi_gian IS NOT NULL AND Thoi_gian != ''`);
        const dates = datesRaw.map(d => d.Thoi_gian).sort((a, b) => {
            const pA = a.split('/'); const pB = b.split('/');
            return new Date(`${pB[2]}-${pB[1]}-${pB[0]}`) - new Date(`${pA[2]}-${pA[1]}-${pA[0]}`);
        });

        if (dates.length === 0) return; 

        // Nếu người dùng import ít hơn 8 ngày, vẫn tiến hành quét lỗi Zero Traffic
        const targetDates = dates.slice(0, 10);
        const t0 = targetDates[0];
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
            dataArray.forEach(row => {
                // Thêm biến cờ hiệu has_t0 để đánh dấu trạm có tồn tại trong ngày mới nhất
                if (!cellMap[row.Cell_name]) cellMap[row.Cell_name] = { has_t0: false };
                cellMap[row.Cell_name][row.Thoi_gian] = parseFloat(row.traffic) || 0;
                
                if (row.Thoi_gian === t0) {
                    cellMap[row.Cell_name].has_t0 = true;
                }
                
                if (network === '4g' || network === '5g') {
                    let poi = cellToPoi[row.Cell_name];
                    if (poi) {
                        if (!poiTrafficMap[poi]) poiTrafficMap[poi] = { has_t0: false };
                        if (!poiTrafficMap[poi][row.Thoi_gian]) poiTrafficMap[poi][row.Thoi_gian] = 0;
                        poiTrafficMap[poi][row.Thoi_gian] += parseFloat(row.traffic) || 0;
                        
                        if (row.Thoi_gian === t0) {
                            poiTrafficMap[poi].has_t0 = true;
                        }
                    }
                }
            });

            for (let cell in cellMap) {
                const c = cellMap[cell];
                
                // CHẶN BÓNG MA: Nếu trạm không có mặt trong file ngày t0, bỏ qua luôn!
                if (!c.has_t0) continue;

                const v0 = c[t0] || 0; 
                
                // Tính trung bình các ngày cũ có sẵn (từ t1 trở đi)
                let sumOld = 0; let countOld = 0;
                for (let i = 1; i < targetDates.length; i++) {
                    if (c[targetDates[i]] !== undefined) {
                        sumOld += c[targetDates[i]];
                        countOld++;
                    }
                }
                const avgOld = countOld > 0 ? (sumOld / countOld) : 0;

                // TIÊU CHÍ 1: ZERO CELL (Traffic hôm nay = 0 VÀ Trung bình 7 ngày trước > 0)
                if (v0 === 0 && avgOld > 0) {
                    zeroTrafficCells.push({ Cell_name: cell, network: network, t0: v0.toFixed(2), avg7: avgOld.toFixed(2) });
                }

                // TIÊU CHÍ 2: DROPPED CELL (Chỉ tính khi có đủ 8 ngày để đối chiếu với tuần trước t7)
                if (targetDates.length >= 8) {
                    const t7 = targetDates[7];
                    const t1 = targetDates[1]; const t2 = targetDates[2];
                    const t8 = targetDates[8]; const t9 = targetDates[9];
                    
                    const v7 = c[t7] || 0;
                    const v1 = c[t1] || 0; const v8 = c[t8] || 0;
                    const v2 = c[t2] || 0; const v9 = c[t9] || 0;

                    if ((network === '4g' || network === '5g') && v7 > 5 && v0 < 0.7 * v7 && v1 < 0.7 * v8 && v2 < 0.7 * v9) {
                        droppedTrafficCells.push({ Cell_name: cell, network: network, t0: v0.toFixed(2), t7: v7.toFixed(2), ratio: Math.round((v0/v7)*100) });
                    }
                }
            }
        };

        analyzeData(data3g, '3g');
        analyzeData(data4g, '4g');
        analyzeData(data5g, '5g');

        let droppedTrafficPOIs = [];
        // TIÊU CHÍ 3: POI SUY GIẢM (Chỉ tính khi đủ 8 ngày)
        if (targetDates.length >= 8) {
            const t7 = targetDates[7];
            const t1 = targetDates[1]; const t2 = targetDates[2];
            const t8 = targetDates[8]; const t9 = targetDates[9];

            for (let poi in poiTrafficMap) {
                const p = poiTrafficMap[poi];
                
                // CHẶN BÓNG MA POI: Nếu tất cả các trạm của POI đều biến mất trong file t0, bỏ qua!
                if (!p.has_t0) continue;

                const v0 = p[t0] || 0; const v1 = p[t1] || 0; const v2 = p[t2] || 0;
                const v7 = p[t7] || 0; const v8 = p[t8] || 0; const v9 = p[t9] || 0;

                if (v7 > 0 && v0 < 0.7 * v7 && v1 < 0.7 * v8 && v2 < 0.7 * v9) {
                    droppedTrafficPOIs.push({ POI: poi, t0: v0.toFixed(2), t7: v7.toFixed(2), ratio: Math.round((v0/v7)*100) });
                }
            }
        }
        
        let insertData = [];
        // Xử lý chặn lỗi Null cho biến last_week_date
        const safeT7 = targetDates.length >= 8 ? targetDates[7] : 'N/A';

        zeroTrafficCells.forEach(r => insertData.push([t0, safeT7, 'zero_cell', r.network, r.Cell_name, getSafeFloat(r.t0), getSafeFloat(r.avg7), 0]));
        droppedTrafficCells.forEach(r => insertData.push([t0, safeT7, 'dropped_cell', r.network, r.Cell_name, getSafeFloat(r.t0), getSafeFloat(r.t7), getSafeFloat(r.ratio)]));
        droppedTrafficPOIs.forEach(r => insertData.push([t0, safeT7, 'dropped_poi', '4g_5g', r.POI, getSafeFloat(r.t0), getSafeFloat(r.t7), getSafeFloat(r.ratio)]));

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

async function syncBadCells() {
    try {
        console.log("⏳ Bắt đầu phân tích Ma Trận Ưu Tiên Bad Cells (Luật 5/7 ngày)...");
        
        // Dọn dẹp các trạm 5G cũ nếu có trong CSDL Bad Cells (Để hiển thị sạch sẽ 100%)
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

        // Bổ sung lọc Traffic > 1GB/ngày và Trung bình > 5GB/tuần cho 4G
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

            // Chống chèn biến undefined gây sập Database
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
            
            // --- TÍNH NĂNG MỚI: TỰ ĐỘNG THÊM CỘT CÒN THIẾU VÀO DATABASE CHO BẢNG RF ---
            if (networkType.startsWith('rf_')) {
                let isSchemaChanged = false;
                for (let h of excelHeaders) {
                    if (!h) continue;
                    let safeName = String(h).trim().replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
                    if (!safeName) continue;
                    
                    let normH = normalizeStr(safeName);
                    let exists = dbCols.some(c => c.norm === normH || c.original.toLowerCase() === safeName.toLowerCase());
                    
                    if (!exists) {
                        try {
                            console.log(`⚡ Auto-Migration: Thêm cột mới [${safeName}] vào bảng ${networkType}`);
                            await db.query(`ALTER TABLE ${networkType} ADD COLUMN \`${safeName}\` TEXT`);
                            isSchemaChanged = true;
                        } catch (e) {
                            console.error(`Lỗi tạo cột ${safeName}:`, e.message);
                        }
                    }
                }
                if (isSchemaChanged) {
                    const [newCols] = await db.query(`SHOW COLUMNS FROM ${networkType}`);
                    dbCols = newCols.map(c => ({ original: c.Field, norm: normalizeStr(c.Field) }));
                }
            }

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
            
            const stringColumns = ['Thoi_gian', 'Date', 'Cell_name', 'Ten_CELL', 'Site_name', 'Cell_code', 'Ma_Tinh', 'Don_Vi', 'Phuong_Xa', 'Ten_GNODEB', 'CellType', 'District_code', 'MIMO', 'CI', 'CELL_ID', 'Cell_ID', 'Tuan', 'POI', 'Cell_Code', 'Site_Code'];

            for (let i = dataStartIdx; i < rawData.length; i++) {
                const row = rawData[i];
                if (!row || row.length === 0) continue; 
                let firstCellStr = String(row[0] || '').toLowerCase().trim();
                if (firstCellStr === 'summary' || firstCellStr.includes('không thành công')) continue; 

                const rowObj = {}; let hasKpiData = false;
                colMapping.forEach(map => {
                    let val = row[map.excelIdx];
                    let isStrCol = stringColumns.some(sc => sc.toLowerCase() === map.dbCol.toLowerCase());
                    
                    // --- BẢO VỆ DỮ LIỆU CHỮ CHO BẢNG RF ---
                    if (networkType.startsWith('rf_')) {
                        let floatRfCols = ['latitude', 'longitude', 'azimuth', 'tilt', 'height', 'ant_height'];
                        if (!floatRfCols.includes(map.dbCol.toLowerCase())) {
                            isStrCol = true;
                        }
                    }

                    if (!isStrCol) {
                        if (val === null || val === undefined || val === '' || String(val).trim() === '') {
                            val = null; 
                        } else if (typeof val === 'string') {
                            let parsed = parseFloat(val.replace(/,/g, '.'));
                            val = isNaN(parsed) ? null : parsed; 
                        } else if (typeof val === 'number') {
                            val = isNaN(val) ? null : val;
                        }
                    }

                    if (map.dbCol === 'Thoi_gian' || map.dbCol === 'Date') {
                        if (val !== null && val !== '') {
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

    // GỌI CÁC LUỒNG ĐỒNG BỘ CHẠY NGẦM
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
            if (networkType === 'mbb_qoe' || networkType === 'mbb_qos' || networkType === 'kpi_4g') {
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
        if (rows.length === 0) {
            return res.json({ error: "Chưa đủ dữ liệu hoặc hệ thống chưa cập nhật bộ nhớ đệm. Vui lòng nạp lại dữ liệu." });
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
            latestDate, lastWeekDate,
            zeroTrafficCells: zeroTrafficCells.sort((a,b) => b.avg7 - a.avg7),
            droppedTrafficCells: droppedTrafficCells.sort((a,b) => a.ratio - b.ratio),
            droppedTrafficPOIs: droppedTrafficPOIs.sort((a,b) => a.ratio - b.ratio)
        });
    } catch (error) { res.status(500).json({ error: "Lỗi truy xuất hệ thống máy chủ CSDL." }); }
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
            FROM poi_4g p JOIN kpi_4g k ON p.Cell_Code = k.Cell_name 
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
        const [data4g] = await db.query(`
            SELECT k.Thoi_gian, SUM(k.Total_Data_Traffic_Volume_GB) as traffic_4g, AVG(k.User_DL_Avg_Throughput_Kbps) as thput_4g 
            FROM kpi_4g k JOIN poi_4g p ON k.Cell_name = p.Cell_Code 
            WHERE p.POI = ? AND k.Thoi_gian IS NOT NULL AND k.Thoi_gian != '' GROUP BY k.Thoi_gian
        `, [poiName]);

        const [data5g] = await db.query(`
            SELECT k.Thoi_gian, SUM(k.Total_Data_Traffic_Volume_GB) as traffic_5g, AVG(k.A_User_DL_Avg_Throughput) as thput_5g 
            FROM kpi_5g k JOIN poi_5g p ON k.Ten_CELL = p.Cell_Code 
            WHERE p.POI = ? AND k.Thoi_gian IS NOT NULL AND k.Thoi_gian != '' GROUP BY k.Thoi_gian
        `, [poiName]);

        let mergedData = {};
        data4g.forEach(r => mergedData[r.Thoi_gian] = { Thoi_gian: r.Thoi_gian, traffic_4g: r.traffic_4g, thput_4g: r.thput_4g, traffic_5g: 0, thput_5g: 0 });
        data5g.forEach(r => {
            if (!mergedData[r.Thoi_gian]) mergedData[r.Thoi_gian] = { Thoi_gian: r.Thoi_gian, traffic_4g: 0, thput_4g: 0 };
            mergedData[r.Thoi_gian].traffic_5g = r.traffic_5g; mergedData[r.Thoi_gian].thput_5g = r.thput_5g;
        });

        res.json({ data: Object.values(mergedData), has4g: data4g.length > 0, has5g: data5g.length > 0 });
    } catch (error) { res.json({ error: "Lỗi cơ sở dữ liệu." }); }
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
            const keywords = value.split(',').map(k => k.trim()).filter(Boolean);
            if (keywords.length === 0) return res.json([]);
            
            // [THUẬT TOÁN ĐỒNG BỘ RF - KPI]
            // Bước 1: Tìm tất cả các Cell_code thuộc Site_code từ bảng RF tương ứng
            let rfConditions = [];
            let rfParams = [];
            keywords.forEach(k => {
                rfConditions.push(`Site_code LIKE ? OR Cell_code LIKE ?`);
                rfParams.push(`%${k}%`, `%${k}%`);
            });
            
            let matchedCells = [];
            try {
                const [rfRows] = await db.query(`SELECT Cell_code FROM ${rfTable} WHERE ${rfConditions.join(' OR ')} LIMIT 300`, rfParams);
                matchedCells = rfRows.map(r => r.Cell_code).filter(Boolean);
            } catch (e) {
                console.log(`⚠️ Bảng RF (${rfTable}) chưa có dữ liệu để ánh xạ Site_code.`);
            }

            // Bước 2: Gộp Cell_code tìm được với các Keyword gốc
            const searchList = [...new Set([...matchedCells, ...keywords])];
            
            const conditions = [];
            const params = [];

            // Ép điều kiện quét trên cột Tên Cell của bảng KPI
            searchList.forEach(k => {
                conditions.push(`k.${cellCol} LIKE ?`);
                params.push(`%${k}%`);
            });

            // Bước 3: Dự phòng quét thêm trên cột Site_name
            let siteCol = null;
            if (network === '4g') siteCol = 'Site_name';
            if (network === '5g') siteCol = 'Ten_GNODEB';

            if (siteCol) {
                keywords.forEach(k => {
                    conditions.push(`k.${siteCol} LIKE ?`);
                    params.push(`%${k}%`);
                });
            }

            // Bước 4: Chạy lệnh truy vấn KPI cuối cùng
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
        const keywords = value.split(',').map(k => k.trim()).filter(Boolean);
        if (keywords.length === 0) return res.json({ qoe: [], qos: [] });

        const placeholders = keywords.map(() => `Cell_Name LIKE ? OR Site_Name LIKE ?`).join(' OR ');
        const params = [];
        keywords.forEach(k => { params.push(`%${k}%`, `%${k}%`); });

        const [qoe] = await db.query(`SELECT * FROM mbb_qoe WHERE ${placeholders}`, params);
        const [qos] = await db.query(`SELECT * FROM mbb_qos WHERE ${placeholders}`, params);

        res.json({ qoe: qoe, qos: qos });
    } catch (error) { res.json({ qoe: [], qos: [] }); }
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
