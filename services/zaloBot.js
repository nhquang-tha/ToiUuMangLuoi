const express = require('express');
const router = express.Router();
const db = require('../models/db');

// ĐIỀN BOT TOKEN BẠN LẤY TỪ ZALO BOT CREATOR VÀO ĐÂY (dạng {bot_id}:{secret})
const ZALO_TOKEN = process.env.ZALO_BOT_TOKEN || '2227226583786668049:AChJXQAIyHjEGhvIsvjTDtDqzqsvjetpIqPsrKacSeTRNgmbkalXifCYJlzOsFbC';
const ZALO_API_BASE = `https://bot-api.zaloplatforms.com/bot${ZALO_TOKEN}`;

// ==========================================
// CÁC HÀM HỖ TRỢ GIAO TIẾP VỚI ZALO BOT CREATOR API
// ==========================================
const sendZaloText = async (chatId, text) => {
    try {
        const response = await fetch(`${ZALO_API_BASE}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: text })
        });
        const result = await response.json();
        if (!result.ok) console.error("❌ Zalo từ chối gửi tin Text:", result);
    } catch (e) { 
        console.error("❌ Lỗi mạng khi gọi Zalo API:", e.message); 
    }
};

const sendZaloPicture = async (chatId, imageUrl, caption) => {
    try {
        const response = await fetch(`${ZALO_API_BASE}/sendPhoto`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, photo: imageUrl, caption: caption })
        });
        const result = await response.json();
        if (!result.ok) console.error("❌ Zalo từ chối gửi tin Ảnh:", result);
    } catch (e) { 
        console.error("❌ Lỗi mạng khi gửi ảnh Zalo API:", e.message); 
    }
};

const generateChartUrl = (chartConfig) => {
    return `https://quickchart.io/chart?w=600&h=350&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
};

const parseKeyword = (str) => {
    if (!str) return { net: null, kw: '' };
    let kw = String(str).toUpperCase().trim();
    let net = null;
    if (/^3G[- ]/i.test(kw)) { net = '3g'; kw = kw.replace(/^3G[- ]/i, ''); }
    else if (/^4G[- ]/i.test(kw)) { net = '4g'; kw = kw.replace(/^4G[- ]/i, ''); }
    else if (/^5G[- ]/i.test(kw)) { net = '5g'; kw = kw.replace(/^5G[- ]/i, ''); }
    kw = kw.replace(/-THA$/i, '').replace(/-TH$/i, ''); 
    return { net, kw };
};

// ==========================================
// ENDPOINT NHẬN SỰ KIỆN TỪ ZALO BOT WEBHOOK
// ==========================================
router.post('/api/zalo-webhook', async (req, res) => {
    res.status(200).send('OK');

    const update = req.body;
    if (!update || !update.message || !update.message.text) return;

    const chatId = update.message.chat.id;
    const textMsg = update.message.text.trim();
    
    const parts = textMsg.split(/\s+/);
    const command = parts[0].replace('/', '').toLowerCase();
    const keyword = textMsg.substring(parts[0].length).trim();

    console.log(`💬 Zalo Bot nhận lệnh [${command}] với từ khóa [${keyword}] từ ChatID: ${chatId}`);

    // ==========================================
    // ĐIỀU HƯỚNG LỆNH (ZALO COMMANDS)
    // ==========================================
    
    if (command === 'start' || command === 'help') {
        const resp = `👋 HỆ THỐNG TRA CỨU MẠNG LƯỚI VNPT

Tra cứu Thông tin:
📦 vt <tên_viết_tắt>: Tra cứu mã vật tư/thiết bị.
🚑 alarm <bản_tin>: Phân tích nguyên nhân & cách xử lý cảnh báo.
🏢 csht <mã_CSHT> hoặc ne <tên_rút_gọn>: Tra cứu CSHT.
📡 rf <cell_code>: Tra thông tin RF của cell.
📊 kpi <cell_code>: Tra thông tin KPI mới nhất của cell.
⭐ cem <cell_code>: Tra thông tin CEM tuần mới nhất của cell.
⚙️ qos <cell_code>: Tra thông tin QoS tuần mới nhất của cell.

Vẽ Biểu đồ (Charts):
📈 charkpi <cell_code>: Vẽ biểu đồ biến động KPI 7 ngày gần nhất.
📉 charcem <cell_code>: Vẽ biểu đồ biến động CEM 4 tuần gần nhất.
📉 charqos <cell_code>: Vẽ biểu đồ biến động QoS 4 tuần gần nhất.`;
        await sendZaloText(chatId, resp);
        return;
    }

    if (command === 'vt') {
        await sendZaloText(chatId, `⏳ Đang tra cứu danh mục mã vật tư cho: ${keyword}...`);
        try {
            const [rows] = await db.query(
                `SELECT DISTINCT ten_viet_tat, loai_card, ma_vt 
                 FROM vat_tu 
                 WHERE LOWER(ten_viet_tat) LIKE LOWER(?) 
                    OR LOWER(loai_card) LIKE LOWER(?) 
                    OR LOWER(ma_vt) LIKE LOWER(?)
                 ORDER BY loai_card ASC, ten_viet_tat ASC 
                 LIMIT 50`, 
                [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`]
            );

            if (rows.length > 0) {
                let responseText = `📦 KẾT QUẢ TRA CỨU VẬT TƯ\nTừ khóa: ${keyword}\nSố lượng: ${rows.length} thiết bị\n---------------------------\n`;
                
                let groupedData = {};
                rows.forEach(r => {
                    let loaiCard = r.loai_card || "Khác";
                    if (!groupedData[loaiCard]) groupedData[loaiCard] = [];
                    groupedData[loaiCard].push({ tenVietTat: r.ten_viet_tat || "N/A", maKho: r.ma_vt || "N/A" });
                });

                for (let group in groupedData) {
                    responseText += `🔹 Loại Card: ${group}\n`;
                    groupedData[group].forEach(item => {
                        responseText += `   ▪️ Viết tắt: ${item.tenVietTat}\n`;
                        responseText += `   ▪️ Mã VT: ${item.maKho}\n\n`;
                    });
                }

                if (responseText.length > 1900) {
                    responseText = responseText.substring(0, 1900) + '...\n\n⚠️ Danh sách quá dài, đã bị cắt bớt.';
                }
                await sendZaloText(chatId, responseText);
            } else {
                await sendZaloText(chatId, `❌ Không tìm thấy thông tin Mã Vật Tư nào khớp với: ${keyword}`);
            }
        } catch (e) { await sendZaloText(chatId, `❌ Lỗi kết nối CSDL Vật Tư.`); }
        return;
    }

    if (command === 'alarm') {
        const alarmText = keyword;
        await sendZaloText(chatId, `⏳ Đang phân tích bản tin Alarm...`);

        try {
            let cellName = null;
            let explicitNameMatch = alarmText.match(/(?:Cell|NodeB|eNodeB Function|Site)\s*Name\s*=\s*([A-Z0-9_.-]+)/i);
            if (explicitNameMatch && explicitNameMatch[1]) {
                cellName = explicitNameMatch[1].toUpperCase();
            } else {
                let fallbackMatch = alarmText.match(/(?:2G_|3G_|4G-|5G-)[A-Z0-9]+(?:[-_][A-Z0-9]+)*/i);
                cellName = fallbackMatch ? fallbackMatch[0].toUpperCase() : null;
            }

            let hwMatch = alarmText.match(/\|\s*([^|]*(?:Cabinet|Subrack|Slot|Port)\s*No[^|]*)\s*\|/i);
            let hwPos = hwMatch ? hwMatch[1].trim() : null;

            let spMatch = alarmText.match(/Specific\s*Problem\s*=\s*([^,\]|]+)/i);
            let specificProblem = spMatch ? spMatch[1].trim() : null;

            let cause = "Chưa có thông định nghĩa cho cảnh báo này trong Cẩm nang.";
            let action = "- Vui lòng liên hệ OMC/NOC để kiểm tra thêm trên hệ thống giám sát.\n- Reset thiết bị nếu cần thiết.";
            let matchedKeyword = "Không xác định";
            let alarmGroup = "Không xác định";

            try {
                const [alarmRules] = await db.query('SELECT nhom_canh_bao, tu_khoa, nguyen_nhan, phuong_an_xu_ly FROM alarm_data');
                alarmRules.sort((a, b) => {
                    let lenA = a.tu_khoa ? a.tu_khoa.trim().length : 0;
                    let lenB = b.tu_khoa ? b.tu_khoa.trim().length : 0;
                    return lenB - lenA;
                });

                for (let rule of alarmRules) {
                    let kw = rule.tu_khoa ? rule.tu_khoa.trim() : '';
                    if (kw && alarmText.toLowerCase().includes(kw.toLowerCase())) {
                        matchedKeyword = kw;
                        alarmGroup = rule.nhom_canh_bao || "Chưa phân nhóm";
                        cause = rule.nguyen_nhan || "Không có nội dung nguyên nhân.";
                        action = rule.phuong_an_xu_ly || "Không có phương án xử lý.";
                        break; 
                    }
                }
            } catch (e) {}

            let cshtInfo = ``;
            if (cellName) {
                cshtInfo += `▪️ Mã Trạm/Cell_Code: ${cellName}\n`;
                let siteCodeFromRF = null;
                let finalLat = null; let finalLng = null; let actualCellNameFromRF = null;

                try {
                    const rfQueries = [
                        `SELECT Site_code, Latitude, Longitude, CELL_NAME as DbCellName FROM rf_4g WHERE LOWER(Cell_code) LIKE LOWER(?) OR LOWER(CELL_NAME) LIKE LOWER(?) ORDER BY LENGTH(Cell_code) ASC LIMIT 1`,
                        `SELECT Site_code, Latitude, Longitude, SITE_NAME as DbCellName FROM rf_5g WHERE LOWER(Cell_code) LIKE LOWER(?) OR LOWER(SITE_NAME) LIKE LOWER(?) ORDER BY LENGTH(Cell_code) ASC LIMIT 1`,
                        `SELECT Site_code, Latitude, Longitude, CELL_NAME as DbCellName FROM rf_3g WHERE LOWER(Cell_code) LIKE LOWER(?) OR LOWER(CELL_NAME) LIKE LOWER(?) ORDER BY LENGTH(Cell_code) ASC LIMIT 1`
                    ];
                    let searchCell = cellName.replace(/(?:_THA|-THA|_TH|-TH)$/i, '').trim();
                    for (let sql of rfQueries) {
                        let [rfRows] = await db.query(sql, [`%${searchCell}%`, `%${searchCell}%`]);
                        if (rfRows.length > 0) {
                            siteCodeFromRF = rfRows[0].Site_code; finalLat = rfRows[0].Latitude; finalLng = rfRows[0].Longitude; actualCellNameFromRF = rfRows[0].DbCellName; break;
                        }
                    }
                } catch (e) {}

                let coreCode = siteCodeFromRF;
                if (!coreCode) {
                    let coreMatch = cellName.match(/(?:2G_|3G_|4G-|5G-)([A-Z0-9]{7})/i);
                    coreCode = coreMatch ? coreMatch[1] : cellName.replace(/^(?:2G_|3G_|4G-|5G-)/i, '').replace(/(?:_THA|-THA|_TH|-TH)$/i, '').trim();
                }

                const [cshtRows] = await db.query(`SELECT Ten_CSHT, Dia_Chi, Latitude, Longitude FROM csht_data WHERE LOWER(Ma_Tram_3G) LIKE LOWER(?) OR LOWER(Ma_Tram_4G) LIKE LOWER(?) OR LOWER(Ma_Tram_5G) LIKE LOWER(?) LIMIT 1`, [`%${coreCode}%`, `%${coreCode}%`, `%${coreCode}%`]);

                if (cshtRows.length > 0) {
                    let r = cshtRows[0];
                    let mapLat = r.Latitude || finalLat;
                    let mapLng = r.Longitude || finalLng;
                    let displayCshtName = actualCellNameFromRF ? actualCellNameFromRF : r.Ten_CSHT;
                    
                    cshtInfo += `▪️ Tên CSHT: ${displayCshtName}\n▪️ Địa chỉ: ${r.Dia_Chi}\n`;
                    if (mapLat && mapLng) cshtInfo += `🗺️ Bản đồ: https://www.google.com/maps/search/?api=1&query=${mapLat},${mapLng}\n`;
                } else {
                    if (actualCellNameFromRF || siteCodeFromRF) {
                        let displayName = actualCellNameFromRF ? actualCellNameFromRF : `Chưa khai báo (Mã gốc: ${siteCodeFromRF})`;
                        cshtInfo += `▪️ Tên CSHT: ${displayName}\n`;
                        if (finalLat && finalLng) cshtInfo += `🗺️ Bản đồ: https://www.google.com/maps/search/?api=1&query=${finalLat},${finalLng}\n`;
                    } else {
                        cshtInfo += `▪️ Tên CSHT: Chưa có dữ liệu khớp.\n`;
                    }
                }
            } else { cshtInfo += `▪️ Mã Trạm: Không bóc tách được từ bản tin\n`; }

            if (hwPos) cshtInfo += `▪️ Thông tin HW/NodeB: ${hwPos}\n`;
            if (specificProblem) cshtInfo += `▪️ Lỗi chi tiết: ${specificProblem}\n`;

            let responseText = `🚑 KẾT QUẢ PHÂN TÍCH CẢNH BÁO\n---------------------------\n${cshtInfo}---------------------------\n📑 Nhóm cảnh báo: ${alarmGroup}\n🔍 Từ khóa nhận diện: ${matchedKeyword}\n\n⚠️ NGUYÊN NHÂN:\n${cause}\n\n🛠 PHƯƠNG ÁN XỬ LÝ:\n${action}`;
            
            if (responseText.length > 1900) responseText = responseText.substring(0, 1900) + '... (Dài quá đã bị cắt)';
            await sendZaloText(chatId, responseText);
        } catch (error) { await sendZaloText(chatId, `❌ Lỗi phân tích Alarm.`); }
        return;
    }

    if (command === 'csht' || command === 'ne') {
        await sendZaloText(chatId, `⏳ Đang tra cứu Cơ sở hạ tầng: ${keyword}...`);
        try {
            const [rows] = await db.query(`SELECT * FROM csht_data WHERE LOWER(Ma_CSHT) LIKE LOWER(?) OR LOWER(Ten_CSHT) LIKE LOWER(?) OR LOWER(Ma_Tram_3G) LIKE LOWER(?) OR LOWER(Ma_Tram_4G) LIKE LOWER(?) OR LOWER(Ma_Tram_5G) LIKE LOWER(?) LIMIT 1`, [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`]);
            if (rows.length > 0) {
                let r = rows[0];
                let text = `🏢 THÔNG TIN CƠ SỞ HẠ TẦNG\n---------------------------\n▪️ Tên CSHT: ${r.Ten_CSHT}\n▪️ Mã CSHT: ${r.Ma_CSHT}\n▪️ Địa chỉ: ${r.Dia_Chi}\n`;
                if (r.Loai_Nha_Tram) text += `▪️ Loại trạm: ${r.Loai_Nha_Tram}\n`;
                if (r.Don_Vi_Quan_Ly) text += `▪️ Đơn vị QL: ${r.Don_Vi_Quan_Ly}\n`;
                
                let tramList = [];
                if (r.Ma_Tram_3G) tramList.push(`3G: ${r.Ma_Tram_3G}`);
                if (r.Ma_Tram_4G) tramList.push(`4G: ${r.Ma_Tram_4G}`);
                if (r.Ma_Tram_5G) tramList.push(`5G: ${r.Ma_Tram_5G}`);
                if (tramList.length > 0) text += `▪️ Trạm phát sóng: ${tramList.join(' | ')}\n`;
                
                text += `\n🗺️ BẢN ĐỒ: https://www.google.com/maps/search/?api=1&query=${r.Latitude},${r.Longitude}`;
                await sendZaloText(chatId, text);
            } else { await sendZaloText(chatId, `❌ Không tìm thấy CSHT cho từ khóa: ${keyword}`); }
        } catch (e) { await sendZaloText(chatId, "❌ Lỗi CSDL CSHT."); }
        return;
    }

    if (command === 'rf') {
        const parsed = parseKeyword(keyword);
        const targetNet = parsed.net;
        await sendZaloText(chatId, `⏳ Đang trích xuất dữ liệu RF cho: ${parsed.kw}...`);
        try {
            let rows = [];
            const queries = [
                { net: '4g', sql: `SELECT '4G' as Net, rf_4g.* FROM rf_4g WHERE LOWER(Cell_code) LIKE LOWER(?) OR LOWER(CELL_NAME) LIKE LOWER(?) ORDER BY LENGTH(Cell_code) ASC LIMIT 1` },
                { net: '5g', sql: `SELECT '5G' as Net, rf_5g.* FROM rf_5g WHERE LOWER(Cell_code) LIKE LOWER(?) OR LOWER(SITE_NAME) LIKE LOWER(?) ORDER BY LENGTH(Cell_code) ASC LIMIT 1` },
                { net: '3g', sql: `SELECT '3G' as Net, rf_3g.* FROM rf_3g WHERE LOWER(Cell_code) LIKE LOWER(?) OR LOWER(CELL_NAME) LIKE LOWER(?) ORDER BY LENGTH(Cell_code) ASC LIMIT 1` }
            ];
            for (let q of queries) {
                if (targetNet && q.net !== targetNet) continue; 
                if (rows.length > 0) break; 
                let [res] = await db.query(q.sql, [`%${parsed.kw}%`, `%${parsed.kw}%`]);
                if (res.length > 0) rows = res;
            }
            if (rows.length > 0) {
                let r = rows[0]; 
                let text = `📡 KẾT QUẢ RF CHI TIẾT:\n🌐 Mạng: ${r.Net}\n---------------------------\n`;
                for (let key in r) {
                    if (key !== 'id' && key !== 'created_at' && key !== 'Net' && r[key]) {
                        text += `▪️ ${key.replace(/_/g, ' ').toUpperCase()}: ${r[key]}\n`;
                    }
                }
                text += `\n🗺️ BẢN ĐỒ: https://www.google.com/maps/search/?api=1&query=${r.Latitude},${r.Longitude}`;
                if (text.length > 1900) text = text.substring(0, 1900) + '...\n(Dữ liệu quá dài đã bị cắt bớt)';
                await sendZaloText(chatId, text);
            } else { await sendZaloText(chatId, `❌ Không tìm thấy Cell nào khớp với: ${keyword}`); }
        } catch (e) { await sendZaloText(chatId, `❌ Lỗi CSDL RF.`); }
        return;
    }

    if (command === 'kpi') {
        const parsed = parseKeyword(keyword);
        const targetNet = parsed.net;
        try {
            if (!targetNet || targetNet === '4g') {
                let [rows] = await db.query(`SELECT '4G' as Net, Thoi_gian, Cell_name as Cell, Total_Data_Traffic_Volume_GB as Traffic, User_DL_Avg_Throughput_Kbps as Thput, RB_Util_Rate_DL as PRB, CQI_4G as CQI, Service_Drop_all as DropRate FROM kpi_4g WHERE LOWER(Cell_name) LIKE LOWER(?) ORDER BY LENGTH(Cell_name) ASC, Cell_name ASC, id DESC LIMIT 1`, [`%${parsed.kw}%`]);
                if (rows.length > 0) {
                    let r = rows[0];
                    let text = `📊 KPI MỚI NHẤT (${r.Net}): ${r.Cell}\n📅 Ngày: ${r.Thoi_gian}\n---------------------------\n📦 Traffic: ${parseFloat(r.Traffic).toFixed(2)} GB\n🚀 Tốc độ (DL): ${parseFloat(r.Thput).toFixed(2)} Kbps\n🎯 CQI: ${parseFloat(r.CQI).toFixed(2)}%\n⚠️ Tải PRB DL: ${parseFloat(r.PRB).toFixed(2)}%\n✂️ Drop Rate: ${parseFloat(r.DropRate).toFixed(3)}%`;
                    return await sendZaloText(chatId, text);
                }
            }
            if (!targetNet || targetNet === '5g') {
                let [rows] = await db.query(`SELECT '5G' as Net, Thoi_gian, Ten_CELL as Cell, Total_Data_Traffic_Volume_GB as Traffic, A_User_DL_Avg_Throughput as Thput, CQI_5G as CQI FROM kpi_5g WHERE LOWER(Ten_CELL) LIKE LOWER(?) OR LOWER(CELL_ID) LIKE LOWER(?) ORDER BY LENGTH(Ten_CELL) ASC, Ten_CELL ASC, id DESC LIMIT 1`, [`%${parsed.kw}%`, `%${parsed.kw}%`]);
                if (rows.length > 0) {
                    let r = rows[0];
                    let text = `📊 KPI MỚI NHẤT (${r.Net}): ${r.Cell}\n📅 Ngày: ${r.Thoi_gian}\n---------------------------\n📦 Traffic: ${parseFloat(r.Traffic).toFixed(2)} GB\n🚀 Tốc độ (DL): ${parseFloat(r.Thput).toFixed(2)} Mbps\n🎯 CQI 5G: ${parseFloat(r.CQI).toFixed(2)}%`;
                    return await sendZaloText(chatId, text);
                }
            }
            if (!targetNet || targetNet === '3g') {
                let [rows] = await db.query(`SELECT '3G' as Net, Thoi_gian, Ten_CELL as Cell, TRAFFIC as Traffic, CSSR, DCR FROM kpi_3g WHERE LOWER(Ten_CELL) LIKE LOWER(?) OR LOWER(CI) LIKE LOWER(?) ORDER BY LENGTH(Ten_CELL) ASC, Ten_CELL ASC, id DESC LIMIT 1`, [`%${parsed.kw}%`, `%${parsed.kw}%`]);
                if (rows.length > 0) {
                    let r = rows[0];
                    let text = `📊 KPI MỚI NHẤT (${r.Net}): ${r.Cell}\n📅 Ngày: ${r.Thoi_gian}\n---------------------------\n📦 Traffic: ${parseFloat(r.Traffic).toFixed(2)} Erl/GB\n🚀 CSSR: ${parseFloat(r.CSSR).toFixed(2)}%\n✂️ Drop Rate (DCR): ${parseFloat(r.DCR).toFixed(3)}%`;
                    return await sendZaloText(chatId, text);
                }
            }
            await sendZaloText(chatId, `❌ Không tìm thấy dữ liệu KPI nào cho: ${keyword}`);
        } catch (e) { await sendZaloText(chatId, `❌ Lỗi CSDL KPI.`); }
        return;
    }

    if (command === 'cem') {
        const parsed = parseKeyword(keyword);
        try {
            const [rows] = await db.query(`SELECT Tuan, Cell_Name, CEI_1_5, CEI_Percent FROM mbb_cem WHERE LOWER(Cell_Name) LIKE LOWER(?) OR LOWER(Cell_ID) LIKE LOWER(?) ORDER BY LENGTH(Cell_Name) ASC, Cell_Name ASC, id DESC LIMIT 1`, [`%${parsed.kw}%`, `%${parsed.kw}%`]);
            if (rows.length > 0) {
                const r = rows[0];
                await sendZaloText(chatId, `⭐ CHỈ SỐ TRẢI NGHIỆM (CEM)\n🔹 Cell: ${r.Cell_Name}\n📅 Tuần đánh giá: ${r.Tuan}\n---------------------------\n🏆 Điểm CEM (1-5): ${r.CEI_1_5}\n🏅 Tỷ lệ CEI: ${r.CEI_Percent}%`);
            } else await sendZaloText(chatId, `❌ Không có dữ liệu CEM.`);
        } catch (e) {} return;
    }

    if (command === 'qos') {
        const parsed = parseKeyword(keyword);
        try {
            const [rows] = await db.query(`SELECT Tuan, Cell_Name, QoS_Score, QoS_Rank FROM mbb_qos WHERE LOWER(Cell_Name) LIKE LOWER(?) OR LOWER(Cell_ID) LIKE LOWER(?) ORDER BY LENGTH(Cell_Name) ASC, Cell_Name ASC, id DESC LIMIT 1`, [`%${parsed.kw}%`, `%${parsed.kw}%`]);
            if (rows.length > 0) {
                const r = rows[0];
                await sendZaloText(chatId, `⚙️ CHỈ SỐ DỊCH VỤ (QoS)\n🔹 Cell: ${r.Cell_Name}\n📅 Tuần đánh giá: ${r.Tuan}\n---------------------------\n🏆 Điểm QoS: ${r.QoS_Score}\n🏅 Hạng (Rank): ${r.QoS_Rank}`);
            } else await sendZaloText(chatId, `❌ Không có dữ liệu QoS.`);
        } catch (e) {} return;
    }

    if (command === 'charkpi') {
        const parsed = parseKeyword(keyword);
        const targetNet = parsed.net;
        await sendZaloText(chatId, `⏳ Đang vẽ biểu đồ KPI 7 ngày cho: ${parsed.kw}...`);
        try {
            let title1 = 'Traffic (GB)', title2 = 'Throughput DL (Kbps)', title3 = 'CQI (%)';
            let rows = [];

            if (!targetNet || targetNet === '4g') {
                [rows] = await db.query(`SELECT Thoi_gian, Total_Data_Traffic_Volume_GB as traf, User_DL_Avg_Throughput_Kbps as thput, CQI_4G as cqi FROM kpi_4g WHERE LOWER(Cell_name) LIKE LOWER(?) ORDER BY LENGTH(Cell_name) ASC, Cell_name ASC, id DESC LIMIT 7`, [`%${parsed.kw}%`]);
            }
            if (rows.length < 2 && (!targetNet || targetNet === '5g')) {
                [rows] = await db.query(`SELECT Thoi_gian, Total_Data_Traffic_Volume_GB as traf, A_User_DL_Avg_Throughput as thput, CQI_5G as cqi FROM kpi_5g WHERE LOWER(Ten_CELL) LIKE LOWER(?) OR LOWER(CELL_ID) LIKE LOWER(?) ORDER BY LENGTH(Ten_CELL) ASC, Ten_CELL ASC, id DESC LIMIT 7`, [`%${parsed.kw}%`, `%${parsed.kw}%`]);
                title2 = 'Throughput DL (Mbps)';
            }
            if (rows.length < 2 && (!targetNet || targetNet === '3g')) {
                [rows] = await db.query(`SELECT Thoi_gian, TRAFFIC as traf, CSSR as thput, DCR as cqi FROM kpi_3g WHERE LOWER(Ten_CELL) LIKE LOWER(?) OR LOWER(CI) LIKE LOWER(?) ORDER BY LENGTH(Ten_CELL) ASC, Ten_CELL ASC, id DESC LIMIT 7`, [`%${parsed.kw}%`, `%${parsed.kw}%`]);
                title1 = 'Traffic (Erl/GB)'; title2 = 'CSSR (%)'; title3 = 'Drop Rate (%)';
            }

            if (rows.length < 2) return await sendZaloText(chatId, `❌ Cần ít nhất 2 ngày dữ liệu để vẽ biểu đồ KPI.`);

            const data = rows.reverse();
            const labels = data.map(d => d.Thoi_gian.substring(0, 5)); 
            const cellFound = parsed.kw.toUpperCase();

            const chart1 = generateChartUrl({ 
                type: 'line', 
                data: { labels: labels, datasets: [{ label: title1, data: data.map(d => d.traf), borderColor: '#3498db', backgroundColor: 'rgba(52, 152, 219, 0.2)', fill: true, borderWidth: 3, lineTension: 0.4, pointRadius: 4, pointBackgroundColor: '#ffffff', pointBorderColor: '#3498db', pointBorderWidth: 2 }] }, 
                options: { title: { display: true, text: `Biến động ${title1} - ${cellFound}`, fontSize: 16, fontColor: '#2c3e50' }, legend: { display: false }, scales: { xAxes: [{ gridLines: { display: false } }], yAxes: [{ gridLines: { borderDash: [5, 5] } }] } } 
            });
            const chart2 = generateChartUrl({ 
                type: 'line', 
                data: { labels: labels, datasets: [{ label: title2, data: data.map(d => d.thput), borderColor: '#9b59b6', backgroundColor: 'rgba(155, 89, 182, 0.2)', fill: true, borderWidth: 3, lineTension: 0.4, pointRadius: 4, pointBackgroundColor: '#ffffff', pointBorderColor: '#9b59b6', pointBorderWidth: 2 }] }, 
                options: { title: { display: true, text: `Biến động ${title2} - ${cellFound}`, fontSize: 16, fontColor: '#2c3e50' }, legend: { display: false }, scales: { xAxes: [{ gridLines: { display: false } }], yAxes: [{ gridLines: { borderDash: [5, 5] } }] } } 
            });
            const chart3 = generateChartUrl({ 
                type: 'line', 
                data: { labels: labels, datasets: [{ label: title3, data: data.map(d => d.cqi), borderColor: '#2ecc71', backgroundColor: 'rgba(46, 204, 113, 0.2)', fill: true, borderWidth: 3, lineTension: 0.4, pointRadius: 4, pointBackgroundColor: '#ffffff', pointBorderColor: '#2ecc71', pointBorderWidth: 2 }] }, 
                options: { title: { display: true, text: `Biến động ${title3} - ${cellFound}`, fontSize: 16, fontColor: '#2c3e50' }, legend: { display: false }, scales: { xAxes: [{ gridLines: { display: false } }], yAxes: [{ gridLines: { borderDash: [5, 5] } }] } } 
            });

            // Gửi lần lượt 3 ảnh
            await sendZaloPicture(chatId, chart1, `📈 Biểu đồ Traffic`);
            await sendZaloPicture(chatId, chart2, `📈 Biểu đồ Tốc độ`);
            await sendZaloPicture(chatId, chart3, `📈 Biểu đồ Chất lượng (CQI/Drop)`);
        } catch (e) { await sendZaloText(chatId, `❌ Lỗi vẽ biểu đồ KPI.`); }
        return;
    }

    if (command === 'charcem') {
        const parsed = parseKeyword(keyword);
        await sendZaloText(chatId, `⏳ Đang vẽ biểu đồ CEM cho: ${parsed.kw}...`);
        try {
            const [rows] = await db.query(`SELECT Tuan, CEI_1_5 FROM mbb_cem WHERE LOWER(Cell_Name) LIKE LOWER(?) OR LOWER(Cell_ID) LIKE LOWER(?) ORDER BY LENGTH(Cell_Name) ASC, Cell_Name ASC, id DESC LIMIT 4`, [`%${parsed.kw}%`, `%${parsed.kw}%`]);
            if (rows.length < 2) return await sendZaloText(chatId, `❌ Cần ít nhất dữ liệu 2 tuần để vẽ biểu đồ CEM.`);
            
            const data = rows.reverse();
            const chartUrl = generateChartUrl({
                type: 'line', 
                data: { 
                    labels: data.map(d => d.Tuan.split(' ')[1] || d.Tuan), 
                    datasets: [{ 
                        label: 'Điểm CEM', 
                        data: data.map(d => d.CEI_1_5), 
                        borderColor: '#f1c40f', 
                        backgroundColor: 'rgba(241, 196, 15, 0.2)', 
                        fill: true, 
                        borderWidth: 3,
                        lineTension: 0.4, 
                        pointRadius: 4,
                        pointBackgroundColor: '#ffffff',
                        pointBorderColor: '#f1c40f',
                        pointBorderWidth: 2
                    }] 
                },
                options: { 
                    title: { display: true, text: `Biến động Điểm CEM (4 Tuần) - ${parsed.kw.toUpperCase()}`, fontSize: 16, fontColor: '#2c3e50' },
                    legend: { display: false },
                    scales: { xAxes: [{ gridLines: { display: false } }], yAxes: [{ gridLines: { borderDash: [5, 5] } }] }
                }
            });
            await sendZaloPicture(chatId, chartUrl, `⭐ Biểu đồ Trải nghiệm CEM: ${parsed.kw.toUpperCase()}`);
        } catch (e) {} return;
    }

    if (command === 'charqos') {
        const parsed = parseKeyword(keyword);
        await sendZaloText(chatId, `⏳ Đang vẽ biểu đồ QoS cho: ${parsed.kw}...`);
        try {
            const [rows] = await db.query(`SELECT Tuan, Cell_Name, QoS_Score, QoS_Rank FROM mbb_qos WHERE LOWER(Cell_Name) LIKE LOWER(?) OR LOWER(Cell_ID) LIKE LOWER(?) ORDER BY LENGTH(Cell_Name) ASC, Cell_Name ASC, id DESC LIMIT 4`, [`%${parsed.kw}%`, `%${parsed.kw}%`]);
            if (rows.length < 2) return await sendZaloText(chatId, `❌ Cần ít nhất dữ liệu 2 tuần để vẽ biểu đồ QoS.`);
            
            const data = rows.reverse();
            const chartUrl = generateChartUrl({
                type: 'bar', data: { labels: data.map(d => d.Tuan.split(' ')[1] || d.Tuan), datasets: [{ label: 'Điểm QoS', data: data.map(d => d.QoS_Score), backgroundColor: '#e74c3c' }] },
                options: { title: { display: true, text: `Biến động Điểm QoS (4 Tuần) - ${parsed.kw.toUpperCase()}`, fontSize: 16, fontColor: '#2c3e50' } }
            });
            await sendZaloPicture(chatId, chartUrl, `⚙️ Biểu đồ Dịch vụ QoS: ${parsed.kw.toUpperCase()}`);
        } catch (e) {} return;
    }

    // Nếu không khớp lệnh nào
    await sendZaloText(chatId, `❌ Lệnh không hợp lệ. Gõ 'help' để xem danh sách lệnh.`);
});

module.exports = router;
```eof
