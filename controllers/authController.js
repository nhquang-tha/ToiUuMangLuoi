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
            await db.query('SELECT permissions FROM users LIMIT 1'); 
        } catch (e) {
            try {
                // Thử nâng cấp bảng nếu thiếu cột permissions (Dành cho DB cũ)
                await db.query('ALTER TABLE users ADD COLUMN permissions TEXT');
                console.log("✅ Đã cập nhật bảng users: Thêm cột permissions");
            } catch (err) {
                // Tạo mới hoàn toàn nếu bảng chưa có
                await db.query(`
                    CREATE TABLE IF NOT EXISTS users (
                        id INT AUTO_INCREMENT PRIMARY KEY, 
                        username VARCHAR(50) UNIQUE, 
                        password VARCHAR(255), 
                        role VARCHAR(20) DEFAULT 'user', 
                        permissions TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `);
            }
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
                
                // Trích xuất quyền hạn (Permissions)
                let perms = [];
                if (user && user.permissions) {
                    try { perms = JSON.parse(user.permissions); } catch(e) {}
                } else if (cleanRole === 'admin') {
                    // Cấp full quyền mặc định cho admin nếu chưa tick
                    perms = ['dashboard', 'gis_map', 'worst_cells', 'congestion_3g', 'traffic_down', 'kpi_analytics', 'qoe_qos', 'poi_report', 'optimizing_qoe_qos', 'bad_cells', 'downtilt_coverage', 'rf_database', 'scrip', 'import_data', 'user_manager'];
                }

                // Khởi tạo Phiên đăng nhập (Session)
                req.session.user = { 
                    id: user ? user.id : 0, 
                    username: username, 
                    role: cleanRole, 
                    permissions: perms,
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
