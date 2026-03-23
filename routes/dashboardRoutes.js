const express = require('express');
const router = express.Router();
const multer = require('multer');
const { isAuthenticated } = require('../middlewares/authMiddleware');
const dashboardController = require('../controllers/dashboardController');

// Cấu hình Multer để lưu file tạm vào bộ nhớ (RAM)
const upload = multer({ storage: multer.memoryStorage() });

// Các menu tĩnh mặc định
const pages = [
    { path: '/', name: 'Dashboard' },
    { path: '/kpi-analytics', name: 'KPI Analytics' },
    { path: '/rf-database', name: 'RF Database' },
    { path: '/poi-report', name: 'POI Report' },
    { path: '/worst-cells', name: 'Worst Cells' },
    { path: '/congestion-3g', name: 'Congestion 3G' },
    { path: '/traffic-down', name: 'Traffic Down' },
    { path: '/scrip', name: 'Scrip' }
];

pages.forEach(page => {
    router.get(page.path, isAuthenticated, dashboardController.renderPage(page.name));
});

// Xử lý riêng trang Import Data
router.get('/import-data', isAuthenticated, dashboardController.getImportPage);
router.post('/import-data', isAuthenticated, upload.single('dataFile'), dashboardController.handleImportData);

module.exports = router;
