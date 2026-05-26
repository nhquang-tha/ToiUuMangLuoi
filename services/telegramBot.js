const TelegramBot = require('node-telegram-bot-api');
const db = require('../models/db'); 

// THAY TOKEN CỦA BẠN VÀO ĐÂY NẾU KHÔNG DÙNG BIẾN MÔI TRƯỜNG ENV
const token = process.env.TELEGRAM_BOT_TOKEN || 'ĐIỀN_TOKEN_CỦA_BẠN_VÀO_ĐÂY';
let bot;

try {
    bot = new TelegramBot(token, { polling: true });
    console.log("🤖 Telegram Bot đã khởi động với chức năng tra cứu RF, KPI, QoE/QoS và CSHT...");
} catch (error) { 
    console.error("❌ Lỗi khởi động Telegram Bot! Vui lòng kiểm tra lại Token.", error); 
}

if (bot) {
    // Hàm bóc tách từ khóa (Ví dụ: "4g tha001" -> net: 4g, kw: tha001)
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

    // Hàm chống lỗi ký tự đặc biệt của Telegram MarkdownV2
    const escapeMarkdown = (text) => {
        return text === null || text === undefined ? '' : String(text).replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
    };

    // LỆNH: /start HOẶC /help
    bot.onText(/^(?:\/)?(?:start|help)$/i, (msg) => {
        const resp = `👋 *HỆ THỐNG TRA CỨU MẠNG LƯỚI VNPT*\n\n` +
                     `*Danh sách lệnh hỗ trợ:*\n` +
                     `🏢 \`/csht <mã CSHT>\`: Tra cứu Cơ sở hạ tầng (VD: csht 01358).\n` +
                     `📡 \`/rf <tên trạm>\`: Tra cứu thông số trạm phát sóng.\n` +
                     `📊 \`/kpi <tên trạm>\`: Xem thông số chất lượng mạng (CQI, Drop Rate...)\n` +
                     `⭐ \`/qoe <tên trạm>\`: Tra cứu Điểm Trải nghiệm & Điểm Dịch vụ (QoS)\n\n` +
                     `_Lưu ý: Bạn có thể gõ trực tiếp tên lệnh mà không cần dấu / (VD: rf 4G-THA001)_`;
        bot.sendMessage(msg.chat.id, resp, { parse_mode: 'MarkdownV2' });
    });

    // LỆNH: /csht <mã CSHT>
    bot.onText(/^(?:\/)?csht\s+(.+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const keyword = match[1].trim();
        bot.sendMessage(chatId, `⏳ Đang tra cứu thông tin Cơ sở hạ tầng: *${escapeMarkdown(keyword)}*...`, { parse_mode: 'MarkdownV2' });

        try {
            // Truy vấn lấy dữ liệu CSHT (Tìm theo mã hoặc tên đều được)
            const [rows] = await db.query(`SELECT * FROM csht_data WHERE Ma_CSHT LIKE ? OR Ten_CSHT LIKE ? LIMIT 1`, [`%${keyword}%`, `%${keyword}%`]);
            
            if (rows.length > 0) {
                let r = rows[0];
                // Tạo link Google Maps chuẩn
                let mapLink = `https://www.google.com/maps?q=${r.Latitude},${r.Longitude}`;
                
                let text = `🏢 *THÔNG TIN CƠ SỞ HẠ TẦNG*\n\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\n` +
                           `▪️ *Tên CSHT:* ${escapeMarkdown(r.Ten_CSHT)}\n` +
                           `▪️ *Mã CSHT:* ${escapeMarkdown(r.Ma_CSHT)}\n` +
                           `▪️ *Địa chỉ:* ${escapeMarkdown(r.Dia_Chi)}\n` +
                           `\n🗺️ [📍 CHỈ ĐƯỜNG GOOGLE MAPS](${escapeMarkdown(mapLink)})`;
                
                bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2', disable_web_page_preview: false });
            } else {
                bot.sendMessage(chatId, `❌ Không tìm thấy thông tin CSHT cho từ khóa: *${escapeMarkdown(keyword)}*`, { parse_mode: 'MarkdownV2' });
            }
        } catch (e) {
            console.error(e);
            bot.sendMessage(chatId, `❌ Đã xảy ra lỗi khi kết nối tới cơ sở dữ liệu CSHT.`, { parse_mode: 'MarkdownV2' });
        }
    });

    // LỆNH: /rf <tên trạm>
    bot.onText(/^(?:\/)?rf\s+(.+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const { net: targetNet, kw: keyword } = parseKeyword(match[1]);
        bot.sendMessage(chatId, `⏳ Đang tìm kiếm tọa độ & cấu hình trạm: *${escapeMarkdown(match[1])}*...`, { parse_mode: 'MarkdownV2' });

        try {
            let rows = [];
            const queries = [
                { net: '4g', sql: `SELECT '4G' as Net, rf_4g.* FROM rf_4g WHERE Cell_code LIKE ? OR CELL_NAME LIKE ? LIMIT 1` },
                { net: '5g', sql: `SELECT '5G' as Net, rf_5g.* FROM rf_5g WHERE Cell_code LIKE ? OR SITE_NAME LIKE ? LIMIT 1` },
                { net: '3g', sql: `SELECT '3G' as Net, rf_3g.* FROM rf_3g WHERE Cell_code LIKE ? OR CELL_NAME LIKE ? LIMIT 1` }
            ];

            for (let q of queries) {
                if (targetNet && q.net !== targetNet) continue; 
                if (rows.length > 0) break; 
                let [res] = await db.query(q.sql, [`%${keyword}%`, `%${keyword}%`]);
                if (res.length > 0) rows = res;
            }

            if (rows.length > 0) {
                let r = rows[0]; 
                let mapLink = `https://www.google.com/maps?q=${r.Latitude},${r.Longitude}`;
                let responseText = `📡 *KẾT QUẢ TÌM KIẾM RF:*\n🌐 *Mạng:* ${r.Net}\n\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\n`;
                for (let key in r) {
                    if (key !== 'id' && key !== 'created_at' && key !== 'Net' && r[key] !== null && r[key] !== '') {
                        responseText += `▪️ *${escapeMarkdown(key.replace(/_/g, ' ').toUpperCase())}:* ${escapeMarkdown(r[key])}\n`;
                    }
                }
                responseText += `\n🗺️ [📍 MỞ BẢN ĐỒ GOOGLE MAPS](${escapeMarkdown(mapLink)})`;
                
                if (responseText.length > 4000) responseText = responseText.substring(0, 4000) + '...\n_\\(Đã cắt bớt do quá dài\\)_';
                bot.sendMessage(chatId, responseText, { parse_mode: 'MarkdownV2', disable_web_page_preview: false });
            } else { 
                bot.sendMessage(chatId, `❌ Không tìm thấy dữ liệu trạm: *${escapeMarkdown(match[1])}*`, { parse_mode: 'MarkdownV2' }); 
            }
        } catch (e) { 
            console.error(e);
            bot.sendMessage(chatId, `❌ Đã xảy ra lỗi khi kết nối tới CSDL TiDB.`, { parse_mode: 'MarkdownV2' }); 
        }
    });

    // LỆNH: /kpi <tên trạm>
    bot.onText(/^(?:\/)?kpi\s+(.+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const { net: targetNet, kw: keyword } = parseKeyword(match[1]);
        bot.sendMessage(chatId, `⏳ Đang truy xuất KPI mới nhất của: *${escapeMarkdown(match[1])}*...`, { parse_mode: 'MarkdownV2' });

        try {
            let kpiData = null;
            let networkName = '';
            
            // Tìm KPI 4G
            if (!targetNet || targetNet === '4g') {
                const [rows] = await db.query(`SELECT * FROM kpi_4g WHERE Cell_name LIKE ? OR Site_name LIKE ? ORDER BY id DESC LIMIT 1`, [`%${keyword}%`, `%${keyword}%`]);
                if (rows.length > 0) { kpiData = rows[0]; networkName = '4G LTE'; }
            }
            // Tìm KPI 5G
            if ((!targetNet || targetNet === '5g') && !kpiData) {
                const [rows] = await db.query(`SELECT * FROM kpi_5g WHERE Ten_CELL LIKE ? OR Ten_GNODEB LIKE ? ORDER BY id DESC LIMIT 1`, [`%${keyword}%`, `%${keyword}%`]);
                if (rows.length > 0) { kpiData = rows[0]; networkName = '5G NR'; }
            }
            // Tìm KPI 3G
            if ((!targetNet || targetNet === '3g') && !kpiData) {
                const [rows] = await db.query(`SELECT * FROM kpi_3g WHERE Ten_CELL LIKE ? ORDER BY id DESC LIMIT 1`, [`%${keyword}%`]);
                if (rows.length > 0) { kpiData = rows[0]; networkName = '3G WCDMA'; }
            }

            if (kpiData) {
                let cellName = kpiData.Cell_name || kpiData.Ten_CELL || "Unknown";
                let dateStr = kpiData.Thoi_gian || "N/A";
                let text = `📊 *BÁO CÁO KPI MỚI NHẤT \\(${escapeMarkdown(networkName)}\\)*\n` +
                           `📍 *Trạm:* ${escapeMarkdown(cellName)}\n` +
                           `📅 *Ngày cập nhật:* ${escapeMarkdown(dateStr)}\n\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\n`;
                
                if (networkName === '4G LTE') {
                    text += `🔹 *Traffic:* ${escapeMarkdown(kpiData.Total_Data_Traffic_Volume_GB)} GB\n` +
                            `🔹 *Throughput DL:* ${escapeMarkdown(kpiData.User_DL_Avg_Throughput_Kbps)} Kbps\n` +
                            `🔹 *PRB DL:* ${escapeMarkdown(kpiData.RB_Util_Rate_DL)} %\n` +
                            `🔹 *CQI:* ${escapeMarkdown(kpiData.CQI_4G)} %\n` +
                            `🔹 *Drop Rate:* ${escapeMarkdown(kpiData.Service_Drop_all)} %\n`;
                } else if (networkName === '5G NR') {
                    text += `🔹 *Traffic:* ${escapeMarkdown(kpiData.Total_Data_Traffic_Volume_GB)} GB\n` +
                            `🔹 *Throughput DL:* ${escapeMarkdown(kpiData.A_User_DL_Avg_Throughput)} Mbps\n` +
                            `🔹 *CQI:* ${escapeMarkdown(kpiData.CQI_5G)} %\n`;
                } else {
                    text += `🔹 *CS Congestion:* ${escapeMarkdown(kpiData.CSCONGES)} %\n` +
                            `🔹 *PS Congestion:* ${escapeMarkdown(kpiData.PSCONGES)} %\n` +
                            `🔹 *Traffic:* ${escapeMarkdown(kpiData.TRAFFIC)} Erl/GB\n`;
                }
                
                bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
            } else {
                bot.sendMessage(chatId, `❌ Không có dữ liệu KPI cho trạm: *${escapeMarkdown(match[1])}*`, { parse_mode: 'MarkdownV2' });
            }
        } catch (e) {
            console.error(e);
            bot.sendMessage(chatId, `❌ Đã xảy ra lỗi khi kết nối CSDL.`, { parse_mode: 'MarkdownV2' });
        }
    });

    // LỆNH: /qoe HOẶC /qos <tên trạm>
    bot.onText(/^(?:\/)?(?:qoe|qos)\s+(.+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        let keyword = match[1].trim();
        let cleanKw = keyword.toUpperCase().replace(/^(3G|4G|5G)[-\s_]?/i, '').replace(/[-\s_]?(THA|TH)$/i, '').trim();

        bot.sendMessage(chatId, `⏳ Đang tra cứu trải nghiệm khách hàng (QoE/QoS) cho trạm: *${escapeMarkdown(keyword)}*...`, { parse_mode: 'MarkdownV2' });

        try {
            // Truy vấn trực tiếp vào bảng qoe_qos siêu tốc
            const [rows] = await db.query(`SELECT * FROM qoe_qos WHERE Cell_Name LIKE ? OR Site_Name LIKE ? LIMIT 1`, [`%${cleanKw}%`, `%${cleanKw}%`]);
            
            if (rows.length > 0) {
                let r = rows[0];
                let text = `⭐ *ĐÁNH GIÁ CHẤT LƯỢNG MẠNG \\(QoE / QoS\\)*\n` +
                           `📍 *Trạm:* ${escapeMarkdown(r.Cell_Name)}\n` +
                           `🏢 *Khu vực:* ${escapeMarkdown(r.District || 'N/A')}\n\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\n` +
                           `⭐ *QoE Rank:* ${escapeMarkdown(r.QoE_Rank !== null ? r.QoE_Rank : 'N/A')} Sao\n` +
                           `📈 *QoE Score:* ${escapeMarkdown(r.QoE_Score !== null ? parseFloat(r.QoE_Score).toFixed(2) : 'N/A')} ` +
                           `${r.QoE_Trend > 0 ? '🔺' : (r.QoE_Trend < 0 ? '🔻' : '➖')}\n\n` +
                           `⚙️ *QoS Rank:* ${escapeMarkdown(r.QoS_Rank !== null ? r.QoS_Rank : 'N/A')} Sao\n` +
                           `📉 *QoS Score:* ${escapeMarkdown(r.QoS_Score !== null ? parseFloat(r.QoS_Score).toFixed(2) : 'N/A')} ` +
                           `${r.QoS_Trend > 0 ? '🔺' : (r.QoS_Trend < 0 ? '🔻' : '➖')}\n\n`;
                
                if (r.lich_su_tac_dong) {
                    text += `📝 *Ghi chú xử lý:* ${escapeMarkdown(r.lich_su_tac_dong)}\n`;
                }

                bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
            } else {
                bot.sendMessage(chatId, `❌ Trạm *${escapeMarkdown(keyword)}* không có đánh giá QoE/QoS trong tuần mới nhất.`, { parse_mode: 'MarkdownV2' });
            }
        } catch (e) {
            console.error(e);
            bot.sendMessage(chatId, `❌ Đã xảy ra lỗi khi tra cứu QoE/QoS.`, { parse_mode: 'MarkdownV2' });
        }
    });

    bot.on("polling_error", (err) => console.log("Lỗi Polling Telegram:", err.message));
}

module.exports = bot;
