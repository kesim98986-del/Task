/**
 * browserManager.js - Puppeteer-Extra Stealth Browser Manager
 * Persistent sessions, headless mode, iframe handling
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');

// Apply stealth BEFORE any launch
puppeteer.use(StealthPlugin());

class BrowserManager {
  constructor() {
    this.browser = null;
    this.page = null;
    this.userDataDir = process.env.USER_DATA_DIR || path.join(__dirname, 'user_data');

    // Ensure directory exists
    if (!fs.existsSync(this.userDataDir)) {
      fs.mkdirSync(this.userDataDir, { recursive: true });
    }
  }

  /**
   * Launch Chromium with stealth and persistent profile
   */
  async launch() {
    const isHeadless = process.env.HEADLESS !== 'false';

    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--window-size=1920,1080',
      '--disable-blink-features=AutomationControlled',
    ];

    // Single process only in Docker/Railway
    if (process.env.RAILWAY_ENVIRONMENT || process.env.DOCKER) {
      args.push('--single-process');
    }

    const launchOptions = {
      headless: isHeadless ? 'new' : false,
      userDataDir: this.userDataDir,
      args,
      defaultViewport: { width: 1920, height: 1080 },
      timeout: 60000,
    };

    // Use system Chromium if path is set (Railway/Docker)
    if (process.env.CHROMIUM_PATH) {
      launchOptions.executablePath = process.env.CHROMIUM_PATH;
    } else if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    console.log('[Browser] Launching with stealth plugin...');
    console.log(`[Browser] Headless: ${isHeadless}`);
    console.log(`[Browser] User data: ${this.userDataDir}`);

    this.browser = await puppeteer.launch(launchOptions);
    this.page = await this.browser.newPage();

    // Realistic user agent
    await this.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );

    // Extra stealth tweaks
    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
      if (!window.chrome) window.chrome = {};
      window.chrome.runtime = {};
    });

    console.log('[Browser] Ready');
    return { browser: this.browser, page: this.page };
  }

  /**
   * Take screenshot as base64 string
   */
  async takeScreenshot(targetPage = null) {
    const pg = targetPage || this.page;
    if (!pg) throw new Error('No page available for screenshot');

    const buffer = await pg.screenshot({
      encoding: 'base64',
      fullPage: false,
      type: 'png',
    });
    return buffer;
  }

  /**
   * Navigate to URL
   */
  async navigateTo(url, waitUntil = 'networkidle2') {
    console.log(`[Browser] Navigating to: ${url}`);
    await this.page.goto(url, {
      waitUntil: waitUntil,
      timeout: 60000,
    });
    await this._sleep(2000);
    console.log(`[Browser] Loaded: ${this.page.url()}`);
  }

  /**
   * Find and switch to Telegram Mini App iframe
   */
  async switchToTelegramMiniApp() {
    console.log('[Browser] Looking for Mini App iframe...');
    // Wait for iframes to load
    await this._sleep(3000);

    const frames = this.page.frames();
    console.log(`[Browser] Found ${frames.length} frames`);

    for (const frame of frames) {
      const url = frame.url();
      if (url === 'about:blank' || url === '') continue;
      if (frame === this.page.mainFrame()) continue;

      // Telegram Mini App iframes usually have specific patterns
      if (
        url.includes('tgWebAppData') ||
        url.includes('web_app') ||
        !url.includes('telegram.org')
      ) {
        console.log(`[Browser] Found Mini App iframe: ${url.substring(0, 80)}...`);
        return frame;
      }
    }

    // Fallback: first non-main, non-blank frame
    for (const frame of frames) {
      if (frame !== this.page.mainFrame() && frame.url() !== 'about:blank') {
        console.log(`[Browser] Using fallback iframe: ${frame.url().substring(0, 80)}`);
        return frame;
      }
    }

    throw new Error('No Mini App iframe found');
  }

  /**
   * Click at specific pixel coordinates
   */
  async clickAt(x, y) {
    console.log(`[Browser] Clicking at (${x}, ${y})`);
    await this.page.mouse.click(Math.round(x), Math.round(y));
    await this._sleep(1500);
  }

  /**
   * Click element by CSS selector
   */
  async clickSelector(selector, frame = null) {
    const target = frame || this.page;
    console.log(`[Browser] Clicking selector: ${selector}`);
    await target.waitForSelector(selector, { timeout: 10000 });
    await target.click(selector);
    await this._sleep(1500);
  }

  /**
   * Type text into input
   */
  async typeText(selector, text, frame = null) {
    const target = frame || this.page;
    console.log(`[Browser] Typing into: ${selector}`);
    await target.waitForSelector(selector, { timeout: 10000 });
    await target.click(selector, { clickCount: 3 }); // Select existing text
    await target.type(selector, text, { delay: 50 + Math.random() * 50 });
  }

  /**
   * Get current page URL
   */
  getCurrentUrl() {
    return this.page ? this.page.url() : 'N/A';
  }

  /**
   * Close browser
   */
  async close() {
    if (this.browser) {
      console.log('[Browser] Closing...');
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

module.exports = { BrowserManager };
