const db = require('../models/db');

// Hàm tạo controller động để render các trang khác nhau
exports.renderPage = (pageName) => {
    return async (req, res) => {
        try {
            // Sau này bạn có thể bổ sung logic truy vấn database tùy theo trang. 
            // Ví dụ: if (pageName === 'KPI Analytics') { lấy data bảng KPI... }
            
            res.render('dashboard', { 
                title: pageName, 
                page: pageName 
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Lỗi máy chủ khi tải trang');
        }
    };
};
