const db = require('../models/db');
const bcrypt = require('bcryptjs');

// ================= USER MANAGER (Dành cho Admin) =================
exports.getUserManagerPage = async (req, res) => {
    try {
        const [users] = await db.query('SELECT id, username, role FROM users ORDER BY id DESC');
        res.render('user_manager', { 
            title: 'Quản Lý Người Dùng', page: 'User Manager', 
            users: users, message: null, error: null 
        });
    } catch (error) {
        console.error(error);
        res.status(500).send("Lỗi tải danh sách người dùng");
    }
};

exports.addUser = async (req, res) => {
    const { username, password, role } = req.body;
    try {
        // Kiểm tra user tồn tại chưa
        const [exist] = await db.query('SELECT id FROM users WHERE username = ?', [username]);
        if (exist.length > 0) {
            const [users] = await db.query('SELECT id, username, role FROM users ORDER BY id DESC');
            return res.render('user_manager', { title: 'Quản Lý Người Dùng', page: 'User Manager', users: users, message: null, error: 'Tên đăng nhập đã tồn tại!' });
        }

        // Mã hóa mật khẩu
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.query('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hashedPassword, role]);
        
        res.redirect('/system/users');
    } catch (error) {
        console.error(error);
        res.status(500).send("Lỗi thêm người dùng");
    }
};

exports.deleteUser = async (req, res) => {
    const { id } = req.params;
    // Không cho phép tự xóa chính mình
    if (id == req.session.user.id) {
        return res.send("<script>alert('Bạn không thể xóa chính mình!'); window.location.href='/system/users';</script>");
    }
    try {
        await db.query('DELETE FROM users WHERE id = ?', [id]);
        res.redirect('/system/users');
    } catch (error) {
        console.error(error);
        res.status(500).send("Lỗi xóa người dùng");
    }
};

// ================= PROFILE (Đổi mật khẩu cho mọi User) =================
exports.getProfilePage = (req, res) => {
    res.render('profile', { title: 'Thông Tin Cá Nhân', page: 'Profile', message: null, error: null });
};

exports.changePassword = async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = req.session.user.id;

    if (newPassword !== confirmPassword) {
        return res.render('profile', { title: 'Thông Tin Cá Nhân', page: 'Profile', message: null, error: 'Mật khẩu xác nhận không khớp!' });
    }

    try {
        // Lấy thông tin user hiện tại
        const [rows] = await db.query('SELECT password FROM users WHERE id = ?', [userId]);
        const user = rows[0];

        // So sánh mật khẩu cũ
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.render('profile', { title: 'Thông Tin Cá Nhân', page: 'Profile', message: null, error: 'Mật khẩu hiện tại không đúng!' });
        }

        // Cập nhật mật khẩu mới
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);

        res.render('profile', { title: 'Thông Tin Cá Nhân', page: 'Profile', message: 'Đổi mật khẩu thành công! Vui lòng sử dụng mật khẩu mới cho lần đăng nhập sau.', error: null });
    } catch (error) {
        console.error(error);
        res.status(500).send("Lỗi cập nhật mật khẩu");
    }
};
