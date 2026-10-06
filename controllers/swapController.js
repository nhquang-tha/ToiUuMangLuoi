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
        // Nhận tham số cấu hình từ UI (hoặc dùng mặc định)
        const upTraf = parseFloat(req.query.upTraf) || 80;    // Traffic > 80 GB
        const upThput = parseFloat(req.query.upThput) || 15;  // Thput < 15 Mbps
        const downTraf = parseFloat(req.query.downTraf) || 20;// Traffic < 20 GB
        const downPrb = parseFloat(req.query.downPrb) || 15;  // PRB < 15%
        const maxDist = parseFloat(req.query.maxDist) || 15;  // Khoảng cách tối đa để Swap (km)

        // 1. Lấy danh sách 30 ngày gần nhất có dữ liệu KPI 4G
        const [datesRaw] = await db.query(`SELECT DISTINCT Thoi_gian FROM kpi_4g WHERE Thoi_gian IS NOT NULL AND Thoi_gian != ''`);
        let dates = datesRaw.map(d => d.Thoi_gian).sort((a, b) => new Date(b.split('/').reverse().join('-')) - new Date(a.split('/').reverse().join('-')));
        dates = dates.slice(0, 30); // Lấy đúng 30 ngày
        
        if (dates.length === 0) return res.json({ error: "Không có dữ liệu KPI 4G để phân tích." });
        const placeholders = dates.map(() => '?').join(',');

        // 2. Query gom nhóm dữ liệu 30 ngày (Chỉ lấy L1800)
        // Điều kiện L1800: CellType chứa L18, hoặc Band của RF là 1800
        const query = `
            SELECT k.Cell_name, 
                   IFNULL(r.MIMO, k.MIMO) as MIMO, 
                   r.Latitude, r.Longitude,
                   AVG(k.Total_Data_Traffic_Volume_GB) as avg_traf,
                   AVG(k.User_DL_Avg_Throughput_Kbps) as avg_thput,
                   AVG(k.RB_Util_Rate_DL) as avg_prb,
                   AVG(c.CEI_Percent) as avg_cem,
                   AVG(q.QoS_Score) as avg_qos
            FROM kpi_4g k
            LEFT JOIN rf_4g r ON k.Cell_name = r.Cell_code
            LEFT JOIN mbb_cem c ON k.Cell_name = c.Cell_Name
            LEFT JOIN mbb_qos q ON k.Cell_name = q.Cell_Name
            WHERE k.Thoi_gian IN (${placeholders})
              AND k.Cell_name NOT LIKE '%IBS%' AND k.Cell_name NOT LIKE '%DAS%' AND k.Cell_name NOT LIKE 'MBF_TH%'
              AND (k.CellType LIKE '%L18%' OR r.Band LIKE '%1800%')
            GROUP BY k.Cell_name, r.Latitude, r.Longitude, r.MIMO, k.MIMO
        `;
        
        const [rows] = await db.query(query, dates);

        let upgradeCandidates = [];
        let downgradeCandidates = [];

        // 3. Lọc danh sách theo Tiêu chí
        rows.forEach(r => {
            let mimo = String(r.MIMO || '').toUpperCase();
            let traf = parseFloat(r.avg_traf) || 0;
            let thputMbps = (parseFloat(r.avg_thput) || 0) / 1024;
            let prb = parseFloat(r.avg_prb) || 0;
            let lat = parseFloat(r.Latitude);
            let lng = parseFloat(r.Longitude);

            if (isNaN(lat) || isNaN(lng)) return;

            // Nâng cấp: Đang là 2T2R (hoặc 1T1R), Traffic CAO, Thput THẤP
            if (mimo.includes('2T') || mimo.includes('1T') || mimo === '') {
                if (traf >= upTraf && thputMbps <= upThput) {
                    upgradeCandidates.push({
                        cell: r.Cell_name, lat, lng, mimo: mimo || '2T2R', traf, thput: thputMbps, prb,
                        cem: r.avg_cem ? parseFloat(r.avg_cem).toFixed(1) : 'N/A',
                        qos: r.avg_qos ? parseFloat(r.avg_qos).toFixed(1) : 'N/A'
                    });
                }
            }
            
            // Hạ cấp: Đang là 4T4R (hoặc cao hơn), Traffic THẤP, PRB THẤP
            if (mimo.includes('4T') || mimo.includes('8T') || mimo.includes('MASSIVE')) {
                if (traf <= downTraf && prb <= downPrb) {
                    downgradeCandidates.push({
                        cell: r.Cell_name, lat, lng, mimo, traf, thput: thputMbps, prb
                    });
                }
            }
        });

        // 4. Thuật toán Ghép Cặp (Pairing) ưu tiên khoảng cách gần nhất
        let pairs = [];
        let usedDowngrades = new Set(); // Đánh dấu cell 4T4R đã bị lấy đi swap

        upgradeCandidates.forEach(upCell => {
            let bestMatch = null;
            let minDistance = Infinity;

            downgradeCandidates.forEach(downCell => {
                if (usedDowngrades.has(downCell.cell)) return; // Bỏ qua cell đã được ghép cặp

                let dist = calculateDistance(upCell.lat, upCell.lng, downCell.lat, downCell.lng);
                
                // Tìm trạm gần nhất và thỏa mãn khoảng cách tối đa
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
                usedDowngrades.add(bestMatch.cell); // Khóa cell hạ cấp này lại
            }
        });

        // Sắp xếp các cặp theo khoảng cách từ Gần -> Xa
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
        console.error("Lỗi thuật toán SWAP MIMO:", error);
        res.status(500).json({ error: "Lỗi hệ thống khi tính toán." });
    }
};
