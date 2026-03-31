const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../models/db'); 

// Import Middlewares Phân quyền
const { isAuthenticated, isAdmin } = require('../middlewares/authMiddleware');

// Import Controllers
const dashboardController = require('../controllers/dashboardController');
const rfController = require('../controllers/rfController'); 
const kpiController = require('../controllers/kpiController');
const userController = require('../controllers/userController');

const upload = multer({ storage: multer.memoryStorage() });

// MIDDLEWARE TOÀN CỤC: Khôi phục Session User thông minh
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

// --- ROUTES CƠ BẢN (TRANG TĨNH) ---
const pages = [
    { path: '/', name: 'Dashboard' },
    { path: '/scrip', name: 'Scrip' }
];

pages.forEach(page => {
    router.get(page.path, isAuthenticated, dashboardController.renderPage(page.name));
});

// --- ROUTES CHO KPI ANALYTICS & CÁC CẢNH BÁO CHẤT LƯỢNG ---
// QUAN TRỌNG: Đây là các đường dẫn API bắt buộc phải có để vẽ biểu đồ
router.get('/kpi-analytics', isAuthenticated, kpiController.getKpiAnalyticsPage);
router.get('/api/kpi-data', isAuthenticated, kpiController.getKpiData);
router.post('/kpi-data/reset/:network', isAuthenticated, isAdmin, kpiController.resetData);

router.get('/poi-report', isAuthenticated, kpiController.getPoiReportPage);
router.get('/api/poi-list', isAuthenticated, kpiController.getPoiList);
router.get('/api/poi-data', isAuthenticated, kpiController.getPoiData);

router.get('/worst-cells', isAuthenticated, kpiController.getWorstCellsPage);
router.get('/api/worst-cells-data', isAuthenticated, kpiController.getWorstCellsData);

router.get('/congestion-3g', isAuthenticated, kpiController.getCongestion3gPage);
router.get('/api/congestion-3g-data', isAuthenticated, kpiController.getCongestion3gData);

router.get('/traffic-down', isAuthenticated, kpiController.getTrafficDownPage);
router.get('/api/traffic-down-data', isAuthenticated, kpiController.getTrafficDownData);

// --- ROUTES CHO IMPORT DATA ---
router.get('/import-data', isAuthenticated, isAdmin, dashboardController.getImportPage);
router.post('/import-data', isAuthenticated, isAdmin, upload.array('dataFiles', 50), dashboardController.handleImportData);

// --- ROUTES CHO RF DATABASE (CRUD) ---
router.get('/rf-database', isAuthenticated, rfController.getList);
router.get('/rf-database/export', isAuthenticated, rfController.exportData); 
router.post('/rf-database/delete/:network/:id', isAuthenticated, isAdmin, rfController.deleteData);
router.post('/rf-database/reset/:network', isAuthenticated, isAdmin, rfController.resetData);
router.get('/rf-database/:action/:network/:id?', isAuthenticated, rfController.getForm);
router.post('/rf-database/:action/:network/:id?', isAuthenticated, isAdmin, rfController.saveData);

// --- ROUTES CHO HỆ THỐNG (SYSTEM) ---
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
