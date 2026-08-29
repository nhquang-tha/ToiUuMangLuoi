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

exports.exportData = async (req, res) => {
    const network = req.query.network || '3g';
    const search = req.query.search ? req.query.search.trim() : '';

    let tableName = `rf_${network}`;
    let nameColumn = network === '5g' ? 'SITE_NAME' : 'CELL_NAME'; 
    
    let searchClause = '';
    let queryParams = [];

    if (search) {
        // Tìm kiếm theo Cell Code HOẶC Tên Cell
        searchClause = `WHERE Cell_code LIKE ? OR ${nameColumn} LIKE ?`;
        queryParams.push(`%${search}%`, `%${search}%`);
    }

    try {
        // Lấy TOÀN BỘ dữ liệu (Không dùng LIMIT / OFFSET)
        const dataQuery = `SELECT * FROM ${tableName} ${searchClause}`;
        const [rows] = await db.query(dataQuery, queryParams);
        res.json(rows);
    } catch (error) {
        console.error("Lỗi lấy dữ liệu xuất Excel:", error);
        res.status(500).json({ error: "Lỗi cơ sở dữ liệu" });
    }
};

exports.getForm = async (req, res) => {
    const action = req.params.action; // 'add' hoặc 'edit'
    const network = req.params.network || '4g';
    const id = req.params.id;
    const activeUser = req.session ? req.session.user : null;

    try {
        const tableName = `rf_${network}`;
        
        // GIẢI PHÁP: Chủ động lấy danh sách cột trực tiếp từ cấu trúc Database
        const [cols] = await db.query(`SHOW COLUMNS FROM ${tableName}`);
        const columns = cols.map(c => c.Field);

        let data = {};
        // Nếu là hành động Sửa, lấy dữ liệu cũ đắp vào Form
        if (action === 'edit' && id) {
            const [rows] = await db.query(`SELECT * FROM ${tableName} WHERE id = ?`, [id]);
            if (rows.length > 0) {
                data = rows[0];
            }
        }

        // Render ra giao diện với đầy đủ các biến cần thiết
        res.render('rf_form', {
            title: action === 'add' ? `Thêm mới trạm ${network.toUpperCase()}` : `Sửa trạm ${network.toUpperCase()}`,
            page: 'RF Database',
            currentUser: activeUser,
            action: action,
            network: network,
            currentNetwork: network,
            columns: columns, // Chắc chắn 100% luôn có mảng cột
            data: data
        });
    } catch (error) {
        console.error("Lỗi tải form RF:", error);
        res.status(500).send("Lỗi truy xuất cơ sở dữ liệu để tải Form. Vui lòng thử lại.");
    }
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
    let network = req.params.network;
    network = network.replace(/^rf_/i, ''); // Tự động cắt bỏ chữ rf_ nếu frontend lỡ gửi nhầm rf_4g
    
    const rowIdentifier = req.params.id; // Giá trị định danh truyền từ Frontend
    
    if (!network || !rowIdentifier) {
        return res.status(400).send("Dữ liệu không hợp lệ. Thiếu mạng lưới hoặc ID nhận diện.");
    }

    // Whitelist bảo mật
    const allowedNetworks = ['3g', '4g', '5g'];
    if (!allowedNetworks.includes(network)) {
        return res.status(403).send("Bảng mạng lưới không hợp lệ.");
    }

    try {
        // Thuật toán nhận diện thông minh: Kiểm tra xem Identifier là ID (Số) hay là Cell_Code (Chứa chữ cái)
        const isNumeric = !isNaN(rowIdentifier) && !String(rowIdentifier).match(/[a-zA-Z]/);
        
        let query = '';
        let params = [];
        
        if (isNumeric) {
            // Xóa bằng ID nguyên thủy
            query = `DELETE FROM rf_${network} WHERE id = ?`;
            params = [parseInt(rowIdentifier, 10)];
        } else {
            // Xóa bằng Tên Cell
            query = `DELETE FROM rf_${network} WHERE Cell_code = ? OR CELL_NAME = ?`;
            params = [rowIdentifier, rowIdentifier];
        }

        const [result] = await db.query(query, params);
        
        if (result.affectedRows > 0) {
            res.redirect(`/rf-database?network=${network}`);
        } else {
            // [FIX]: Fallback xử lý an toàn cho 3G/5G khi xóa bằng Tên Trạm (SITE_NAME)
            try {
                const [result2] = await db.query(`DELETE FROM rf_${network} WHERE SITE_NAME = ?`, [rowIdentifier]);
                if (result2.affectedRows > 0) {
                    res.redirect(`/rf-database?network=${network}`);
                } else {
                    res.status(404).send(`Không tìm thấy dữ liệu để xóa (Giá trị nhận diện: ${rowIdentifier}).`);
                }
            } catch (fallbackError) {
                // Bắt lỗi nếu bảng không có cột SITE_NAME
                res.status(404).send(`Không tìm thấy ID để xóa hoặc giá trị nhận diện không đúng.`);
            }
        }
    } catch (error) {
        console.error("Lỗi xóa dữ liệu RF:", error);
        res.status(500).send("Lỗi cơ sở dữ liệu khi thực hiện lệnh xóa.");
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
