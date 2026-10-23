const db = require('../models/db');

// Tự động khởi tạo Database nếu chưa có
const initDB = async () => {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS projects (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS project_cells (
                id INT AUTO_INCREMENT PRIMARY KEY,
                project_id INT,
                cell_name VARCHAR(150) NOT NULL,
                action_date DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            )
        `);
    } catch (e) {
        console.error("Lỗi khởi tạo DB cho Project Monitor:", e);
    }
};

initDB();

exports.renderProjectPage = (req, res) => {
    let userRole = req.session && req.session.user ? req.session.user.role : 'user';
    res.render('project_monitor', { title: 'Theo Dõi Dự Án', page: 'Project Monitor', userRole });
};

exports.getProjects = async (req, res) => {
    try {
        const [rows] = await db.query('SELECT p.*, COUNT(c.id) as cell_count FROM projects p LEFT JOIN project_cells c ON p.id = c.project_id GROUP BY p.id ORDER BY p.id DESC');
        res.json(rows);
    } catch (error) { res.status(500).json({ error: "Lỗi CSDL" }); }
};

exports.createProject = async (req, res) => {
    try {
        const { name, description } = req.body;
        const [result] = await db.query('INSERT INTO projects (name, description) VALUES (?, ?)', [name, description]);
        res.json({ success: true, id: result.insertId });
    } catch (error) { res.status(500).json({ error: "Lỗi tạo dự án" }); }
};

exports.deleteProject = async (req, res) => {
    try {
        await db.query('DELETE FROM projects WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Lỗi xóa dự án" }); }
};

exports.addCellsToProject = async (req, res) => {
    try {
        const { cells, action_date } = req.body;
        const projectId = req.params.id;
        
        let cellList = cells.split(/[\n,]+/).map(c => c.trim().toUpperCase()).filter(Boolean);
        
        if (cellList.length > 0) {
            const values = cellList.map(cell => [projectId, cell, action_date || null]);
            await db.query('INSERT INTO project_cells (project_id, cell_name, action_date) VALUES ?', [values]);
        }
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Lỗi thêm Cell" }); }
};

exports.removeCell = async (req, res) => {
    try {
        await db.query('DELETE FROM project_cells WHERE id = ?', [req.params.cellId]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Lỗi xóa Cell" }); }
};

exports.getProjectData = async (req, res) => {
    try {
        const projectId = req.params.id;
        
        // Lấy danh sách Cells và Ngày tác động của dự án
        const [cells] = await db.query('SELECT * FROM project_cells WHERE project_id = ? ORDER BY id DESC', [projectId]);
        
        if (cells.length === 0) return res.json([]);

        // Tải Cache QoE/QoS để ghép điểm CEM, QoS hiện tại
        let qoeQosMap = {};
        try {
            const [qoeRows] = await db.query('SELECT Cell_Name, QoE_Score, QoS_Score FROM qoe_qos');
            qoeRows.forEach(r => qoeQosMap[r.Cell_Name.toUpperCase()] = r);
        } catch(e) {}

        let finalData = [];

        for (let cellObj of cells) {
            let cellName = cellObj.cell_name;
            let actionDate = cellObj.action_date; // Định dạng YYYY-MM-DD
            
            let query = ``;
            let params = [];

            if (actionDate) {
                // [LÕI THUẬT TOÁN]: Có ngày tác động -> Chia làm 2 nhóm (Trước và Sau) để tính Trung Bình
                query = `
                    SELECT 
                        AVG(CASE WHEN STR_TO_DATE(Thoi_gian, '%d/%m/%Y') < ? THEN Total_Data_Traffic_Volume_GB END) as traf_before,
                        AVG(CASE WHEN STR_TO_DATE(Thoi_gian, '%d/%m/%Y') >= ? THEN Total_Data_Traffic_Volume_GB END) as traf_after,
                        
                        AVG(CASE WHEN STR_TO_DATE(Thoi_gian, '%d/%m/%Y') < ? THEN User_DL_Avg_Throughput_Kbps END) as thput_before,
                        AVG(CASE WHEN STR_TO_DATE(Thoi_gian, '%d/%m/%Y') >= ? THEN User_DL_Avg_Throughput_Kbps END) as thput_after,
                        
                        AVG(CASE WHEN STR_TO_DATE(Thoi_gian, '%d/%m/%Y') < ? THEN RB_Util_Rate_DL END) as prb_before,
                        AVG(CASE WHEN STR_TO_DATE(Thoi_gian, '%d/%m/%Y') >= ? THEN RB_Util_Rate_DL END) as prb_after,
                        
                        AVG(CASE WHEN STR_TO_DATE(Thoi_gian, '%d/%m/%Y') < ? THEN CQI_4G END) as cqi_before,
                        AVG(CASE WHEN STR_TO_DATE(Thoi_gian, '%d/%m/%Y') >= ? THEN CQI_4G END) as cqi_after
                    FROM kpi_4g 
                    WHERE Cell_name = ?
                `;
                // Truyền tham số ActionDate 8 lần cho 8 điều kiện so sánh
                params = [actionDate, actionDate, actionDate, actionDate, actionDate, actionDate, actionDate, actionDate, cellName];
            } else {
                // Không có ngày tác động -> Tính trung bình 7 ngày gần nhất
                query = `
                    SELECT 
                        NULL as traf_before, AVG(Total_Data_Traffic_Volume_GB) as traf_after,
                        NULL as thput_before, AVG(User_DL_Avg_Throughput_Kbps) as thput_after,
                        NULL as prb_before, AVG(RB_Util_Rate_DL) as prb_after,
                        NULL as cqi_before, AVG(CQI_4G) as cqi_after
                    FROM (
                        SELECT * FROM kpi_4g WHERE Cell_name = ? 
                        ORDER BY STR_TO_DATE(Thoi_gian, '%d/%m/%Y') DESC LIMIT 7
                    ) sub
                `;
                params = [cellName];
            }

            const [kpiResult] = await db.query(query, params);
            let kpi = kpiResult[0] || {};
            let qq = qoeQosMap[cellName] || {};

            // Định dạng Action Date ra hiển thị
            let displayDate = "-";
            if (actionDate) {
                let d = new Date(actionDate);
                displayDate = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
            }

            finalData.push({
                cell_id: cellObj.id,
                cell_name: cellName,
                action_date: displayDate,
                
                traf_before: kpi.traf_before || 0,
                traf_after: kpi.traf_after || 0,
                
                thput_before: (kpi.thput_before || 0) / 1024, // Đổi sang Mbps
                thput_after: (kpi.thput_after || 0) / 1024,
                
                prb_before: kpi.prb_before || 0,
                prb_after: kpi.prb_after || 0,
                
                cqi_before: kpi.cqi_before || 0,
                cqi_after: kpi.cqi_after || 0,
                
                cem_score: qq.QoE_Score ? parseFloat(qq.QoE_Score).toFixed(1) : '-',
                qos_score: qq.QoS_Score ? parseFloat(qq.QoS_Score).toFixed(1) : '-'
            });
        }

        res.json(finalData);
    } catch (error) {
        console.error("Lỗi getProjectData:", error);
        res.status(500).json({ error: "Lỗi truy xuất dữ liệu" });
    }
};
