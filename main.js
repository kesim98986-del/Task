/**
 * main.js - Automation Master Bot v2.0
 * FIXED:
 *  - state.page now kept in sync with browserManager.page (single source of truth)
 *  - Graceful shutdown handles both SIGINT and SIGTERM
 *  - Task queue loop checks state.isRunning before each task
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const { BrowserManager }      = require('./browserManager');
const { AIManager }            = require('./aiManager');
const { TelegramBotController } = require('./telegramBot');
const { AutoPilot }            = require('./autoPilot');
const { AccountManager }       = require('./accountManager');

const state = {
  browser:        null,
  page:           null,   // kept in sync with browserManager.page
  isRunning:      false,
  isBusy:         false,
  currentTask:    null,
  completedTasks: 0,
  failedTasks:    0,
  startTime:      null,
  taskQueue:      [],
};

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  console.log('');
  console.log('=============================================');
  console.log('  AUTOMATION MASTER BOT v2.0');
  console.log('  Full AI Autonomous Mode');
  console.log('  Puppeteer Stealth + Gemini AI + Telegram');
  console.log('=============================================');
  console.log('');

  state.startTime = new Date();

  // 1. AI Manager
  const aiManager = new AIManager();
  if (aiManager.getKeyCount() === 0) {
    console.error('[FATAL] No Gemini API keys. Set GEMINI_API_KEY_1 in .env');
    process.exit(1);
  }
  console.log(`[AI] ${aiManager.getKeyCount()} Gemini key(s) loaded`);

  // 2. Account Manager
  const accountManager = new AccountManager();
  await accountManager.load();
  console.log(`[Accounts] ${accountManager.getCount()} saved account(s)`);

  // 3. Browser Manager
  const browserManager = new BrowserManager();

  // 4. Telegram Bot
  const telegramBot = new TelegramBotController(
    state, aiManager, browserManager, accountManager
  );
  await telegramBot.start();

  // 5. Launch Browser
  try {
    const { browser, page } = await browserManager.launch();
    state.browser   = browser;
    // FIXED: state.page is set here AND kept in sync via browserManager.page
    state.page      = page;
    state.isRunning = true;
    console.log('[OK] Browser online with stealth mode');
    await telegramBot.notify('<b>🤖 Bot v2.0 Started</b>\nFull AI Autonomous Mode active.\nSend me any URL or @bot link!');
  } catch (err) {
    console.error('[FATAL] Browser failed to launch:', err.message);
    await telegramBot.notify(`<b>⚠️ FATAL:</b> Browser failed\n<code>${err.message}</code>`);
    process.exit(1);
  }

  // 6. AutoPilot Engine
  const autoPilot = new AutoPilot(
    state, aiManager, browserManager, telegramBot, accountManager
  );
  telegramBot.setAutoPilot(autoPilot);

  // 7. Run tasks.json if present
  const tasksPath = path.join(__dirname, 'tasks.json');
  if (fs.existsSync(tasksPath)) {
    try {
      const tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf-8'));
      if (Array.isArray(tasks) && tasks.length > 0) {
        console.log(`[Tasks] ${tasks.length} task(s) loaded from tasks.json`);
        await telegramBot.notify(`📋 Loaded <b>${tasks.length}</b> tasks from file. Starting...`);

        for (const task of tasks) {
          if (!state.isRunning) break;

          state.currentTask = task.name || task.url;
          state.isBusy      = true;
          console.log(`\n── Task: ${state.currentTask} ──`);

          try {
            const result = await autoPilot.executeURL(task.url, task);
            if (result.success) {
              state.completedTasks++;
              await telegramBot.notify(`✅ Done: <b>${state.currentTask}</b>\n${result.summary || ''}`);
            } else {
              state.failedTasks++;
              await telegramBot.notify(`❌ Failed: <b>${state.currentTask}</b>\n<code>${result.error}</code>`);
            }
          } catch (err) {
            state.failedTasks++;
            await telegramBot.notify(`💥 Error: <b>${state.currentTask}</b>\n<code>${err.message}</code>`);
          }

          state.currentTask = null;
          state.isBusy      = false;
          await sleep(task.delayAfter || 3000);
        }
      }
    } catch (err) {
      console.error('[Tasks] Invalid tasks.json:', err.message);
    }
  }

  console.log('\n[Bot] Ready. Waiting for Telegram commands...');
  console.log(`[Stats] Completed: ${state.completedTasks} | Failed: ${state.failedTasks}`);

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n[Bot] ${signal} received. Shutting down...`);
    state.isRunning = false;
    await browserManager.close();
    process.exit(0);
  };
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
