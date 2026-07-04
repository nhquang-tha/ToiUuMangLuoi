const TelegramBot = require('node-telegram-bot-api');
const db = require('../models/db'); 

// ĐIỀN TOKEN BẠN LẤY TỪ @BotFather VÀO ĐÂY
const token = process.env.TELEGRAM_BOT_TOKEN || '8777941094:AAHFhpj4ZksmF7YyMjY8tn7Z3Ya7donSHpo';

let bot;
try {
    bot = new TelegramBot(token, { polling: true });
    console.log("🤖 Telegram Bot đã khởi động với Thuật toán Lọc Đa Mạng, Full RF, CSHT, Alarm và VẬT TƯ...");
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
    // HÀM HỖ TRỢ 2: BỘ LỌC TỪ KHÓA THÔNG MINH
    // ==========================================
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

    const escapeHTML = (text) => {
        if (text === null || text === undefined) return '';
        return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };

    // ==========================================
    // MENU HƯỚNG DẪN (START)
    // ==========================================
    bot.onText(/^(?:\/)?(?:start|help)$/i, (msg) => {
        const chatId = msg.chat.id;
        const resp = `
👋 <b>HỆ THỐNG TRA CỨU MẠNG LƯỚI VNPT</b>

<b>Tra cứu Thông tin:</b>
📦 <code>vt &lt;tên_viết_tắt&gt;</code>: Tra cứu mã vật tư/thiết bị (VD: vt UBBP, vt RRU).
🚑 <code>alarm &lt;bản_tin&gt;</code>: Phân tích nguyên nhân & cách xử lý cảnh báo.
🏢 <code>csht &lt;mã_CSHT&gt;</code> hoặc <code>ne &lt;tên_rút_gọn&gt;</code>: Tra cứu CSHT.
📡 <code>rf &lt;cell_code&gt;</code>: Tra thông tin RF của cell kèm link map.
📊 <code>kpi &lt;cell_code&gt;</code>: Tra thông tin KPI mới nhất của cell.
⭐ <code>qoe &lt;cell_code&gt;</code>: Tra thông tin QOE tuần mới nhất của cell.
⚙️ <code>qos &lt;cell_code&gt;</code>: Tra thông tin QOS tuần mới nhất của cell.

<b>Vẽ Biểu đồ (Charts):</b>
📈 <code>charkpi &lt;cell_code&gt;</code>: Vẽ biểu đồ biến động KPI 7 ngày gần nhất.
📉 <code>charqoe &lt;cell_code&gt;</code>: Vẽ biểu đồ biến động QoE 4 tuần gần nhất.
📉 <code>charqos &lt;cell_code&gt;</code>: Vẽ biểu đồ biến động QoS 4 tuần gần nhất.
        `;
        bot.sendMessage(chatId, resp, { parse_mode: 'HTML' });
    });

    // ==========================================
    // TRA CỨU VẬT TƯ (TÍNH NĂNG MỚI)
    // Cú pháp: vt <tên viết tắt> (vd: vt UBBP)
    // ==========================================
    bot.onText(/^(?:\/)?vt\s+(.+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        let keyword = match[1].trim();

        bot.sendMessage(chatId, `⏳ <b>Đang tra cứu danh mục mã vật tư cho:</b> <code>${escapeHTML(keyword)}</code>...`, { parse_mode: 'HTML' });

        try {
            // Dùng DISTINCT để lọc bỏ các dòng trùng lặp (chung Tên viết tắt và Mã)
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
                let responseText = `📦 <b>KẾT QUẢ TRA CỨU VẬT TƯ</b>\nTừ khóa: <code>${escapeHTML(keyword)}</code>\nSố lượng tìm thấy: <b>${rows.length}</b> thiết bị\n---------------------------\n`;
                
                // Nhóm các kết quả lại theo Loại Card
                let groupedData = {};
                rows.forEach(r => {
                    let loaiCard = r.loai_card || "Khác";
                    if (!groupedData[loaiCard]) {
                        groupedData[loaiCard] = [];
                    }
                    groupedData[loaiCard].push({
                        tenVietTat: r.ten_viet_tat || "N/A",
                        maKho: r.ma_vt || "N/A"
                    });
                });

                // Render danh sách ra dạng Text theo chuẩn: Loại Card -> Tên viết tắt -> Mã
                for (let group in groupedData) {
                    responseText += `🔹 <b>Loại Card:</b> <code>${escapeHTML(group)}</code>\n`;
                    groupedData[group].forEach(item => {
                        responseText += `   ▪️ Tên viết tắt: <b>${escapeHTML(item.tenVietTat)}</b>\n`;
                        responseText += `   ▪️ Mã VT: <code>${escapeHTML(item.maKho)}</code>\n\n`;
                    });
                }

                // Chặn Telegram báo lỗi nếu tin nhắn quá dài (Giới hạn Telegram là 4096 ký tự)
                if (responseText.length > 4000) {
                    responseText = responseText.substring(0, 4000) + '...\n\n<i>⚠️ Danh sách quá dài, đã bị cắt bớt. Hãy gõ từ khóa chi tiết hơn!</i>';
                }

                bot.sendMessage(chatId, responseText, { parse_mode: 'HTML' });
            } else {
                bot.sendMessage(chatId, `❌ Không tìm thấy thông tin Mã Vật Tư / Thiết bị nào khớp với từ khóa: <b>${escapeHTML(keyword)}</b>.\nVui lòng kiểm tra lại bảng dữ liệu trên Web.`, { parse_mode: 'HTML' });
            }
        } catch (e) {
            console.error("Lỗi truy xuất Vật Tư:", e);
            bot.sendMessage(chatId, `❌ Đã xảy ra lỗi khi kết nối với CSDL Vật Tư. Vui lòng thử lại sau.`, { parse_mode: 'HTML' });
        }
    });

    // ==========================================
    // ALARM: PHÂN TÍCH BẢN TIN CẢNH BÁO TỪ DATABASE
    // ==========================================
    bot.onText(/^(?:\/)?alarm\s+([\s\S]+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const alarmText = match[1].trim();
        bot.sendMessage(chatId, `⏳ <b>Đang phân tích bản tin Alarm...</b>`, { parse_mode: 'HTML' });

        try {
            // 1. Quét Mã Định Danh (Thường gọi là Cell Name / Site Name trong bản tin)
            let cellName = null;
            let explicitNameMatch = alarmText.match(/(?:Cell|NodeB|eNodeB Function|Site)\s*Name\s*=\s*([A-Z0-9_.-]+)/i);
            
            if (explicitNameMatch && explicitNameMatch[1]) {
                cellName = explicitNameMatch[1].toUpperCase();
            } else {
                let fallbackMatch = alarmText.match(/(?:2G_|3G_|4G-|5G-)[A-Z0-9]+(?:[-_][A-Z0-9]+)*/i);
                cellName = fallbackMatch ? fallbackMatch[0].toUpperCase() : null;
            }

            // 2. Quét Hardware Position
            let hwMatch = alarmText.match(/\|\s*([^|]*(?:Cabinet|Subrack|Slot|Port)\s*No[^|]*)\s*\|/i);
            let hwPos = hwMatch ? hwMatch[1].trim() : null;

            // 3. Quét Specific Problem
            let spMatch = alarmText.match(/Specific\s*Problem\s*=\s*([^,\]|]+)/i);
            let specificProblem = spMatch ? spMatch[1].trim() : null;

            // 4. Tìm kiếm Nguyên nhân & Giải pháp (Cẩm nang)
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
            } catch (e) {
                console.error("Lỗi khi đọc bảng alarm_data:", e);
            }

            // 5. MÓC NỐI TRA CỨU TÊN CSHT QUA BẢNG RF_DATA
            let cshtInfo = ``;
            if (cellName) {
                cshtInfo += `▪️ <b>Mã Trạm/Cell_Code:</b> <code>${escapeHTML(cellName)}</code>\n`;
                
                let siteCodeFromRF = null;
                let finalLat = null;
                let finalLng = null;
                let actualCellNameFromRF = null;

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
                            siteCodeFromRF = rfRows[0].Site_code;
                            finalLat = rfRows[0].Latitude;
                            finalLng = rfRows[0].Longitude;
                            actualCellNameFromRF = rfRows[0].DbCellName; 
                            break;
                        }
                    }
                } catch (e) {
                    console.error("Lỗi ánh xạ RF:", e);
                }

                let coreCode = siteCodeFromRF;
                if (!coreCode) {
                    let coreMatch = cellName.match(/(?:2G_|3G_|4G-|5G-)([A-Z0-9]{7})/i);
                    coreCode = coreMatch ? coreMatch[1] : cellName.replace(/^(?:2G_|3G_|4G-|5G-)/i, '').replace(/(?:_THA|-THA|_TH|-TH)$/i, '').trim();
                }

                const [cshtRows] = await db.query(
                    `SELECT Ten_CSHT, Dia_Chi, Latitude, Longitude FROM csht_data 
                     WHERE LOWER(Ma_CSHT) LIKE LOWER(?) 
                     OR LOWER(Ma_Tram_2G) LIKE LOWER(?) OR LOWER(Ma_Tram_3G) LIKE LOWER(?) OR LOWER(Ma_Tram_4G) LIKE LOWER(?) OR LOWER(Ma_Tram_5G) LIKE LOWER(?) 
                     ORDER BY LENGTH(COALESCE(Ten_CSHT, Ma_CSHT)) ASC 
                     LIMIT 1`,
                    [`%${coreCode}%`, `%${coreCode}%`, `%${coreCode}%`, `%${coreCode}%`, `%${coreCode}%`]
                );

                if (cshtRows.length > 0) {
                    let r = cshtRows[0];
                    let mapLat = r.Latitude || finalLat;
                    let mapLng = r.Longitude || finalLng;
                    
                    let displayCshtName = actualCellNameFromRF ? actualCellNameFromRF : r.Ten_CSHT;
                    
                    cshtInfo += `▪️ <b>Tên CSHT:</b> ${escapeHTML(displayCshtName)}\n`;
                    cshtInfo += `▪️ <b>Địa chỉ:</b> ${escapeHTML(r.Dia_Chi)}\n`;
                    
                    if (mapLat && mapLng) {
                        let mapLink = `https://www.google.com/maps/search/?api=1&query=${mapLat},${mapLng}`;
                        cshtInfo += `🗺️ <a href="${mapLink}">📍 Mở Bản Đồ Chỉ Đường</a>\n`;
                    }
                } else {
                    if (actualCellNameFromRF || siteCodeFromRF) {
                        let displayName = actualCellNameFromRF ? actualCellNameFromRF : `Chưa khai báo CSHT (Mã gốc: ${siteCodeFromRF})`;
                        cshtInfo += `▪️ <b>Tên CSHT:</b> ${escapeHTML(displayName)}\n`;
                        
                        if (finalLat && finalLng) {
                            let mapLink = `https://www.google.com/maps/search/?api=1&query=${finalLat},${finalLng}`;
                            cshtInfo += `🗺️ <a href="${mapLink}">📍 Mở Bản Đồ (Theo tọa độ bảng RF)</a>\n`;
                        }
                    } else {
                        cshtInfo += `▪️ <b>Tên CSHT:</b> Chưa có dữ liệu CSHT khớp với trạm này.\n`;
                    }
                }
            } else {
                cshtInfo += `▪️ <b>Mã Trạm/Cell_Code:</b> Không bóc tách được từ bản tin\n`;
            }

            if (hwPos) cshtInfo += `▪️ <b>Thông tin chi tiết (HW/NodeB):</b> <code>${escapeHTML(hwPos)}</code>\n`;
            if (specificProblem) cshtInfo += `▪️ <b>Lỗi chi tiết:</b> <code>${escapeHTML(specificProblem)}</code>\n`;

            let responseText = `🚑 <b>KẾT QUẢ PHÂN TÍCH CẢNH BÁO</b>\n---------------------------\n`;
            responseText += cshtInfo;
            responseText += `---------------------------\n`;
            responseText += `📑 <b>Nhóm cảnh báo:</b> <code>${escapeHTML(alarmGroup)}</code>\n`;
            responseText += `🔍 <b>Từ khóa nhận diện:</b> <code>${escapeHTML(matchedKeyword)}</code>\n\n`;
            responseText += `⚠️ <b>NGUYÊN NHÂN:</b>\n${escapeHTML(cause)}\n\n`;
            responseText += `🛠 <b>PHƯƠNG ÁN KIỂM TRA, XỬ LÝ:</b>\n${escapeHTML(action)}`;

            bot.sendMessage(chatId, responseText, { parse_mode: 'HTML', disable_web_page_preview: true });

        } catch (error) {
            console.error(error);
            bot.sendMessage(chatId, `❌ Đã xảy ra lỗi khi phân tích Alarm.`, { parse_mode: 'HTML' });
        }
    });

    // ==========================================
    // CÁC LỆNH TRA CỨU CSHT, RF, KPI, QOE, QOS, CHARTS
    // ==========================================
    bot.onText(/^(?:\/)?(?:csht|ne)\s+(.+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const keyword = match[1].trim();
        const fuzzyKeyword = keyword.replace(/-/g, '%');
        
        bot.sendMessage(chatId, `⏳ Đang tra cứu thông tin Cơ sở hạ tầng: <b>${escapeHTML(keyword)}</b>...`, { parse_mode: 'HTML' });

        try {
            const [rows] = await db.query(
                `SELECT * FROM csht_data 
                 WHERE LOWER(Ma_CSHT) LIKE LOWER(?) 
                 OR LOWER(Ten_CSHT) LIKE LOWER(?) 
                 OR LOWER(Ma_Tram_2G) LIKE LOWER(?) 
                 OR LOWER(Ma_Tram_3G) LIKE LOWER(?) 
                 OR LOWER(Ma_Tram_4G) LIKE LOWER(?) 
                 OR LOWER(Ma_Tram_5G) LIKE LOWER(?) 
                 ORDER BY LENGTH(COALESCE(Ten_CSHT, Ma_CSHT)) ASC 
                 LIMIT 1`, 
                [`%${fuzzyKeyword}%`, `%${fuzzyKeyword}%`, `%${fuzzyKeyword}%`, `%${fuzzyKeyword}%`, `%${fuzzyKeyword}%`, `%${fuzzyKeyword}%`]
            );
            
            if (rows.length > 0) {
                let r = rows[0];
                let mapLink = `https://www.google.com/maps/search/?api=1&query=${r.Latitude},${r.Longitude}`;
                
                let text = `🏢 <b>THÔNG TIN CƠ SỞ HẠ TẦNG</b>\n---------------------------\n` +
                           `▪️ <b>Tên CSHT:</b> ${escapeHTML(r.Ten_CSHT)}\n` +
                           `▪️ <b>Mã CSHT:</b> ${escapeHTML(r.Ma_CSHT)}\n` +
                           `▪️ <b>Địa chỉ:</b> ${escapeHTML(r.Dia_Chi)}\n`;
                
                if (r.Loai_Nha_Tram) text += `▪️ <b>Loại trạm:</b> ${escapeHTML(r.Loai_Nha_Tram)}\n`;
                if (r.Don_Vi_Quan_Ly) text += `▪️ <b>Đơn vị QL:</b> ${escapeHTML(r.Don_Vi_Quan_Ly)}\n`;
                
                let tramList = [];
                if (r.Ma_Tram_2G) tramList.push(`2G: ${r.Ma_Tram_2G}`);
                if (r.Ma_Tram_3G) tramList.push(`3G: ${r.Ma_Tram_3G}`);
                if (r.Ma_Tram_4G) tramList.push(`4G: ${r.Ma_Tram_4G}`);
                if (r.Ma_Tram_5G) tramList.push(`5G: ${r.Ma_Tram_5G}`);
                
                if (tramList.length > 0) {
                    text += `▪️ <b>Trạm phát sóng:</b> ${escapeHTML(tramList.join(' | '))}\n`;
                }

                text += `\n🗺️ <a href="${mapLink}">📍 CHỈ ĐƯỜNG GOOGLE MAPS</a>`;
                
                bot.sendMessage(chatId, text, { parse_mode: 'HTML', disable_web_page_preview: false });
            } else {
                bot.sendMessage(chatId, `❌ Không tìm thấy thông tin CSHT cho từ khóa: <b>${escapeHTML(keyword)}</b>`, { parse_mode: 'HTML' });
            }
        } catch (e) {
            console.error(e);
            bot.sendMessage(chatId, `❌ Đã xảy ra lỗi khi kết nối tới cơ sở dữ liệu CSHT.`, { parse_mode: 'HTML' });
        }
    });

    bot.onText(/^(?:\/)?rf\s+(.+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const parsed = parseKeyword(match[1]);
        const keyword = parsed.kw;
        const targetNet = parsed.net;
        
        bot.sendMessage(chatId, `⏳ Đang trích xuất toàn bộ dữ liệu RF cho: <b>${escapeHTML(match[1])}</b>...`, { parse_mode: 'HTML' });

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
                let [res] = await db.query(q.sql, [`%${keyword}%`, `%${keyword}%`]);
                if (res.length > 0) rows = res;
            }

            if (rows.length > 0) {
                let r = rows[0]; 
                let mapLink = `https://www.google.com/maps/search/?api=1&query=${r.Latitude},${r.Longitude}`;
                let responseText = `📡 <b>KẾT QUẢ RF CHI TIẾT:</b>\n🌐 <b>Mạng:</b> ${r.Net}\n---------------------------\n`;
                
                for (let key in r) {
                    if (key !== 'id' && key !== 'created_at' && key !== 'Net') {
                        if (r[key] !== null && r[key] !== '') {
                            let niceKey = key.replace(/_/g, ' ').toUpperCase();
                            responseText += `▪️ <b>${niceKey}:</b> ${escapeHTML(r[key])}\n`;
                        }
                    }
                }
                responseText += `\n🗺️ <a href="${mapLink}">📍 MỞ CHỈ ĐƯỜNG GOOGLE MAP</a>`;

                if (responseText.length > 4000) {
                    responseText = responseText.substring(0, 4000) + '...\n<i>(Dữ liệu đã bị cắt bớt do quá dài)</i>';
                }

                bot.sendMessage(chatId, responseText, { parse_mode: 'HTML', disable_web_page_preview: false });
            } else {
                bot.sendMessage(chatId, `❌ Không tìm thấy Cell nào khớp với: <b>${escapeHTML(match[1])}</b>`, { parse_mode: 'HTML' });
            }
        } catch (e) { 
            bot.sendMessage(chatId, `❌ Lỗi CSDL RF. Chi tiết: ${e.message}`); 
            console.error(e); 
        }
    });

    bot.onText(/^(?:\/)?kpi\s+(.+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const parsed = parseKeyword(match[1]);
        const keyword = parsed.kw;
        const targetNet = parsed.net;

        try {
            if (!targetNet || targetNet === '4g') {
                let [rows] = await db.query(`SELECT '4G' as Net, Thoi_gian, Cell_name as Cell, Total_Data_Traffic_Volume_GB as Traffic, User_DL_Avg_Throughput_Kbps as Thput, RB_Util_Rate_DL as PRB, CQI_4G as CQI, Service_Drop_all as DropRate FROM kpi_4g WHERE LOWER(Cell_name) LIKE LOWER(?) ORDER BY LENGTH(Cell_name) ASC, Cell_name ASC, id DESC LIMIT 1`, [`%${keyword}%`]);
                if (rows.length > 0) {
                    const r = rows[0];
                    let text = `📊 <b>KPI MỚI NHẤT (${r.Net}):</b> <code>${r.Cell}</code>\n📅 Ngày: <b>${r.Thoi_gian}</b>\n---------------------------\n`;
                    text += `📦 Traffic: <b>${parseFloat(r.Traffic).toFixed(2)} GB</b>\n`;
                    text += `🚀 Tốc độ (DL): <b>${parseFloat(r.Thput).toFixed(2)} Kbps</b>\n`;
                    text += `🎯 CQI: <b>${parseFloat(r.CQI).toFixed(2)}%</b>\n`;
                    text += `⚠️ Tải PRB DL: <b>${parseFloat(r.PRB).toFixed(2)}%</b>\n`;
                    text += `✂️ Drop Rate: <b>${parseFloat(r.DropRate).toFixed(3)}%</b>`;
                    return bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
                }
            }
            if (!targetNet || targetNet === '5g') {
                let [rows] = await db.query(`SELECT '5G' as Net, Thoi_gian, Ten_CELL as Cell, Total_Data_Traffic_Volume_GB as Traffic, A_User_DL_Avg_Throughput as Thput, CQI_5G as CQI FROM kpi_5g WHERE LOWER(Ten_CELL) LIKE LOWER(?) OR LOWER(CELL_ID) LIKE LOWER(?) ORDER BY LENGTH(Ten_CELL) ASC, Ten_CELL ASC, id DESC LIMIT 1`, [`%${keyword}%`, `%${keyword}%`]);
                if (rows.length > 0) {
                    const r = rows[0];
                    let text = `📊 <b>KPI MỚI NHẤT (${r.Net}):</b> <code>${r.Cell}</code>\n📅 Ngày: <b>${r.Thoi_gian}</b>\n---------------------------\n`;
                    text += `📦 Traffic: <b>${parseFloat(r.Traffic).toFixed(2)} GB</b>\n`;
                    text += `🚀 Tốc độ (DL): <b>${parseFloat(r.Thput).toFixed(2)} Mbps</b>\n`;
                    text += `🎯 CQI 5G: <b>${parseFloat(r.CQI).toFixed(2)}%</b>\n`;
                    return bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
                }
            }
            if (!targetNet || targetNet === '3g') {
                let [rows] = await db.query(`SELECT '3G' as Net, Thoi_gian, Ten_CELL as Cell, TRAFFIC as Traffic, CSSR, DCR FROM kpi_3g WHERE LOWER(Ten_CELL) LIKE LOWER(?) OR LOWER(CI) LIKE LOWER(?) ORDER BY LENGTH(Ten_CELL) ASC, Ten_CELL ASC, id DESC LIMIT 1`, [`%${keyword}%`, `%${keyword}%`]);
                if (rows.length > 0) {
                    const r = rows[0];
                    let text = `📊 <b>KPI MỚI NHẤT (${r.Net}):</b> <code>${r.Cell}</code>\n📅 Ngày: <b>${r.Thoi_gian}</b>\n---------------------------\n`;
                    text += `📦 Traffic: <b>${parseFloat(r.Traffic).toFixed(2)} Erl/GB</b>\n`;
                    text += `🚀 CSSR: <b>${parseFloat(r.CSSR).toFixed(2)}%</b>\n`;
                    text += `✂️ Drop Rate (DCR): <b>${parseFloat(r.DCR).toFixed(3)}%</b>\n`;
                    return bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
                }
            }
            bot.sendMessage(chatId, `❌ Không tìm thấy dữ liệu KPI nào cho: <b>${escapeHTML(match[1])}</b>`, { parse_mode: 'HTML' });
        } catch (e) { bot.sendMessage(chatId, `❌ Lỗi CSDL KPI.`); console.error(e); }
    });

    bot.onText(/^(?:\/)?qoe\s+(.+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const parsed = parseKeyword(match[1]);
        try {
            const [rows] = await db.query(`SELECT Tuan, Cell_Name, QoE_Score, QoE_Rank FROM mbb_qoe WHERE LOWER(Cell_Name) LIKE LOWER(?) OR LOWER(Cell_ID) LIKE LOWER(?) ORDER BY LENGTH(Cell_Name) ASC, Cell_Name ASC, id DESC LIMIT 1`, [`%${parsed.kw}%`, `%${parsed.kw}%`]);
            if (rows.length > 0) {
                const r = rows[0];
                bot.sendMessage(chatId, `⭐ <b>CHỈ SỐ TRẢI NGHIỆM (QoE)</b>\n🔹 Cell: <code>${r.Cell_Name}</code>\n📅 Tuần đánh giá: <b>${r.Tuan}</b>\n---------------------------\n🏆 <b>Điểm QoE:</b> ${r.QoE_Score}\n🏅 <b>Hạng (Rank):</b> ${r.QoE_Rank}`, { parse_mode: 'HTML' });
            } else bot.sendMessage(chatId, `❌ Không có dữ liệu QoE.`, { parse_mode: 'HTML' });
        } catch (e) {}
    });

    bot.onText(/^(?:\/)?qos\s+(.+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const parsed = parseKeyword(match[1]);
        try {
            const [rows] = await db.query(`SELECT Tuan, Cell_Name, QoS_Score, QoS_Rank FROM mbb_qos WHERE LOWER(Cell_Name) LIKE LOWER(?) OR LOWER(Cell_ID) LIKE LOWER(?) ORDER BY LENGTH(Cell_Name) ASC, Cell_Name ASC, id DESC LIMIT 1`, [`%${parsed.kw}%`, `%${parsed.kw}%`]);
            if (rows.length > 0) {
                const r = rows[0];
                bot.sendMessage(chatId, `⚙️ <b>CHỈ SỐ DỊCH VỤ (QoS)</b>\n🔹 Cell: <code>${r.Cell_Name}</code>\n📅 Tuần đánh giá: <b>${r.Tuan}</b>\n---------------------------\n🏆 <b>Điểm QoS:</b> ${r.QoS_Score}\n🏅 <b>Hạng (Rank):</b> ${r.QoS_Rank}`, { parse_mode: 'HTML' });
            } else bot.sendMessage(chatId, `❌ Không có dữ liệu QoS.`, { parse_mode: 'HTML' });
        } catch (e) {}
    });

    bot.onText(/^(?:\/)?charkpi\s+(.+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const parsed = parseKeyword(match[1]);
        const keyword = parsed.kw;
        const targetNet = parsed.net;
        bot.sendMessage(chatId, `⏳ Đang vẽ biểu đồ KPI 7 ngày cho: <b>${escapeHTML(match[1])}</b>...`, { parse_mode: 'HTML' });

        try {
            let title1 = 'Traffic (GB)', title2 = 'Throughput DL (Kbps)', title3 = 'CQI (%)';
            let rows = [];

            if (!targetNet || targetNet === '4g') {
                [rows] = await db.query(`SELECT Thoi_gian, Total_Data_Traffic_Volume_GB as traf, User_DL_Avg_Throughput_Kbps as thput, CQI_4G as cqi FROM kpi_4g WHERE LOWER(Cell_name) LIKE LOWER(?) ORDER BY LENGTH(Cell_name) ASC, Cell_name ASC, id DESC LIMIT 7`, [`%${keyword}%`]);
            }
            if (rows.length < 2 && (!targetNet || targetNet === '5g')) {
                [rows] = await db.query(`SELECT Thoi_gian, Total_Data_Traffic_Volume_GB as traf, A_User_DL_Avg_Throughput as thput, CQI_5G as cqi FROM kpi_5g WHERE LOWER(Ten_CELL) LIKE LOWER(?) OR LOWER(CELL_ID) LIKE LOWER(?) ORDER BY LENGTH(Ten_CELL) ASC, Ten_CELL ASC, id DESC LIMIT 7`, [`%${keyword}%`, `%${keyword}%`]);
                title2 = 'Throughput DL (Mbps)';
            }
            if (rows.length < 2 && (!targetNet || targetNet === '3g')) {
                [rows] = await db.query(`SELECT Thoi_gian, TRAFFIC as traf, CSSR as thput, DCR as cqi FROM kpi_3g WHERE LOWER(Ten_CELL) LIKE LOWER(?) OR LOWER(CI) LIKE LOWER(?) ORDER BY LENGTH(Ten_CELL) ASC, Ten_CELL ASC, id DESC LIMIT 7`, [`%${keyword}%`, `%${keyword}%`]);
                title1 = 'Traffic (Erl/GB)'; title2 = 'CSSR (%)'; title3 = 'Drop Rate (%)';
            }

            if (rows.length < 2) return bot.sendMessage(chatId, `❌ Cần ít nhất 2 ngày dữ liệu để vẽ biểu đồ.`, { parse_mode: 'HTML' });

            const data = rows.reverse();
            const labels = data.map(d => d.Thoi_gian.substring(0, 5)); 
            const cellFound = keyword.toUpperCase();

            const chart1 = generateChartUrl({ type: 'line', data: { labels: labels, datasets: [{ label: title1, data: data.map(d => d.traf), borderColor: '#3498db', fill: false }] }, options: { title: { display: true, text: `Biến động ${title1} - ${cellFound}` } } });
            const chart2 = generateChartUrl({ type: 'line', data: { labels: labels, datasets: [{ label: title2, data: data.map(d => d.thput), borderColor: '#9b59b6', fill: false }] }, options: { title: { display: true, text: `Biến động ${title2} - ${cellFound}` } } });
            const chart3 = generateChartUrl({ type: 'line', data: { labels: labels, datasets: [{ label: title3, data: data.map(d => d.cqi), borderColor: '#2ecc71', fill: false }] }, options: { title: { display: true, text: `Biến động ${title3} - ${cellFound}` } } });

            bot.sendMediaGroup(chatId, [ { type: 'photo', media: chart1, caption: `📈 Biểu đồ KPI 7 ngày: ${cellFound}` }, { type: 'photo', media: chart2 }, { type: 'photo', media: chart3 } ]);
        } catch (e) { bot.sendMessage(chatId, `❌ Lỗi vẽ biểu đồ KPI.`); console.error(e); }
    });

    bot.onText(/^(?:\/)?charqoe\s+(.+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const parsed = parseKeyword(match[1]);
        const keyword = parsed.kw;
        try {
            const [rows] = await db.query(`SELECT Tuan, QoE_Score FROM mbb_qoe WHERE LOWER(Cell_Name) LIKE LOWER(?) OR LOWER(Cell_ID) LIKE LOWER(?) ORDER BY LENGTH(Cell_Name) ASC, Cell_Name ASC, id DESC LIMIT 4`, [`%${keyword}%`, `%${keyword}%`]);
            if (rows.length < 2) return bot.sendMessage(chatId, `❌ Cần ít nhất dữ liệu 2 tuần để vẽ biểu đồ QoE.`);
            const data = rows.reverse();
            const chartUrl = generateChartUrl({
                type: 'line', data: { labels: data.map(d => d.Tuan.split(' ')[1] || d.Tuan), datasets: [{ label: 'Điểm QoE', data: data.map(d => d.QoE_Score), borderColor: '#f1c40f', backgroundColor: 'rgba(241, 196, 15, 0.1)', fill: true, borderWidth: 3 }] },
                options: { title: { display: true, text: `Biến động Điểm QoE (4 Tuần) - ${keyword.toUpperCase()}` } }
            });
            bot.sendPhoto(chatId, chartUrl, { caption: `⭐ Biểu đồ Trải nghiệm QoE: ${keyword.toUpperCase()}` });
        } catch (e) {}
    });

    bot.onText(/^(?:\/)?charqos\s+(.+)$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const parsed = parseKeyword(match[1]);
        const keyword = parsed.kw;
        try {
            const [rows] = await db.query(`SELECT Tuan, Cell_Name, QoS_Score, QoS_Rank FROM mbb_qos WHERE LOWER(Cell_Name) LIKE LOWER(?) OR LOWER(Cell_ID) LIKE LOWER(?) ORDER BY LENGTH(Cell_Name) ASC, Cell_Name ASC, id DESC LIMIT 4`, [`%${keyword}%`, `%${keyword}%`]);
            if (rows.length < 2) return bot.sendMessage(chatId, `❌ Cần ít nhất dữ liệu 2 tuần để vẽ biểu đồ QoS.`);
            const data = rows.reverse();
            const chartUrl = generateChartUrl({
                type: 'bar', data: { labels: data.map(d => d.Tuan.split(' ')[1] || d.Tuan), datasets: [{ label: 'Điểm QoS', data: data.map(d => d.QoS_Score), backgroundColor: '#e74c3c' }] },
                options: { title: { display: true, text: `Biến động Điểm QoS (4 Tuần) - ${keyword.toUpperCase()}` } }
            });
            bot.sendPhoto(chatId, chartUrl, { caption: `⚙️ Biểu đồ Dịch vụ QoS: ${keyword.toUpperCase()}` });
        } catch (e) {}
    });

    bot.on("polling_error", (err) => console.log("Lỗi Polling Telegram:", err.message));
}

module.exports = bot;
