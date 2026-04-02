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
const mapController = require('../controllers/mapController'); 

const upload = multer({ storage: multer.memoryStorage() });

// Hàm bảo vệ chống sập Server
const safeCtrl = (handler) => {
    if (typeof handler === 'function') return handler;
    return (req, res) => {
        res.status(503).send(`
            <div style="font-family: Arial, sans-serif; padding: 40px; text-align: center; color: #2c3e50; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #e74c3c; font-size: 24px;">⚠️ Tính Năng Đang Được Cập Nhật</h2>
                <p style="font-size: 16px; line-height: 1.6;">Hệ thống không tìm thấy đoạn mã xử lý cho chức năng này.</p>
                <div style="background: #f8f9fa; padding: 15px; border-left: 4px solid #f39c12; text-align: left; margin: 20px 0;">
                    <strong>Nguyên nhân:</strong> Controller chưa được gắn đúng luồng.
                </div>
                <a href="/" style="display: inline-block; padding: 12px 25px; background: #3498db; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; transition: 0.2s;">⬅ Quay lại Trang Chủ</a>
            </div>
        `);
    };
};

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

// --- ROUTES CƠ BẢN (TRANG TĨNH & DASHBOARD) ---
router.get('/', isAuthenticated, safeCtrl(dashboardController.renderPage('Dashboard')));
router.get('/scrip', isAuthenticated, safeCtrl(dashboardController.renderPage('Scrip')));
router.get('/api/dashboard-data', isAuthenticated, safeCtrl(dashboardController.getDashboardData));

// --- BẢN ĐỒ GIS VÀ MÔ PHỎNG TA ---
router.get('/gis-map', isAuthenticated, safeCtrl(mapController.getMapPage));
router.get('/api/gis-data', isAuthenticated, safeCtrl(mapController.getMapData));
router.get('/api/ta-data', isAuthenticated, safeCtrl(mapController.getTAData)); 
router.post('/ta-data/reset', isAuthenticated, isAdmin, safeCtrl(mapController.resetTAData));

// --- ROUTES CHO KPI ANALYTICS & CÁC CẢNH BÁO CHẤT LƯỢNG (ĐÃ ĐƯỢC TÁCH LUỒNG ĐÚNG) ---
router.get('/kpi-analytics', isAuthenticated, safeCtrl(kpiController.getKpiAnalyticsPage));
router.get('/api/kpi-data', isAuthenticated, safeCtrl(kpiController.getKpiData));
router.post('/kpi-data/reset/:network', isAuthenticated, isAdmin, safeCtrl(kpiController.resetData));

router.get('/poi-report', isAuthenticated, safeCtrl(kpiController.getPoiReportPage));
router.get('/api/poi-list', isAuthenticated, safeCtrl(kpiController.getPoiList));
router.get('/api/poi-data', isAuthenticated, safeCtrl(kpiController.getPoiData));

router.get('/worst-cells', isAuthenticated, safeCtrl(kpiController.getWorstCellsPage));
router.get('/api/worst-cells-data', isAuthenticated, safeCtrl(kpiController.getWorstCellsData));

router.get('/congestion-3g', isAuthenticated, safeCtrl(kpiController.getCongestion3gPage));
router.get('/api/congestion-3g-data', isAuthenticated, safeCtrl(kpiController.getCongestion3gData));

router.get('/traffic-down', isAuthenticated, safeCtrl(kpiController.getTrafficDownPage));
router.get('/api/traffic-down-data', isAuthenticated, safeCtrl(kpiController.getTrafficDownData));

// --- ROUTES CHO IMPORT DATA ---
router.get('/import-data', isAuthenticated, isAdmin, safeCtrl(dashboardController.getImportPage));
router.post('/import-data', isAuthenticated, isAdmin, upload.array('dataFiles', 50), safeCtrl(dashboardController.handleImportData));

// --- ROUTES CHO RF DATABASE (CRUD) ---
router.get('/rf-database', isAuthenticated, safeCtrl(rfController.getList));
router.get('/rf-database/export', isAuthenticated, safeCtrl(rfController.exportData)); 
router.post('/rf-database/delete/:network/:id', isAuthenticated, isAdmin, safeCtrl(rfController.deleteData));
router.post('/rf-database/reset/:network', isAuthenticated, isAdmin, safeCtrl(rfController.resetData));
router.get('/rf-database/:action/:network/:id?', isAuthenticated, safeCtrl(rfController.getForm));
router.post('/rf-database/:action/:network/:id?', isAuthenticated, isAdmin, safeCtrl(rfController.saveData));

// --- ROUTES CHO HỆ THỐNG (SYSTEM) ---
router.get('/system/profile', isAuthenticated, safeCtrl(userController.getProfilePage));
router.post('/system/profile/change-password', isAuthenticated, safeCtrl(userController.changePassword));
router.get('/system/users', isAuthenticated, isAdmin, safeCtrl(userController.getUserManagerPage));
router.post('/system/users/add', isAuthenticated, isAdmin, safeCtrl(userController.addUser));
router.post('/system/users/delete/:id', isAuthenticated, isAdmin, safeCtrl(userController.deleteUser));

// Đăng xuất
router.get('/logout', (req, res) => { 
    req.session.destroy(); 
    res.redirect('/login'); 
});

module.exports = router;
