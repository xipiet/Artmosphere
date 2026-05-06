// Headless renderer for the wall composite ("main_canvas.png").
// Boots one Chromium instance + one persistent /main page at server startup.
// That page connects via socket.io like a real display computer would, so it
// stays in sync with newImage events automatically. On finalize, we just take
// a screenshot of that page — no animation-state duplication needed.
//
// Why this design:
// - The dedicated wall PC is for projection only. Screenshot reliability must
//   not depend on it being focused, awake, or even online.
// - The screenshot doesn't need to match the wall pixel-by-pixel — visitors
//   want "my drawing in the scene with the others, like the wall is right
//   now-ish". A second browser rendering the same /main code with random
//   spawn positions delivers exactly that.

const puppeteer = require('puppeteer');

let browser = null;
let page = null;
let pageUrl = null;
let bootingPromise = null;

async function ensureReady(url) {
  if (page && pageUrl === url) return page;
  if (bootingPromise) return bootingPromise;

  bootingPromise = (async () => {
    try {
      if (!browser) {
        browser = await puppeteer.launch({
          headless: 'new',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--hide-scrollbars',
            '--mute-audio'
          ]
        });
        browser.on('disconnected', () => {
          console.warn('[renderer] browser disconnected');
          browser = null;
          page = null;
          pageUrl = null;
        });
      }

      const newPage = await browser.newPage();
      await newPage.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      // Pipe console errors so we notice if /main is broken inside headless
      newPage.on('pageerror', err => console.warn('[renderer/page] error:', err.message));

      await newPage.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
      // Give the animation loop a moment so first frame is non-empty
      await new Promise(r => setTimeout(r, 500));

      if (page) {
        try { await page.close(); } catch (_) { /* ignore */ }
      }
      page = newPage;
      pageUrl = url;
      console.log('[renderer] headless /main page ready:', url);
      return page;
    } finally {
      bootingPromise = null;
    }
  })();

  return bootingPromise;
}

// Capture the current state of the headless /main page. Returns a PNG Buffer,
// or null on failure (caller falls back to "no main_canvas.png").
async function captureMainScreenshot(url, { settleMs = 250 } = {}) {
  try {
    const p = await ensureReady(url);
    if (settleMs > 0) await new Promise(r => setTimeout(r, settleMs));
    return await p.screenshot({ type: 'png', fullPage: false });
  } catch (err) {
    console.error('[renderer] screenshot failed:', err.message);
    // If the page died, drop our handle so the next call rebuilds it
    page = null;
    pageUrl = null;
    return null;
  }
}

// Generic one-shot capture in a temporary tab. Reuses the running Chromium so
// callers don't pay the boot cost. The persistent /main page is left alone.
async function capturePage(url, { settleMs = 250, viewport = { width: 1080, height: 1320 } } = {}) {
  if (!browser) await ensureReady(url);
  const tmp = await browser.newPage();
  try {
    await tmp.setViewport({ ...viewport, deviceScaleFactor: 1 });
    tmp.on('pageerror', err => console.warn('[renderer/tmp] error:', err.message));
    await tmp.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
    await tmp.waitForFunction(() => document.body.dataset.ready === '1', { timeout: 5000 }).catch(() => {});
    if (settleMs > 0) await new Promise(r => setTimeout(r, settleMs));
    return await tmp.screenshot({ type: 'png', fullPage: false });
  } catch (err) {
    console.error('[renderer] capturePage failed:', err.message);
    return null;
  } finally {
    try { await tmp.close(); } catch (_) {}
  }
}

async function shutdown() {
  try { if (page) await page.close(); } catch (_) {}
  try { if (browser) await browser.close(); } catch (_) {}
  page = null;
  pageUrl = null;
  browser = null;
}

module.exports = { ensureReady, captureMainScreenshot, capturePage, shutdown };
