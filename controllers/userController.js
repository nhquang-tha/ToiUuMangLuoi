const db = require('../models/db');
const bcrypt = require('bcryptjs');

exports.getProfilePage = async (req, res) => {
    // Lấy user từ res.locals đã được Middleware khôi phục tự động ở file Routes
    const activeUser = res.locals.currentUser || req.session.user || req.user;
    
    res.render('profile', { 
        title: 'Thông Tin Tài Khoản', 
        page: 'Profile', 
        currentUser: activeUser, 
        message: null,
        error: null
    });
};

exports.changePassword = async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const activeUser = res.locals.currentUser || req.session.user || req.user;
    
    if (!activeUser || !activeUser.id) {
        return res.render('profile', { title: 'Profile', page: 'Profile', currentUser: activeUser, error: 'Phiên đăng nhập bị lỗi. Hãy đăng nhập lại!', message: null });
    }

    const userId = activeUser.id;

    if (newPassword !== confirmPassword) {
        return res.render('profile', { title: 'Profile', page: 'Profile', currentUser: activeUser, error: 'Mật khẩu mới không khớp!', message: null });
    }

    try {
        const [users] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
        if (users.length === 0) return res.render('profile', { title: 'Profile', page: 'Profile', currentUser: activeUser, error: 'Không tìm thấy người dùng trong hệ thống.', message: null });

        const user = users[0];
        const isMatch = await bcrypt.compare(currentPassword, user.password);

        if (!isMatch) {
            return res.render('profile', { title: 'Profile', page: 'Profile', currentUser: activeUser, error: 'Mật khẩu hiện tại không đúng!', message: null });
        }

        const hashedPw = await bcrypt.hash(newPassword, 10);
        await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPw, userId]);

        res.render('profile', { title: 'Profile', page: 'Profile', currentUser: activeUser, message: 'Đổi mật khẩu thành công!', error: null });
    } catch (error) {
        console.error("Lỗi khi đổi mật khẩu:", error);
        res.render('profile', { title: 'Profile', page: 'Profile', currentUser: activeUser, error: 'Lỗi máy chủ', message: null });
    }
};

exports.getUserManagerPage = async (req, res) => {
    const activeUser = req.session.user || req.user || res.locals.currentUser || res.locals.user;
    try {
        const [users] = await db.query('SELECT id, username, role, created_at FROM users');
        res.render('user_manager', { 
            title: 'Quản Lý Người Dùng', 
            page: 'User Manager', 
            users: users, 
            currentUser: activeUser 
        });
    } catch (error) {
        console.error("Lỗi danh sách user:", error);
        res.status(500).send("Lỗi lấy danh sách tài khoản từ Database.");
    }
};

exports.addUser = async (req, res) => {
    const { username, password, role } = req.body;
    try {
        const hashedPw = await bcrypt.hash(password, 10);
        // Lưu role viết thường và xóa khoảng trắng để tránh lỗi phân quyền mãi về sau
        const cleanRole = role.toString().trim().toLowerCase();
        await db.query('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hashedPw, cleanRole]);
        res.redirect('/system/users');
    } catch (error) {
        console.error("Lỗi thêm user:", error);
        res.status(500).send("Lỗi thêm user (có thể trùng tên đăng nhập).");
    }
};

exports.deleteUser = async (req, res) => {
    const id = req.params.id;
    try {
        await db.query('DELETE FROM users WHERE id = ?', [id]);
        res.redirect('/system/users');
    } catch (error) {
        console.error("Lỗi xóa user:", error);
        res.status(500).send("Lỗi xóa tài khoản.");
    }
};
