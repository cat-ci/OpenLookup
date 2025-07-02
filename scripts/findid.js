const express = require('express');
const puppeteer = require('puppeteer');

const PORT = process.env.PORT || 3000;
const router = express.Router();

router.get('/findid', async (req, res) => {
  const userInput = req.query.user;
  if (!userInput) {
    return res.status(400).json({ error: 'Missing user parameter' });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.goto('https://steamid.xyz/', { waitUntil: 'networkidle2' });

    await page.type('input[name="id"]', userInput);
    await Promise.all([
      page.click('input[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
    ]);

    await page.waitForSelector('#guide table', { timeout: 10000 });

    const data = await page.evaluate(() => {
      const getAttr = (selector, attr) => {
        const el = document.querySelector(selector);
        return el ? el.getAttribute(attr) : null;
      };

      const getValueAfterLabel = (label) => {
        const iTags = Array.from(document.querySelectorAll('#guide i'));
        const iTag = iTags.find(
          (i) => i.textContent.trim().replace(':', '') === label
        );
        if (iTag && iTag.nextSibling) {
          let val = iTag.nextSibling.textContent
            ? iTag.nextSibling.textContent.trim()
            : iTag.nextSibling.nodeValue.trim();
          return val.replace(/^\s*|\s*$/g, '');
        }
        return '';
      };

      const rows = Array.from(
        document.querySelectorAll('#guide table tr')
      ).map((tr) => {
        const tds = tr.querySelectorAll('td');
        return {
          key: tds[0]?.textContent.trim().toLowerCase(),
          value: tds[1]?.textContent.trim(),
        };
      });

      const getRow = (key) =>
        rows.find((r) => r.key && r.key.includes(key))?.value || '';

      return {
        avatar: getAttr('#guide img.avatar', 'src'),
        realName: getValueAfterLabel('Real Name'),
        country: getValueAfterLabel('Country'),
        accountCreated: getValueAfterLabel('Account Created'),
        lastLogoff: getValueAfterLabel('Last Logoff'),
        status: getValueAfterLabel('Status'),
        visibility: getValueAfterLabel('Visibility'),
        steamID: getRow('steam id'),
        steamID3: getRow('steam id3'),
        steam32: getRow('steam32'),
        steam64: getRow('steam64'),
        profileURL: getRow('profile url'),
        profilePermalink: getRow('permalink'),
      };
    });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

module.exports = router;