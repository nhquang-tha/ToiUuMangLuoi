const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// "Người gác cổng": Chỉ xử lý luồng Đăng nhập ban đầu
router.get('/login', authController.getLoginPage);
router.post('/login', authController.login);

// DÒNG QUAN TRỌNG NHẤT KHÔNG ĐƯỢC THIẾU ĐỂ TRÁNH LỖI CRASH
module.exports = router;
