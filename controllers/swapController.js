const db = require('../models/db');

// Hàm tính khoảng cách đường chim bay (Haversine Formula) - Đơn vị: Km
function calculateDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 9999;
    const R = 6371; // Bán kính Trái Đất (km)
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

exports.renderSwapMimoPage = (req, res) => {
    let userRole = req.session && req.session.user ? req.session.user.role : 'user';
    res.render('swap_mimo', { title: 'SWAP MIMO 1800', page: 'SWAP MIMO', userRole });
};

exports.getSwapData = async (req, res) => {
    try {
        const upTraf = parseFloat(req.query.upTraf) || 80;    
        const upThput = parseFloat(req.query.upThput) || 15;  
        const downTraf = parseFloat(req.query.downTraf) || 20;
        const downPrb = parseFloat(req.query.downPrb) || 15;  
        const days = parseInt(req.query.days) || 30; // [MỚI] Tham số 30, 60, 90 ngày
        
        const districtsParam = req.query.districts || 'ALL';
        const selectedDistricts = districtsParam.split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
        const filterByDistrict = !selectedDistricts.includes('all') && selectedDistricts.length > 0;

        // 1. Kiểm tra ngày mới nhất để quản lý phiên bản Cache
        const [datesRaw] = await db.query(`SELECT DISTINCT Thoi_gian FROM kpi_4g WHERE Thoi_gian IS NOT NULL AND Thoi_gian != ''`);
        if (datesRaw.length === 0) return res.json({ error: "Không có dữ liệu KPI 4G để phân tích." });
        
        let uniqueDates = datesRaw.map(d => d.Thoi_gian).sort((a, b) => new Date(b.split('/').reverse().join('-')) - new Date(a.split('/').reverse().join('-')));
        const latestDate = uniqueDates[0];

        // 2. [CƠ CHẾ DATABASE CACHE SIÊU TỐC] Tự động tạo bảng nếu chưa có
        try {
            await db.query("SELECT latest_date FROM swap_mimo_cache LIMIT 1");
        } catch(e) {
            await db.query(`DROP TABLE IF EXISTS swap_mimo_cache`);
            await db.query(`
                CREATE TABLE swap_mimo_cache (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    latest_date VARCHAR(50),
                    cell_name VARCHAR(255),
                    days_filter INT,
                    avg_traf FLOAT,
                    avg_thput FLOAT,
                    avg_prb FLOAT,
                    cell_type VARCHAR(100),
                    district VARCHAR(100),
                    UNIQUE KEY unique_cell_days (cell_name, days_filter)
                )
            `);
        }

        // 3. Load Cache. Nếu Cache cũ (khác latest_date) hoặc chưa có -> Tính toán và Lưu lại
        let [kpiRows] = await db.query(`SELECT cell_name as Cell_name, cell_type, district, avg_traf, avg_thput, avg_prb FROM swap_mimo_cache WHERE days_filter = ? AND latest_date = ?`, [days, latestDate]);

        if (kpiRows.length === 0) {
            console.log(`[SWAP MIMO] Đang tạo Cache Database cho ${days} ngày...`);
            const targetDates = uniqueDates.slice(0, days);
            if (targetDates.length === 0) return res.json({ error: `Không đủ dữ liệu cho ${days} ngày.`});
            const placeholders = targetDates.map(() => '?').join(',');
            
            await db.query(`DELETE FROM swap_mimo_cache WHERE days_filter = ?`, [days]); // Xóa cache cũ

            // [FIX BẢO MẬT DB]: Tự động dò tìm xem các cột có tồn tại không trước khi Query
            const [kpiCols] = await db.query('SHOW COLUMNS FROM kpi_4g');
            const hasDistrict = kpiCols.some(c => String(c.Field).toLowerCase() === 'district_code');
            const hasCellType = kpiCols.some(c => String(c.Field).toLowerCase() === 'celltype');
            
            const districtSelect = hasDistrict ? "MAX(District_code) as district," : "'' as district,";
            const cellTypeSelect = hasCellType ? "MAX(CellType) as cell_type," : "'' as cell_type,";

            const query = `
                SELECT Cell_name, 
                       ${cellTypeSelect}
                       ${districtSelect}
                       AVG(Total_Data_Traffic_Volume_GB) as avg_traf,
                       AVG(User_DL_Avg_Throughput_Kbps) as avg_thput,
                       AVG(RB_Util_Rate_DL) as avg_prb
                FROM kpi_4g 
                WHERE Thoi_gian IN (${placeholders}) 
                  AND Cell_name NOT LIKE '%IBS%' AND Cell_name NOT LIKE '%DAS%' AND Cell_name NOT LIKE 'MBF_TH%'
                GROUP BY Cell_name
            `;
            const [rows] = await db.query(query, targetDates);
            kpiRows = rows;

            let insertData = rows.map(r => [
                latestDate, r.Cell_name, days,
                parseFloat(r.avg_traf)||0, parseFloat(r.avg_thput)||0, parseFloat(r.avg_prb)||0,
                r.cell_type || '', r.district || ''
            ]);
            
            if (insertData.length > 0) {
                const chunkSize = 500;
                for (let i = 0; i < insertData.length; i += chunkSize) {
                    await db.query(`INSERT IGNORE INTO swap_mimo_cache (latest_date, cell_name, days_filter, avg_traf, avg_thput, avg_prb, cell_type, district) VALUES ?`, [insertData.slice(i, i + chunkSize)]);
                }
            }
        }

        // 4. Lấy dữ liệu Cấu hình RF & CEM
        // [FIX BẢO MẬT DB]: Dùng SELECT * để chống lỗi nếu Database thiếu cột MIMO hoặc Band
        const [rfRows] = await db.query(`SELECT * FROM rf_4g`);
        let rfMap = {};
        rfRows.forEach(r => {
            let cellCode = r.Cell_code || r.Cell_Code || r.CELL_CODE || r.cell_code || r.CELL_NAME;
            if (cellCode) {
                rfMap[cellCode] = {
                    Latitude: r.Latitude || r.latitude || r.LATITUDE || r.Lat,
                    Longitude: r.Longitude || r.longitude || r.LONGITUDE || r.Long,
                    rf_mimo: r.MIMO || r.mimo || r.Mimo || '',
                    Band: r.Band || r.band || r.BAND || ''
                };
            }
        });

        let qoeQosMap = {};
        try {
            const [qoeQosRows] = await db.query(`SELECT Cell_Name, QoE_Score, QoS_Score FROM qoe_qos`);
            qoeQosRows.forEach(r => qoeQosMap[r.Cell_Name] = r);
        } catch(e) {} 

        // ==============================================================
        // THUẬT TOÁN ĐỊNH VỊ CELL CÓ F2/F3 (Không hỗ trợ Swap)
        // ==============================================================
        let siteSectorMap = {}; 
        kpiRows.forEach(k => {
            const cell = k.Cell_name;
            // Pattern tách Tên Trạm - Băng tần/Carrier - Sector. VD: 4G-NIS078M11-THA
            // match[1] = 4G-NIS078M, match[2] = Freq (1, 3, 5), match[3] = Sector (1, 2, 3)
            const match = cell.match(/^(.*?)(\d)(\d)(-[A-Za-z]+)?$/);
            if (match) {
                const baseSite = match[1]; 
                const carrier = parseInt(match[2], 10); 
                const sector = parseInt(match[3], 10); 
                const key = `${baseSite}_${sector}`;
                if (!siteSectorMap[key]) siteSectorMap[key] = [];
                siteSectorMap[key].push(carrier);
            }
        });

        let upgradeCandidates = [];
        let downgradeCandidates = [];

        // 5. Duyệt và Áp dụng Tiêu chí
        kpiRows.forEach(k => {
            let cellDist = String(k.district || '').trim().toLowerCase();
            if (filterByDistrict && !selectedDistricts.includes(cellDist)) return; 

            const cell = k.Cell_name;
            if (!cell) return;

            // [MỚI] Loại bỏ Small Cell (Ký hiệu chữ 'S' kẹp giữa số trạm và số cell. VD: 4G-NCG056S11-THA)
            if (cell.match(/\dS\d{2}(-[A-Za-z]+)?$/i)) return;

            const rf = rfMap[cell] || {};
            
            let isL1800 = false;
            if (k.cell_type && k.cell_type.includes('L18')) isL1800 = true;
            if (rf.Band && String(rf.Band).includes('1800')) isL1800 = true;
            if (!isL1800 && !cell.match(/[A-Za-z]+.*[456]$/)) return; 

            let mimo = String(rf.rf_mimo || '').toUpperCase();
            if (mimo === '' && k.cell_type) {
                if (k.cell_type.includes('2T')) mimo = '2T2R';
                else if (k.cell_type.includes('4T')) mimo = '4T4R';
            }

            let is2T = mimo.includes('2T');
            let is4T = mimo.includes('4T');
            
            // [NGHIỆP VỤ]: Chỉ cho phép phân tích trên phần cứng 2T2R và 4T4R
            if (!is2T && !is4T) return; 

            // [NGHIỆP VỤ]: Kiểm tra xem Cell này (hoặc anh em cùng Sector của nó) có Carrier > 1 (như F2, F3) không?
            let hasF2 = false;
            const match = cell.match(/^(.*?)(\d)(\d)(-[A-Za-z]+)?$/);
            if (match) {
                const baseSite = match[1];
                const sector = parseInt(match[3], 10);
                const key = `${baseSite}_${sector}`;
                // Nếu mảng Carrier của Sector này có số lớn hơn 1 (ví dụ 31, 51)
                if (siteSectorMap[key] && siteSectorMap[key].some(c => c > 1)) {
                    hasF2 = true;
                }
            }

            let traf = parseFloat(k.avg_traf) || 0;
            let thputMbps = (parseFloat(k.avg_thput) || 0) / 1024;
            let prb = parseFloat(k.avg_prb) || 0;
            
            const qq = qoeQosMap[cell] || {};
            let cemScore = qq.QoE_Score ? parseFloat(qq.QoE_Score).toFixed(1) : 'N/A';
            let qosScore = qq.QoS_Score ? parseFloat(qq.QoS_Score).toFixed(1) : 'N/A';

            // Phân loại UPGRADE: Chỉ 2T2R và KHÔNG ĐƯỢC CÓ F2
            if (is2T) {
                if (hasF2) return; // Bỏ qua nếu là cụm trạm đã ghép đa băng tần (F2)
                
                if (traf >= upTraf && thputMbps <= upThput) {
                    upgradeCandidates.push({
                        cell, lat: parseFloat(rf.Latitude), lng: parseFloat(rf.Longitude), 
                        mimo: '2T2R', traf, thput: thputMbps, prb, cem: cemScore, qos: qosScore
                    });
                }
            }
            
            // Phân loại DOWNGRADE: Chỉ 4T4R
            if (is4T) {
                if (traf <= downTraf && prb <= downPrb) {
                    downgradeCandidates.push({
                        cell, lat: parseFloat(rf.Latitude), lng: parseFloat(rf.Longitude), 
                        mimo: '4T4R', traf, thput: thputMbps, prb
                    });
                }
            }
        });

        // 6. Thuật toán Ghép Cặp (Cross-District) ưu tiên 1-1 theo độ nghẽn Traffic
        let pairs = [];
        upgradeCandidates.sort((a, b) => b.traf - a.traf); // Nghẽn nhất xếp trước
        downgradeCandidates.sort((a, b) => a.traf - b.traf); // Lãng phí nhất xếp trước

        let matchCount = Math.min(upgradeCandidates.length, downgradeCandidates.length);

        for (let i = 0; i < matchCount; i++) {
            let upCell = upgradeCandidates[i];
            let downCell = downgradeCandidates[i];
            
            let dist = calculateDistance(upCell.lat, upCell.lng, downCell.lat, downCell.lng);
            
            pairs.push({
                upgrade: upCell,
                downgrade: downCell,
                distance: dist.toFixed(2)
            });
        }
        pairs.sort((a, b) => b.upgrade.traf - a.upgrade.traf);

        res.json({
            success: true,
            daysAnalyzed: days,
            stats: {
                totalUpgradesFound: upgradeCandidates.length,
                totalDowngradesFound: downgradeCandidates.length,
                totalPairsMatched: pairs.length
            },
            pairs: pairs
        });

    } catch (error) {
        console.error("❌ Lỗi thuật toán SWAP MIMO:", error);
        res.status(500).json({ error: "Lỗi hệ thống khi tính toán. Vui lòng thử lại sau." });
    }
};
