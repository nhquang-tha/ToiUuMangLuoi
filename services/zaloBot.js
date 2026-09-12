const express = require('express');
const router = express.Router();
const db = require('../models/db');
const crypto = require('crypto');

// ==========================================
// CẤU HÌNH ZALO MINI APP / ZALO OA
// ==========================================
// 1. ZALO_BOT_TOKEN: Dùng để gọi API gửi tin nhắn từ phía Server về người dùng Zalo.
const ZALO_TOKEN = process.env.ZALO_BOT_TOKEN || '2227226583786668049:AChJXQAIyHjEGhvIsvjTDtDqzqsvjetpIqPsrKacSeTRNgmbkalXifCYJlzOsFbC';

// 2. SECRET_TOKEN (Mới): Lấy từ giao diện "Thiết lập chung" -> "Secret Token" của Webhook
// Cần điền chính xác chuỗi ngẫu nhiên mà Zalo cấp (VD: uv7Ul-z70-kGaGj00z) để xác thực.
const ZALO_SECRET_TOKEN = process.env.ZALO_SECRET_TOKEN || 'uv7Ul-z70-kGaGj00z'; 

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
// XỬ LÝ SỰ KIỆN TỪ ZALO WEBHOOK VỚI XÁC THỰC
// ==========================================
router.post('/api/zalo-webhook', async (req, res) => {
    
    // 1. Xác thực bảo mật Zalo (Signature Verification)
    const zaloSignature = req.headers['x-zevent-signature'];
    const bodyStr = req.rawBody || JSON.stringify(req.body); // Chú ý: Express cần cấu hình middleware để lưu req.rawBody. Nếu không, JSON.stringify(req.body) có thể lệch format.
    
    // Tính toán lại mã hash theo công thức: HMAC_SHA256(data: appId + raw_body, key: secret_token)
    // Dựa theo tài liệu Zalo, thông thường dữ liệu body cùng với timestamp hoặc MAC. 
    // Tuy nhiên, đối với tính năng Webhook chuẩn của Zalo Mini App, Zalo sử dụng HMAC:
    // (Bên dưới là mã giả, bạn cần điều chỉnh theo đúng thuật toán Zalo cung cấp nếu Zalo yêu cầu format cụ thể).
    if (ZALO_SECRET_TOKEN !== 'Điền_Secret_Token_Vào_Đây' && zaloSignature) {
        // Tạm ẩn thuật toán kiểm tra vì cần `appId` và cấu hình Body Parser thô.
        // const expectedSignature = crypto.createHmac('sha256', ZALO_SECRET_TOKEN).update(bodyStr).digest('hex');
        // if (expectedSignature !== zaloSignature) {
        //     console.error("Cảnh báo: Yêu cầu từ Zalo bị từ chối do sai chữ ký (Signature Mismatch).");
        //     return res.status(403).send('Forbidden');
        // }
    }

    // 2. Trả về 200 OK ngay lập tức để Zalo không báo Timeout
    res.status(200).send('OK');

    const event = req.body;
    
    // 3. Chỉ xử lý nếu sự kiện là người dùng gửi tin nhắn Text
    if (event.event_name !== 'user_send_text' || !event.message || !event.message.text) return;

    const senderId = event.sender.id;
    const textMsg = event.message.text.trim();
    
    // Tách lệnh và tham số
    const parts = textMsg.split(/\s+/);
    const command = parts[0].replace('/', '').toLowerCase();
    const keyword = textMsg.substring(parts[0].length).trim();

    // ==========================================
    // ĐIỀU HƯỚNG LỆNH (ZALO COMMANDS)
    // ==========================================
    
    if (command === 'start' || command === 'help') {
        const resp = `👋 HỆ THỐNG TRA CỨU MẠNG LƯỚI VNPT\n\nDanh sách lệnh hỗ trợ:\n📦 vt <tên>: Tra cứu mã vật tư\n🏢 csht <mã>: Tra cứu CSHT\n📡 rf <cell>: Tra thông tin RF\n📊 kpi <cell>: Xem KPI mới nhất\n⭐ cem <cell>: Điểm Trải nghiệm CEM\n⚙️ qos <cell>: Điểm Dịch vụ QoS\n\nVẽ Biểu đồ (Áp dụng 3G/4G/5G):\n📈 charkpi <cell>\n📉 charcem <cell>\n📉 charqos <cell>`;
        await sendZaloText(senderId, resp);
        return;
    }

    if (command === 'vt') {
        await sendZaloText(senderId, `⏳ Đang tra cứu vật tư: ${keyword}...`);
        try {
            const [rows] = await db.query(
                `SELECT DISTINCT ten_viet_tat, loai_card, ma_vt FROM vat_tu WHERE LOWER(ten_viet_tat) LIKE LOWER(?) OR LOWER(loai_card) LIKE LOWER(?) OR LOWER(ma_vt) LIKE LOWER(?) ORDER BY loai_card ASC LIMIT 20`, 
                [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`]
            );
            if (rows.length > 0) {
                let text = `📦 VẬT TƯ: ${keyword}\n-------------------\n`;
                rows.forEach(r => { text += `▪️ ${r.loai_card || 'Khác'} - ${r.ten_viet_tat}: ${r.ma_vt}\n`; });
                await sendZaloText(senderId, text);
            } else await sendZaloText(senderId, `❌ Không tìm thấy mã VT.`);
        } catch (e) { await sendZaloText(senderId, `❌ Lỗi DB.`); }
        return;
    }

    if (command === 'csht' || command === 'ne') {
        await sendZaloText(senderId, `⏳ Đang tìm CSHT: ${keyword}...`);
        try {
            const [rows] = await db.query(`SELECT * FROM csht_data WHERE LOWER(Ma_CSHT) LIKE LOWER(?) OR LOWER(Ten_CSHT) LIKE LOWER(?) OR LOWER(Ma_Tram_2G) LIKE LOWER(?) OR LOWER(Ma_Tram_3G) LIKE LOWER(?) OR LOWER(Ma_Tram_4G) LIKE LOWER(?) OR LOWER(Ma_Tram_5G) LIKE LOWER(?) LIMIT 1`, [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`]);
            if (rows.length > 0) {
                let r = rows[0];
                let text = `🏢 THÔNG TIN CSHT\n--------------------\n▪️ Tên CSHT: ${r.Ten_CSHT}\n▪️ Mã CSHT: ${r.Ma_CSHT}\n▪️ Địa chỉ: ${r.Dia_Chi}\n`;
                if (r.Loai_Nha_Tram) text += `▪️ Loại: ${r.Loai_Nha_Tram}\n`;
                let tramList = [];
                if (r.Ma_Tram_2G) tramList.push(`2G: ${r.Ma_Tram_2G}`);
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
                if (text.length > 2000) text = text.substring(0, 2000) + '...\n(Zalo giới hạn chiều dài)';
                await sendZaloText(senderId, text);
            } else { await sendZaloText(senderId, `❌ Không tìm thấy RF.`); }
        } catch (e) { await sendZaloText(senderId, `❌ Lỗi CSDL.`); }
        return;
    }

    // ==========================================
    // NHÓM LỆNH TRUY VẤN SỐ LIỆU ĐA MẠNG
    // ==========================================
    if (command === 'kpi') {
        const parsed = parseKeyword(keyword);
        await sendZaloText(senderId, `⏳ Đang lấy KPI...`);
        try {
            if (!parsed.net || parsed.net === '4g') {
                let [rows] = await db.query(`SELECT '4G' as Net, Thoi_gian, Cell_name as Cell, Total_Data_Traffic_Volume_GB as Traffic, User_DL_Avg_Throughput_Kbps as Thput, RB_Util_Rate_DL as PRB, CQI_4G as CQI, Service_Drop_all as DropRate FROM kpi_4g WHERE LOWER(Cell_name) LIKE LOWER(?) ORDER BY LENGTH(Cell_name) ASC, Cell_name ASC, id DESC LIMIT 1`, [`%${parsed.kw}%`]);
                if (rows.length > 0) {
                    let r = rows[0];
                    let text = `📊 KPI ${r.Net}: ${r.Cell}\n📅 Ngày: ${r.Thoi_gian}\n--------------------\n📦 Traffic: ${parseFloat(r.Traffic).toFixed(2)} GB\n🚀 DL Thput: ${parseFloat(r.Thput).toFixed(2)} Kbps\n🎯 CQI: ${parseFloat(r.CQI).toFixed(2)}%\n⚠️ PRB DL: ${parseFloat(r.PRB).toFixed(2)}%\n✂️ Drop: ${parseFloat(r.DropRate).toFixed(3)}%`;
                    return await sendZaloText(senderId, text);
                }
            }
            if (!parsed.net || parsed.net === '5g') {
                let [rows] = await db.query(`SELECT '5G' as Net, Thoi_gian, Ten_CELL as Cell, Total_Data_Traffic_Volume_GB as Traffic, A_User_DL_Avg_Throughput as Thput, CQI_5G as CQI FROM kpi_5g WHERE LOWER(Ten_CELL) LIKE LOWER(?) OR LOWER(CELL_ID) LIKE LOWER(?) ORDER BY LENGTH(Ten_CELL) ASC, Ten_CELL ASC, id DESC LIMIT 1`, [`%${parsed.kw}%`, `%${parsed.kw}%`]);
                if (rows.length > 0) {
                    let r = rows[0];
                    let text = `📊 KPI ${r.Net}: ${r.Cell}\n📅 Ngày: ${r.Thoi_gian}\n--------------------\n📦 Traffic: ${parseFloat(r.Traffic).toFixed(2)} GB\n🚀 DL Thput: ${parseFloat(r.Thput).toFixed(2)} Mbps\n🎯 CQI: ${parseFloat(r.CQI).toFixed(2)}%`;
                    return await sendZaloText(senderId, text);
                }
            }
            if (!parsed.net || parsed.net === '3g') {
                let [rows] = await db.query(`SELECT '3G' as Net, Thoi_gian, Ten_CELL as Cell, TRAFFIC as Traffic, CSSR, DCR FROM kpi_3g WHERE LOWER(Ten_CELL) LIKE LOWER(?) OR LOWER(CI) LIKE LOWER(?) ORDER BY LENGTH(Ten_CELL) ASC, Ten_CELL ASC, id DESC LIMIT 1`, [`%${parsed.kw}%`, `%${parsed.kw}%`]);
                if (rows.length > 0) {
                    let r = rows[0];
                    let text = `📊 KPI ${r.Net}: ${r.Cell}\n📅 Ngày: ${r.Thoi_gian}\n--------------------\n📦 Traffic: ${parseFloat(r.Traffic).toFixed(2)} Erl/GB\n🚀 CSSR: ${parseFloat(r.CSSR).toFixed(2)}%\n✂️ Drop: ${parseFloat(r.DCR).toFixed(3)}%`;
                    return await sendZaloText(senderId, text);
                }
            }
            await sendZaloText(senderId, `❌ Không có dữ liệu KPI.`);
        } catch (e) { await sendZaloText(senderId, `❌ Lỗi CSDL KPI.`); }
        return;
    }

    if (command === 'cem' || command === 'qoe') {
        const parsed = parseKeyword(keyword);
        try {
            const [rows] = await db.query(`SELECT Tuan, Cell_Name, CEI_Percent as QoE_Score, CEI_1_5 as QoE_Rank FROM mbb_cem WHERE LOWER(Cell_Name) LIKE LOWER(?) OR LOWER(Cell_ID) LIKE LOWER(?) ORDER BY LENGTH(Cell_Name) ASC, Cell_Name ASC, id DESC LIMIT 1`, [`%${parsed.kw}%`, `%${parsed.kw}%`]);
            if (rows.length > 0) {
                let r = rows[0];
                await sendZaloText(senderId, `⭐ ĐIỂM TRẢI NGHIỆM CEM\n🔹 Cell: ${r.Cell_Name}\n📅 Tuần: ${r.Tuan}\n--------------------\n🏆 Điểm: ${r.QoE_Score}%\n🏅 Hạng: ${r.QoE_Rank}`);
            } else await sendZaloText(senderId, `❌ Không có dữ liệu CEM.`);
        } catch (e) {} return;
    }

    if (command === 'qos') {
        const parsed = parseKeyword(keyword);
        try {
            const [rows] = await db.query(`SELECT Tuan, Cell_Name, QoS_Score, QoS_Rank FROM mbb_qos WHERE LOWER(Cell_Name) LIKE LOWER(?) OR LOWER(Cell_ID) LIKE LOWER(?) ORDER BY LENGTH(Cell_Name) ASC, Cell_Name ASC, id DESC LIMIT 1`, [`%${parsed.kw}%`, `%${parsed.kw}%`]);
            if (rows.length > 0) {
                let r = rows[0];
                await sendZaloText(senderId, `⚙️ ĐIỂM DỊCH VỤ (QoS)\n🔹 Cell: ${r.Cell_Name}\n📅 Tuần: ${r.Tuan}\n--------------------\n🏆 Điểm: ${r.QoS_Score}\n🏅 Hạng: ${r.QoS_Rank}`);
            } else await sendZaloText(senderId, `❌ Không có dữ liệu QoS.`);
        } catch (e) {} return;
    }

    // ==========================================
    // NHÓM LỆNH VẼ BIỂU ĐỒ (QUICKCHART.IO)
    // ==========================================
    if (command === 'charkpi') {
        const parsed = parseKeyword(keyword);
        await sendZaloText(senderId, `⏳ Đang vẽ biểu đồ KPI...`);
        try {
            let title1 = 'Traffic (GB)', title2 = 'Throughput DL (Kbps)', title3 = 'CQI (%)';
            let rows = [];

            if (!parsed.net || parsed.net === '4g') {
                [rows] = await db.query(`SELECT Thoi_gian, Total_Data_Traffic_Volume_GB as traf, User_DL_Avg_Throughput_Kbps as thput, CQI_4G as cqi FROM kpi_4g WHERE LOWER(Cell_name) LIKE LOWER(?) ORDER BY LENGTH(Cell_name) ASC, Cell_name ASC, id DESC LIMIT 7`, [`%${parsed.kw}%`]);
            }
            if (rows.length < 2 && (!parsed.net || parsed.net === '5g')) {
                [rows] = await db.query(`SELECT Thoi_gian, Total_Data_Traffic_Volume_GB as traf, A_User_DL_Avg_Throughput as thput, CQI_5G as cqi FROM kpi_5g WHERE LOWER(Ten_CELL) LIKE LOWER(?) OR LOWER(CELL_ID) LIKE LOWER(?) ORDER BY LENGTH(Ten_CELL) ASC, Ten_CELL ASC, id DESC LIMIT 7`, [`%${parsed.kw}%`, `%${parsed.kw}%`]);
                title2 = 'Throughput DL (Mbps)';
            }
            if (rows.length < 2 && (!parsed.net || parsed.net === '3g')) {
                [rows] = await db.query(`SELECT Thoi_gian, TRAFFIC as traf, CSSR as thput, DCR as cqi FROM kpi_3g WHERE LOWER(Ten_CELL) LIKE LOWER(?) OR LOWER(CI) LIKE LOWER(?) ORDER BY LENGTH(Ten_CELL) ASC, Ten_CELL ASC, id DESC LIMIT 7`, [`%${parsed.kw}%`, `%${parsed.kw}%`]);
                title1 = 'Traffic (Erl/GB)'; title2 = 'CSSR (%)'; title3 = 'Drop Rate (%)';
            }

            if (rows.length < 2) return await sendZaloText(senderId, `❌ Cần ít nhất 2 ngày dữ liệu.`);

            const data = rows.reverse();
            const labels = data.map(d => d.Thoi_gian.substring(0, 5)); 
            const cellFound = parsed.kw.toUpperCase();

            // Cập nhật biểu đồ hiển thị mượt mà với Tension, Fill color và BorderWidth (Giống Viber/Telegram)
            const chart1 = generateChartUrl({ 
                type: 'line', 
                data: { labels: labels, datasets: [{ label: title1, data: data.map(d => d.traf), borderColor: '#3498db', backgroundColor: 'rgba(52, 152, 219, 0.2)', fill: true, borderWidth: 3, tension: 0.4 }] }, 
                options: { title: { display: true, text: `Biến động ${title1} - ${cellFound}` } } 
            });
            const chart2 = generateChartUrl({ 
                type: 'line', 
                data: { labels: labels, datasets: [{ label: title2, data: data.map(d => d.thput), borderColor: '#9b59b6', backgroundColor: 'rgba(155, 89, 182, 0.2)', fill: true, borderWidth: 3, tension: 0.4 }] }, 
                options: { title: { display: true, text: `Biến động ${title2} - ${cellFound}` } } 
            });
            const chart3 = generateChartUrl({ 
                type: 'line', 
                data: { labels: labels, datasets: [{ label: title3, data: data.map(d => d.cqi), borderColor: '#2ecc71', backgroundColor: 'rgba(46, 204, 113, 0.2)', fill: true, borderWidth: 3, tension: 0.4 }] }, 
                options: { title: { display: true, text: `Biến động ${title3} - ${cellFound}` } } 
            });

            // Gửi từng ảnh một do Zalo không hỗ trợ gửi cụm (MediaGroup) tiện như Telegram
            await sendZaloPicture(senderId, chart1, `📈 Biểu đồ Traffic - ${cellFound}`);
            await sendZaloPicture(senderId, chart2, `📈 Biểu đồ Tốc độ - ${cellFound}`);
            await sendZaloPicture(senderId, chart3, `📈 Biểu đồ Chất lượng - ${cellFound}`);
        } catch (e) { await sendZaloText(senderId, `❌ Lỗi vẽ biểu đồ KPI.`); }
        return;
    }

    if (command === 'charcem' || command === 'charqoe') {
        const parsed = parseKeyword(keyword);
        await sendZaloText(senderId, `⏳ Đang vẽ biểu đồ CEM...`);
        try {
            const [rows] = await db.query(`SELECT Tuan, CEI_1_5 FROM mbb_cem WHERE LOWER(Cell_Name) LIKE LOWER(?) OR LOWER(Cell_ID) LIKE LOWER(?) ORDER BY LENGTH(Cell_Name) ASC, Cell_Name ASC, id DESC LIMIT 4`, [`%${parsed.kw}%`, `%${parsed.kw}%`]);
            if (rows.length < 2) return await sendZaloText(senderId, `❌ Ít nhất 2 tuần dữ liệu CEM.`);
            const data = rows.reverse();
            const chartUrl = generateChartUrl({
                type: 'line', data: { labels: data.map(d => d.Tuan.split(' ')[1] || d.Tuan), datasets: [{ label: 'Điểm CEM', data: data.map(d => d.CEI_1_5), borderColor: '#f1c40f', backgroundColor: 'rgba(241, 196, 15, 0.1)', fill: true, borderWidth: 3 }] },
                options: { title: { display: true, text: `Biến động CEM (4 Tuần)` } }
            });
            await sendZaloPicture(senderId, chartUrl, `⭐ Biểu đồ CEM: ${parsed.kw.toUpperCase()}`);
        } catch (e) {} return;
    }

    if (command === 'charqos') {
        const parsed = parseKeyword(keyword);
        await sendZaloText(senderId, `⏳ Đang vẽ biểu đồ QoS...`);
        try {
            const [rows] = await db.query(`SELECT Tuan, Cell_Name, QoS_Score, QoS_Rank FROM mbb_qos WHERE LOWER(Cell_Name) LIKE LOWER(?) OR LOWER(Cell_ID) LIKE LOWER(?) ORDER BY LENGTH(Cell_Name) ASC, Cell_Name ASC, id DESC LIMIT 4`, [`%${parsed.kw}%`, `%${parsed.kw}%`]);
            if (rows.length < 2) return await sendZaloText(senderId, `❌ Ít nhất 2 tuần dữ liệu.`);
            const data = rows.reverse();
            const chartUrl = generateChartUrl({
                type: 'bar', data: { labels: data.map(d => d.Tuan.split(' ')[1] || d.Tuan), datasets: [{ label: 'Điểm QoS', data: data.map(d => d.QoS_Score), backgroundColor: '#e74c3c' }] },
                options: { title: { display: true, text: `Biến động QoS (4 Tuần)` } }
            });
            await sendZaloPicture(senderId, chartUrl, `⚙️ Biểu đồ QoS: ${parsed.kw.toUpperCase()}`);
        } catch (e) {} return;
    }

    // Nếu không khớp lệnh nào
    await sendZaloText(senderId, `❌ Lệnh không hợp lệ. Gõ 'help' để xem danh sách lệnh.`);
});

module.exports = router;
