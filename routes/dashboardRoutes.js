const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middlewares/authMiddleware');

// Danh sách các menu
const pages = [
    { path: '/', name: 'Dashboard' },
    { path: '/kpi-analytics', name: 'KPI Analytics' },
    { path: '/rf-database', name: 'RF Database' },
    { path: '/poi-report', name: 'POI Report' },
    { path: '/worst-cells', name: 'Worst Cells' },
    { path: '/congestion-3g', name: 'Congestion 3G' },
    { path: '/traffic-down', name: 'Traffic Down' },
    { path: '/scrip', name: 'Scrip' },
    { path: '/import-data', name: 'Import Data' }
];

// Tạo tự động các route dựa trên danh sách menu
pages.forEach(page => {
    router.get(page.path, isAuthenticated, (req, res) => {
        res.render('dashboard', { title: page.name, page: page.name });
    });
});

module.exports = router;
