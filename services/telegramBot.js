const TelegramBot = require('node-telegram-bot-api');
const db = require('../models/db'); 

// ĐIỀN TOKEN BẠN LẤY TỪ @BotFather VÀO ĐÂY
const token = process.env.TELEGRAM_BOT_TOKEN || 'ĐIỀN_TOKEN_CỦA_BẠN_VÀO_ĐÂY';

let bot;
try {
    bot = new TelegramBot(token, { polling: true });
    console.log("🤖 Telegram Bot đã khởi động với Thuật toán Lọc Đa Mạng & Full RF...");
} catch (error) {
    console.error("❌ Lỗi khởi động Telegram Bot!", error);
}

if (bot) {
    // ==========================================
    // HÀM HỖ TRỢ 1: TẠO URL BIỂU ĐỒ ẢNH TỪ QUICKCHART
    // ==========================================
    const generateChartUrl = (chartConfig) => {
        return `https://quickchart.io/chart?w=600&h=350&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
    };

    // ==========================================
    // HÀM HỖ TRỢ 2: BỘ LỌC TỪ KHÓA THÔNG MINH (PHIÊN BẢN MỚI)
    // Tự động nhận diện mạng cần tìm (nếu có gõ 3G-, 4G-, 5G-)
    // ==========================================
    const parseKeyword = (str) => {
        if (!str) return { net: null, kw: '' };
        let kw = String(str).toUpperCase().trim();
        let net = null;
        
        // Nhận diện người dùng muốn tìm mạng nào
        if (/^3G[- ]/i.test(kw)) { net = '3g'; kw = kw.replace(/^3G[- ]/i, ''); }
        else if (/^4G[- ]/i.test(kw)) { net = '4g'; kw = kw.replace(/^4G[- ]/i, ''); }
        else if (/^5G[- ]/i.test(kw)) { net = '5g'; kw = kw.replace(/^5G[- ]/i, ''); }
        
        // Xóa đuôi -THA
        kw = kw.replace(/-THA$/i, '').replace(/-TH$/i, ''); 
        return { net, kw };
    };

    // Hàm chuẩn hóa text để không bị Telegram Markdown cắt xén lỗi
    const escapeMarkdown = (text) => {
        if (text === null || text === undefined) return '';
        return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
    };

    // ==========================================
    // MENU HƯỚNG DẪN (START)
    // ==========================================
    bot.onText(/^(?:\/)?(?:start|help)$/i, (msg) => {
        const chatId = msg.chat.id;
        const resp = `
👋 *HỆ THỐNG TRA CỨU MẠNG LƯỚI VNPT*

*Tra cứu Thông tin (Hỗ trợ 3G, 4G, 5G):*
📡 \`rf <cell_code>\`: Tra toàn bộ thông tin RF của cell kèm link chỉ đường.
📊 \`kpi <cell_code>\`: Tra thông tin KPI mới nhất của cell.
⭐ \`qoe <cell_code>\`: Tra thông tin QOE tuần mới nhất của cell.
⚙️ \`qos <cell_code>\`: Tra thông tin QOS tuần mới nhất của cell.

*Vẽ Biểu đồ (Charts):*
📈 \`charkpi <cell_code>\`: Vẽ biểu đồ biến động KPI 7 ngày gần nhất.
📉 \`charqoe <cell_code>\`: Vẽ biểu đồ biến động QoE 4 tuần gần nhất.
📉 \`charqos <cell_code>\`: Vẽ biểu đồ biến động QoS 4 tuần gần nhất.

_Ví dụ: rf 4G-THA001M11-THA_
        `;
        bot.sendMessage(chatId, resp, { parse_mode: 'Markdown' });
    });

    // ==========================================
    // 1. LỆNH: rf <cell_code> (HIỂN THỊ TOÀN BỘ CỘT RF)
    // ==========================================
    bot.onText(/^(?:\/)?rf\s+(.+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const parsed = parseKeyword(match[1]);
        const keyword = parsed.kw;
        const targetNet = parsed.net;
        
        bot.sendMessage(chatId, `⏳ Đang trích xuất toàn bộ dữ liệu RF cho: *${escapeMarkdown(match[1])}*...`, { parse_mode: 'Markdown' });

        try {
            let rows = [];
            
            // Danh sách các câu lệnh truy vấn
            const queries = [
                { net: '4g', sql: `SELECT '4G' as Net, rf_4g.* FROM rf_4g WHERE Cell_code LIKE ? OR CELL_NAME LIKE ? LIMIT 1` },
                { net: '5g', sql: `SELECT '5G' as Net, rf_5g.* FROM rf_5g WHERE Cell_code LIKE ? OR SITE_NAME LIKE ? LIMIT 1` },
                { net: '3g', sql: `SELECT '3G' as Net, rf_3g.* FROM rf_3g WHERE Cell_code LIKE ? OR CELL_NAME LIKE ? LIMIT 1` }
            ];

            // Chạy truy vấn (Nếu có chỉ định targetNet thì chỉ chạy mạng đó)
            for (let q of queries) {
                if (targetNet && q.net !== targetNet) continue; // Bỏ qua mạng không đúng yêu cầu
                if (rows.length > 0) break; // Nếu tìm thấy rồi thì dừng lại
                
                let [res] = await db.query(q.sql, [`%${keyword}%`, `%${keyword}%`]);
                if (res.length > 0) rows = res;
            }

            if (rows.length > 0) {
                let r = rows[0]; // Chỉ lấy 1 trạm chuẩn nhất để tránh lỗi Full Text của Telegram
                let mapLink = `https://www.google.com/maps/search/?api=1&query=${r.Latitude},${r.Longitude}`;
                
                let responseText = `📡 *KẾT QUẢ RF CHI TIẾT:*\n`;
                responseText += `🌐 *Mạng:* ${r.Net}\n---------------------------\n`;
                
                // Duyệt qua toàn bộ các cột trong Database và in ra
                for (let key in r) {
                    if (key !== 'id' && key !== 'created_at' && key !== 'Net') {
                        if (r[key] !== null && r[key] !== '') {
                            let niceKey = key.replace(/_/g, ' ').toUpperCase();
                            let safeVal = escapeMarkdown(r[key]);
                            responseText += `▪️ *${niceKey}:* ${safeVal}\n`;
                        }
                    }
                }
                responseText += `\n🗺️ [📍 MỞ CHỈ ĐƯỜNG GOOGLE MAP](${mapLink})`;

                // Telegram giới hạn tin nhắn ~4000 ký tự
                if (responseText.length > 4000) {
                    responseText = responseText.substring(0, 4000) + '...\n_(Dữ liệu đã bị cắt bớt do quá dài)_';
                }

                bot.sendMessage(chatId, responseText, { parse_mode: 'Markdown', disable_web_page_preview: false });
            } else {
                bot.sendMessage(chatId, `❌ Không tìm thấy Cell nào khớp với: *${escapeMarkdown(match[1])}*`, { parse_mode: 'Markdown' });
            }
        } catch (e) { 
            bot.sendMessage(chatId, `❌ Lỗi CSDL RF. Chi tiết: ${e.message}`); 
            console.error(e); 
        }
    });

    // ==========================================
    // 2. LỆNH: kpi <cell_code> (Hỗ trợ 4G, 5G, 3G)
    // ==========================================
    bot.onText(/^(?:\/)?kpi\s+(.+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const parsed = parseKeyword(match[1]);
        const keyword = parsed.kw;
        const targetNet = parsed.net;

        try {
            // Tìm 4G
            if (!targetNet || targetNet === '4g') {
                let [rows] = await db.query(`SELECT '4G' as Net, Thoi_gian, Cell_name as Cell, Total_Data_Traffic_Volume_GB as Traffic, User_DL_Avg_Throughput_Kbps as Thput, RB_Util_Rate_DL as PRB, CQI_4G as CQI, Service_Drop_all as DropRate FROM kpi_4g WHERE Cell_name LIKE ? ORDER BY id DESC LIMIT 1`, [`%${keyword}%`]);
                if (rows.length > 0) {
                    const r = rows[0];
                    let text = `📊 *KPI MỚI NHẤT (${r.Net}):* \`${r.Cell}\`\n📅 Ngày: *${r.Thoi_gian}*\n---------------------------\n`;
                    text += `📦 Traffic: *${parseFloat(r.Traffic).toFixed(2)} GB*\n`;
                    text += `🚀 Tốc độ (DL): *${parseFloat(r.Thput).toFixed(2)} Kbps*\n`;
                    text += `🎯 CQI: *${parseFloat(r.CQI).toFixed(2)}%*\n`;
                    text += `⚠️ Tải PRB DL: *${parseFloat(r.PRB).toFixed(2)}%*\n`;
                    text += `✂️ Drop Rate: *${parseFloat(r.DropRate).toFixed(3)}%*`;
                    return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
                }
            }

            // Tìm 5G
            if (!targetNet || targetNet === '5g') {
                let [rows] = await db.query(`SELECT '5G' as Net, Thoi_gian, Ten_CELL as Cell, Total_Data_Traffic_Volume_GB as Traffic, A_User_DL_Avg_Throughput as Thput, CQI_5G as CQI FROM kpi_5g WHERE Ten_CELL LIKE ? OR CELL_ID LIKE ? ORDER BY id DESC LIMIT 1`, [`%${keyword}%`, `%${keyword}%`]);
                if (rows.length > 0) {
                    const r = rows[0];
                    let text = `📊 *KPI MỚI NHẤT (${r.Net}):* \`${r.Cell}\`\n📅 Ngày: *${r.Thoi_gian}*\n---------------------------\n`;
                    text += `📦 Traffic: *${parseFloat(r.Traffic).toFixed(2)} GB*\n`;
                    text += `🚀 Tốc độ (DL): *${parseFloat(r.Thput).toFixed(2)} Mbps*\n`;
                    text += `🎯 CQI 5G: *${parseFloat(r.CQI).toFixed(2)}%*\n`;
                    return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
                }
            }

            // Tìm 3G
            if (!targetNet || targetNet === '3g') {
                let [rows] = await db.query(`SELECT '3G' as Net, Thoi_gian, Ten_CELL as Cell, TRAFFIC as Traffic, CSSR, DCR FROM kpi_3g WHERE Ten_CELL LIKE ? OR CI LIKE ? ORDER BY id DESC LIMIT 1`, [`%${keyword}%`, `%${keyword}%`]);
                if (rows.length > 0) {
                    const r = rows[0];
                    let text = `📊 *KPI MỚI NHẤT (${r.Net}):* \`${r.Cell}\`\n📅 Ngày: *${r.Thoi_gian}*\n---------------------------\n`;
                    text += `📦 Traffic: *${parseFloat(r.Traffic).toFixed(2)} Erl/GB*\n`;
                    text += `🚀 CSSR: *${parseFloat(r.CSSR).toFixed(2)}%*\n`;
                    text += `✂️ Drop Rate (DCR): *${parseFloat(r.DCR).toFixed(3)}%*\n`;
                    return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
                }
            }

            bot.sendMessage(chatId, `❌ Không tìm thấy dữ liệu KPI nào cho: *${escapeMarkdown(match[1])}*`, { parse_mode: 'Markdown' });

        } catch (e) { bot.sendMessage(chatId, `❌ Lỗi CSDL KPI.`); console.error(e); }
    });

    // ==========================================
    // 3. LỆNH: qoe & qos <cell_code>
    // ==========================================
    bot.onText(/^(?:\/)?qoe\s+(.+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const parsed = parseKeyword(match[1]);
        const keyword = parsed.kw;
        try {
            const [rows] = await db.query(`SELECT Tuan, Cell_Name, QoE_Score, QoE_Rank FROM mbb_qoe WHERE Cell_Name LIKE ? OR Cell_ID LIKE ? ORDER BY id DESC LIMIT 1`, [`%${keyword}%`, `%${keyword}%`]);
            if (rows.length > 0) {
                const r = rows[0];
                bot.sendMessage(chatId, `⭐ *CHỈ SỐ TRẢI NGHIỆM (QoE)*\n🔹 Cell: \`${r.Cell_Name}\`\n📅 Tuần đánh giá: *${r.Tuan}*\n---------------------------\n🏆 *Điểm QoE:* ${r.QoE_Score}\n🏅 *Hạng (Rank):* ${r.QoE_Rank}`, { parse_mode: 'Markdown' });
            } else bot.sendMessage(chatId, `❌ Không có dữ liệu QoE cho: *${escapeMarkdown(match[1])}*`, { parse_mode: 'Markdown' });
        } catch (e) {}
    });

    bot.onText(/^(?:\/)?qos\s+(.+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const parsed = parseKeyword(match[1]);
        const keyword = parsed.kw;
        try {
            const [rows] = await db.query(`SELECT Tuan, Cell_Name, QoS_Score, QoS_Rank FROM mbb_qos WHERE Cell_Name LIKE ? OR Cell_ID LIKE ? ORDER BY id DESC LIMIT 1`, [`%${keyword}%`, `%${keyword}%`]);
            if (rows.length > 0) {
                const r = rows[0];
                bot.sendMessage(chatId, `⚙️ *CHỈ SỐ DỊCH VỤ (QoS)*\n🔹 Cell: \`${r.Cell_Name}\`\n📅 Tuần đánh giá: *${r.Tuan}*\n---------------------------\n🏆 *Điểm QoS:* ${r.QoS_Score}\n🏅 *Hạng (Rank):* ${r.QoS_Rank}`, { parse_mode: 'Markdown' });
            } else bot.sendMessage(chatId, `❌ Không có dữ liệu QoS cho: *${escapeMarkdown(match[1])}*`, { parse_mode: 'Markdown' });
        } catch (e) {}
    });

    // ==========================================
    // 4. LỆNH: charkpi <cell_code> (Gửi Nhóm Ảnh)
    // ==========================================
    bot.onText(/^(?:\/)?charkpi\s+(.+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const parsed = parseKeyword(match[1]);
        const keyword = parsed.kw;
        const targetNet = parsed.net;
        
        bot.sendMessage(chatId, `⏳ Đang vẽ biểu đồ KPI 7 ngày cho: *${escapeMarkdown(match[1])}*...`, { parse_mode: 'Markdown' });

        try {
            let title1 = 'Traffic (GB)', title2 = 'Throughput DL (Kbps)', title3 = 'CQI (%)';
            let rows = [];

            if (!targetNet || targetNet === '4g') {
                [rows] = await db.query(`SELECT Thoi_gian, Total_Data_Traffic_Volume_GB as traf, User_DL_Avg_Throughput_Kbps as thput, CQI_4G as cqi FROM kpi_4g WHERE Cell_name LIKE ? ORDER BY id DESC LIMIT 7`, [`%${keyword}%`]);
            }
            
            if (rows.length < 2 && (!targetNet || targetNet === '5g')) {
                [rows] = await db.query(`SELECT Thoi_gian, Total_Data_Traffic_Volume_GB as traf, A_User_DL_Avg_Throughput as thput, CQI_5G as cqi FROM kpi_5g WHERE Ten_CELL LIKE ? OR CELL_ID LIKE ? ORDER BY id DESC LIMIT 7`, [`%${keyword}%`, `%${keyword}%`]);
                title2 = 'Throughput DL (Mbps)';
            }
            
            if (rows.length < 2 && (!targetNet || targetNet === '3g')) {
                [rows] = await db.query(`SELECT Thoi_gian, TRAFFIC as traf, CSSR as thput, DCR as cqi FROM kpi_3g WHERE Ten_CELL LIKE ? OR CI LIKE ? ORDER BY id DESC LIMIT 7`, [`%${keyword}%`, `%${keyword}%`]);
                title1 = 'Traffic (Erl/GB)';
                title2 = 'CSSR (%)';
                title3 = 'Drop Rate (%)';
            }

            if (rows.length < 2) return bot.sendMessage(chatId, `❌ Cần ít nhất 2 ngày dữ liệu để vẽ biểu đồ cho: *${escapeMarkdown(match[1])}*`, { parse_mode: 'Markdown' });

            const data = rows.reverse();
            const labels = data.map(d => d.Thoi_gian.substring(0, 5)); 
            const cellFound = keyword.toUpperCase();

            const chart1 = generateChartUrl({
                type: 'line', data: { labels: labels, datasets: [{ label: title1, data: data.map(d => d.traf), borderColor: '#3498db', fill: false }] },
                options: { title: { display: true, text: `Biến động ${title1} - ${cellFound}` } }
            });

            const chart2 = generateChartUrl({
                type: 'line', data: { labels: labels, datasets: [{ label: title2, data: data.map(d => d.thput), borderColor: '#9b59b6', fill: false }] },
                options: { title: { display: true, text: `Biến động ${title2} - ${cellFound}` } }
            });

            const chart3 = generateChartUrl({
                type: 'line', data: { labels: labels, datasets: [{ label: title3, data: data.map(d => d.cqi), borderColor: '#2ecc71', fill: false }] },
                options: { title: { display: true, text: `Biến động ${title3} - ${cellFound}` } }
            });

            bot.sendMediaGroup(chatId, [
                { type: 'photo', media: chart1, caption: `📈 Biểu đồ KPI 7 ngày: ${cellFound}` },
                { type: 'photo', media: chart2 },
                { type: 'photo', media: chart3 }
            ]);

        } catch (e) { bot.sendMessage(chatId, `❌ Lỗi vẽ biểu đồ KPI.`); console.error(e); }
    });

    // ==========================================
    // 5. LỆNH: charqoe & charqos <cell_code>
    // ==========================================
    bot.onText(/^(?:\/)?charqoe\s+(.+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const parsed = parseKeyword(match[1]);
        const keyword = parsed.kw;
        bot.sendMessage(chatId, `⏳ Đang vẽ biểu đồ QoE 4 tuần cho: *${escapeMarkdown(match[1])}*...`, { parse_mode: 'Markdown' });

        try {
            const [rows] = await db.query(`SELECT Tuan, QoE_Score FROM mbb_qoe WHERE Cell_Name LIKE ? OR Cell_ID LIKE ? ORDER BY id DESC LIMIT 4`, [`%${keyword}%`, `%${keyword}%`]);
            if (rows.length < 2) return bot.sendMessage(chatId, `❌ Cần ít nhất dữ liệu 2 tuần để vẽ biểu đồ QoE.`);

            const data = rows.reverse();
            const chartUrl = generateChartUrl({
                type: 'line', 
                data: { 
                    labels: data.map(d => d.Tuan.split(' ')[1] || d.Tuan),
                    datasets: [{ label: 'Điểm QoE', data: data.map(d => d.QoE_Score), borderColor: '#f1c40f', backgroundColor: 'rgba(241, 196, 15, 0.1)', fill: true, borderWidth: 3 }] 
                },
                options: { title: { display: true, text: `Biến động Điểm QoE (4 Tuần) - ${keyword.toUpperCase()}` } }
            });

            bot.sendPhoto(chatId, chartUrl, { caption: `⭐ Biểu đồ Trải nghiệm QoE: ${keyword.toUpperCase()}` });
        } catch (e) {}
    });

    bot.onText(/^(?:\/)?charqos\s+(.+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const parsed = parseKeyword(match[1]);
        const keyword = parsed.kw;
        bot.sendMessage(chatId, `⏳ Đang vẽ biểu đồ QoS 4 tuần cho: *${escapeMarkdown(match[1])}*...`, { parse_mode: 'Markdown' });

        try {
            const [rows] = await db.query(`SELECT Tuan, QoS_Score FROM mbb_qos WHERE Cell_Name LIKE ? OR Cell_ID LIKE ? ORDER BY id DESC LIMIT 4`, [`%${keyword}%`, `%${keyword}%`]);
            if (rows.length < 2) return bot.sendMessage(chatId, `❌ Cần ít nhất dữ liệu 2 tuần để vẽ biểu đồ QoS.`);

            const data = rows.reverse();
            const chartUrl = generateChartUrl({
                type: 'bar', 
                data: { 
                    labels: data.map(d => d.Tuan.split(' ')[1] || d.Tuan), 
                    datasets: [{ label: 'Điểm QoS', data: data.map(d => d.QoS_Score), backgroundColor: '#e74c3c' }] 
                },
                options: { title: { display: true, text: `Biến động Điểm QoS (4 Tuần) - ${keyword.toUpperCase()}` } }
            });

            bot.sendPhoto(chatId, chartUrl, { caption: `⚙️ Biểu đồ Dịch vụ QoS: ${keyword.toUpperCase()}` });
        } catch (e) {}
    });

    bot.on("polling_error", (err) => console.log("Lỗi Polling Telegram:", err.message));
}

module.exports = bot;
