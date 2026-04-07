const TelegramBot = require('node-telegram-bot-api');
const db = require('../models/db'); // Kết nối chung Database của Web

// 1. ĐIỀN TOKEN BẠN LẤY TỪ @BotFather VÀO ĐÂY
const token = process.env.TELEGRAM_BOT_TOKEN || 8777941094:AAHFhpj4ZksmF7YyMjY8tn7Z3Ya7donSHpo;

let bot;
try {
    // Khởi tạo Bot ở chế độ polling (liên tục lắng nghe tin nhắn)
    bot = new TelegramBot(token, { polling: true });
    console.log("🤖 Telegram Bot đã khởi động và đang lắng nghe lệnh...");
} catch (error) {
    console.error("❌ Lỗi khởi động Telegram Bot. Hãy kiểm tra lại Token!", error);
}

if (bot) {
    // ==========================================
    // LỆNH 1: /start HOẶC /help - HƯỚNG DẪN SỬ DỤNG
    // ==========================================
    bot.onText(/\/(start|help)/, (msg) => {
        const chatId = msg.chat.id;
        const resp = `
👋 *Xin chào! Tôi là Bot Tra Cứu Trạm Phát Sóng.*

Vui lòng sử dụng các lệnh sau:
1️⃣ \`/rf <Tên Cell hoặc Site>\` 
👉 *Tra cứu cấu hình RF* (Tọa độ, Góc phát, Tilt...)
Ví dụ: \`/rf TPO008S11\`

2️⃣ \`/kpi <Tên Cell>\`
👉 *Tra cứu chất lượng mạng KPI* (Traffic, Tốc độ, CQI...) mới nhất.
Ví dụ: \`/kpi TPO008S11\`
        `;
        bot.sendMessage(chatId, resp, { parse_mode: 'Markdown' });
    });

    // ==========================================
    // LỆNH 2: /rf <Từ khóa> - TRA CỨU CẤU HÌNH RF
    // ==========================================
    bot.onText(/\/rf (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const keyword = match[1].trim();
        bot.sendMessage(chatId, `⏳ Đang tra cứu cấu hình RF cho: *${keyword}*...`, { parse_mode: 'Markdown' });

        try {
            // Tìm trong bảng 4G trước
            let [rows] = await db.query(`SELECT '4G' as Net, CELL_NAME as Cell, Site_code as Site, Latitude, Longitude, Azimuth, Anten_height, Total_tilt, ENodeBID as Node FROM rf_4g WHERE Cell_code LIKE ? OR CELL_NAME LIKE ? LIMIT 3`, [`%${keyword}%`, `%${keyword}%`]);
            
            // Nếu không có 4G, tìm tiếp 5G
            if (rows.length === 0) {
                [rows] = await db.query(`SELECT '5G' as Net, SITE_NAME as Cell, Site_code as Site, Latitude, Longitude, Azimuth, Anten_height, Total_tilt, gNodeB_ID as Node FROM rf_5g WHERE Cell_code LIKE ? OR SITE_NAME LIKE ? LIMIT 3`, [`%${keyword}%`, `%${keyword}%`]);
            }
            
            // Nếu không có 5G, tìm tiếp 3G
            if (rows.length === 0) {
                [rows] = await db.query(`SELECT '3G' as Net, CELL_NAME as Cell, Site_code as Site, Latitude, Longitude, Azimuth, Anten_height, Total_tilt, BSC_LAC as Node FROM rf_3g WHERE Cell_code LIKE ? OR CELL_NAME LIKE ? LIMIT 3`, [`%${keyword}%`, `%${keyword}%`]);
            }

            if (rows.length > 0) {
                let responseText = `📡 *KẾT QUẢ TRA CỨU RF:*\n`;
                rows.forEach((r) => {
                    responseText += `
---------------------------
🔹 *Cell:* ${r.Cell} (${r.Net})
📍 *Site / Node:* ${r.Site} / ${r.Node}
🧭 *Tọa độ:* \`${r.Latitude}, ${r.Longitude}\`
📐 *Azimuth:* ${r.Azimuth}° | *Cao độ:* ${r.Anten_height}m
📉 *Tilt (Cơ+Điện):* ${r.Total_tilt}
🗺️ [Xem trên Google Maps](https://www.google.com/maps/search/?api=1&query=${r.Latitude},${r.Longitude})
`;
                });
                bot.sendMessage(chatId, responseText, { parse_mode: 'Markdown', disable_web_page_preview: true });
            } else {
                bot.sendMessage(chatId, `❌ Không tìm thấy thông tin RF nào cho: *${keyword}*`, { parse_mode: 'Markdown' });
            }
        } catch (error) {
            console.error(error);
            bot.sendMessage(chatId, `❌ Lỗi truy xuất cơ sở dữ liệu RF.`);
        }
    });

    // ==========================================
    // LỆNH 3: /kpi <Từ khóa> - TRA CỨU CHẤT LƯỢNG MẠNG
    // ==========================================
    bot.onText(/\/kpi (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const keyword = match[1].trim();
        bot.sendMessage(chatId, `⏳ Đang lấy dữ liệu KPI mới nhất cho: *${keyword}*...`, { parse_mode: 'Markdown' });

        try {
            // Lấy KPI 4G (Sắp xếp theo ID giảm dần để lấy bản ghi import mới nhất)
            let [rows] = await db.query(`
                SELECT '4G' as Net, Thoi_gian, Cell_name as Cell, 
                       Total_Data_Traffic_Volume_GB as Traffic, 
                       User_DL_Avg_Throughput_Kbps as Thput, 
                       RB_Util_Rate_DL as PRB, 
                       CQI_4G as CQI, 
                       Service_Drop_all as DropRate
                FROM kpi_4g 
                WHERE Cell_name LIKE ? 
                ORDER BY id DESC LIMIT 1
            `, [`%${keyword}%`]);

            // Nếu không có 4G, lấy KPI 5G
            if (rows.length === 0) {
                [rows] = await db.query(`
                    SELECT '5G' as Net, Thoi_gian, Ten_CELL as Cell, 
                           Total_Data_Traffic_Volume_GB as Traffic, 
                           A_User_DL_Avg_Throughput as Thput, 
                           CQI_5G as CQI
                    FROM kpi_5g 
                    WHERE Ten_CELL LIKE ? 
                    ORDER BY id DESC LIMIT 1
                `, [`%${keyword}%`]);
            }

            if (rows.length > 0) {
                const r = rows[0];
                let responseText = `📊 *KẾT QUẢ KPI MỚI NHẤT (${r.Net}):*\n`;
                responseText += `
📅 *Ngày:* ${r.Thoi_gian}
🔹 *Cell:* ${r.Cell}
---------------------------
📦 *Traffic:* ${parseFloat(r.Traffic).toFixed(2)} GB
🚀 *Tốc độ (DL Thput):* ${parseFloat(r.Thput).toFixed(2)} ${r.Net === '4G' ? 'Kbps' : 'Mbps'}
🎯 *Chất lượng CQI:* ${parseFloat(r.CQI).toFixed(2)}%
`;
                if (r.Net === '4G') {
                    responseText += `⚠️ *Tải tài nguyên (PRB DL):* ${parseFloat(r.PRB).toFixed(2)}%\n`;
                    responseText += `✂️ *Rớt mạng (Drop Rate):* ${parseFloat(r.DropRate).toFixed(3)}%\n`;
                }

                bot.sendMessage(chatId, responseText, { parse_mode: 'Markdown' });
            } else {
                bot.sendMessage(chatId, `❌ Không tìm thấy dữ liệu KPI nào cho: *${keyword}*`, { parse_mode: 'Markdown' });
            }
        } catch (error) {
            console.error(error);
            bot.sendMessage(chatId, `❌ Lỗi truy xuất cơ sở dữ liệu KPI.`);
        }
    });

    // Chống sập hệ thống khi mạng lỗi
    bot.on("polling_error", (err) => console.log("Lỗi Polling Telegram:", err.message));
}

module.exports = bot;
