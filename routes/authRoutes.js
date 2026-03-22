const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { isAuthenticated, isAdmin } = require('../middlewares/authMiddleware');

// Xác thực
router.get('/login', (req, res) => res.render('login', { title: 'Đăng nhập', error: null }));
router.post('/login', authController.login);
router.get('/logout', authController.logout);

// Đổi mật khẩu (User nào cũng dùng được)
router.get('/change-password', isAuthenticated, (req, res) => res.render('change_password', { title: 'Đổi mật khẩu' }));
router.post('/change-password', isAuthenticated, authController.changePassword);

// Quản lý User (Chỉ Admin)
router.get('/admin/add-user', isAuthenticated, isAdmin, (req, res) => res.render('admin_add_user', { title: 'Thêm người dùng' }));
router.post('/admin/add-user', isAuthenticated, isAdmin, authController.addUser);

module.exports = router;
