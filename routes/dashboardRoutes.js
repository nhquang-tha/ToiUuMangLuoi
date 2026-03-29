const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../models/db'); // Bổ sung để phục vụ tự động lấy Session

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

// MIDDLEWARE TOÀN CỤC: Khôi phục Session User thông minh
// Khắc phục triệt để lỗi mất menu Admin khi vào các trang con
router.use(async (req, res, next) => {
    if (req.session && req.session.user) {
        res.locals.currentUser = req.session.user;
    } else if (req.session && (req.session.userId || req.session.user_id || req.session.id)) {
        const uid = req.session.userId || req.session.user_id || req.session.id;
        try {
            const [users] = await db.query('SELECT id, username, role FROM users WHERE id = ?', [uid]);
            if (users.length > 0) {
                req.session.user = users[0];
                res.locals.currentUser = users[0];
            }
        } catch(e) { console.error("Lỗi khôi phục session:", e); }
    }
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
router.post('/kpi-data/reset/:network', isAuthenticated, isAdmin, kpiController.resetData);

// --- ROUTES CHO IMPORT DATA ---
router.get('/import-data', isAuthenticated, isAdmin, dashboardController.getImportPage);
router.post('/import-data', isAuthenticated, isAdmin, upload.array('dataFiles', 50), dashboardController.handleImportData);

// --- ROUTES CHO RF DATABASE (CRUD) ---
router.get('/rf-database', isAuthenticated, rfController.getList);
router.get('/rf-database/export', isAuthenticated, rfController.exportData); // API xuất Excel

// 1. ĐƯA ROUTE RESET VÀ DELETE LÊN TRÊN (Để không bị nhầm lẫn với action)
router.post('/rf-database/delete/:network/:id', isAuthenticated, isAdmin, rfController.deleteData);
router.post('/rf-database/reset/:network', isAuthenticated, isAdmin, rfController.resetData);

// 2. CÁC ROUTE CHUNG XUỐNG DƯỚI
router.get('/rf-database/:action/:network/:id?', isAuthenticated, rfController.getForm);
router.post('/rf-database/:action/:network/:id?', isAuthenticated, isAdmin, rfController.saveData);

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
