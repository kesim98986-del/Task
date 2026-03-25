# Automation Master Bot v2.0

**Full AI Autonomous Mode** — Send a URL, bot does everything.

## How It Works

1. You send a URL to the Telegram bot (website or @TelegramBot link)
2. Bot opens the page in stealth browser
3. AI takes screenshot and analyzes the ENTIRE page
4. AI detects buttons, links, forms, login requirements, tasks
5. Bot clicks/types/scrolls automatically
6. Repeats until the page is complete
7. Reports results to you via Telegram

## Files

| File | Purpose |
|---|---|
| `main.js` | Entry point |
| `autoPilot.js` | AI autonomous engine (the brain) |
| `aiManager.js` | Gemini AI + multi-key rotation |
| `telegramBot.js` | Telegram commands + URL handler |
| `browserManager.js` | Puppeteer Stealth browser |
| `accountManager.js` | Persistent account/session manager |
| `tasks.json` | Scheduled tasks (optional) |
| `Dockerfile` | Railway deployment |
| `railway.json` | Railway config |

## Deploy to Railway

1. Push to GitHub
2. New Project on Railway -> Deploy from GitHub
3. Add Volume: mount path `/data` (saves browser sessions!)
4. Set environment variables:

```
TELEGRAM_BOT_TOKEN=from_botfather
TELEGRAM_CHAT_ID=your_chat_id
GEMINI_API_KEY_1=key1
GEMINI_API_KEY_2=key2 (optional)
GEMINI_API_KEY_3=key3 (optional)
```

5. Deploy!

## Usage via Telegram

**Send any URL:**
```
https://example.com
```
Bot opens it, AI analyzes, auto-completes all actions.

**Send Telegram bot link:**
```
https://t.me/SomeGameBot
```
or
```
@SomeGameBot
```
Bot opens in Telegram Web, launches Mini App, auto-plays.

**Send URL with goal:**
```
https://example.com/tasks Follow all social media accounts and claim rewards
```

## Commands

| Command | What |
|---|---|
| `/start` | Menu + quick buttons |
| `/status` | Uptime, tasks, API keys |
| `/screenshot` | See browser screen |
| `/switch_key` | Rotate Gemini key |
| `/accounts` | View saved accounts |
| `/stop` | Stop current task |
| `/help` | All commands |

## Account Persistence

- Browser profile saved in Railway Volume (`/data`)
- Login to Google, Twitter, Telegram Web ONCE → stays forever
- Bot auto-detects login pages and uses saved sessions
- No need to re-enter credentials after redeploy

## AI Key Rotation

Multiple Gemini keys supported. When one hits daily limit:
- Auto-switches to next key
- Sends Telegram notification
- All keys exhausted → resets and retries

## First Time Setup

After first deploy:
1. Send `/screenshot` to see what browser shows
2. Navigate to Google login via tasks.json: `{"url": "https://accounts.google.com"}`
3. Use `/screenshot` to monitor login process
4. Or run locally with `HEADLESS=false` to login manually first

## License
MIT
