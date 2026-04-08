const TelegramBot = require('node-telegram-bot-api');
const db = require('../models/db'); 

// ĐIỀN TOKEN BẠN LẤY TỪ @BotFather VÀO ĐÂY
const token = process.env.TELEGRAM_BOT_TOKEN || '8777941094:AAHFhpj4ZksmF7YyMjY8tn7Z3Ya7donSHpo';

let bot;
try {
    bot = new TelegramBot(token, { polling: true });
    console.log("🤖 Telegram Bot đã khởi động với Full Tính năng (Data & Charts)...");
} catch (error) {
    console.error("❌ Lỗi khởi động Telegram Bot!", error);
}

if (bot) {
    // ==========================================
    // HÀM HỖ TRỢ: TẠO URL BIỂU ĐỒ ẢNH TỪ QUICKCHART
    // ==========================================
    const generateChartUrl = (chartConfig) => {
        return `https://quickchart.io/chart?w=600&h=350&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
    };

    // ==========================================
    // MENU HƯỚNG DẪN (START)
    // ==========================================
    bot.onText(/^(?:\/)?(?:start|help)$/i, (msg) => {
        const chatId = msg.chat.id;
        const resp = `
👋 *HỆ THỐNG TRA CỨU MẠNG LƯỚI VNPT*

*Tra cứu Thông tin:*
📡 \`rf <Tên Cell>\`: Tra thông tin RF & Google Map.
📊 \`kpi <Tên Cell>\`: Tra KPI mới nhất.
⭐ \`qoe <Tên Cell>\`: Tra điểm QoE (Trải nghiệm) tuần mới nhất.
⚙️ \`qos <Tên Cell>\`: Tra điểm QoS (Dịch vụ) tuần mới nhất.

*Vẽ Biểu đồ (Charts):*
📈 \`charkpi <Tên Cell>\`: Biểu đồ KPI 7 ngày gần nhất.
📉 \`charqoe <Tên Cell>\`: Biểu đồ QoE 4 tuần gần nhất.
📉 \`charqos <Tên Cell>\`: Biểu đồ QoS 4 tuần gần nhất.

_Ví dụ: rf 4G-THA001M11-THA_
        `;
        bot.sendMessage(chatId, resp, { parse_mode: 'Markdown' });
    });

    // ==========================================
    // 1. LỆNH: rf <tên cell>
    // ==========================================
    bot.onText(/^(?:\/)?rf\s+(.+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const keyword = match[1].trim();
        bot.sendMessage(chatId, `⏳ Đang quét cấu hình RF cho: *${keyword}*...`, { parse_mode: 'Markdown' });

        try {
            let [rows] = await db.query(`SELECT '4G' as Net, CELL_NAME as Cell, Site_code as Site, Latitude, Longitude, Azimuth, Anten_height, Total_tilt, ENodeBID as Node FROM rf_4g WHERE CELL_NAME LIKE ? LIMIT 3`, [`%${keyword}%`]);
            if (rows.length === 0) [rows] = await db.query(`SELECT '5G' as Net, SITE_NAME as Cell, Site_code as Site, Latitude, Longitude, Azimuth, Anten_height, Total_tilt, gNodeB_ID as Node FROM rf_5g WHERE SITE_NAME LIKE ? LIMIT 3`, [`%${keyword}%`]);
            if (rows.length === 0) [rows] = await db.query(`SELECT '3G' as Net, CELL_NAME as Cell, Site_code as Site, Latitude, Longitude, Azimuth, Anten_height, Total_tilt, BSC_LAC as Node FROM rf_3g WHERE CELL_NAME LIKE ? LIMIT 3`, [`%${keyword}%`]);

            if (rows.length > 0) {
                let responseText = `📡 *KẾT QUẢ RF ĐỊNH VỊ:*\n`;
                rows.forEach((r) => {
                    const mapLink = `https://www.google.com/maps/search/?api=1&query=${r.Latitude},${r.Longitude}`;
                    responseText += `
---------------------------
🔹 *Cell:* \`${r.Cell}\` (${r.Net})
📍 *Site:* ${r.Site} | *Node:* ${r.Node}
🧭 *Góc phát (Azi):* ${r.Azimuth}° | *Cao độ:* ${r.Anten_height}m
📉 *Tilt (Tổng):* ${r.Total_tilt}
🗺️ [📍 MỞ CHỈ ĐƯỜNG GOOGLE MAP](${mapLink})
`;
                });
                bot.sendMessage(chatId, responseText, { parse_mode: 'Markdown', disable_web_page_preview: false });
            } else {
                bot.sendMessage(chatId, `❌ Không tìm thấy Cell nào khớp với: *${keyword}*`);
            }
        } catch (e) { bot.sendMessage(chatId, `❌ Lỗi CSDL RF.`); }
    });

    // ==========================================
    // 2. LỆNH: kpi <tên cell>
    // ==========================================
    bot.onText(/^(?:\/)?kpi\s+(.+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const keyword = match[1].trim();

        try {
            let [rows] = await db.query(`SELECT '4G' as Net, Thoi_gian, Cell_name as Cell, Total_Data_Traffic_Volume_GB as Traffic, User_DL_Avg_Throughput_Kbps as Thput, RB_Util_Rate_DL as PRB, CQI_4G as CQI, Service_Drop_all as DropRate FROM kpi_4g WHERE Cell_name LIKE ? ORDER BY id DESC LIMIT 1`, [`%${keyword}%`]);
            
            if (rows.length > 0) {
                const r = rows[0];
                let text = `📊 *KPI MỚI NHẤT (${r.Net}):* \`${r.Cell}\`\n📅 Ngày: *${r.Thoi_gian}*\n---------------------------\n`;
                text += `📦 Traffic: *${parseFloat(r.Traffic).toFixed(2)} GB*\n`;
                text += `🚀 Tốc độ (DL): *${parseFloat(r.Thput).toFixed(2)} Kbps*\n`;
                text += `🎯 Chất lượng (CQI): *${parseFloat(r.CQI).toFixed(2)}%*\n`;
                text += `⚠️ Tải PRB: *${parseFloat(r.PRB).toFixed(2)}%*\n`;
                text += `✂️ Drop Rate: *${parseFloat(r.DropRate).toFixed(3)}%*`;
                bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
            } else {
                bot.sendMessage(chatId, `❌ Không tìm thấy KPI cho Cell: *${keyword}*`);
            }
        } catch (e) { bot.sendMessage(chatId, `❌ Lỗi CSDL KPI.`); }
    });

    // ==========================================
    // 3. LỆNH: qoe & qos <tên cell>
    // ==========================================
    bot.onText(/^(?:\/)?qoe\s+(.+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const keyword = match[1].trim();
        try {
            const [rows] = await db.query(`SELECT Tuan, Cell_Name, QoE_Score, QoE_Rank FROM mbb_qoe WHERE Cell_Name LIKE ? ORDER BY id DESC LIMIT 1`, [`%${keyword}%`]);
            if (rows.length > 0) {
                const r = rows[0];
                bot.sendMessage(chatId, `⭐ *CHỈ SỐ TRẢI NGHIỆM (QoE)*\n🔹 Cell: \`${r.Cell_Name}\`\n📅 Tuần đánh giá: *${r.Tuan}*\n---------------------------\n🏆 *Điểm QoE:* ${r.QoE_Score}\n🏅 *Hạng (Rank):* ${r.QoE_Rank}`, { parse_mode: 'Markdown' });
            } else bot.sendMessage(chatId, `❌ Không có dữ liệu QoE cho: *${keyword}*`);
        } catch (e) {}
    });

    bot.onText(/^(?:\/)?qos\s+(.+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const keyword = match[1].trim();
        try {
            const [rows] = await db.query(`SELECT Tuan, Cell_Name, QoS_Score, QoS_Rank FROM mbb_qos WHERE Cell_Name LIKE ? ORDER BY id DESC LIMIT 1`, [`%${keyword}%`]);
            if (rows.length > 0) {
                const r = rows[0];
                bot.sendMessage(chatId, `⚙️ *CHỈ SỐ DỊCH VỤ (QoS)*\n🔹 Cell: \`${r.Cell_Name}\`\n📅 Tuần đánh giá: *${r.Tuan}*\n---------------------------\n🏆 *Điểm QoS:* ${r.QoS_Score}\n🏅 *Hạng (Rank):* ${r.QoS_Rank}`, { parse_mode: 'Markdown' });
            } else bot.sendMessage(chatId, `❌ Không có dữ liệu QoS cho: *${keyword}*`);
        } catch (e) {}
    });

    // ==========================================
    // 4. LỆNH: charkpi <tên cell> (Gửi Nhóm Ảnh)
    // ==========================================
    bot.onText(/^(?:\/)?charkpi\s+(.+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const keyword = match[1].trim();
        bot.sendMessage(chatId, `⏳ Đang vẽ biểu đồ KPI 7 ngày cho: *${keyword}*...`, { parse_mode: 'Markdown' });

        try {
            const [rows] = await db.query(`SELECT Thoi_gian, Total_Data_Traffic_Volume_GB as traf, User_DL_Avg_Throughput_Kbps as thput, CQI_4G as cqi FROM kpi_4g WHERE Cell_name LIKE ? ORDER BY id DESC LIMIT 7`, [`%${keyword}%`]);
            
            if (rows.length < 2) return bot.sendMessage(chatId, `❌ Cần ít nhất 2 ngày dữ liệu để vẽ biểu đồ cho: *${keyword}*`);

            // Đảo ngược mảng để vẽ từ cũ tới mới
            const data = rows.reverse();
            const labels = data.map(d => d.Thoi_gian.substring(0, 5)); // Lấy ngày/tháng
            const cellFound = keyword.toUpperCase();

            // Biểu đồ 1: Traffic
            const chart1 = generateChartUrl({
                type: 'line', data: { labels: labels, datasets: [{ label: 'Traffic (GB)', data: data.map(d => d.traf), borderColor: '#3498db', fill: false }] },
                options: { title: { display: true, text: `Biến động Traffic - ${cellFound}` } }
            });

            // Biểu đồ 2: Throughput
            const chart2 = generateChartUrl({
                type: 'line', data: { labels: labels, datasets: [{ label: 'Throughput DL (Kbps)', data: data.map(d => d.thput), borderColor: '#9b59b6', fill: false }] },
                options: { title: { display: true, text: `Biến động Throughput - ${cellFound}` } }
            });

            // Biểu đồ 3: CQI
            const chart3 = generateChartUrl({
                type: 'line', data: { labels: labels, datasets: [{ label: 'CQI (%)', data: data.map(d => d.cqi), borderColor: '#2ecc71', fill: false }] },
                options: { title: { display: true, text: `Biến động CQI - ${cellFound}` } }
            });

            // Gửi một cụm (Album) 3 ảnh biểu đồ
            bot.sendMediaGroup(chatId, [
                { type: 'photo', media: chart1, caption: `📈 Biểu đồ KPI 7 ngày: ${cellFound}` },
                { type: 'photo', media: chart2 },
                { type: 'photo', media: chart3 }
            ]);

        } catch (e) { bot.sendMessage(chatId, `❌ Lỗi vẽ biểu đồ KPI.`); console.error(e); }
    });

    // ==========================================
    // 5. LỆNH: charqoe & charqos <tên cell>
    // ==========================================
    bot.onText(/^(?:\/)?charqoe\s+(.+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const keyword = match[1].trim();
        bot.sendMessage(chatId, `⏳ Đang vẽ biểu đồ QoE 4 tuần cho: *${keyword}*...`, { parse_mode: 'Markdown' });

        try {
            const [rows] = await db.query(`SELECT Tuan, QoE_Score FROM mbb_qoe WHERE Cell_Name LIKE ? ORDER BY id DESC LIMIT 4`, [`%${keyword}%`]);
            if (rows.length < 2) return bot.sendMessage(chatId, `❌ Cần ít nhất dữ liệu 2 tuần để vẽ biểu đồ QoE.`);

            const data = rows.reverse();
            const chartUrl = generateChartUrl({
                type: 'line', 
                data: { 
                    labels: data.map(d => d.Tuan.split(' ')[1] || d.Tuan), // Lấy số tuần
                    datasets: [{ label: 'Điểm QoE', data: data.map(d => d.QoE_Score), borderColor: '#f1c40f', backgroundColor: 'rgba(241, 196, 15, 0.1)', fill: true, borderWidth: 3 }] 
                },
                options: { title: { display: true, text: `Biến động Điểm QoE (4 Tuần) - ${keyword.toUpperCase()}` } }
            });

            bot.sendPhoto(chatId, chartUrl, { caption: `⭐ Biểu đồ Trải nghiệm QoE: ${keyword.toUpperCase()}` });
        } catch (e) {}
    });

    bot.onText(/^(?:\/)?charqos\s+(.+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const keyword = match[1].trim();
        bot.sendMessage(chatId, `⏳ Đang vẽ biểu đồ QoS 4 tuần cho: *${keyword}*...`, { parse_mode: 'Markdown' });

        try {
            const [rows] = await db.query(`SELECT Tuan, QoS_Score FROM mbb_qos WHERE Cell_Name LIKE ? ORDER BY id DESC LIMIT 4`, [`%${keyword}%`]);
            if (rows.length < 2) return bot.sendMessage(chatId, `❌ Cần ít nhất dữ liệu 2 tuần để vẽ biểu đồ QoS.`);

            const data = rows.reverse();
            const chartUrl = generateChartUrl({
                type: 'bar', // Vẽ dạng cột cho QoS để đổi phong cách
                data: { 
                    labels: data.map(d => d.Tuan.split(' ')[1] || d.Tuan), 
                    datasets: [{ label: 'Điểm QoS', data: data.map(d => d.QoS_Score), backgroundColor: '#e74c3c' }] 
                },
                options: { title: { display: true, text: `Biến động Điểm QoS (4 Tuần) - ${keyword.toUpperCase()}` } }
            });

            bot.sendPhoto(chatId, chartUrl, { caption: `⚙️ Biểu đồ Dịch vụ QoS: ${keyword.toUpperCase()}` });
        } catch (e) {}
    });

    // Chống sập hệ thống khi mạng lỗi
    bot.on("polling_error", (err) => console.log("Lỗi Polling Telegram:", err.message));
}

module.exports = bot;
