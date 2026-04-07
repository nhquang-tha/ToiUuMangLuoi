const db = require('../models/db');
const bcrypt = require('bcryptjs');

exports.getLoginPage = (req, res) => {
    if (req.session && req.session.user) {
        return res.redirect('/');
    }
    res.render('login', { error: null });
};

exports.login = async (req, res) => {
    const { username, password } = req.body;
    try {
        // [TÍNH NĂNG CỨU HỘ] Nếu Database chưa có ai, tự động tạo tài khoản Admin
        const [usersCheck] = await db.query('SELECT id FROM users LIMIT 1');
        if (usersCheck.length === 0) {
            const hashedPw = await bcrypt.hash('admin123', 10);
            await db.query("INSERT INTO users (username, password, role) VALUES ('admin', ?, 'admin')", [hashedPw]);
        }

        // Kiểm tra User trong Database
        const [users] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
        
        if (users.length > 0) {
            const user = users[0];
            
            let isMatch = false;
            // Hỗ trợ cả pass chưa băm (cũ) và pass đã băm bằng bcrypt
            if (user.password.startsWith('$2a$') || user.password.startsWith('$2b$')) {
                isMatch = await bcrypt.compare(password, user.password);
            } else {
                isMatch = (password === user.password);
            }
            
            // Đăng nhập thành công (Hoặc dùng tài khoản cấp cứu admin/admin123)
            if (isMatch || (username === 'admin' && password === 'admin123')) {
                req.session.user = { id: user.id, username: user.username, role: user.role };
                return res.redirect('/');
            } else {
                return res.render('login', { error: 'Sai mật khẩu!' });
            }
        } else {
            return res.render('login', { error: 'Tài khoản không tồn tại!' });
        }
    } catch (error) {
        console.error("Lỗi đăng nhập:", error);
        return res.render('login', { error: 'Lỗi kết nối Cơ sở dữ liệu!' });
    }
};

exports.logout = (req, res) => {
    req.session.destroy();
    res.redirect('/login');
};
