const db = require('../models/db');
const bcrypt = require('bcryptjs');

exports.getProfilePage = (req, res) => {
    res.render('profile', { 
        title: 'Thông Tin Tài Khoản', 
        page: 'Profile', 
        currentUser: req.session.user, // Đồng bộ chuẩn tên biến
        message: null,
        error: null
    });
};

exports.changePassword = async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = req.session.user.id;

    if (newPassword !== confirmPassword) {
        return res.render('profile', { title: 'Profile', page: 'Profile', currentUser: req.session.user, error: 'Mật khẩu mới không khớp!', message: null });
    }

    try {
        const [users] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
        if (users.length === 0) return res.render('profile', { title: 'Profile', page: 'Profile', currentUser: req.session.user, error: 'Không tìm thấy người dùng', message: null });

        const user = users[0];
        const isMatch = await bcrypt.compare(currentPassword, user.password);

        if (!isMatch) {
            return res.render('profile', { title: 'Profile', page: 'Profile', currentUser: req.session.user, error: 'Mật khẩu hiện tại không đúng!', message: null });
        }

        const hashedPw = await bcrypt.hash(newPassword, 10);
        await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPw, userId]);

        res.render('profile', { title: 'Profile', page: 'Profile', currentUser: req.session.user, message: 'Đổi mật khẩu thành công!', error: null });
    } catch (error) {
        console.error(error);
        res.render('profile', { title: 'Profile', page: 'Profile', currentUser: req.session.user, error: 'Lỗi server', message: null });
    }
};

exports.getUserManagerPage = async (req, res) => {
    try {
        const [users] = await db.query('SELECT id, username, role, created_at FROM users');
        res.render('user_manager', { 
            title: 'Quản Lý Người Dùng', 
            page: 'User Manager', 
            users: users, 
            currentUser: req.session.user 
        });
    } catch (error) {
        res.status(500).send("Lỗi lấy danh sách user");
    }
};

exports.addUser = async (req, res) => {
    const { username, password, role } = req.body;
    try {
        const hashedPw = await bcrypt.hash(password, 10);
        await db.query('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hashedPw, role]);
        res.redirect('/system/users');
    } catch (error) {
        res.status(500).send("Lỗi thêm user (có thể trùng tên)");
    }
};

exports.deleteUser = async (req, res) => {
    const id = req.params.id;
    try {
        await db.query('DELETE FROM users WHERE id = ?', [id]);
        res.redirect('/system/users');
    } catch (error) {
        res.status(500).send("Lỗi xóa user");
    }
};
