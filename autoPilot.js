/**
 * autoPilot.js - Full AI Autonomous Engine
 * Give it a URL -> AI analyzes page -> detects all actions -> executes everything
 * Handles: websites, Telegram Mini Apps, login detection, task completion
 */

const { MiniAppEngine } = require('./miniAppEngine.js');

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

      return { success: true, summary: `${stepsExecuted} actions performed. Max steps reached.` };
    } catch (err) {
      console.error('[AutoPilot] Error:', err);
      return { success: false, error: err.message };
    }
  }

  async _analyzePage(screenshot, lastAction, options) {
    // This is where AI logic resides to decide what to do next
    // Placeholder for AI analysis logic
    return null; 
  }

  async _handleLogin(analysis, screenshot) {
    // Placeholder for login handling logic
    return { success: false };
  }

  async _executeAction(action) {
    // Placeholder for action execution logic
    return { success: true };
  }

  async _handleTelegramBot(url, options) {
    // Use the MiniAppEngine for Telegram-specific bots
    const engine = new MiniAppEngine(this.state, this.ai, this.browser, this.telegram, this);
    return await engine.run(options);
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = { AutoPilot };
