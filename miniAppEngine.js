/**
 * miniAppEngine.js - Telegram Mini App Specialist
 *
 * Handles TWO modes automatically detected from the page:
 *
 *  MODE A — TAP-TO-EARN (Hamster Kombat, Blum, TapSwap, Notcoin, etc.)
 *    • Detects main tap target (big coin/character in center)
 *    • Runs configurable rapid-tap loop with energy monitoring
 *    • Collects daily bonus, boosts, and passive income
 *    • Stops when energy is depleted or timer says "come back later"
 *
 *  MODE B — TASK / QUEST BOT (join channel, follow Twitter, watch video, etc.)
 *    • Scans task list, finds unfinished tasks
 *    • For each task: reads what's required, opens link if needed, marks done
 *    • Handles "verify" / "check" buttons after completing external tasks
 *    • Reports each completed task back to Telegram
 *
 *  AUTO-DETECT: First screenshot → AI classifies which mode to use.
 *  HYBRID: Many bots have both → runs tap loop first, then task list.
 */

class MiniAppEngine {
  constructor(state, aiManager, browserManager, telegramBot, clickEngine) {
    this.state       = state;
    this.ai          = aiManager;
    this.browser     = browserManager;
    this.telegram    = telegramBot;
    this.clicker     = clickEngine;

    // Tap-to-earn config (can be overridden per-bot via tasks.json options)
    this.tapConfig = {
      maxTaps:        500,   // safety limit per session
      tapDelay:       80,    // ms between taps (fast enough to not miss frames)
      energyCheckEvery: 50,  // check energy every N taps
      tapSpreadRadius: 20,   // px jitter around tap center (looks human)
    };
  }

  /**
   * Main entry — auto-detects mode and runs the right strategy.
   */
  async run(options = {}) {
    const screenshot = await this.browser.takeScreenshot();
    const mode       = await this._detectMode(screenshot, options);

    await this.telegram.notify(`Mini App mode: <b>${mode.toUpperCase()}</b>`);
    console.log(`[MiniApp] Detected mode: ${mode}`);

    let results = { taps: 0, tasks: 0, errors: 0 };

    if (mode === 'tap' || mode === 'both') {
      const tapResult = await this._runTapLoop(options);
      results.taps    = tapResult.taps;
      results.errors += tapResult.errors;
    }

    if (mode === 'tasks' || mode === 'both') {
      const taskResult = await this._runTaskLoop(options);
      results.tasks   = taskResult.completed;
      results.errors += taskResult.errors;
    }

    if (mode === 'unknown') {
      // Fall back to generic autopilot-style scan
      return { success: false, summary: 'Unknown mini app type — use generic AutoPilot instead' };
    }

    return {
      success: true,
      summary: `Mini App done.\nTaps: ${results.taps} | Tasks: ${results.tasks} | Errors: ${results.errors}`,
    };
  }

  // ── Mode detection ────────────────────────────────────────────────────────

  async _detectMode(screenshot, options) {
    if (options.mode) return options.mode; // caller can force a mode

    try {
      const result = await this.ai.analyzeScreenshot(
        screenshot,
        `Analyze this Telegram Mini App screenshot and classify it.

Look for:
- A large tappable element (coin, character, planet, button in center) → "tap"
- A list of tasks/quests/missions (join channel, follow Twitter, etc.) → "tasks"
- Both of the above → "both"
- Something else entirely → "unknown"

Return ONLY valid JSON:
{"mode": "tap" | "tasks" | "both" | "unknown", "reason": "brief explanation", "tapTargetVisible": true/false, "taskListVisible": true/false}`
      );
      const parsed = this.ai._parseJSON(result.text);
      return parsed?.mode || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  // ── TAP-TO-EARN loop ──────────────────────────────────────────────────────

  async _runTapLoop(options = {}) {
    console.log('[MiniApp] Starting tap loop...');
    const cfg = { ...this.tapConfig, ...(options.tapConfig || {}) };

    // Find tap target coordinates
    const tapTarget = await this._findTapTarget();
    if (!tapTarget) {
      console.warn('[MiniApp] Could not find tap target');
      return { taps: 0, errors: 1 };
    }

    console.log(`[MiniApp] Tap target: (${tapTarget.x}, ${tapTarget.y})`);
    await this.telegram.notify(`🎮 Tap target found at (${tapTarget.x},${tapTarget.y}). Starting taps...`);

    let taps   = 0;
    let errors = 0;

    // Handle daily bonus/popup before tapping
    await this._dismissPopups();

    while (taps < cfg.maxTaps) {
      // Check energy every N taps
      if (taps > 0 && taps % cfg.energyCheckEvery === 0) {
        const energyStatus = await this._checkEnergy();
        if (energyStatus.depleted) {
          await this.telegram.notify(`⚡ Energy depleted after ${taps} taps. Stopping.`);
          console.log(`[MiniApp] Energy depleted at ${taps} taps`);
          break;
        }
        if (energyStatus.comeBackLater) {
          await this.telegram.notify(`⏰ Bot says come back later. Stopping after ${taps} taps.`);
          break;
        }
        console.log(`[MiniApp] ${taps} taps done. Energy: ${energyStatus.level ?? '?'}`);
      }

      // Apply small random jitter to look human
      const jx = tapTarget.x + Math.round((Math.random() - 0.5) * cfg.tapSpreadRadius);
      const jy = tapTarget.y + Math.round((Math.random() - 0.5) * cfg.tapSpreadRadius);

      try {
        await this.browser.page.mouse.click(jx, jy);
        taps++;
      } catch (err) {
        errors++;
        console.warn(`[MiniApp] Tap error at ${taps}:`, err.message);
        if (errors > 10) break; // page probably crashed
      }

      await this._sleep(cfg.tapDelay);
    }

    // After tapping — check for rewards/collection popup
    await this._collectRewards();

    console.log(`[MiniApp] Tap loop done. Taps: ${taps}`);
    return { taps, errors };
  }

  async _findTapTarget() {
    const screenshot = await this.browser.takeScreenshot();
    try {
      const result = await this.ai.analyzeScreenshot(
        screenshot,
        `Find the main tappable element in this tap-to-earn game.
This is usually a large coin, character, planet, or glowing button in the center of the screen.

Return ONLY valid JSON:
{"x": pixel_x, "y": pixel_y, "found": true/false, "description": "what you see"}`
      );
      const parsed = this.ai._parseJSON(result.text);
      if (parsed?.found && parsed.x && parsed.y) return { x: parsed.x, y: parsed.y };
    } catch (err) {
      console.warn('[MiniApp] _findTapTarget failed:', err.message);
    }
    return null;
  }

  async _checkEnergy() {
    try {
      const screenshot = await this.browser.takeScreenshot();
      const result     = await this.ai.analyzeScreenshot(
        screenshot,
        `Check energy/stamina/fuel status in this tap-to-earn app.
Look for: energy bar, number like "1200/3000", text like "come back later", "no energy", "recharge".

Return ONLY valid JSON:
{"depleted": false, "comeBackLater": false, "level": "current/max or null if not visible"}`
      );
      return this.ai._parseJSON(result.text) || { depleted: false, comeBackLater: false };
    } catch {
      return { depleted: false, comeBackLater: false };
    }
  }

  async _collectRewards() {
    await this._sleep(2000);
    try {
      const screenshot = await this.browser.takeScreenshot();
      const result     = await this.ai.analyzeScreenshot(
        screenshot,
        `Is there a reward popup, "Collect", "Claim", "OK", or "Continue" button visible?
Return ONLY valid JSON: {"found": true/false, "x": number, "y": number, "buttonText": "..."}`
      );
      const parsed = this.ai._parseJSON(result.text);
      if (parsed?.found) {
        await this.clicker.smartClick({ x: parsed.x, y: parsed.y, description: parsed.buttonText });
      }
    } catch { /* optional */ }
  }

  // ── TASK / QUEST loop ─────────────────────────────────────────────────────

  async _runTaskLoop(options = {}) {
    console.log('[MiniApp] Starting task loop...');
    let completed = 0;
    let errors    = 0;
    let attempts  = 0;
    const maxAttempts = 20;

    // Navigate to tasks section first
    await this._navigateToTasksTab();
    await this._sleep(2000);

    while (attempts < maxAttempts) {
      attempts++;

      const screenshot = await this.browser.takeScreenshot();
      const taskList   = await this._scanTaskList(screenshot);

      if (!taskList || taskList.length === 0) {
        console.log('[MiniApp] No more tasks found');
        break;
      }

      // Find first incomplete task
      const nextTask = taskList.find((t) => !t.completed);
      if (!nextTask) {
        await this.telegram.notify(`✅ All visible tasks completed! (${completed} done this session)`);
        break;
      }

      console.log(`[MiniApp] Task: "${nextTask.title}" — ${nextTask.action}`);
      const result = await this._executeTask(nextTask);

      if (result.success) {
        completed++;
        await this.telegram.notify(`✔ Task done: <b>${nextTask.title}</b>`);
      } else {
        errors++;
        console.warn(`[MiniApp] Task failed: ${nextTask.title} — ${result.reason}`);
      }

      await this._sleep(3000);
    }

    return { completed, errors };
  }

  async _navigateToTasksTab() {
    try {
      const screenshot = await this.browser.takeScreenshot();
      const result     = await this.ai.analyzeScreenshot(
        screenshot,
        `Find a "Tasks", "Quests", "Earn", or "Missions" tab/button in the navigation.
Return ONLY valid JSON: {"found": true/false, "x": number, "y": number, "label": "..."}`
      );
      const parsed = this.ai._parseJSON(result.text);
      if (parsed?.found) {
        await this.clicker.smartClick({
          x: parsed.x, y: parsed.y, description: parsed.label,
        });
        await this._sleep(2000);
      }
    } catch { /* stay on current tab */ }
  }

  async _scanTaskList(screenshot) {
    try {
      const result = await this.ai.analyzeScreenshot(
        screenshot,
        `Scan this Telegram Mini App task list. Find all visible tasks/quests.

For each task, determine:
- title: task name
- completed: true if it shows a checkmark, "Done", "Claimed", or greyed out
- action: what needs to be done ("join channel", "follow twitter", "watch video", "invite friends", etc.)
- reward: reward amount if visible
- buttonX, buttonY: coordinates of the "Go", "Start", "Do", or action button

Return ONLY valid JSON array:
[{"title": "...", "completed": false, "action": "...", "reward": "...", "buttonX": number, "buttonY": number}]

Return [] if no tasks are visible.`
      );
      return this.ai._parseJSON(result.text) || [];
    } catch {
      return [];
    }
  }

  async _executeTask(task) {
    try {
      // Click the task's action button
      const clickResult = await this.clicker.smartClick({
        x:           task.buttonX,
        y:           task.buttonY,
        description: task.title,
      });

      if (!clickResult.success) {
        return { success: false, reason: 'Could not click task button' };
      }

      await this._sleep(3000);

      // Handle external links (opens new tab for Telegram channel / Twitter)
      if (this.state.browser) {
        const pages = await this.state.browser.pages();
        if (pages.length > 1) {
          // External page opened — switch to it briefly then close
          const extPage = pages[pages.length - 1];
          console.log(`[MiniApp] External task page: ${extPage.url()}`);
          await this._sleep(3000);
          await extPage.close();
          await this._sleep(1000);
          // Bring main page back to front
          await pages[0].bringToFront();
          await this._sleep(2000);
        }
      }

      // Look for Verify / Check / Claim button after completing external action
      const screenshot     = await this.browser.takeScreenshot();
      const verifyResult   = await this.ai.analyzeScreenshot(
        screenshot,
        `After completing a task, is there a "Verify", "Check", "Claim", "Done", or "Confirm" button visible?
Return ONLY valid JSON: {"found": true/false, "x": number, "y": number, "buttonText": "..."}`
      );
      const verifyParsed = this.ai._parseJSON(verifyResult.text);

      if (verifyParsed?.found) {
        await this.clicker.smartClick({
          x:           verifyParsed.x,
          y:           verifyParsed.y,
          description: verifyParsed.buttonText,
        });
        await this._sleep(2000);
      }

      return { success: true };
    } catch (err) {
      return { success: false, reason: err.message };
    }
  }

  // ── Popup handling ────────────────────────────────────────────────────────

  async _dismissPopups() {
    try {
      const screenshot = await this.browser.takeScreenshot();
      const result     = await this.ai.analyzeScreenshot(
        screenshot,
        `Is there a popup, daily bonus dialog, welcome screen, or ad overlay blocking the main content?
Return ONLY valid JSON: {"found": true/false, "x": number, "y": number, "description": "..."}`
      );
      const parsed = this.ai._parseJSON(result.text);
      if (parsed?.found) {
        console.log(`[MiniApp] Dismissing popup: ${parsed.description}`);
        await this.clicker.smartClick({ x: parsed.x, y: parsed.y, description: parsed.description });
        await this._sleep(2000);
      }
    } catch { /* no popup, continue */ }
  }

  _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
}

module.exports = { MiniAppEngine };
