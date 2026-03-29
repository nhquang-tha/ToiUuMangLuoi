const db = require('../models/db');

exports.getList = async (req, res) => {
    // 1. Nhận các tham số cấu hình từ URL
    const network = req.query.network || '3g';
    const search = req.query.search ? req.query.search.trim() : '';
    const page = parseInt(req.query.page) || 1;
    const limit = 100; // Số lượng hiển thị tối đa trên 1 trang
    const offset = (page - 1) * limit;

    // Xác định quyền Admin
    const isAdmin = req.session && req.session.user && req.session.user.role === 'admin';

    // 2. Tạo SQL động cho chức năng Tìm Kiếm
    let tableName = `rf_${network}`;
    // 5G thường dùng SITE_NAME, 3G/4G dùng CELL_NAME (Tùy thuộc chính xác DB của bạn)
    let nameColumn = network === '5g' ? 'SITE_NAME' : 'CELL_NAME'; 
    
    let searchClause = '';
    let queryParams = [];

    if (search) {
        // Tìm kiếm theo Cell Code HOẶC Tên Cell
        searchClause = `WHERE Cell_code LIKE ? OR ${nameColumn} LIKE ?`;
        queryParams.push(`%${search}%`, `%${search}%`);
    }

    try {
        // 3. Đếm tổng số dữ liệu để tạo Thanh Phân Trang
        const countQuery = `SELECT COUNT(*) as total FROM ${tableName} ${searchClause}`;
        const [countResult] = await db.query(countQuery, queryParams);
        const totalRecords = countResult[0].total;
        const totalPages = Math.ceil(totalRecords / limit) || 1;

        // 4. Lấy dữ liệu với Limit và Offset
        const dataQuery = `SELECT * FROM ${tableName} ${searchClause} LIMIT ? OFFSET ?`;
        const [rows] = await db.query(dataQuery, [...queryParams, limit, offset]);

        // Trả kết quả ra View
        res.render('rf_database', {
            title: 'RF Database',
            page: 'RF Database',
            currentNetwork: network,
            rfData: rows,
            currentUser: req.session.user,
            searchQuery: search,
            currentPage: page,
            totalPages: totalPages,
            totalRecords: totalRecords
        });

    } catch (error) {
        console.error("Lỗi lấy dữ liệu RF Database:", error);
        res.status(500).send("Lỗi lấy dữ liệu từ Database. Hãy kiểm tra kết nối TiDB.");
    }
};

exports.getForm = async (req, res) => {
    const action = req.params.action;
    const network = req.params.network;
    const id = req.params.id;
    
    let row = null;
    if (action === 'edit' && id) {
        try {
            const [rows] = await db.query(`SELECT * FROM rf_${network} WHERE id = ?`, [id]);
            if (rows.length > 0) row = rows[0];
        } catch (error) {
            console.error(error);
        }
    }
    res.render('rf_form', { title: action === 'add' ? 'Thêm Trạm' : 'Sửa Trạm', page: 'RF Database', action, network, row });
};

exports.saveData = async (req, res) => {
    const action = req.params.action;
    const network = req.params.network;
    const id = req.params.id;
    const data = req.body;
    
    try {
        if (action === 'add') {
            await db.query(`INSERT INTO rf_${network} SET ?`, data);
        } else if (action === 'edit' && id) {
            await db.query(`UPDATE rf_${network} SET ? WHERE id = ?`, [data, id]);
        }
        res.redirect(`/rf-database?network=${network}`);
    } catch (error) {
        console.error(error);
        res.status(500).send("Lỗi lưu dữ liệu");
    }
};

exports.deleteData = async (req, res) => {
    const network = req.params.network;
    const id = req.params.id;
    try {
        await db.query(`DELETE FROM rf_${network} WHERE id = ?`, [id]);
        res.redirect(`/rf-database?network=${network}`);
    } catch (error) {
        console.error(error);
        res.status(500).send("Lỗi xóa dữ liệu");
    }
};

exports.resetData = async (req, res) => {
    const network = req.params.network;
    try {
        await db.query(`TRUNCATE TABLE rf_${network}`);
        res.redirect(`/rf-database?network=${network}`);
    } catch (error) {
        console.error(error);
        res.status(500).send("Lỗi xóa toàn bộ dữ liệu");
    }
};
