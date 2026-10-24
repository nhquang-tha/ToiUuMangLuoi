const db = require('../models/db');

// [MỚI] Hàm hỗ trợ ánh xạ tự động tên bảng chuẩn
const getTableName = (network) => {
    if (network === 'csht') return 'csht_data';
    return `rf_${network}`;
};

exports.getList = async (req, res) => {
    const network = req.query.network || '4g';
    const search = req.query.search ? req.query.search.trim() : '';
    const page = parseInt(req.query.page) || 1;
    const limit = 100; 
    const offset = (page - 1) * limit;
    const isAdmin = req.session && req.session.user && req.session.user.role === 'admin';

    const tableName = getTableName(network);
    
    let searchClause = '';
    let queryParams = [];

    if (search) {
        if (network === 'csht') {
            searchClause = `WHERE Ma_CSHT LIKE ? OR Ten_CSHT LIKE ?`;
        } else {
            let nameColumn = network === '5g' ? 'SITE_NAME' : 'CELL_NAME'; 
            searchClause = `WHERE Cell_code LIKE ? OR ${nameColumn} LIKE ?`;
        }
        queryParams.push(`%${search}%`, `%${search}%`);
    }

    try {
        const countQuery = `SELECT COUNT(*) as total FROM ${tableName} ${searchClause}`;
        const [countResult] = await db.query(countQuery, queryParams);
        const totalRecords = countResult[0].total;
        const totalPages = Math.ceil(totalRecords / limit) || 1;

        const dataQuery = `SELECT * FROM ${tableName} ${searchClause} LIMIT ? OFFSET ?`;
        const [rows] = await db.query(dataQuery, [...queryParams, limit, offset]);

        res.render('rf_database', {
            title: network === 'csht' ? 'Cơ Sở Hạ Tầng' : 'RF Database',
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
        res.status(500).send("Lỗi lấy dữ liệu từ Database. Hãy kiểm tra kết nối CSDL.");
    }
};

exports.exportData = async (req, res) => {
    const network = req.query.network || '4g';
    const search = req.query.search ? req.query.search.trim() : '';

    const tableName = getTableName(network);
    let searchClause = '';
    let queryParams = [];

    if (search) {
        if (network === 'csht') {
            searchClause = `WHERE Ma_CSHT LIKE ? OR Ten_CSHT LIKE ?`;
        } else {
            let nameColumn = network === '5g' ? 'SITE_NAME' : 'CELL_NAME'; 
            searchClause = `WHERE Cell_code LIKE ? OR ${nameColumn} LIKE ?`;
        }
        queryParams.push(`%${search}%`, `%${search}%`);
    }

    try {
        const dataQuery = `SELECT * FROM ${tableName} ${searchClause}`;
        const [rows] = await db.query(dataQuery, queryParams);
        res.json(rows);
    } catch (error) {
        console.error("Lỗi lấy dữ liệu xuất Excel:", error);
        res.status(500).json({ error: "Lỗi cơ sở dữ liệu" });
    }
};

exports.getForm = async (req, res) => {
    const action = req.params.action; 
    const network = req.params.network || '4g';
    const id = req.params.id;
    const activeUser = req.session ? req.session.user : null;

    try {
        const tableName = getTableName(network);
        const [cols] = await db.query(`SHOW COLUMNS FROM ${tableName}`);
        const columns = cols.map(c => c.Field);

        let data = {};
        if (action === 'edit' && id) {
            const [rows] = await db.query(`SELECT * FROM ${tableName} WHERE id = ?`, [id]);
            if (rows.length > 0) data = rows[0];
        }

        res.render('rf_form', {
            title: action === 'add' ? `Thêm mới bản ghi ${network.toUpperCase()}` : `Sửa bản ghi ${network.toUpperCase()}`,
            page: 'RF Database',
            currentUser: activeUser,
            action: action,
            network: network,
            currentNetwork: network,
            columns: columns, 
            data: data
        });
    } catch (error) {
        console.error("Lỗi tải form RF/CSHT:", error);
        res.status(500).send("Lỗi truy xuất cơ sở dữ liệu để tải Form. Vui lòng thử lại.");
    }
};

exports.saveData = async (req, res) => {
    const action = req.params.action;
    const network = req.params.network;
    const id = req.params.id;
    const data = req.body;
    const tableName = getTableName(network);
    
    // Dọn dẹp các trường trống thành null để CSDL không bị lỗi rỗng
    for(let key in data) {
        if(data[key] === '') data[key] = null;
    }

    try {
        if (action === 'add') {
            await db.query(`INSERT INTO ${tableName} SET ?`, data);
        } else if (action === 'edit' && id) {
            await db.query(`UPDATE ${tableName} SET ? WHERE id = ?`, [data, id]);
        }
        res.redirect(`/rf-database?network=${network}`);
    } catch (error) {
        console.error(error);
        res.status(500).send("Lỗi lưu dữ liệu. Có thể do trùng lặp Mã/Tên.");
    }
};

exports.deleteData = async (req, res) => {
    let network = req.params.network;
    network = network.replace(/^rf_/i, ''); 
    const rowIdentifier = req.params.id; 
    
    if (!network || !rowIdentifier) {
        return res.status(400).send("Dữ liệu không hợp lệ. Thiếu mạng lưới hoặc ID nhận diện.");
    }

    const allowedNetworks = ['3g', '4g', '5g', 'csht'];
    if (!allowedNetworks.includes(network)) {
        return res.status(403).send("Bảng mạng lưới không hợp lệ.");
    }

    const tableName = getTableName(network);

    try {
        const isNumeric = !isNaN(rowIdentifier) && !String(rowIdentifier).match(/[a-zA-Z]/);
        let query = '';
        let params = [];
        
        if (isNumeric) {
            query = `DELETE FROM ${tableName} WHERE id = ?`;
            params = [parseInt(rowIdentifier, 10)];
        } else {
            if (network === 'csht') {
                query = `DELETE FROM ${tableName} WHERE Ma_CSHT = ?`;
                params = [rowIdentifier];
            } else {
                query = `DELETE FROM ${tableName} WHERE Cell_code = ? OR CELL_NAME = ?`;
                params = [rowIdentifier, rowIdentifier];
            }
        }

        const [result] = await db.query(query, params);
        
        if (result.affectedRows > 0) {
            res.redirect(`/rf-database?network=${network}`);
        } else {
            if (network !== 'csht') {
                try {
                    const [result2] = await db.query(`DELETE FROM ${tableName} WHERE SITE_NAME = ?`, [rowIdentifier]);
                    if (result2.affectedRows > 0) {
                        res.redirect(`/rf-database?network=${network}`);
                    } else {
                        res.status(404).send(`Không tìm thấy dữ liệu để xóa.`);
                    }
                } catch (fallbackError) {
                    res.status(404).send(`Không tìm thấy ID để xóa.`);
                }
            } else {
                res.status(404).send(`Không tìm thấy CSHT để xóa.`);
            }
        }
    } catch (error) {
        console.error("Lỗi xóa dữ liệu:", error);
        res.status(500).send("Lỗi cơ sở dữ liệu khi thực hiện lệnh xóa.");
    }
};

exports.resetData = async (req, res) => {
    const network = req.params.network;
    const tableName = getTableName(network);
    try {
        await db.query(`TRUNCATE TABLE ${tableName}`);
        res.redirect(`/rf-database?network=${network}`);
    } catch (error) {
        console.error(error);
        res.status(500).send("Lỗi xóa toàn bộ dữ liệu");
    }
};
