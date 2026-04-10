const express = require('express');
const router = express.Router();
const multer = require('multer');

// Import Middleware phân quyền
const { isAuthenticated, isAdmin } = require('../middlewares/authMiddleware');

// Import các Controllers xử lý logic
const dashboardController = require('../controllers/dashboardController');
const rfController = require('../controllers/rfController'); 
const kpiController = require('../controllers/kpiController');
const userController = require('../controllers/userController');
const mapController = require('../controllers/mapController'); 

// Cấu hình Multer để upload file vào RAM (memory buffer)
const upload = multer({ storage: multer.memoryStorage() });

// ==========================================
// 1. CÁC TRANG CƠ BẢN (Dùng chung hàm renderPage)
// ==========================================
const pages = [
    { path: '/', name: 'Dashboard' },
    { path: '/poi-report', name: 'POI Report' },
    { path: '/worst-cells', name: 'Worst Cells' },
    { path: '/congestion-3g', name: 'Congestion 3G' },
    { path: '/traffic-down', name: 'Traffic Down' },
    { path: '/scrip', name: 'Scrip' }
];

pages.forEach(page => {
    router.get(page.path, isAuthenticated, dashboardController.renderPage(page.name));
});

// ==========================================
// 2. BẢN ĐỒ GIS VÀ MÔ PHỎNG TA
// ==========================================
router.get('/gis-map', isAuthenticated, mapController.getMapPage);
router.get('/api/gis-data', isAuthenticated, mapController.getMapData);
router.get('/api/ta-data', isAuthenticated, mapController.getTAData); 

// ==========================================
// 3. PHÂN TÍCH KPI VÀ QOE/QOS (ANALYTICS)
// ==========================================
router.get('/kpi-analytics', isAuthenticated, kpiController.getKpiAnalyticsPage);
router.get('/api/kpi-data', isAuthenticated, kpiController.getKpiData);
router.post('/kpi-data/reset/:network', isAuthenticated, isAdmin, kpiController.resetData);

router.get('/qoe-qos-analytics', isAuthenticated, kpiController.getQoeQosAnalyticsPage);
router.get('/api/qoe-qos-data', isAuthenticated, kpiController.getQoeQosData);

// ==========================================
// 4. IMPORT DỮ LIỆU (Excel/CSV)
// ==========================================
router.get('/import-data', isAuthenticated, isAdmin, dashboardController.getImportPage);
router.post('/import-data', isAuthenticated, isAdmin, upload.array('dataFiles', 50), dashboardController.handleImportData);

// CHỨC NĂNG MỚI: Xóa dữ liệu đa năng cho RF, TA, QoE, QoS
router.post('/import-data/reset/:table', isAuthenticated, isAdmin, dashboardController.resetImportedData);

// ==========================================
// 5. QUẢN LÝ CƠ SỞ DỮ LIỆU TRẠM (RF DATABASE)
// ==========================================
router.get('/rf-database', isAuthenticated, rfController.getList);
router.get('/rf-database/export', isAuthenticated, rfController.exportData); 
router.get('/rf-database/:action/:network/:id?', isAuthenticated, rfController.getForm);
router.post('/rf-database/:action/:network/:id?', isAuthenticated, isAdmin, rfController.saveData);
router.post('/rf-database/delete/:network/:id', isAuthenticated, isAdmin, rfController.deleteData);
router.post('/rf-database/reset/:network', isAuthenticated, isAdmin, rfController.resetData);

// ==========================================
// 6. CÁC CỔNG GIAO TIẾP API CHO BÁO CÁO (DASHBOARD & CẢNH BÁO)
// ==========================================
router.get('/api/dashboard-data', isAuthenticated, dashboardController.getDashboardData);
router.get('/api/worst-cells-data', isAuthenticated, dashboardController.getWorstCellsData);
router.get('/api/congestion-3g-data', isAuthenticated, dashboardController.getCongestion3gData);
router.get('/api/traffic-down-data', isAuthenticated, dashboardController.getTrafficDownData);

// Bổ sung API cho trang POI Report
if (kpiController.getPoiList) {
    router.get('/api/poi-list', isAuthenticated, kpiController.getPoiList);
    router.get('/api/poi-data', isAuthenticated, kpiController.getPoiData);
}

// ==========================================
// 7. QUẢN LÝ HỆ THỐNG & USER
// ==========================================
router.get('/system/profile', isAuthenticated, userController.getProfilePage);
router.post('/system/profile/change-password', isAuthenticated, userController.changePassword);

router.get('/system/users', isAuthenticated, isAdmin, userController.getUserManagerPage);
router.post('/system/users/add', isAuthenticated, isAdmin, userController.addUser);
router.post('/system/users/delete/:id', isAuthenticated, isAdmin, userController.deleteUser);

// Đăng xuất
router.get('/logout', (req, res) => { 
    req.session.destroy(); 
    res.redirect('/login'); 
});

module.exports = router;
