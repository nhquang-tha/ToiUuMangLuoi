const db = require('../models/db');
const bcrypt = require('bcryptjs');

exports.getLoginPage = (req, res) => {
    // Xóa an toàn phiên làm việc cũ nếu người dùng quay lại trang login
    if (req.session) {
        req.session.user = null;
    }
    res.render('login', { error: null });
};

exports.login = async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.render('login', { error: 'Vui lòng nhập đầy đủ Tên đăng nhập và Mật khẩu.' });
        }

        // 1. Tự động khởi tạo cấu trúc Bảng Users nếu chưa tồn tại
        try { 
            await db.query('SELECT 1 FROM users LIMIT 1'); 
        } catch (e) {
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

        // 2. Tạo tài khoản admin mặc định (admin/admin123) nếu bảng trống
        const [usersCheck] = await db.query('SELECT id FROM users LIMIT 1');
        if (usersCheck.length === 0) {
            const hashedPw = await bcrypt.hash('admin123', 10);
            await db.query("INSERT INTO users (username, password, role) VALUES ('admin', ?, 'admin')", [hashedPw]);
        }

        // 3. Tìm người dùng trong CSDL
        const [users] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
        
        if (users.length > 0) {
            const user = users[0];
            let isMatch = false;
            
            // Nhận diện mật khẩu: Hỗ trợ cả mật khẩu đã mã hóa (bcrypt) và mật khẩu nguyên bản (text)
            if (user.password && user.password.startsWith('$2')) {
                isMatch = await bcrypt.compare(password, user.password);
            } else {
                isMatch = (password === user.password);
            }
            
            // 4. Cấp quyền truy cập (Có Backdoor dự phòng cho Admin)
            if (isMatch || (username === 'admin' && password === 'admin123')) {
                let cleanRole = username === 'admin' ? 'admin' : (user.role ? String(user.role).trim().toLowerCase() : 'user');
                
                // Khởi tạo Phiên đăng nhập (Session)
                req.session.user = { 
                    id: user.id, 
                    username: user.username, 
                    role: cleanRole, 
                    isAdmin: (cleanRole === 'admin') 
                };
                
                // Lưu Session và chuyển hướng
                req.session.save((err) => { 
                    if(err) {
                        console.error('Lỗi Session:', err);
                        return res.render('login', { error: 'Lỗi máy chủ: Không thể lưu phiên đăng nhập (Session).' });
                    }
                    return res.redirect('/'); 
                });
            } else { 
                return res.render('login', { error: 'Sai mật khẩu đăng nhập!' }); 
            }
        } else { 
            return res.render('login', { error: 'Tài khoản không tồn tại trong hệ thống!' }); 
        }
    } catch (error) { 
        // Bắt mọi lỗi từ MySQL và báo thẳng ra màn hình UI (Chống sập Internal Server Error)
        console.error('Lỗi nghiêm trọng tại Login:', error);
        return res.render('login', { error: 'Lỗi hệ thống: Không thể kết nối tới cơ sở dữ liệu TiDB. Vui lòng thử lại!' }); 
    }
};
