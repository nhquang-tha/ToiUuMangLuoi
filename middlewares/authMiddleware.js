// Kiểm tra xem người dùng đã đăng nhập chưa
exports.isAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) {
        return next();
    }
    // Nếu chưa đăng nhập, đá về trang login
    res.redirect('/login');
};

// Kiểm tra xem người dùng có phải là Admin không
exports.isAdmin = (req, res, next) => {
    // Thuật toán thông minh: Tìm thông tin user ở mọi ngóc ngách có thể có
    const activeUser = req.session.user || res.locals.currentUser || req.user;

    // Nếu tìm thấy user và role là admin -> Cho phép đi tiếp (Mở cổng)
    if (activeUser && activeUser.role === 'admin') {
        return next();
    }

    // Nếu không phải admin -> Chặn lại và báo lỗi
    res.status(403).send(`
        <div style="font-family: Arial, sans-serif; padding: 50px; text-align: center; color: #2c3e50; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #e74c3c; font-size: 80px; margin: 0;">⛔</h1>
            <h2>Truy Cập Bị Từ Chối</h2>
            <p style="font-size: 16px;">Tài khoản <b>${activeUser ? activeUser.username : 'của bạn'}</b> không có quyền truy cập chức năng này (Chỉ dành cho Admin).</p>
            <div style="margin-top: 30px;">
                <a href="/" style="padding: 12px 25px; background: #3498db; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; transition: 0.2s;">⬅ Quay lại Trang Chủ</a>
            </div>
        </div>
    `);
};
