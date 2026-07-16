const express = require('express');
const router = express.Router();
const multer = require('multer');

const { isAuthenticated, isAdmin } = require('../middlewares/authMiddleware');

const dashboardController = require('../controllers/dashboardController');
const rfController = require('../controllers/rfController'); 
const userController = require('../controllers/userController');
const mapController = require('../controllers/mapController'); 
const scriptController = require('../controllers/scriptController'); 

let kpiController = null;
try { kpiController = require('../controllers/kpiController'); } catch(e) {}

const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } 
});

const pages = [
    { path: '/', name: 'Dashboard' },
    { path: '/poi-report', name: 'POI Report' },
    { path: '/worst-cells', name: 'Worst Cells' },
    { path: '/congestion-3g', name: 'Congestion 3G' },
    { path: '/traffic-down', name: 'Traffic Down' },
    { path: '/downtilt-coverage', name: 'Downtilt Coverage' },
    { path: '/bad-cells', name: 'Bad Cells' } // Thêm trang Bad Cells vào mảng
];

pages.forEach(page => {
    router.get(page.path, isAuthenticated, dashboardController.renderPage(page.name));
});

router.get('/scrip', isAuthenticated, scriptController.getScriptPage);
router.post('/scrip', isAuthenticated, upload.none(), scriptController.generateScript);

router.get('/gis-map', isAuthenticated, mapController.getMapPage);
router.get('/api/gis-data', isAuthenticated, mapController.getMapData);
router.get('/api/ta-data', isAuthenticated, mapController.getTAData); 
router.get('/api/csht-data', isAuthenticated, mapController.getCshtData);

if (kpiController) {
    if (kpiController.getKpiAnalyticsPage) router.get('/kpi-analytics', isAuthenticated, kpiController.getKpiAnalyticsPage);
    if (kpiController.getQoeQosAnalyticsPage) router.get('/qoe-qos-analytics', isAuthenticated, kpiController.getQoeQosAnalyticsPage);
    if (kpiController.getOptimizingPage) router.get('/optimizing-qoe-qos', isAuthenticated, kpiController.getOptimizingPage);
    if (kpiController.getOptimizingData) router.get('/api/optimizing-data', isAuthenticated, kpiController.getOptimizingData);
}

router.get('/import-data', isAuthenticated, isAdmin, dashboardController.getImportPage);
router.post('/import-data', isAuthenticated, isAdmin, upload.array('dataFiles', 50), dashboardController.handleImportData);
router.post('/import-data/reset/:table', isAuthenticated, isAdmin, dashboardController.resetImportedData);

router.post('/kpi-data/reset/:network', isAuthenticated, isAdmin, async (req, res) => {
    const db = require('../models/db');
    const net = req.params.network;
    if(['3g', '4g', '5g'].includes(net)) {
        try { await db.query(`TRUNCATE TABLE kpi_${net}`); } catch(e) { console.error(e); }
    }
    res.redirect('/import-data');
});

router.get('/rf-database', isAuthenticated, rfController.getList);
router.get('/rf-database/export', isAuthenticated, rfController.exportData); 
router.get('/rf-database/:action/:network/:id?', isAuthenticated, rfController.getForm);
router.post('/rf-database/:action/:network/:id?', isAuthenticated, isAdmin, rfController.saveData);
router.post('/rf-database/delete/:network/:id', isAuthenticated, isAdmin, rfController.deleteData);
router.post('/rf-database/reset/:network', isAuthenticated, isAdmin, rfController.resetData);

router.get('/api/dashboard-data', isAuthenticated, dashboardController.getDashboardData);
router.get('/api/districts', isAuthenticated, dashboardController.getDistricts); 

router.get('/api/worst-cells-data', isAuthenticated, dashboardController.getWorstCellsData);
router.get('/api/congestion-3g-data', isAuthenticated, dashboardController.getCongestion3gData);
router.get('/api/traffic-down-data', isAuthenticated, dashboardController.getTrafficDownData);

// Khai báo API riêng cho Bad Cells
router.get('/api/bad-cells-data', isAuthenticated, dashboardController.getBadCellsData);
router.post('/api/bad-cells-update', isAuthenticated, dashboardController.updateBadCellStatus);

router.get('/api/poi-list', isAuthenticated, dashboardController.getPoiList);
router.get('/api/export-all-poi', isAuthenticated, dashboardController.getAllPoiExportData);
router.get('/api/poi-data', isAuthenticated, dashboardController.getPoiData);

router.get('/api/kpi-data', isAuthenticated, dashboardController.getKpiData);
router.get('/api/qoe-qos-data', isAuthenticated, dashboardController.getQoeQosData);
router.get('/api/qoe-qos-list-all', isAuthenticated, dashboardController.getQoeQosListAll);
router.post('/api/save-cell-note', isAuthenticated, dashboardController.saveCellNote);

router.get('/system/profile', isAuthenticated, userController.getProfilePage);
router.post('/system/profile/change-password', isAuthenticated, userController.changePassword);
router.get('/system/users', isAuthenticated, isAdmin, userController.getUserManagerPage);
router.post('/system/users/add', isAuthenticated, isAdmin, userController.addUser);
router.post('/system/users/delete/:id', isAuthenticated, isAdmin, userController.deleteUser);

router.get('/logout', (req, res) => { 
    req.session.destroy(); 
    res.redirect('/login'); 
});

module.exports = router;
