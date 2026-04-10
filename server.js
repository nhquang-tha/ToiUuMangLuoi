const express = require('express');
const session = require('express-session');
const path = require('path');
const app = express();

// Cấu hình Express và giới hạn kích thước file upload (cho file Excel nặng)
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// Cấu hình Session (Phiên đăng nhập)
app.use(session({
    secret: 'vnpt-telecom-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // Thời hạn 1 ngày
}));

// ==========================================
// MIDDLEWARE: THIẾT LẬP BIẾN TOÀN CỤC (FIX LỖI TITLE IS NOT DEFINED)
// Đảm bảo mọi tệp EJS luôn có các biến cơ bản, tránh sập trang 500
// ==========================================
app.use((req, res, next) => {
    res.locals.title = 'VNPT Dashboard'; // Tiêu đề mặc định
    res.locals.error = null;            // Lỗi mặc định
    res.locals.message = null;          // Thông báo mặc định
    res.locals.currentUser = req.session.user || null;
    next();
});

// Khởi động Telegram Bot (Có bẫy lỗi để tránh sập server nếu thiếu Token)
try {
    require('./services/telegramBot');
} catch (error) {
    console.error('Lỗi khởi động Telegram Bot:', error.message);
}

// ==========================================
// IMPORT VÀ KIỂM TRA ROUTES (BẪY LỖI RENDER)
// ==========================================
const authRoutes = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');

// 1. Kiểm tra file authRoutes.js
if (typeof authRoutes !== 'function') {
    console.error('❌ LỖI NGHIÊM TRỌNG: authRoutes đang trả về một', typeof authRoutes, 'thay vì Router hợp lệ.');
    console.error('👉 CÁCH SỬA: Hãy kiểm tra file routes/authRoutes.js và đảm bảo dòng cuối cùng là: module.exports = router;');
} else {
    app.use('/', authRoutes);
}

// 2. Kiểm tra file dashboardRoutes.js
if (typeof dashboardRoutes !== 'function') {
    console.error('❌ LỖI NGHIÊM TRỌNG: dashboardRoutes đang trả về một', typeof dashboardRoutes, 'thay vì Router hợp lệ.');
    console.error('👉 CÁCH SỬA: Hãy kiểm tra file routes/dashboardRoutes.js và đảm bảo dòng cuối cùng là: module.exports = router;');
} else {
    app.use('/', dashboardRoutes);
}

// Xử lý lỗi 404 (Trang không tồn tại)
app.use('*', (req, res) => {
    res.status(404).send('<div style="text-align:center; padding:50px; font-family:Arial; background-color:#f4f6f8; height:100vh;"><h2 style="color:#e74c3c;">404 - Trang không tồn tại</h2><p>Đường dẫn bạn truy cập không đúng hoặc đã bị gỡ bỏ.</p><a href="/" style="display:inline-block; padding:10px 20px; background:#3498db; color:white; text-decoration:none; border-radius:5px; font-weight:bold;">Về Trang Chủ</a></div>');
});

// ==========================================
// BẮT LỖI 500 (INTERNAL SERVER ERROR)
// In trực tiếp chi tiết lỗi ra màn hình để dễ dàng sửa chữa
// ==========================================
app.use((err, req, res, next) => {
    console.error('🔥 LỖI HỆ THỐNG (500):', err.stack);
    res.status(500).send(`
        <div style="text-align:center; padding:50px; font-family:Arial; background-color:#fdf2f2; height:100vh;">
            <h2 style="color:#c0392b;">🔥 500 - Lỗi Máy Chủ (Internal Server Error)</h2>
            <p style="color:#34495e; font-size: 16px;">Hệ thống đang gặp sự cố khi xử lý yêu cầu hoặc vẽ giao diện (EJS).</p>
            <div style="background: white; padding: 20px; border-radius: 8px; border: 1px solid #fad2d2; display: inline-block; text-align: left; max-width: 800px; width: 100%; overflow-x: auto;">
                <strong style="color: #e74c3c;">Chi tiết lỗi (Copy mã này gửi cho AI):</strong>
                <pre style="color: #2c3e50; font-size: 13px; margin-top: 10px; white-space: pre-wrap;">${err.message}\n\n${err.stack}</pre>
            </div>
        </div>
    `);
});

// ==========================================
// KHỞI ĐỘNG MÁY CHỦ
// ==========================================
const PORT = process.env.PORT || 3000;

// Rất quan trọng: Phải bind port '0.0.0.0' để Render có thể kết nối từ bên ngoài
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server Dashboard VNPT đang chạy thành công tại port: ${PORT}`);
});
