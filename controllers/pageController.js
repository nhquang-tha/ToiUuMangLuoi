const db = require('../models/db');

exports.getHomePage = async (req, res) => {
    try {
        // Ví dụ: Lấy dữ liệu từ database (nếu có bảng 'items')
        // const [rows] = await db.query('SELECT * FROM items LIMIT 5');
        const rows = [{ id: 1, name: "Thiết kế Tối giản" }, { id: 2, name: "Tối ưu UX" }]; 
        
        // Render View và truyền dữ liệu (Model) vào
        res.render('index', { 
            title: 'Trang chủ | Minimal MVC',
            items: rows
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Lỗi máy chủ');
    }
};