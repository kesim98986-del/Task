/**
 * autoPilot.js - Full AI Autonomous Engine
 * Give it a URL → AI analyzes page → detects all actions → executes everything
 * Handles: websites, Telegram Mini Apps, login detection, task completion
 */

class AutoPilot {
  constructor(state, aiManager, browserManager, telegramBot, accountManager) {
    this.state = state;
    this.ai = aiManager;
    this.browser = browserManager;
    this.telegram = telegramBot;
    this.accounts = accountManager;
    this.maxSteps = 30; // safety limit per URL
    this.stepDelay = 2000;
  }

  /**
   * Main entry: give URL, bot does everything
   */
  async executeURL(url, options = {}) {
    const isTelegramBot = url.startsWith('https://t.me/') || url.startsWith('@');
    
    if (isTelegramBot) {
      return await this._handleTelegramBot(url, options);
    } else {
      return await this._handleWebsite(url, options);
    }
  }

  /**
   * Handle regular website URL
   */
  async _handleWebsite(url, options) {
    try {
      await this.browser.navigateTo(url);
      await this._sleep(3000);

      let stepsExecuted = 0;
      let lastAction = '';

      for (let step = 0; step < this.maxSteps; step++) {
        // Take screenshot
        const screenshot = await this.browser.takeScreenshot();

        // AI full page analysis
        const analysis = await this._analyzePage(screenshot, lastAction, options);

        if (!analysis) {
          return { success: true, summary: `Completed after ${stepsExecuted} steps. AI found no more actions.` };
        }

        // Check if login is needed
        if (analysis.needsLogin) {
          const loginResult = await this._handleLogin(analysis, screenshot);
          if (!loginResult.success) {
            await this.telegram.notify(`Login needed: ${analysis.loginType}\nBot will use saved session.`);
          }
          stepsExecuted++;
          continue;
        }

        // Check if page is done (no more actionable items)
        if (analysis.pageComplete) {
          return {
            success: true,
            summary: `Page completed! ${stepsExecuted} actions performed.\nFinal state: ${analysis.pageStatus}`,
          };
        }

        // Execute the next action AI recommends
        const actionResult = await this._executeAction(analysis.nextAction);
        lastAction = `${analysis.nextAction.action}: ${analysis.nextAction.description}`;
        stepsExecuted++;

        // Notify on important actions
        if (analysis.nextAction.important) {
          await this.telegram.notify(
            `Step ${stepsExecuted}: ${analysis.nextAction.description}`
          );
        }

        await this._sleep(this.stepDelay);
      }

      return {
        success: true,
        summary: `Reached step limit (${this.maxSteps}). ${stepsExecuted} actions performed.`,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Handle Telegram bot / Mini App
   */
  async _handleTelegramBot(botLink, options) {
    try {
      // Extract bot username
      let botUsername = botLink;
      if (botLink.startsWith('https://t.me/')) {
        botUsername = '@' + botLink.replace('https://t.me/', '').split('/')[0].split('?')[0];
      }
      if (!botUsername.startsWith('@')) {
        botUsername = '@' + botUsername;
      }

      await this.telegram.notify(`Opening Telegram bot: <b>${botUsername}</b>`);

      // Navigate to Telegram Web
      await this.browser.navigateTo('https://web.telegram.org/k/', 'networkidle2');
      await this._sleep(5000);

      // Check if logged in
      const loginCheck = await this.browser.takeScreenshot();
      const isLoggedIn = await this.ai.analyzeScreenshot(
        loginCheck,
        `Is this Telegram Web logged in? Can you see a chat list or contacts?
Return ONLY JSON: {"loggedIn": true/false, "description": "what you see"}`
      );
      const loginStatus = this.ai._parseJSON(isLoggedIn.text);

      if (!loginStatus || !loginStatus.loggedIn) {
        await this.telegram.notify('Telegram Web not logged in. Please login first using /screenshot to guide you, or run locally with HEADLESS=false');
        return { success: false, error: 'Telegram Web not logged in' };
      }

      // Search for bot
      await this._telegramSearch(botUsername);
      await this._sleep(3000);

      // Click on bot in search results
      let screenshot = await this.browser.takeScreenshot();
      const findBot = await this.ai.analyzeScreenshot(
        screenshot,
        `Find "${botUsername}" in the search results or chat list. Click on it.
Return ONLY JSON: {"x": number, "y": number, "found": true/false}`
      );
      const botCoords = this.ai._parseJSON(findBot.text);

      if (botCoords && botCoords.found) {
        await this.browser.clickAt(botCoords.x, botCoords.y);
        await this._sleep(3000);
      }

      // Look for Start / Play / Open / Launch button
      screenshot = await this.browser.takeScreenshot();
      const findAction = await this.ai.analyzeScreenshot(
        screenshot,
        `Look at this Telegram chat. Find any actionable button like "Start", "Play", "Open", "Launch", or any bot menu button. Also look for keyboard buttons at the bottom.
Return ONLY JSON: {"x": number, "y": number, "found": true/false, "buttonText": "what button you found"}`
      );
      const actionCoords = this.ai._parseJSON(findAction.text);

      if (actionCoords && actionCoords.found) {
        await this.telegram.notify(`Found button: "${actionCoords.buttonText}". Clicking...`);
        await this.browser.clickAt(actionCoords.x, actionCoords.y);
        await this._sleep(5000);
      }

      // Check for Mini App iframe
      let frame = null;
      try {
        frame = await this.browser.switchToTelegramMiniApp();
        await this.telegram.notify('Mini App detected! Switching to iframe...');
        await this._sleep(3000);
      } catch {
        // No iframe, continue on main page
      }

      // Now run autonomous loop on whatever is showing
      let stepsExecuted = 0;
      let lastAction = '';

      for (let step = 0; step < this.maxSteps; step++) {
        screenshot = await this.browser.takeScreenshot();

        const analysis = await this._analyzeMiniApp(screenshot, lastAction, options);

        if (!analysis || analysis.pageComplete) {
          return {
            success: true,
            summary: `Mini App done! ${stepsExecuted} actions performed.${analysis ? '\n' + analysis.pageStatus : ''}`,
          };
        }

        if (analysis.nextAction) {
          const result = await this._executeAction(analysis.nextAction);
          lastAction = `${analysis.nextAction.action}: ${analysis.nextAction.description}`;
          stepsExecuted++;

          if (analysis.nextAction.important) {
            await this.telegram.notify(`Step ${stepsExecuted}: ${analysis.nextAction.description}`);
          }
        }

        await this._sleep(this.stepDelay);
      }

      return {
        success: true,
        summary: `Telegram bot task done. ${stepsExecuted} actions performed.`,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * AI analyzes full webpage and decides next action
   */
  async _analyzePage(screenshot, lastAction, options) {
    const context = options.goal ? `USER GOAL: ${options.goal}\n` : '';
    const lastInfo = lastAction ? `LAST ACTION: ${lastAction}\n` : '';

    const prompt = `You are an autonomous web automation bot. Analyze this screenshot (1920x1080).
${context}${lastInfo}
Your job: Find the most important NEXT ACTION to take on this page.

Look for:
- Buttons to click (claim, start, play, submit, confirm, next, continue, follow, like, repost, connect, login)
- Forms to fill
- Links to follow
- Pop-ups or modals to handle (close cookie banners, accept terms)
- Captchas or verification steps
- Login requirements (Google, Twitter, Telegram, email)
- Tasks/missions/quests to complete
- Rewards to claim
- Airdrop actions

Return ONLY valid JSON:
{
  "pageComplete": false,
  "pageStatus": "brief description of current page state",
  "needsLogin": false,
  "loginType": null,
  "nextAction": {
    "action": "click" or "type" or "wait" or "scroll",
    "x": pixel_x,
    "y": pixel_y,
    "text": "text to type if action is type",
    "description": "what this action does",
    "important": true or false
  }
}

If page has no more actions or everything is done:
{"pageComplete": true, "pageStatus": "description of final state"}

If login is needed:
{"needsLogin": true, "loginType": "Google/Twitter/Telegram/Other", "loginButtonX": x, "loginButtonY": y}`;

    try {
      const result = await this.ai.analyzeScreenshot(screenshot, prompt);
      return this.ai._parseJSON(result.text);
    } catch (err) {
      console.error('[AutoPilot] AI analysis failed:', err.message);
      return null;
    }
  }

  /**
   * AI analyzes Mini App / Telegram bot interface
   */
  async _analyzeMiniApp(screenshot, lastAction, options) {
    const lastInfo = lastAction ? `LAST ACTION: ${lastAction}\n` : '';

    const prompt = `You are an autonomous bot inside a Telegram Mini App / Web App. Analyze this screenshot (1920x1080).
${lastInfo}
Find the next action to take. This could be a:
- Tap/click button (claim, start, play, boost, mine, collect, spin, tap)
- Daily check-in / daily reward button
- Task/quest to complete (follow, like, subscribe, join)
- Navigation (go to tasks tab, rewards tab, etc.)
- Close popups/modals/ads
- Scroll to find more content

Return ONLY valid JSON:
{
  "pageComplete": false,
  "pageStatus": "what you see",
  "nextAction": {
    "action": "click" or "wait" or "scroll",
    "x": pixel_x,
    "y": pixel_y,
    "description": "what this does",
    "important": true or false
  }
}

If everything looks done or no actions available:
{"pageComplete": true, "pageStatus": "what final state looks like"}`;

    try {
      const result = await this.ai.analyzeScreenshot(screenshot, prompt);
      return this.ai._parseJSON(result.text);
    } catch (err) {
      console.error('[AutoPilot] Mini App analysis failed:', err.message);
      return null;
    }
  }

  /**
   * Handle login detection - use saved sessions
   */
  async _handleLogin(analysis, screenshot) {
    const loginType = (analysis.loginType || '').toLowerCase();
    console.log(`[AutoPilot] Login detected: ${loginType}`);

    // Try clicking the login button - saved sessions should handle it
    if (analysis.loginButtonX && analysis.loginButtonY) {
      await this.browser.clickAt(analysis.loginButtonX, analysis.loginButtonY);
      await this._sleep(5000);

      // Check if a new tab/popup opened for OAuth
      const pages = await this.state.browser.pages();
      if (pages.length > 1) {
        // Switch to the login popup
        const loginPage = pages[pages.length - 1];
        await loginPage.bringToFront();
        await this._sleep(3000);

        // Take screenshot of login page
        const loginScreenshot = await loginPage.screenshot({ encoding: 'base64', fullPage: false });
        const loginAnalysis = await this.ai.analyzeScreenshot(
          loginScreenshot,
          `This is a login/OAuth page. Is it asking for credentials, or is it showing a "Continue as [name]" or "Allow" button?
Return ONLY JSON: {"hasAutoLogin": true/false, "buttonX": x, "buttonY": y, "description": "what you see"}`
        );
        const parsed = this.ai._parseJSON(loginAnalysis.text);

        if (parsed && parsed.hasAutoLogin) {
          // Click the auto-login / allow button
          await loginPage.mouse.click(parsed.buttonX, parsed.buttonY);
          await this._sleep(5000);
        }

        // Switch back to main page
        if (pages.length > 0) {
          await pages[0].bringToFront();
          await this._sleep(2000);
        }
      }

      return { success: true };
    }

    return { success: false };
  }

  /**
   * Execute a single AI-determined action
   */
  async _executeAction(action) {
    if (!action) return { success: false };

    switch (action.action) {
      case 'click':
        if (action.x && action.y) {
          await this.browser.clickAt(action.x, action.y);
        }
        break;

      case 'type':
        if (action.text) {
          if (action.x && action.y) {
            await this.browser.clickAt(action.x, action.y);
            await this._sleep(500);
          }
          await this.state.page.keyboard.type(action.text, { delay: 50 });
        }
        break;

      case 'scroll':
        await this.state.page.evaluate(() => {
          window.scrollBy(0, 400);
        });
        break;

      case 'wait':
        await this._sleep(action.duration || 3000);
        break;

      default:
        console.log(`[AutoPilot] Unknown action: ${action.action}`);
    }

    await this._sleep(1500);
    return { success: true };
  }

  /**
   * Search for bot in Telegram Web
   */
  async _telegramSearch(query) {
    // Try clicking search area
    const screenshot = await this.browser.takeScreenshot();
    const findSearch = await this.ai.analyzeScreenshot(
      screenshot,
      `Find the search input or search icon at the top of Telegram Web chat list.
Return ONLY JSON: {"x": number, "y": number, "found": true/false}`
    );
    const coords = this.ai._parseJSON(findSearch.text);

    if (coords && coords.found) {
      await this.browser.clickAt(coords.x, coords.y);
      await this._sleep(1000);
      await this.state.page.keyboard.type(query.replace('@', ''), { delay: 80 });
      await this._sleep(2000);
    }
  }

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

module.exports = { AutoPilot };
