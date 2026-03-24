const express = require('express');
const router = express.Router();
const multer = require('multer');
// THÊM isAdmin vào đây
const { isAuthenticated, isAdmin } = require('../middlewares/authMiddleware');
const dashboardController = require('../controllers/dashboardController');
const rfController = require('../controllers/rfController'); 

const upload = multer({ storage: multer.memoryStorage() });

const pages = [
    { path: '/', name: 'Dashboard' },
    { path: '/kpi-analytics', name: 'KPI Analytics' },
    { path: '/poi-report', name: 'POI Report' },
    { path: '/worst-cells', name: 'Worst Cells' },
    { path: '/congestion-3g', name: 'Congestion 3G' },
    { path: '/traffic-down', name: 'Traffic Down' },
    { path: '/scrip', name: 'Scrip' }
];

pages.forEach(page => {
    router.get(page.path, isAuthenticated, dashboardController.renderPage(page.name));
});

// --- ROUTES CHO IMPORT DATA ---
router.get('/import-data', isAuthenticated, dashboardController.getImportPage);
router.post('/import-data', isAuthenticated, upload.single('dataFile'), dashboardController.handleImportData);

// --- ROUTES CHO RF DATABASE (CRUD) ---
router.get('/rf-database', isAuthenticated, rfController.getList);
router.get('/rf-database/:action/:network/:id?', isAuthenticated, rfController.getForm);
router.post('/rf-database/:action/:network/:id?', isAuthenticated, rfController.saveData);
router.post('/rf-database/delete/:network/:id', isAuthenticated, rfController.deleteData);

// Route thực hiện Reset DB (Chỉ Admin mới có quyền)
router.post('/rf-database/reset/:network', isAuthenticated, isAdmin, rfController.resetData);

module.exports = router;
