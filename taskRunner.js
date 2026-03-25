/**
 * taskRunner.js - Smart Task Execution Engine
 * Reads tasks from tasks.json, uses AI vision for element detection
 */

class TaskRunner {
  constructor(state, aiManager, browserManager, telegramBot) {
    this.state = state;
    this.ai = aiManager;
    this.browser = browserManager;
    this.telegram = telegramBot;
  }

  /**
   * Execute one task based on its type
   */
  async execute(task) {
    try {
      switch (task.type) {
        case 'navigate':
          return await this._navigate(task);
        case 'click':
          return await this._click(task);
        case 'type':
          return await this._type(task);
        case 'telegram_mini_app':
          return await this._telegramMiniApp(task);
        case 'ai_guided':
          return await this._aiGuided(task);
        case 'wait':
          await this._sleep(task.duration || 5000);
          return { success: true };
        default:
          return { success: false, error: `Unknown task type: ${task.type}` };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ── Navigate ──────────────────────────────────
  async _navigate(task) {
    await this.browser.navigateTo(task.url, task.waitUntil || 'networkidle2');
    return { success: true };
  }

  // ── Click ─────────────────────────────────────
  async _click(task) {
    if (task.selector) {
      // Direct CSS selector click
      await this.browser.clickSelector(task.selector);
    } else if (task.description) {
      // AI-guided click: take screenshot, ask AI for coordinates
      const screenshot = await this.browser.takeScreenshot();
      const prompt = `Look at this screenshot of a web page (1920x1080 pixels).
Find the element described as: "${task.description}"

Return ONLY valid JSON, no other text:
{"x": <pixel x coordinate>, "y": <pixel y coordinate>, "found": true, "element": "<what you found>"}

If you cannot find it, return:
{"x": 0, "y": 0, "found": false, "element": "not found"}`;

      const aiResult = await this.ai.analyzeScreenshot(screenshot, prompt);
      const coords = this.ai._parseJSON(aiResult.text);

      if (coords && coords.found) {
        console.log(`  [AI] Found "${coords.element}" at (${coords.x}, ${coords.y})`);
        await this.browser.clickAt(coords.x, coords.y);
      } else {
        return { success: false, error: `AI could not find: ${task.description}` };
      }
    } else {
      return { success: false, error: 'Click task needs selector or description' };
    }

    // Optional verification with Pro model
    if (task.verify) {
      return await this._verify(task);
    }

    return { success: true };
  }

  // ── Type ──────────────────────────────────────
  async _type(task) {
    let textToType = task.text;

    // If task says "ask AI what to type"
    if (task.aiPrompt) {
      const screenshot = await this.browser.takeScreenshot();
      const aiResult = await this.ai.analyzeScreenshot(screenshot, task.aiPrompt);
      textToType = aiResult.text.trim();
      console.log(`  [AI] Determined text to type: "${textToType.substring(0, 50)}"`);
    }

    if (!textToType) {
      return { success: false, error: 'No text to type (set "text" or "aiPrompt")' };
    }

    await this.browser.typeText(task.selector, textToType);

    // Press Enter if specified
    if (task.pressEnter) {
      await this.state.page.keyboard.press('Enter');
      await this._sleep(2000);
    }

    return { success: true };
  }

  // ── Telegram Mini App ─────────────────────────
  async _telegramMiniApp(task) {
    // 1. Open Telegram Web
    await this.browser.navigateTo('https://web.telegram.org/k/', 'networkidle2');
    await this._sleep(5000);

    // 2. Search for bot
    if (task.botUsername) {
      console.log(`  [Mini App] Searching for bot: ${task.botUsername}`);

      // Click search area
      const searchScreenshot = await this.browser.takeScreenshot();
      const findSearch = await this.ai.analyzeScreenshot(
        searchScreenshot,
        `Find the search input field or search icon at the top of Telegram Web.
Return ONLY JSON: {"x": number, "y": number, "found": true/false}`
      );

      const searchCoords = this.ai._parseJSON(findSearch.text);
      if (searchCoords && searchCoords.found) {
        await this.browser.clickAt(searchCoords.x, searchCoords.y);
        await this._sleep(1000);

        // Type bot username
        await this.state.page.keyboard.type(task.botUsername, { delay: 80 });
        await this._sleep(3000);

        // Click on the bot in results
        const resultScreenshot = await this.browser.takeScreenshot();
        const findBot = await this.ai.analyzeScreenshot(
          resultScreenshot,
          `Find the chat result for "${task.botUsername}" in the search results list.
Return ONLY JSON: {"x": number, "y": number, "found": true/false}`
        );

        const botCoords = this.ai._parseJSON(findBot.text);
        if (botCoords && botCoords.found) {
          await this.browser.clickAt(botCoords.x, botCoords.y);
          await this._sleep(3000);
        }
      }
    }

    // 3. Launch Mini App (click Play/Open/Start button)
    if (task.launchButton) {
      console.log(`  [Mini App] Looking for "${task.launchButton}" button...`);
      const launchScreenshot = await this.browser.takeScreenshot();
      const findLaunch = await this.ai.analyzeScreenshot(
        launchScreenshot,
        `Find a button labeled "${task.launchButton}" (could be a menu button, keyboard button, or inline button) in the Telegram chat.
Return ONLY JSON: {"x": number, "y": number, "found": true/false}`
      );

      const launchCoords = this.ai._parseJSON(findLaunch.text);
      if (launchCoords && launchCoords.found) {
        await this.browser.clickAt(launchCoords.x, launchCoords.y);
        await this._sleep(5000);
      }
    }

    // 4. Switch to Mini App iframe
    let frame;
    try {
      frame = await this.browser.switchToTelegramMiniApp();
    } catch (err) {
      console.log(`  [Mini App] No iframe found: ${err.message}`);
      // Continue on main page if no iframe
      frame = null;
    }

    // 5. Execute steps inside the mini app
    if (task.steps && Array.isArray(task.steps)) {
      for (const step of task.steps) {
        console.log(`  [Mini App Step] ${step.action}: ${step.description || ''}`);

        if (step.action === 'click' && step.description) {
          const screenshot = await this.browser.takeScreenshot();
          const findEl = await this.ai.analyzeScreenshot(
            screenshot,
            `Find the element: "${step.description}" on this page/app.
Return ONLY JSON: {"x": number, "y": number, "found": true/false}`
          );

          const elCoords = this.ai._parseJSON(findEl.text);
          if (elCoords && elCoords.found) {
            await this.browser.clickAt(elCoords.x, elCoords.y);
          } else {
            console.log(`  [Mini App] Could not find: ${step.description}`);
          }
        } else if (step.action === 'wait') {
          await this._sleep(step.duration || 3000);
        } else if (step.action === 'type' && step.selector && step.text) {
          await this.browser.typeText(step.selector, step.text, frame);
        }

        await this._sleep(step.delay || 2000);
      }
    }

    return { success: true };
  }

  // ── AI-Guided (fully autonomous) ──────────────
  async _aiGuided(task) {
    if (task.url) {
      await this.browser.navigateTo(task.url);
    }

    const screenshot = await this.browser.takeScreenshot();
    const prompt = `${task.aiPrompt || task.description}

Look at this screenshot (1920x1080 pixels). Provide step-by-step actions to complete this task.

Return ONLY valid JSON:
{"steps": [{"action": "click", "x": number, "y": number, "description": "what to click"}, {"action": "type", "text": "text to type", "description": "where to type"}, {"action": "wait", "duration": milliseconds}]}`;

    const aiResult = await this.ai.analyzeScreenshot(screenshot, prompt);
    const instructions = this.ai._parseJSON(aiResult.text);

    if (instructions && instructions.steps && Array.isArray(instructions.steps)) {
      for (const step of instructions.steps) {
        console.log(`  [AI Step] ${step.action}: ${step.description || ''}`);

        if (step.action === 'click' && step.x && step.y) {
          await this.browser.clickAt(step.x, step.y);
        } else if (step.action === 'type' && step.text) {
          await this.state.page.keyboard.type(step.text, { delay: 60 });
        } else if (step.action === 'wait') {
          await this._sleep(step.duration || 2000);
        }

        await this._sleep(1500);
      }
    } else {
      console.log('  [AI] Could not parse steps from AI response');
    }

    // Verify if requested
    if (task.verify) {
      return await this._verify(task);
    }

    return { success: true };
  }

  // ── Verification (Pro model) ──────────────────
  async _verify(task) {
    await this._sleep(2000);
    const screenshot = await this.browser.takeScreenshot();
    const result = await this.ai.verifyTask(
      screenshot,
      task.name,
      task.verify.expected
    );

    const v = result.verification;
    console.log(`  [Verify] Success: ${v.success}, Confidence: ${v.confidence}%`);
    if (v.issues && v.issues.length > 0) {
      console.log(`  [Verify] Issues: ${v.issues.join(', ')}`);
    }

    return {
      success: v.success,
      confidence: v.confidence,
      details: v.details,
    };
  }

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

module.exports = { TaskRunner };
