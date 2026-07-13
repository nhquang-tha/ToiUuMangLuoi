const express = require('express');
const router = express.Router();
const multer = require('multer');
const dashboardController = require('../controllers/dashboardController');

// Khai báo an toàn cho kpiController (Tránh lỗi nếu file chưa có)
let kpiController = null;
try { kpiController = require('../controllers/kpiController'); } catch(e) {}

const authMiddleware = require('../middlewares/authMiddleware');

// Cấu hình Multer để lưu file trên RAM (buffer)
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } // Giới hạn 50MB cho các file Excel nặng
});

// ==========================================
// 1. CÁC TRANG CƠ BẢN (VIEWS)
// ==========================================
const pages = [
    { path: '/', name: 'Dashboard' },
    { path: '/poi-report', name: 'POI Report' },
    { path: '/worst-cells', name: 'Worst Cells' },
    { path: '/congestion-3g', name: 'Congestion 3G' },
    { path: '/traffic-down', name: 'Traffic Down' },
    { path: '/downtilt-coverage', name: 'Downtilt Coverage' },
    { path: '/scrip', name: 'Scrip' },
    { path: '/optimizing-qoe-qos', name: 'Optimizing QoE/QoS' }
];

// Tạo các đường dẫn tự động tới Views
pages.forEach(page => {
    router.get(page.path, authMiddleware.isAuthenticated, dashboardController.renderPage(page.name));
});

// ==========================================
// 2. CHỨC NĂNG QUẢN TRỊ & IMPORT DỮ LIỆU
// ==========================================
router.get('/import-data', authMiddleware.isAuthenticated, authMiddleware.isAdmin, dashboardController.getImportPage);
router.post('/import-data', authMiddleware.isAuthenticated, authMiddleware.isAdmin, upload.array('dataFiles', 10), dashboardController.handleImportData);

// API Xóa sạch dữ liệu KPI (Admin)
router.post('/kpi-data/reset/:network', authMiddleware.isAuthenticated, authMiddleware.isAdmin, async (req, res) => {
    const db = require('../models/db');
    const net = req.params.network;
    if(['3g', '4g', '5g'].includes(net)) {
        try { await db.query(`TRUNCATE TABLE kpi_${net}`); } catch(e) { console.error(e); }
    }
    res.redirect('/import-data');
});

// API Xóa sạch dữ liệu cấu hình, POI, QoE, QoS (Admin)
router.post('/import-data/reset/:table', authMiddleware.isAuthenticated, authMiddleware.isAdmin, dashboardController.resetImportedData);

// ==========================================
// 3. CÁC API CUNG CẤP DỮ LIỆU CHO AJAX (FRONTEND)
// ==========================================
router.get('/api/districts', authMiddleware.isAuthenticated, dashboardController.getDistricts);
router.get('/api/dashboard-data', authMiddleware.isAuthenticated, dashboardController.getDashboardData);

// API Dữ liệu Cảnh Báo (Đọc từ Cache)
router.get('/api/worst-cells-data', authMiddleware.isAuthenticated, dashboardController.getWorstCellsData);
router.get('/api/congestion-3g-data', authMiddleware.isAuthenticated, dashboardController.getCongestion3gData);
router.get('/api/traffic-down-data', authMiddleware.isAuthenticated, dashboardController.getTrafficDownData);

// API Báo Cáo Điểm Quan Tâm (POI)
router.get('/api/poi-list', authMiddleware.isAuthenticated, dashboardController.getPoiList);
router.get('/api/export-all-poi', authMiddleware.isAuthenticated, dashboardController.getAllPoiExportData);

// API Vẽ biểu đồ động (Đa luồng)
router.get('/api/kpi-data', authMiddleware.isAuthenticated, dashboardController.getKpiData);

// API Dữ liệu Trải Nghiệm & Dịch Vụ (QoE/QoS)
router.get('/api/qoe-qos-data', authMiddleware.isAuthenticated, dashboardController.getQoeQosData);
router.get('/api/qoe-qos-list-all', authMiddleware.isAuthenticated, dashboardController.getQoeQosListAll);
router.post('/api/save-cell-note', authMiddleware.isAuthenticated, dashboardController.saveCellNote);

// API Thuật toán Tối Ưu (Tích hợp từ kpiController)
if (kpiController && kpiController.getOptimizingData) {
    router.get('/api/optimizing-data', authMiddleware.isAuthenticated, kpiController.getOptimizingData);
}

module.exports = router;
