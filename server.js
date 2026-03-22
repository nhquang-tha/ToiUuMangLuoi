const express = require('express');
const app = express();
const pageController = require('./controllers/pageController');

app.set('view engine', 'ejs');
app.use(express.static('public')); // Phục vụ file tĩnh (CSS, JS)

// Routes
app.get('/', pageController.getHomePage);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server chạy tại cổng ${PORT}`);
});