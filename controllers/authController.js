const db = require('../models/db');
const bcrypt = require('bcryptjs');

exports.login = async (req, res) => {
    const { username, password } = req.body;
    try {
        const [users] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
        if (users.length > 0) {
            const user = users[0];
            const isMatch = await bcrypt.compare(password, user.password);
            if (isMatch) {
                req.session.userId = user.id;
                req.session.username = user.username;
                req.session.role = user.role;
                return res.redirect('/');
            }
        }
        res.render('login', { error: 'Sai tài khoản hoặc mật khẩu', title: 'Đăng nhập' });
    } catch (err) {
        res.status(500).send('Lỗi máy chủ');
    }
};

exports.changePassword = async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const userId = req.session.userId;
    try {
        const [users] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
        const isMatch = await bcrypt.compare(oldPassword, users[0].password);
        if (isMatch) {
            const hashedNewPassword = await bcrypt.hash(newPassword, 10);
            await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedNewPassword, userId]);
            return res.send('<script>alert("Đổi mật khẩu thành công!"); window.location.href="/";</script>');
        }
        res.send('<script>alert("Mật khẩu cũ không đúng!"); window.history.back();</script>');
    } catch (err) {
        res.status(500).send('Lỗi máy chủ');
    }
};

exports.addUser = async (req, res) => {
    const { username, password, role } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.query('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hashedPassword, role]);
        res.send('<script>alert("Thêm User thành công!"); window.location.href="/admin/add-user";</script>');
    } catch (err) {
        res.send('<script>alert("Lỗi: Tên đăng nhập đã tồn tại hoặc lỗi hệ thống!"); window.history.back();</script>');
    }
};

exports.logout = (req, res) => {
    req.session.destroy();
    res.redirect('/login');
};
