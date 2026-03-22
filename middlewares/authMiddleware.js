// Kiểm tra đã đăng nhập chưa
exports.isAuthenticated = (req, res, next) => {
    if (req.session && req.session.userId) {
        return next();
    }
    res.redirect('/login');
};

// Kiểm tra quyền admin
exports.isAdmin = (req, res, next) => {
    if (req.session && req.session.role === 'admin') {
        return next();
    }
    res.status(403).send('Bạn không có quyền truy cập chức năng này (Chỉ dành cho Admin).');
};
