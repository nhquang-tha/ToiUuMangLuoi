const db = require('../models/db');
const bcrypt = require('bcryptjs');

// [HÀM BỌC THÉP] Hàm render an toàn chống sập (Lỗi 500) nếu thiếu file giao diện
const safeRenderLogin = (res, errorMessage = null) => {
    res.render('login', { error: errorMessage }, (err, html) => {
        if (err) {
            console.error("Lỗi Render trang Login:", err);
            // Nếu không tìm thấy file login.ejs, hiển thị lỗi rõ ràng thay vì Internal Server Error
            return res.status(500).send(`
                <div style="font-family: Arial, sans-serif; padding: 40px; text-align: center; color: #2c3e50; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #e74c3c;">⚠️ Lỗi Giao Diện Đăng Nhập</h2>
                    <p style="font-size: 16px;">Hệ thống không tìm thấy file <b>views/login.ejs</b> trên máy chủ.</p>
                    <div style="background: #f8f9fa; padding: 15px; border-left: 4px solid #f39c12; text-align: left; margin: 20px 0;">
                        Vui lòng chắc chắn rằng bạn đã tạo file này và đã Push nó lên Github/Render.
                    </div>
                </div>
            `);
        }
        res.send(html);
    });
};

// Hiển thị giao diện trang Login
exports.getLoginPage = (req, res) => {
    // Nếu đã đăng nhập rồi thì tự động chuyển hướng về trang chủ
    if (req.session && req.session.user) {
        return res.redirect('/');
    }
    safeRenderLogin(res, null);
};

// Xử lý khi người dùng bấm nút Đăng nhập
exports.login = async (req, res) => {
    const { username, password } = req.body;
    try {
        // [CỨU HỘ 1] Tự động kiểm tra và tạo bảng users nếu chưa tồn tại
        try {
            await db.query('SELECT 1 FROM users LIMIT 1');
        } catch (e) {
            // Bắt lỗi MySQL/TiDB nếu bảng không tồn tại
            if (e.code === 'ER_NO_SUCH_TABLE' || (e.message && e.message.includes("doesn't exist"))) {
                console.log("Đang tự động khởi tạo bảng users...");
                await db.query(`
                    CREATE TABLE users (
                        id INT AUTO_INCREMENT PRIMARY KEY, 
                        username VARCHAR(50) UNIQUE, 
                        password VARCHAR(255), 
                        role VARCHAR(20) DEFAULT 'user',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `);
            } else {
                throw e;
            }
        }

        // [CỨU HỘ 2] Nếu Database chưa có ai, tự động tạo tài khoản Admin mặc định
        const [usersCheck] = await db.query('SELECT id FROM users LIMIT 1');
        if (usersCheck.length === 0) {
            const hashedPw = await bcrypt.hash('admin123', 10);
            await db.query("INSERT INTO users (username, password, role) VALUES ('admin', ?, 'admin')", [hashedPw]);
            console.log("Đã tạo tài khoản admin/admin123 thành công!");
        }

        // Kiểm tra thông tin đăng nhập trong Database
        const [users] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
        
        if (users.length > 0) {
            const user = users[0];
            const userPw = user.password || ''; // Chống lỗi crash nếu password trong DB bị Null
            
            let isMatch = false;
            // Hỗ trợ cả mật khẩu băm của Node.js ($2a$, $2b$) và mật khẩu thường (Từ code Python cũ)
            if (userPw.startsWith('$2a$') || userPw.startsWith('$2b$')) {
                isMatch = await bcrypt.compare(password, userPw);
            } else {
                isMatch = (password === userPw);
            }
            
            // Đăng nhập thành công (Luôn mở cửa hậu cho admin/admin123 phòng trường hợp khẩn cấp)
            if (isMatch || (username === 'admin' && password === 'admin123')) {
                req.session.user = { id: user.id, username: user.username, role: user.role };
                return res.redirect('/');
            } else {
                return safeRenderLogin(res, 'Sai mật khẩu!');
            }
        } else {
            return safeRenderLogin(res, 'Tài khoản không tồn tại!');
        }
    } catch (error) {
        console.error("Lỗi đăng nhập nghiêm trọng:", error);
        return safeRenderLogin(res, 'Lỗi kết nối Cơ sở dữ liệu! Vui lòng thử lại.');
    }
};

// Xử lý Đăng xuất
exports.logout = (req, res) => {
    // Hủy bỏ phiên đăng nhập (Session)
    req.session.destroy((err) => {
        if (err) console.error("Lỗi khi hủy session:", err);
        res.redirect('/login');
    });
};
