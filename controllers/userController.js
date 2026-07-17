const db = require('../models/db');
const bcrypt = require('bcryptjs');

exports.getProfilePage = async (req, res) => {
    const activeUser = res.locals.currentUser || req.session.user || req.user;
    res.render('profile', { title: 'Thông Tin Tài Khoản', page: 'Profile', currentUser: activeUser, message: null, error: null });
};

exports.changePassword = async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const activeUser = res.locals.currentUser || req.session.user || req.user;
    
    if (!activeUser || !activeUser.id) {
        return res.render('profile', { title: 'Profile', page: 'Profile', currentUser: activeUser, error: 'Phiên đăng nhập bị lỗi. Hãy đăng nhập lại!', message: null });
    }

    if (newPassword !== confirmPassword) {
        return res.render('profile', { title: 'Profile', page: 'Profile', currentUser: activeUser, error: 'Mật khẩu xác nhận không khớp!', message: null });
    }

    try {
        const [users] = await db.query('SELECT * FROM users WHERE id = ?', [activeUser.id]);
        if (users.length === 0) return res.render('profile', { title: 'Profile', page: 'Profile', currentUser: activeUser, error: 'Tài khoản không tồn tại!', message: null });

        const user = users[0];
        let isMatch = false;
        
        if (user.password && user.password.startsWith('$2')) {
            isMatch = await bcrypt.compare(currentPassword, user.password);
        } else {
            isMatch = (currentPassword === user.password);
        }

        if (!isMatch) {
            return res.render('profile', { title: 'Profile', page: 'Profile', currentUser: activeUser, error: 'Mật khẩu hiện tại không đúng!', message: null });
        }

        const hashedPw = await bcrypt.hash(newPassword, 10);
        await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPw, activeUser.id]);
        
        res.render('profile', { title: 'Profile', page: 'Profile', currentUser: activeUser, error: null, message: 'Đổi mật khẩu thành công!' });
    } catch (error) {
        res.render('profile', { title: 'Profile', page: 'Profile', currentUser: activeUser, error: 'Lỗi máy chủ cơ sở dữ liệu.', message: null });
    }
};

exports.getUserManagerPage = async (req, res) => {
    const activeUser = res.locals.currentUser || req.session.user || req.user;
    try {
        const [users] = await db.query('SELECT id, username, role, permissions, created_at FROM users ORDER BY id DESC');
        res.render('user_manager', { title: 'Quản Lý Người Dùng', page: 'User Manager', currentUser: activeUser, users: users });
    } catch (error) {
        res.status(500).send("Lỗi tải danh sách người dùng.");
    }
};

exports.addUser = async (req, res) => {
    const { username, password, role } = req.body;
    let permissions = req.body.permissions || [];
    if (!Array.isArray(permissions)) permissions = [permissions]; // Chuyển thành mảng nếu chỉ tick 1 ô

    try {
        const hashedPw = await bcrypt.hash(password, 10);
        await db.query("INSERT INTO users (username, password, role, permissions) VALUES (?, ?, ?, ?)", [username, hashedPw, role, JSON.stringify(permissions)]);
        res.redirect('/system/users');
    } catch (error) {
        console.error("Lỗi thêm user:", error);
        res.status(500).send("Lỗi thêm người dùng. Tên đăng nhập có thể đã tồn tại.");
    }
};

exports.updatePermissions = async (req, res) => {
    const userId = req.params.id;
    let permissions = req.body.permissions || [];
    if (!Array.isArray(permissions)) permissions = [permissions];

    try {
        await db.query("UPDATE users SET permissions = ? WHERE id = ?", [JSON.stringify(permissions), userId]);
        res.redirect('/system/users');
    } catch (error) {
        console.error("Lỗi cập nhật quyền:", error);
        res.status(500).send("Lỗi cập nhật quyền hạn.");
    }
};

exports.deleteUser = async (req, res) => {
    try {
        await db.query("DELETE FROM users WHERE id = ?", [req.params.id]);
        res.redirect('/system/users');
    } catch (error) {
        res.status(500).send("Lỗi xóa người dùng.");
    }
};
