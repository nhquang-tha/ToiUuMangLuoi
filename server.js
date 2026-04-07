// ==============================================================================
// 1. IMPORT CÁC THƯ VIỆN CẦN THIẾT
// ==============================================================================
const express = require('express');
const path = require('path');
const session = require('express-session');
require('dotenv').config(); // Đọc các biến môi trường từ file .env (DB, Token Bot...)

// Khởi tạo ứng dụng Express
const app = express();

// ==============================================================================
// 2. CẤU HÌNH MIDDLEWARE (Xử lý dữ liệu và Giao diện)
// ==============================================================================
// Phân tích dữ liệu từ Form (POST request) và JSON
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));

// Cấu hình thư mục chứa file tĩnh (CSS, JS, Hình ảnh...)
app.use(express.static(path.join(__dirname, 'public')));

// Cấu hình View Engine là EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ==============================================================================
// 3. CẤU HÌNH SESSION (Quản lý đăng nhập)
// ==============================================================================
app.use(session({
    secret: process.env.SESSION_SECRET || 'vnpt_telecom_super_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 24 * 60 * 60 * 1000 // Session sống trong 1 ngày
    }
}));

// Biến toàn cục cho View (Tự động truyền thông tin User đang đăng nhập sang mọi file EJS)
app.use((req, res, next) => {
    res.locals.currentUser = req.session.user || null;
    next();
});

// ==============================================================================
// 4. KÍCH HOẠT TELEGRAM BOT CHẠY NGẦM
// ==============================================================================
// Lệnh require này sẽ gọi file telegramBot.js thực thi. 
// Bot sẽ chạy song song với Web Server mà không làm treo hệ thống.
try {
    require('./services/telegramBot');
    console.log('✅ Dịch vụ Telegram Bot đã được nạp vào hệ thống.');
} catch (error) {
    console.error('⚠️ Không thể khởi động Telegram Bot. Vui lòng kiểm tra lại file services/telegramBot.js:', error.message);
}

// ==============================================================================
// 5. CẤU HÌNH ROUTER (Điều hướng các trang web)
// ==============================================================================
// Import file cấu hình đường dẫn (Router) mà bạn đã tạo
const dashboardRoutes = require('./routes/dashboardRoutes');
// Nếu bạn có file xử lý Đăng nhập riêng, hãy require ở đây (VD: const authRoutes = require('./routes/authRoutes'); )

// Gắn Router vào ứng dụng
app.use('/', dashboardRoutes);

// Xử lý trang 404 (Không tìm thấy)
app.use('*', (req, res) => {
    res.status(404).send(`
        <div style="text-align: center; font-family: sans-serif; margin-top: 100px;">
            <h1 style="color: #e74c3c; font-size: 50px;">404</h1>
            <h2>Trang không tồn tại</h2>
            <a href="/" style="padding: 10px 20px; background: #3498db; color: white; text-decoration: none; border-radius: 5px;">Về Trang Chủ</a>
        </div>
    `);
});

// ==============================================================================
// 6. KHỞI ĐỘNG SERVER
// ==============================================================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`===================================================`);
    console.log(`🚀 WEB SERVER ĐANG CHẠY TẠI: http://localhost:${PORT}`);
    console.log(`===================================================`);
});
