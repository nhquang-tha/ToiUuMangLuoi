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
        const maxDist = parseFloat(req.query.maxDist) || 15;  

        // 1. Lấy danh sách tối đa 30 ngày KPI gần nhất
        const [datesRaw] = await db.query(`SELECT DISTINCT Thoi_gian FROM kpi_4g WHERE Thoi_gian IS NOT NULL AND Thoi_gian != ''`);
        if (datesRaw.length === 0) return res.json({ error: "Không có dữ liệu KPI 4G để phân tích." });
        
        let dates = datesRaw.map(d => d.Thoi_gian).sort((a, b) => new Date(b.split('/').reverse().join('-')) - new Date(a.split('/').reverse().join('-'))).slice(0, 30);
        const placeholders = dates.map(() => '?').join(',');

        // 2. [TỐI ƯU BIG DATA] Lấy dữ liệu từng mảng riêng biệt để tránh bùng nổ JOIN
        
        const [kpiCols] = await db.query('SHOW COLUMNS FROM kpi_4g');
        const hasMimo = kpiCols.some(c => String(c.Field).toLowerCase() === 'mimo');
        const hasCellType = kpiCols.some(c => String(c.Field).toLowerCase() === 'celltype');

        const mimoSelect = hasMimo ? "MAX(MIMO) as kpi_mimo," : "'' as kpi_mimo,";
        const cellTypeSelect = hasCellType ? "MAX(CellType) as cell_type," : "'' as cell_type,";

        // A. Lấy trung bình KPI 4G
        const [kpiRows] = await db.query(`
            SELECT Cell_name, 
                   ${mimoSelect}
                   ${cellTypeSelect}
                   AVG(Total_Data_Traffic_Volume_GB) as avg_traf,
                   AVG(User_DL_Avg_Throughput_Kbps) as avg_thput,
                   AVG(RB_Util_Rate_DL) as avg_prb
            FROM kpi_4g 
            WHERE Thoi_gian IN (${placeholders}) 
              AND Cell_name NOT LIKE '%IBS%' AND Cell_name NOT LIKE '%DAS%' AND Cell_name NOT LIKE 'MBF_TH%'
            GROUP BY Cell_name
        `, dates);

        // B. Lấy thông tin Tọa độ & MIMO cấu hình từ RF
        const [rfRows] = await db.query(`SELECT * FROM rf_4g`);
        let rfMap = {};
        rfRows.forEach(r => {
            let cellCode = r.Cell_code || r.Cell_Code || r.CELL_CODE || r.cell_code || r.CELL_NAME;
            if (cellCode) {
                rfMap[cellCode] = {
                    Latitude: r.Latitude || r.latitude || r.LATITUDE || r.Lat,
                    Longitude: r.Longitude || r.longitude || r.LONGITUDE || r.Long,
                    rf_mimo: r.MIMO || r.mimo || r.Mimo,
                    Band: r.Band || r.band || r.BAND
                };
            }
        });

        // C. Lấy điểm CEM/QoS từ bảng Cache qoe_qos
        let qoeQosMap = {};
        try {
            const [qoeQosRows] = await db.query(`SELECT Cell_Name, QoE_Score, QoS_Score FROM qoe_qos`);
            qoeQosRows.forEach(r => qoeQosMap[r.Cell_Name] = r);
        } catch(e) {} 

        let upgradeCandidates = [];
        let downgradeCandidates = [];

        // 3. Map dữ liệu trên RAM
        kpiRows.forEach(k => {
            const cell = k.Cell_name;
            const rf = rfMap[cell] || {};
            
            let isL1800 = false;
            if (k.cell_type && k.cell_type.includes('L18')) isL1800 = true;
            if (rf.Band && String(rf.Band).includes('1800')) isL1800 = true;
            if (!isL1800 && !cell.match(/[A-Za-z]+.*[456]$/)) return; 

            let mimo = String(rf.rf_mimo || k.kpi_mimo || '').toUpperCase();
            let traf = parseFloat(k.avg_traf) || 0;
            let thputMbps = (parseFloat(k.avg_thput) || 0) / 1024;
            let prb = parseFloat(k.avg_prb) || 0;
            let lat = parseFloat(rf.Latitude);
            let lng = parseFloat(rf.Longitude);

            if (isNaN(lat) || isNaN(lng)) return; 

            const qq = qoeQosMap[cell] || {};
            let cemScore = qq.QoE_Score ? parseFloat(qq.QoE_Score).toFixed(1) : 'N/A';
            let qosScore = qq.QoS_Score ? parseFloat(qq.QoS_Score).toFixed(1) : 'N/A';

            // Phân loại UPGRADE
            if (mimo === '' || mimo.includes('2T') || mimo.includes('1T')) {
                if (traf >= upTraf && thputMbps <= upThput) {
                    upgradeCandidates.push({
                        cell, lat, lng, mimo: mimo || '2T2R', traf, thput: thputMbps, prb, cem: cemScore, qos: qosScore
                    });
                }
            }
            
            // Phân loại DOWNGRADE
            if (mimo.includes('4T') || mimo.includes('8T') || mimo.includes('MASSIVE')) {
                if (traf <= downTraf && prb <= downPrb) {
                    downgradeCandidates.push({
                        cell, lat, lng, mimo, traf, thput: thputMbps, prb
                    });
                }
            }
        });

        // 4. Thuật toán Ghép Cặp (Pairing)
        let pairs = [];
        let usedDowngrades = new Set(); 

        upgradeCandidates.forEach(upCell => {
            let bestMatch = null;
            let minDistance = Infinity;

            downgradeCandidates.forEach(downCell => {
                if (usedDowngrades.has(downCell.cell)) return; 

                let dist = calculateDistance(upCell.lat, upCell.lng, downCell.lat, downCell.lng);
                
                if (dist < minDistance && dist <= maxDist) {
                    minDistance = dist;
                    bestMatch = downCell;
                }
            });

            if (bestMatch) {
                pairs.push({
                    upgrade: upCell,
                    downgrade: bestMatch,
                    distance: minDistance.toFixed(2)
                });
                usedDowngrades.add(bestMatch.cell); 
            }
        });

        pairs.sort((a, b) => a.distance - b.distance);

        res.json({
            success: true,
            daysAnalyzed: dates.length,
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
