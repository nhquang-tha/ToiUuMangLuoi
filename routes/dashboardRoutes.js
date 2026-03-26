const express = require('express');
const router = express.Router();
const multer = require('multer');
const { isAuthenticated, isAdmin } = require('../middlewares/authMiddleware');
const dashboardController = require('../controllers/dashboardController');
const rfController = require('../controllers/rfController'); 
const kpiController = require('../controllers/kpiController');
const userController = require('../controllers/userController');

const upload = multer({ storage: multer.memoryStorage() });

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

// --- ROUTES CHO KPI ANALYTICS ---
router.get('/kpi-analytics', isAuthenticated, kpiController.getKpiAnalyticsPage);
router.get('/api/kpi-data', isAuthenticated, kpiController.getKpiData);
router.post('/kpi-data/reset/:network', isAuthenticated, isAdmin, kpiController.resetData);

// --- ROUTES CHO IMPORT DATA (Đã sửa thành upload.array hỗ trợ up nhiều file) ---
router.get('/import-data', isAuthenticated, isAdmin, dashboardController.getImportPage);
router.post('/import-data', isAuthenticated, isAdmin, upload.array('dataFiles', 50), dashboardController.handleImportData);

// --- ROUTES CHO RF DATABASE (CRUD) ---
router.get('/rf-database', isAuthenticated, rfController.getList);
router.get('/rf-database/:action/:network/:id?', isAuthenticated, rfController.getForm);
router.post('/rf-database/:action/:network/:id?', isAuthenticated, rfController.saveData);
router.post('/rf-database/delete/:network/:id', isAuthenticated, rfController.deleteData);
router.post('/rf-database/reset/:network', isAuthenticated, isAdmin, rfController.resetData);

// --- ROUTES CHO SYSTEM ---
router.get('/system/profile', isAuthenticated, userController.getProfilePage);
router.post('/system/profile/change-password', isAuthenticated, userController.changePassword);
router.get('/system/users', isAuthenticated, isAdmin, userController.getUserManagerPage);
router.post('/system/users/add', isAuthenticated, isAdmin, userController.addUser);
router.post('/system/users/delete/:id', isAuthenticated, isAdmin, userController.deleteUser);
router.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

module.exports = router;
