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
    // Luôn trả về 200 OK ngay lập tức để Zalo không báo lỗi Timeout
    res.status(200).send('OK');

    const update = req.body;
    
    // Kiểm tra cấu trúc bản tin giống với Telegram
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
        const resp = `👋 HỆ THỐNG TRA CỨU MẠNG LƯỚI VNPT\n\nDanh sách lệnh hỗ trợ:\n📦 vt <tên_viết_tắt>: Tra cứu mã vật tư\n🚑 alarm <bản_tin>: Phân tích nguyên nhân cảnh báo\n🏢 csht <mã_CSHT>: Tra cứu CSHT\n📡 rf <cell_code>: Tra thông tin RF\n📊 kpi <cell_code>: Tra thông tin KPI mới nhất\n⭐ cem <cell_code>: Tra thông tin CEM\n⚙️ qos <cell_code>: Tra thông tin QoS\n\nVẽ Biểu đồ:\n📈 charkpi <cell>\n📉 charcem <cell>\n📉 charqos <cell>`;
        await sendZaloText(chatId, resp);
        return;
    }

    if (command === 'vt') {
        await sendZaloText(chatId, `⏳ Đang tra cứu danh mục mã vật tư cho: ${keyword}...`);
        try {
            const [rows] = await db.query(
                `SELECT DISTINCT ten_viet_tat, loai_card, ma_vt FROM vat_tu WHERE LOWER(ten_viet_tat) LIKE LOWER(?) OR LOWER(loai_card) LIKE LOWER(?) OR LOWER(ma_vt) LIKE LOWER(?) ORDER BY loai_card ASC LIMIT 20`, 
                [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`]
            );
            if (rows.length > 0) {
                let text = `📦 KẾT QUẢ VẬT TƯ: ${keyword}\n-------------------\n`;
                rows.forEach(r => { text += `▪️ ${r.loai_card || 'Khác'} - ${r.ten_viet_tat}: ${r.ma_vt}\n`; });
                await sendZaloText(chatId, text);
            } else await sendZaloText(chatId, `❌ Không tìm thấy mã VT.`);
        } catch (e) { await sendZaloText(chatId, `❌ Lỗi DB.`); }
        return;
    }

    if (command === 'csht' || command === 'ne') {
        await sendZaloText(chatId, `⏳ Đang tìm CSHT: ${keyword}...`);
        try {
            const [rows] = await db.query(`SELECT * FROM csht_data WHERE LOWER(Ma_CSHT) LIKE LOWER(?) OR LOWER(Ten_CSHT) LIKE LOWER(?) OR LOWER(Ma_Tram_3G) LIKE LOWER(?) OR LOWER(Ma_Tram_4G) LIKE LOWER(?) OR LOWER(Ma_Tram_5G) LIKE LOWER(?) LIMIT 1`, [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`]);
            if (rows.length > 0) {
                let r = rows[0];
                let text = `🏢 THÔNG TIN CSHT\n--------------------\n▪️ Tên CSHT: ${r.Ten_CSHT}\n▪️ Mã CSHT: ${r.Ma_CSHT}\n▪️ Địa chỉ: ${r.Dia_Chi}\n`;
                if (r.Loai_Nha_Tram) text += `▪️ Loại: ${r.Loai_Nha_Tram}\n`;
                let tramList = [];
                if (r.Ma_Tram_3G) tramList.push(`3G: ${r.Ma_Tram_3G}`);
                if (r.Ma_Tram_4G) tramList.push(`4G: ${r.Ma_Tram_4G}`);
                if (r.Ma_Tram_5G) tramList.push(`5G: ${r.Ma_Tram_5G}`);
                if (tramList.length > 0) text += `▪️ Trạm: ${tramList.join(' | ')}\n`;
                text += `\n🗺️ BẢN ĐỒ: https://www.google.com/maps/search/?api=1&query=${r.Latitude},${r.Longitude}`;
                await sendZaloText(chatId, text);
            } else { await sendZaloText(chatId, `❌ Không tìm thấy CSHT.`); }
        } catch (e) { await sendZaloText(chatId, "❌ Lỗi CSDL."); }
        return;
    }

    if (command === 'rf') {
        const parsed = parseKeyword(keyword);
        await sendZaloText(chatId, `⏳ Đang tra cứu RF...`);
        try {
            let rows = [];
            const queries = [
                { net: '4g', sql: `SELECT '4G' as Net, rf_4g.* FROM rf_4g WHERE LOWER(Cell_code) LIKE LOWER(?) OR LOWER(CELL_NAME) LIKE LOWER(?) LIMIT 1` },
                { net: '5g', sql: `SELECT '5G' as Net, rf_5g.* FROM rf_5g WHERE LOWER(Cell_code) LIKE LOWER(?) OR LOWER(SITE_NAME) LIKE LOWER(?) LIMIT 1` },
                { net: '3g', sql: `SELECT '3G' as Net, rf_3g.* FROM rf_3g WHERE LOWER(Cell_code) LIKE LOWER(?) OR LOWER(CELL_NAME) LIKE LOWER(?) LIMIT 1` }
            ];
            for (let q of queries) {
                if (parsed.net && q.net !== parsed.net) continue; 
                if (rows.length > 0) break; 
                let [res] = await db.query(q.sql, [`%${parsed.kw}%`, `%${parsed.kw}%`]);
                if (res.length > 0) rows = res;
            }
            if (rows.length > 0) {
                let r = rows[0]; 
                let text = `📡 KẾT QUẢ RF\n🌐 Mạng: ${r.Net}\n--------------------\n`;
                for (let key in r) {
                    if (key !== 'id' && key !== 'created_at' && key !== 'Net' && r[key]) {
                        text += `▪️ ${key.replace(/_/g, ' ').toUpperCase()}: ${r[key]}\n`;
                    }
                }
                text += `\n🗺️ BẢN ĐỒ: https://www.google.com/maps/search/?api=1&query=${r.Latitude},${r.Longitude}`;
                
                if (text.length > 1900) text = text.substring(0, 1900) + '...';
                await sendZaloText(chatId, text);
            } else { await sendZaloText(chatId, `❌ Không tìm thấy RF.`); }
        } catch (e) { await sendZaloText(chatId, `❌ Lỗi CSDL.`); }
        return;
    }

    if (command === 'kpi') {
        const parsed = parseKeyword(keyword);
        try {
            if (!parsed.net || parsed.net === '4g') {
                let [rows] = await db.query(`SELECT '4G' as Net, Thoi_gian, Cell_name as Cell, Total_Data_Traffic_Volume_GB as Traffic, User_DL_Avg_Throughput_Kbps as Thput, RB_Util_Rate_DL as PRB, CQI_4G as CQI, Service_Drop_all as DropRate FROM kpi_4g WHERE LOWER(Cell_name) LIKE LOWER(?) ORDER BY LENGTH(Cell_name) ASC, Cell_name ASC, id DESC LIMIT 1`, [`%${parsed.kw}%`]);
                if (rows.length > 0) {
                    let r = rows[0];
                    let text = `📊 KPI ${r.Net}: ${r.Cell}\n📅 Ngày: ${r.Thoi_gian}\n--------------------\n📦 Traffic: ${parseFloat(r.Traffic).toFixed(2)} GB\n🚀 DL Thput: ${parseFloat(r.Thput).toFixed(2)} Kbps\n🎯 CQI: ${parseFloat(r.CQI).toFixed(2)}%\n⚠️ PRB DL: ${parseFloat(r.PRB).toFixed(2)}%\n✂️ Drop: ${parseFloat(r.DropRate).toFixed(3)}%`;
                    return await sendZaloText(chatId, text);
                }
            }
            if (!parsed.net || parsed.net === '5g') {
                let [rows] = await db.query(`SELECT '5G' as Net, Thoi_gian, Ten_CELL as Cell, Total_Data_Traffic_Volume_GB as Traffic, A_User_DL_Avg_Throughput as Thput, CQI_5G as CQI FROM kpi_5g WHERE LOWER(Ten_CELL) LIKE LOWER(?) OR LOWER(CELL_ID) LIKE LOWER(?) ORDER BY LENGTH(Ten_CELL) ASC, Ten_CELL ASC, id DESC LIMIT 1`, [`%${parsed.kw}%`, `%${parsed.kw}%`]);
                if (rows.length > 0) {
                    let r = rows[0];
                    let text = `📊 KPI ${r.Net}: ${r.Cell}\n📅 Ngày: ${r.Thoi_gian}\n--------------------\n📦 Traffic: ${parseFloat(r.Traffic).toFixed(2)} GB\n🚀 DL Thput: ${parseFloat(r.Thput).toFixed(2)} Mbps\n🎯 CQI 5G: ${parseFloat(r.CQI).toFixed(2)}%`;
                    return await sendZaloText(chatId, text);
                }
            }
            if (!parsed.net || parsed.net === '3g') {
                let [rows] = await db.query(`SELECT '3G' as Net, Thoi_gian, Ten_CELL as Cell, TRAFFIC as Traffic, CSSR, DCR FROM kpi_3g WHERE LOWER(Ten_CELL) LIKE LOWER(?) OR LOWER(CI) LIKE LOWER(?) ORDER BY LENGTH(Ten_CELL) ASC, Ten_CELL ASC, id DESC LIMIT 1`, [`%${parsed.kw}%`, `%${parsed.kw}%`]);
                if (rows.length > 0) {
                    let r = rows[0];
                    let text = `📊 KPI ${r.Net}: ${r.Cell}\n📅 Ngày: ${r.Thoi_gian}\n--------------------\n📦 Traffic: ${parseFloat(r.Traffic).toFixed(2)} Erl/GB\n🚀 CSSR: ${parseFloat(r.CSSR).toFixed(2)}%\n✂️ Drop: ${parseFloat(r.DCR).toFixed(3)}%`;
                    return await sendZaloText(chatId, text);
                }
            }
            await sendZaloText(chatId, `❌ Không có dữ liệu KPI.`);
        } catch (e) {} return;
    }

    if (command === 'cem') {
        const parsed = parseKeyword(keyword);
        try {
            const [rows] = await db.query(`SELECT Tuan, Cell_Name, CEI_1_5, CEI_Percent FROM mbb_cem WHERE LOWER(Cell_Name) LIKE LOWER(?) OR LOWER(Cell_ID) LIKE LOWER(?) ORDER BY LENGTH(Cell_Name) ASC, Cell_Name ASC, id DESC LIMIT 1`, [`%${parsed.kw}%`, `%${parsed.kw}%`]);
            if (rows.length > 0) {
                const r = rows[0];
                await sendZaloText(chatId, `⭐ CHỈ SỐ CEM\n🔹 Cell: ${r.Cell_Name}\n📅 Tuần: ${r.Tuan}\n--------------------\n🏆 Điểm CEM: ${r.CEI_1_5}\n🏅 Tỷ lệ: ${r.CEI_Percent}%`);
            } else await sendZaloText(chatId, `❌ Không có dữ liệu CEM.`);
        } catch (e) {} return;
    }

    if (command === 'qos') {
        const parsed = parseKeyword(keyword);
        try {
            const [rows] = await db.query(`SELECT Tuan, Cell_Name, QoS_Score, QoS_Rank FROM mbb_qos WHERE LOWER(Cell_Name) LIKE LOWER(?) OR LOWER(Cell_ID) LIKE LOWER(?) ORDER BY LENGTH(Cell_Name) ASC, Cell_Name ASC, id DESC LIMIT 1`, [`%${parsed.kw}%`, `%${parsed.kw}%`]);
            if (rows.length > 0) {
                const r = rows[0];
                await sendZaloText(chatId, `⚙️ CHỈ SỐ QOS\n🔹 Cell: ${r.Cell_Name}\n📅 Tuần: ${r.Tuan}\n--------------------\n🏆 Điểm QoS: ${r.QoS_Score}\n🏅 Hạng: ${r.QoS_Rank}`);
            } else await sendZaloText(chatId, `❌ Không có dữ liệu QoS.`);
        } catch (e) {} return;
    }

    if (command === 'charkpi') {
        const parsed = parseKeyword(keyword);
        await sendZaloText(chatId, `⏳ Đang vẽ biểu đồ KPI...`);
        try {
            let [rows] = await db.query(`SELECT Thoi_gian, Total_Data_Traffic_Volume_GB as traf, User_DL_Avg_Throughput_Kbps as thput, CQI_4G as cqi FROM kpi_4g WHERE LOWER(Cell_name) LIKE LOWER(?) ORDER BY LENGTH(Cell_name) ASC, Cell_name ASC, id DESC LIMIT 7`, [`%${parsed.kw}%`]);
            if (rows.length < 2) return await sendZaloText(chatId, `❌ Ít nhất 2 ngày dữ liệu.`);
            const data = rows.reverse();
            const labels = data.map(d => d.Thoi_gian.substring(0, 5)); 
            
            const chartUrl = generateChartUrl({ 
                type: 'line', 
                data: { labels: labels, datasets: [{ label: 'Traffic (GB)', data: data.map(d => d.traf), borderColor: '#3498db', backgroundColor: 'rgba(52, 152, 219, 0.2)', fill: true, borderWidth: 3 }] },
                options: { title: { display: true, text: `Biến động Traffic - ${parsed.kw.toUpperCase()}` } }
            });
            await sendZaloPicture(chatId, chartUrl, `📈 Biểu đồ Traffic`);
        } catch (e) { await sendZaloText(chatId, `❌ Lỗi vẽ biểu đồ KPI.`); }
        return;
    }

    if (command === 'charcem') {
        const parsed = parseKeyword(keyword);
        await sendZaloText(chatId, `⏳ Đang vẽ biểu đồ CEM...`);
        try {
            const [rows] = await db.query(`SELECT Tuan, CEI_1_5 FROM mbb_cem WHERE LOWER(Cell_Name) LIKE LOWER(?) OR LOWER(Cell_ID) LIKE LOWER(?) ORDER BY LENGTH(Cell_Name) ASC, Cell_Name ASC, id DESC LIMIT 4`, [`%${parsed.kw}%`, `%${parsed.kw}%`]);
            if (rows.length < 2) return await sendZaloText(chatId, `❌ Cần ít nhất 2 tuần dữ liệu.`);
            const data = rows.reverse();
            const chartUrl = generateChartUrl({
                type: 'line', 
                data: { labels: data.map(d => d.Tuan.split(' ')[1] || d.Tuan), datasets: [{ label: 'Điểm CEM', data: data.map(d => d.CEI_1_5), borderColor: '#f1c40f', backgroundColor: 'rgba(241, 196, 15, 0.2)', fill: true, borderWidth: 3 }] },
                options: { title: { display: true, text: `Biến động CEM - ${parsed.kw.toUpperCase()}` } }
            });
            await sendZaloPicture(chatId, chartUrl, `⭐ Biểu đồ CEM`);
        } catch (e) {} return;
    }

    if (command === 'charqos') {
        const parsed = parseKeyword(keyword);
        await sendZaloText(chatId, `⏳ Đang vẽ biểu đồ QoS...`);
        try {
            const [rows] = await db.query(`SELECT Tuan, Cell_Name, QoS_Score, QoS_Rank FROM mbb_qos WHERE LOWER(Cell_Name) LIKE LOWER(?) OR LOWER(Cell_ID) LIKE LOWER(?) ORDER BY LENGTH(Cell_Name) ASC, Cell_Name ASC, id DESC LIMIT 4`, [`%${parsed.kw}%`, `%${parsed.kw}%`]);
            if (rows.length < 2) return await sendZaloText(chatId, `❌ Cần ít nhất 2 tuần dữ liệu.`);
            const data = rows.reverse();
            const chartUrl = generateChartUrl({
                type: 'bar', data: { labels: data.map(d => d.Tuan.split(' ')[1] || d.Tuan), datasets: [{ label: 'Điểm QoS', data: data.map(d => d.QoS_Score), backgroundColor: '#e74c3c' }] },
                options: { title: { display: true, text: `Biến động QoS (4 Tuần)` } }
            });
            await sendZaloPicture(chatId, chartUrl, `⚙️ Biểu đồ QoS: ${parsed.kw.toUpperCase()}`);
        } catch (e) {} return;
    }

    // Nếu không khớp lệnh nào
    await sendZaloText(chatId, `❌ Lệnh không hợp lệ. Gõ 'help' để xem danh sách lệnh.`);
});

module.exports = router;
