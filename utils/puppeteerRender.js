/**
 * puppeteerRender.js
 * Renders an HTML string to a PNG buffer using headless Chromium via Puppeteer.
 *
 * All requires are lazy (inside the function) so this module never crashes the
 * server if Puppeteer is not installed.
 *
 * If Puppeteer is unavailable, `renderHtmlToPng` throws — callers should
 * catch and fall back to the SVG overlay method.
 */

/**
 * renderHtmlToPng
 * @param {string} html       - Full HTML document string
 * @param {number} width      - Viewport / output width in px
 * @param {number} height     - Viewport / output height in px
 * @returns {Promise<Buffer>} PNG image buffer
 */
async function renderHtmlToPng(html, width, height) {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (e) {
    throw new Error('Puppeteer not installed. Run: npm install puppeteer in the backend folder. (' + e.message + ')');
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
    ],
  });

  try {
    const page = await browser.newPage();

    await page.setViewport({
      width:  Math.round(width),
      height: Math.round(height),
      deviceScaleFactor: 1,
    });

    // Load the full HTML (base64 background is inline, no network calls)
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 });

    // Screenshot the exact canvas area
    const screenshot = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: Math.round(width), height: Math.round(height) },
    });

    console.log(`[puppeteer] Rendered ${width}x${height} PNG (${Math.round(screenshot.length / 1024)}KB)`);
    return Buffer.from(screenshot);
  } finally {
    await browser.close();
  }
}

module.exports = { renderHtmlToPng };
