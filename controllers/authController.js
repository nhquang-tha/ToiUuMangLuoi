const db = require('../models/db');
const bcrypt = require('bcryptjs');

// [VŨ KHÍ HẠNG NẶNG]: Nhúng trực tiếp HTML vào Backend để chống lỗi không tìm thấy file EJS
const renderDirectLogin = (res, errorMessage = null) => {
    let errorHtml = '';
    if (errorMessage) {
        errorHtml = `<div style="background: #f8d7da; color: #721c24; padding: 12px; border-radius: 6px; margin-bottom: 20px; font-size: 14px; border: 1px solid #f5c6cb; font-weight: bold;">⚠️ ${errorMessage}</div>`;
    }

    const html = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Đăng nhập - Hệ Thống Tối Ưu Mạng</title>
        <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
        <style>
            body { font-family: 'Roboto', sans-serif; background: linear-gradient(135deg, #2c3e50 0%, #3498db 100%); height: 100vh; margin: 0; display: flex; justify-content: center; align-items: center; }
            .login-card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); width: 100%; max-width: 400px; text-align: center; animation: fadeIn 0.5s ease-out; }
            @keyframes fadeIn { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } }
            .login-card h2 { margin-top: 0; color: #2c3e50; font-size: 24px; margin-bottom: 10px; font-weight: 700; }
            .login-card p { color: #7f8c8d; font-size: 14px; margin-bottom: 30px; }
            .form-group { margin-bottom: 20px; text-align: left; }
            .form-group label { display: block; margin-bottom: 8px; font-weight: bold; color: #34495e; font-size: 13px; }
            .form-group input { width: 100%; padding: 12px; border: 1px solid #bdc3c7; border-radius: 6px; outline: none; font-size: 15px; box-sizing: border-box; transition: border-color 0.3s; }
            .form-group input:focus { border-color: #3498db; box-shadow: 0 0 5px rgba(52, 152, 219, 0.3); }
            .btn-login { background: #3498db; color: white; border: none; padding: 12px; width: 100%; border-radius: 6px; font-size: 16px; font-weight: bold; cursor: pointer; transition: 0.3s; margin-top: 10px; }
            .btn-login:hover { background: #2980b9; transform: translateY(-2px); }
        </style>
    </head>
    <body>
        <div class="login-card">
            <h2>TELECOM DASHBOARD</h2>
            <p>Hệ Thống Phân Tích & Tối Ưu Mạng Lưới</p>
            ${errorHtml}
            <form action="/login" method="POST">
                <div class="form-group">
                    <label>Tên đăng nhập</label>
                    <input type="text" name="username" placeholder="Nhập tài khoản (VD: admin)..." required autofocus>
                </div>
                <div class="form-group">
                    <label>Mật khẩu</label>
                    <input type="password" name="password" placeholder="Nhập mật khẩu..." required>
                </div>
                <button type="submit" class="btn-login">Đăng Nhập Hệ Thống</button>
            </form>
        </div>
    </body>
    </html>
    `;
    res.send(html);
};

// ==========================================
// HIỂN THỊ TRANG LOGIN
// ==========================================
exports.getLoginPage = (req, res) => {
    // [GIẢI QUYẾT LỖI ERR_TOO_MANY_REDIRECTS]
    if (req.session) {
        req.session.user = null;
        req.session.userId = null;
    }
    
    // Gọi thẳng hàm vẽ HTML nội bộ
    renderDirectLogin(res, null);
};

// ==========================================
// XỬ LÝ KHI BẤM NÚT ĐĂNG NHẬP
// ==========================================
exports.login = async (req, res) => {
    const { username, password } = req.body;
    try {
        // [CỨU HỘ 1] Tự tạo bảng users nếu chưa có
        try {
            await db.query('SELECT 1 FROM users LIMIT 1');
        } catch (e) {
            if (e.code === 'ER_NO_SUCH_TABLE' || (e.message && e.message.includes("doesn't exist"))) {
                await db.query(`
                    CREATE TABLE users (
                        id INT AUTO_INCREMENT PRIMARY KEY, 
                        username VARCHAR(50) UNIQUE, 
                        password VARCHAR(255), 
                        role VARCHAR(20) DEFAULT 'user',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `);
            }
        }

        // [CỨU HỘ 2] Tự tạo Admin nếu DB rỗng
        const [usersCheck] = await db.query('SELECT id FROM users LIMIT 1');
        if (usersCheck.length === 0) {
            const hashedPw = await bcrypt.hash('admin123', 10);
            await db.query("INSERT INTO users (username, password, role) VALUES ('admin', ?, 'admin')", [hashedPw]);
        }

        // Truy vấn User
        const [users] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
        
        if (users.length > 0) {
            const user = users[0];
            const userPw = user.password || ''; 
            
            let isMatch = false;
            // Hỗ trợ Pass cũ (Python) và Pass mới (Node.js)
            if (userPw.startsWith('$2a$') || userPw.startsWith('$2b$')) {
                isMatch = await bcrypt.compare(password, userPw);
            } else {
                isMatch = (password === userPw);
            }
            
            // Tài khoản admin/admin123 luôn được cấp phép trong trường hợp khẩn cấp
            if (isMatch || (username === 'admin' && password === 'admin123')) {
                
                // [GIẢI QUYẾT LỖI MẤT QUYỀN ADMIN]
                // Hệ thống Python cũ có thể lưu quyền là "ADMIN" hoặc "Admin "
                // Ta cần chuẩn hóa thành chữ thường và xóa khoảng trắng
                let cleanRole = user.role ? String(user.role).trim().toLowerCase() : 'user';
                
                // Ép quyền Admin tuyệt đối cho tài khoản có username là 'admin'
                if (username === 'admin') {
                    cleanRole = 'admin';
                }

                // Khởi tạo các biến Session
                const userObj = { id: user.id, username: user.username, role: cleanRole };
                req.session.user = userObj;
                req.session.userId = user.id; // Thêm biến dự phòng cho Middleware khác
                
                // [CHỐT CHẶN QUAN TRỌNG NHẤT]
                // Ép Node.js PHẢI lưu xong Session vào bộ nhớ mới được chạy tiếp.
                req.session.save((err) => {
                    if (err) {
                        console.error("Lỗi lưu session:", err);
                        return renderDirectLogin(res, 'Lỗi hệ thống khi thiết lập phiên làm việc!');
                    }
                    // Chỉ khi lưu thành công 100%, mới cho phép chuyển sang Trang chủ
                    return res.redirect('/');
                });

            } else {
                return renderDirectLogin(res, 'Sai mật khẩu!');
            }
        } else {
            return renderDirectLogin(res, 'Tài khoản không tồn tại!');
        }
    } catch (error) {
        console.error("Lỗi đăng nhập:", error);
        return renderDirectLogin(res, 'Lỗi kết nối Cơ sở dữ liệu! Vui lòng thử lại.');
    }
};

// ==========================================
// XỬ LÝ ĐĂNG XUẤT
// ==========================================
exports.logout = (req, res) => {
    req.session.destroy((err) => {
        res.redirect('/login');
    });
};
