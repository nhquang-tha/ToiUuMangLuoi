const express = require('express');
const path = require('path');
const session = require('express-session');
require('dotenv').config();

const app = express();

app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'vnpt_telecom_super_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.use((req, res, next) => {
    res.locals.currentUser = req.session.user || null;
    next();
});

// KHỞI ĐỘNG TELEGRAM BOT
try {
    require('./services/telegramBot');
} catch (error) {
    console.error('Lỗi Telegram Bot:', error.message);
}

// ==========================================
// KHAI BÁO ROUTE ĐĂNG NHẬP / ĐĂNG XUẤT
// ==========================================
const authController = require('./controllers/authController');
app.get('/login', authController.getLoginPage);
app.post('/login', authController.login);
app.get('/logout', authController.logout);

// ==========================================
// ROUTE CHÍNH CỦA HỆ THỐNG
// ==========================================
const dashboardRoutes = require('./routes/dashboardRoutes');
app.use('/', dashboardRoutes);

app.use('*', (req, res) => {
    res.status(404).send('<h2>404 - Trang không tồn tại</h2><a href="/">Về Trang Chủ</a>');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server chạy tại: http://localhost:${PORT}`);
});
