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
// KHỞI ĐỘNG MÁY CHỦ
// ==========================================
const PORT = process.env.PORT || 3000;

// Rất quan trọng: Phải bind port '0.0.0.0' để Render có thể kết nối từ bên ngoài
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server Dashboard VNPT đang chạy thành công tại port: ${PORT}`);
});
