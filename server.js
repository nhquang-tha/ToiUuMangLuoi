const express = require('express');
const session = require('express-session');
const app = express();
require('dotenv').config();

// Cấu hình Express
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true })); // Để đọc data từ Form (POST)

// Cấu hình Session
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 ngày
}));

// Truyền thông tin user cho tất cả các View
app.use((req, res, next) => {
    res.locals.currentUser = req.session;
    next();
});

// Import Routes
const authRoutes = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');

// Gắn Routes vào ứng dụng
app.use('/', authRoutes);
app.use('/', dashboardRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server chạy tại cổng ${PORT}`));
