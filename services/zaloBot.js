const express = require('express');
const router = express.Router();
const db = require('../models/db');

// ĐIỀN ACCESS TOKEN CỦA ZALO OA VÀO ĐÂY
const ZALO_TOKEN = process.env.ZALO_BOT_TOKEN || '2227226583786668049:AChJXQAIyHjEGhvIsvjTDtDqzqsvjetpIqPsrKacSeTRNgmbkalXifCYJlzOsFbC';

// ==========================================
// CÁC HÀM HỖ TRỢ GIAO TIẾP VỚI ZALO API
// ==========================================
const sendZaloText = async (userId, text) => {
    try {
        await fetch('https://openapi.zalo.me/v2.0/oa/message', {
            method: 'POST',
            headers: { 'access_token': ZALO_TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify({ recipient: { user_id: userId }, message: { text: text } })
        });
    } catch (e) { console.error("Lỗi gửi tin Zalo:", e.message); }
};

const sendZaloPicture = async (userId, imageUrl, text) => {
    try {
        await fetch('https://openapi.zalo.me/v2.0/oa/message', {
            method: 'POST',
            headers: { 'access_token': ZALO_TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                recipient: { user_id: userId }, 
                message: { 
                    text: text,
                    attachment: { type: "template", payload: { template_type: "media", elements: [{ media_type: "image", url: imageUrl }] } }
                } 
            })
        });
    } catch (e) { console.error("Lỗi gửi ảnh Zalo:", e.message); }
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
// ENDPOINT NHẬN SỰ KIỆN TỪ ZALO WEBHOOK
// (Dán đường dẫn https://tenmiencuaban.com/api/zalo-webhook vào trang quản lý Zalo)
// ==========================================
router.post('/api/zalo-webhook', async (req, res) => {
    // Trả về 200 OK ngay lập tức để Zalo không báo Timeout
    res.status(200).send('OK');

    const event = req.body;
    
    // Chỉ xử lý nếu sự kiện là người dùng gửi tin nhắn Text
    if (event.event_name !== 'user_send_text' || !event.message || !event.message.text) return;

    const senderId = event.sender.id;
    const textMsg = event.message.text.trim();
    
    const parts = textMsg.split(/\s+/);
    const command = parts[0].replace('/', '').toLowerCase();
    const keyword = textMsg.substring(parts[0].length).trim();

    // ==========================================
    // ĐIỀU HƯỚNG LỆNH (ZALO COMMANDS)
    // ==========================================
    
    if (command === 'start' || command === 'help') {
        const resp = `👋 HỆ THỐNG TRA CỨU MẠNG LƯỚI VNPT\n\nDanh sách lệnh hỗ trợ:\n📦 vt <tên_viết_tắt>: Tra cứu mã vật tư\n🚑 alarm <bản_tin>: Phân tích nguyên nhân cảnh báo\n🏢 csht <mã_CSHT>: Tra cứu CSHT\n📡 rf <cell_code>: Tra thông tin RF\n📊 kpi <cell_code>: Tra thông tin KPI mới nhất\n⭐ cem <cell_code>: Tra thông tin CEM\n⚙️ qos <cell_code>: Tra thông tin QoS\n\nVẽ Biểu đồ:\n📈 charkpi <cell>\n📉 charcem <cell>\n📉 charqos <cell>`;
        await sendZaloText(senderId, resp);
        return;
    }

    if (command === 'vt') {
        await sendZaloText(senderId, `⏳ Đang tra cứu danh mục mã vật tư cho: ${keyword}...`);
        try {
            const [rows] = await db.query(
                `SELECT DISTINCT ten_viet_tat, loai_card, ma_vt FROM vat_tu WHERE LOWER(ten_viet_tat) LIKE LOWER(?) OR LOWER(loai_card) LIKE LOWER(?) OR LOWER(ma_vt) LIKE LOWER(?) ORDER BY loai_card ASC LIMIT 20`, 
                [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`]
            );
            if (rows.length > 0) {
                let text = `📦 KẾT QUẢ VẬT TƯ: ${keyword}\n-------------------\n`;
                rows.forEach(r => { text += `▪️ ${r.loai_card || 'Khác'} - ${r.ten_viet_tat}: ${r.ma_vt}\n`; });
                await sendZaloText(senderId, text);
            } else await sendZaloText(senderId, `❌ Không tìm thấy mã VT.`);
        } catch (e) { await sendZaloText(senderId, `❌ Lỗi DB.`); }
        return;
    }

    if (command === 'csht' || command === 'ne') {
        await sendZaloText(senderId, `⏳ Đang tìm CSHT: ${keyword}...`);
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
                await sendZaloText(senderId, text);
            } else { await sendZaloText(senderId, `❌ Không tìm thấy CSHT.`); }
        } catch (e) { await sendZaloText(senderId, "❌ Lỗi CSDL."); }
        return;
    }

    if (command === 'rf') {
        const parsed = parseKeyword(keyword);
        await sendZaloText(senderId, `⏳ Đang tra cứu RF...`);
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
                await sendZaloText(senderId, text);
            } else { await sendZaloText(senderId, `❌ Không tìm thấy RF.`); }
        } catch (e) { await sendZaloText(senderId, `❌ Lỗi CSDL.`); }
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
                    return await sendZaloText(senderId, text);
                }
            }
            await sendZaloText(senderId, `❌ Không có dữ liệu KPI.`);
        } catch (e) {} return;
    }

    if (command === 'charkpi') {
        const parsed = parseKeyword(keyword);
        await sendZaloText(senderId, `⏳ Đang vẽ biểu đồ KPI...`);
        try {
            let [rows] = await db.query(`SELECT Thoi_gian, Total_Data_Traffic_Volume_GB as traf, User_DL_Avg_Throughput_Kbps as thput, CQI_4G as cqi FROM kpi_4g WHERE LOWER(Cell_name) LIKE LOWER(?) ORDER BY LENGTH(Cell_name) ASC, Cell_name ASC, id DESC LIMIT 7`, [`%${parsed.kw}%`]);
            if (rows.length < 2) return await sendZaloText(senderId, `❌ Ít nhất 2 ngày dữ liệu.`);
            const data = rows.reverse();
            const labels = data.map(d => d.Thoi_gian.substring(0, 5)); 
            
            const chartUrl = generateChartUrl({ 
                type: 'line', 
                data: { labels: labels, datasets: [{ label: 'Traffic (GB)', data: data.map(d => d.traf), borderColor: '#3498db', fill: false }] } 
            });
            await sendZaloPicture(senderId, chartUrl, `📈 Biểu đồ Traffic - ${parsed.kw.toUpperCase()}`);
        } catch (e) { await sendZaloText(senderId, `❌ Lỗi vẽ biểu đồ KPI.`); }
        return;
    }

    // Nếu không khớp lệnh nào
    await sendZaloText(senderId, `❌ Lệnh không hợp lệ. Gõ 'help' để xem danh sách lệnh.`);
});

module.exports = router;
