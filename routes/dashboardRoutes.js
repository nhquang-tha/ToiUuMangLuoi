const express = require('express');
const router = express.Router();
const multer = require('multer');

// Import Middlewares Phân quyền
const { isAuthenticated, isAdmin } = require('../middlewares/authMiddleware');

// Import Controllers
const dashboardController = require('../controllers/dashboardController');
const rfController = require('../controllers/rfController'); 
const kpiController = require('../controllers/kpiController');
const userController = require('../controllers/userController');
const mapController = require('../controllers/mapController'); 

// Cấu hình lưu trữ bộ nhớ đệm cho quá trình upload file
const upload = multer({ storage: multer.memoryStorage() });

// Middleware gán biến currentUser toàn cục cho tất cả các View
// Cách này fix triệt để lỗi mất menu Admin khi vào các trang con
router.use((req, res, next) => {
    res.locals.currentUser = req.session ? req.session.user : undefined;
    next();
});

// --- ROUTES CƠ BẢN (Dashboard & Báo cáo tĩnh) ---
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

// --- BẢN ĐỒ GIS VÀ MÔ PHỎNG TA ---
router.get('/gis-map', isAuthenticated, mapController.getMapPage);
router.get('/api/gis-data', isAuthenticated, mapController.getMapData);
router.get('/api/ta-data', isAuthenticated, mapController.getTAData); 

// --- ROUTES CHO KPI ANALYTICS ---
router.get('/kpi-analytics', isAuthenticated, kpiController.getKpiAnalyticsPage);
router.get('/api/kpi-data', isAuthenticated, kpiController.getKpiData);
router.post('/kpi-data/reset/:network', isAuthenticated, isAdmin, kpiController.resetData); // Reset Data chỉ dành cho Admin

// --- ROUTES CHO IMPORT DATA (Hỗ trợ upload Multi-file) ---
router.get('/import-data', isAuthenticated, isAdmin, dashboardController.getImportPage);
router.post('/import-data', isAuthenticated, isAdmin, upload.array('dataFiles', 50), dashboardController.handleImportData);

// --- ROUTES CHO RF DATABASE (CRUD) ---
router.get('/rf-database', isAuthenticated, rfController.getList);
router.get('/rf-database/export', isAuthenticated, rfController.exportData); // API xuất toàn bộ Excel (bỏ qua phân trang)

// Các Route Xem Form (Mọi User đã xác thực đều được xem form / Mặc dù nút bấm đã ẩn ở Frontend)
router.get('/rf-database/:action/:network/:id?', isAuthenticated, rfController.getForm);

// CHẶN QUYỀN TRÊN BACKEND: Chỉ có Admin mới được thực hiện hành động Thêm/Sửa/Xóa dữ liệu
router.post('/rf-database/:action/:network/:id?', isAuthenticated, isAdmin, rfController.saveData);
router.post('/rf-database/delete/:network/:id', isAuthenticated, isAdmin, rfController.deleteData);
router.post('/rf-database/reset/:network', isAuthenticated, isAdmin, rfController.resetData);

// --- ROUTES CHO HỆ THỐNG (SYSTEM) ---
router.get('/system/profile', isAuthenticated, userController.getProfilePage);
router.post('/system/profile/change-password', isAuthenticated, userController.changePassword);

// Quản lý người dùng (Chỉ Admin)
router.get('/system/users', isAuthenticated, isAdmin, userController.getUserManagerPage);
router.post('/system/users/add', isAuthenticated, isAdmin, userController.addUser);
router.post('/system/users/delete/:id', isAuthenticated, isAdmin, userController.deleteUser);

// Đăng xuất
router.get('/logout', (req, res) => { 
    req.session.destroy(); 
    res.redirect('/login'); 
});

module.exports = router;
