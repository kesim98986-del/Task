/**
 * telegramBot.js - Telegram Bot Controller v2.0
 * Send URL → bot auto-completes everything
 * Commands + inline keyboards + real-time notifications
 */

const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

class TelegramBotController {
  constructor(state, aiManager, browserManager, accountManager) {
    this.state = state;
    this.ai = aiManager;
    this.browser = browserManager;
    this.accounts = accountManager;
    this.bot = null;
    this.autoPilot = null;
    this.chatId = process.env.TELEGRAM_CHAT_ID || null;
    this.token = process.env.TELEGRAM_BOT_TOKEN || null;
  }

  setAutoPilot(autoPilot) {
    this.autoPilot = autoPilot;
  }

  async start() {
    if (!this.token) {
      console.warn('[Telegram] No TELEGRAM_BOT_TOKEN. Bot disabled.');
      return;
    }

    try {
      this.bot = new TelegramBot(this.token, { polling: true });
      console.log('[Telegram] Bot connected');
    } catch (err) {
      console.error('[Telegram] Start failed:', err.message);
      return;
    }

    // Commands
    this.bot.onText(/\/start/, (msg) => this._cmdStart(msg));
    this.bot.onText(/\/status/, (msg) => this._cmdStatus(msg));
    this.bot.onText(/\/screenshot/, (msg) => this._cmdScreenshot(msg));
    this.bot.onText(/\/switch_key/, (msg) => this._cmdSwitchKey(msg));
    this.bot.onText(/\/accounts/, (msg) => this._cmdAccounts(msg));
    this.bot.onText(/\/stop/, (msg) => this._cmdStop(msg));
    this.bot.onText(/\/help/, (msg) => this._cmdHelp(msg));

    // Inline keyboard callbacks
    this.bot.on('callback_query', (q) => this._handleCallback(q));

    // URL handler - any message with URL or @bot
    this.bot.on('message', (msg) => this._handleMessage(msg));

    this.bot.on('polling_error', (err) => {
      if (!err.message.includes('ETELEGRAM') && !err.message.includes('409')) {
        console.error('[Telegram] Error:', err.message);
      }
    });
  }

  async notify(message) {
    if (!this.bot || !this.chatId) return;
    try {
      await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
    } catch (err) {
      console.error('[Telegram] Notify failed:', err.message);
    }
  }

  /**
   * Handle any message - detect URLs and trigger autopilot
   */
  async _handleMessage(msg) {
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();

    // Skip commands
    if (text.startsWith('/')) return;

    // Auto-save chat ID
    if (!this.chatId) {
      this.chatId = String(chatId);
    }

    // Detect URL
    const urlMatch = text.match(/https?:\/\/[^\s]+/);
    const tgBotMatch = text.match(/@[\w]+/);

    if (urlMatch || tgBotMatch) {
      const target = urlMatch ? urlMatch[0] : tgBotMatch[0];

      if (this.state.isBusy) {
        await this.bot.sendMessage(chatId, `Bot is busy with: ${this.state.currentTask}\nPlease wait...`);
        return;
      }

      if (!this.autoPilot) {
        await this.bot.sendMessage(chatId, 'AutoPilot not ready yet. Please wait...');
        return;
      }

      // Start autopilot
      this.state.isBusy = true;
      this.state.currentTask = target;

      await this.bot.sendMessage(chatId, `<b>Starting AutoPilot</b>\nTarget: <code>${target}</code>\n\nI'll analyze the page and do everything automatically. Sending updates...`, {
        parse_mode: 'HTML',
      });

      try {
        const result = await this.autoPilot.executeURL(target, {
          goal: text.replace(target, '').trim() || null,
        });

        if (result.success) {
          this.state.completedTasks++;
          await this.bot.sendMessage(chatId, `<b>DONE</b>\n${result.summary || 'Task completed successfully.'}`, {
            parse_mode: 'HTML',
          });
        } else {
          this.state.failedTasks++;
          await this.bot.sendMessage(chatId, `<b>FAILED</b>\n<code>${result.error}</code>`, {
            parse_mode: 'HTML',
          });
        }
      } catch (err) {
        this.state.failedTasks++;
        await this.bot.sendMessage(chatId, `<b>ERROR</b>\n<code>${err.message}</code>`, {
          parse_mode: 'HTML',
        });
      }

      this.state.isBusy = false;
      this.state.currentTask = null;
    }
  }

  // ── Commands ──

  async _cmdStart(msg) {
    const chatId = msg.chat.id;
    if (!this.chatId) this.chatId = String(chatId);

    await this.bot.sendMessage(
      chatId,
      `<b>Automation Master Bot v2.0</b>
<b>Full AI Autonomous Mode</b>

Send me any link and I'll handle everything:
- <code>https://example.com</code> - opens & auto-completes
- <code>https://t.me/SomeBot</code> - opens Mini App & auto-plays
- <code>@BotName</code> - finds bot in Telegram & auto-interacts

Your accounts are saved permanently. Login once, never again.

Status: <b>${this.state.isRunning ? 'ONLINE' : 'OFFLINE'}</b>
Accounts: <b>${this.accounts.getCount()}</b> saved`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Status', callback_data: 'cmd_status' },
              { text: 'Screenshot', callback_data: 'cmd_screenshot' },
            ],
            [
              { text: 'My Accounts', callback_data: 'cmd_accounts' },
              { text: 'Switch AI Key', callback_data: 'cmd_switch_key' },
            ],
            [{ text: 'Help', callback_data: 'cmd_help' }],
          ],
        },
      }
    );
  }

  async _cmdStatus(msg) {
    const chatId = msg.chat.id;
    const keys = this.ai.getKeyStatuses();
    const keyLines = keys
      .map((k) => `  #${k.index + 1}: ${k.active ? 'OK' : 'EXHAUSTED'}${k.isCurrent ? ' << ACTIVE' : ''} (${k.errors} err)`)
      .join('\n');

    await this.bot.sendMessage(
      chatId,
      `<b>Status</b>

<b>Running:</b> ${this.state.isRunning ? 'Yes' : 'No'}
<b>Busy:</b> ${this.state.isBusy ? this.state.currentTask : 'No'}
<b>Uptime:</b> ${this._uptime()}
<b>Completed:</b> ${this.state.completedTasks}
<b>Failed:</b> ${this.state.failedTasks}

<b>AI Keys:</b>
<code>${keyLines}</code>

<b>Browser:</b> ${this.browser.getCurrentUrl()}
<b>Accounts:</b> ${this.accounts.getCount()} saved`,
      { parse_mode: 'HTML' }
    );
  }

  async _cmdScreenshot(msg) {
    const chatId = msg.chat.id;
    if (!this.state.page) {
      await this.bot.sendMessage(chatId, 'Browser not active.');
      return;
    }
    try {
      const tmpPath = path.join(__dirname, `scr_${Date.now()}.png`);
      await this.state.page.screenshot({ path: tmpPath, fullPage: false });
      await this.bot.sendPhoto(chatId, tmpPath, {
        caption: `URL: ${this.state.page.url()}\n${new Date().toISOString()}`,
      });
      try { fs.unlinkSync(tmpPath); } catch {}
    } catch (err) {
      await this.bot.sendMessage(chatId, `Screenshot failed: ${err.message}`);
    }
  }

  async _cmdSwitchKey(msg) {
    const chatId = msg.chat.id;
    const result = this.ai.switchKey(true);
    const text = result.reset
      ? 'All keys reset. Using key #1'
      : result.switched
      ? `Switched to key #${result.newIndex + 1}`
      : result.message || 'Cannot switch';
    await this.bot.sendMessage(chatId, text);
  }

  async _cmdAccounts(msg) {
    const chatId = msg.chat.id;
    const summary = this.accounts.getSummary();
    await this.bot.sendMessage(
      chatId,
      `<b>Saved Accounts</b>\n\n<code>${summary}</code>\n\nAccounts are saved in browser profile. Login once on any site and the session persists forever.`,
      { parse_mode: 'HTML' }
    );
  }

  async _cmdStop(msg) {
    const chatId = msg.chat.id;
    this.state.isBusy = false;
    this.state.currentTask = null;
    await this.bot.sendMessage(chatId, 'Stopped current task. Bot is idle.');
  }

  async _cmdHelp(msg) {
    const chatId = msg.chat.id;
    await this.bot.sendMessage(
      chatId,
      `<b>How to Use</b>

<b>Send any link:</b>
<code>https://example.com</code> - auto-complete website
<code>https://t.me/BotName</code> - auto-play Mini App
<code>@BotName</code> - find & interact with Telegram bot

<b>Commands:</b>
/start - Menu
/status - Bot status & uptime
/screenshot - See browser screen
/switch_key - Rotate Gemini API key
/accounts - View saved accounts
/stop - Stop current task
/help - This message

<b>How it works:</b>
1. You send URL
2. AI takes screenshot
3. AI detects all buttons/actions
4. Bot clicks/types/scrolls automatically
5. Repeats until page is done
6. Reports back to you`,
      { parse_mode: 'HTML' }
    );
  }

  async _handleCallback(query) {
    await this.bot.answerCallbackQuery(query.id);
    const msg = query.message;
    switch (query.data) {
      case 'cmd_status': return this._cmdStatus(msg);
      case 'cmd_screenshot': return this._cmdScreenshot(msg);
      case 'cmd_switch_key': return this._cmdSwitchKey(msg);
      case 'cmd_accounts': return this._cmdAccounts(msg);
      case 'cmd_help': return this._cmdHelp(msg);
    }
  }

  _uptime() {
    if (!this.state.startTime) return 'N/A';
    const ms = Date.now() - this.state.startTime.getTime();
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m`;
  }
}

module.exports = { TelegramBotController };
