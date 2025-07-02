const express = require('express');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const NodeCache = require('node-cache');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs/promises');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const scrapeRouter = require('./scripts/scrape');
const findidRouter = require('./scripts/findid');
const steamRouter = require('./scripts/steam');

// Allow 1 request every 3 seconds per IP to /steam
const steamLimiter = rateLimit({
    windowMs: 3 * 1000, // 3 seconds
    max: 1, // limit each IP to 1 request per windowMs
    message: {
        status: 429,
        error: 'Too many requests, please wait 3 seconds before trying again.'
    }
});

app.use('/steam', steamLimiter, steamRouter);

app.use(scrapeRouter);
app.use(findidRouter);

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});