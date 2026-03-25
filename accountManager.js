/**
 * accountManager.js - Persistent Account Manager
 * Saves and manages accounts (Google, Twitter, Telegram, etc.)
 * Accounts saved to disk, never asks again after first login
 */

const fs = require('fs');
const path = require('path');

class AccountManager {
  constructor() {
    this.dataDir = process.env.USER_DATA_DIR || path.join(__dirname, 'user_data');
    this.accountsFile = path.join(this.dataDir, 'accounts.json');
    this.accounts = {};
  }

  /**
   * Load saved accounts from disk
   */
  async load() {
    try {
      if (fs.existsSync(this.accountsFile)) {
        const data = fs.readFileSync(this.accountsFile, 'utf-8');
        this.accounts = JSON.parse(data);
        console.log(`[Accounts] Loaded ${Object.keys(this.accounts).length} account(s)`);
      }
    } catch (err) {
      console.error('[Accounts] Failed to load:', err.message);
      this.accounts = {};
    }
  }

  /**
   * Save accounts to disk
   */
  async save() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      fs.writeFileSync(this.accountsFile, JSON.stringify(this.accounts, null, 2));
    } catch (err) {
      console.error('[Accounts] Failed to save:', err.message);
    }
  }

  /**
   * Add/update an account
   */
  async setAccount(type, info) {
    this.accounts[type.toLowerCase()] = {
      ...info,
      type: type.toLowerCase(),
      savedAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
    };
    await this.save();
    console.log(`[Accounts] Saved ${type} account`);
  }

  /**
   * Get account info
   */
  getAccount(type) {
    return this.accounts[type.toLowerCase()] || null;
  }

  /**
   * Check if account exists
   */
  hasAccount(type) {
    return !!this.accounts[type.toLowerCase()];
  }

  /**
   * Mark account as recently used
   */
  async markUsed(type) {
    if (this.accounts[type.toLowerCase()]) {
      this.accounts[type.toLowerCase()].lastUsed = new Date().toISOString();
      await this.save();
    }
  }

  /**
   * Get all saved account types
   */
  getTypes() {
    return Object.keys(this.accounts);
  }

  /**
   * Get count
   */
  getCount() {
    return Object.keys(this.accounts).length;
  }

  /**
   * Get summary for Telegram display
   */
  getSummary() {
    const types = this.getTypes();
    if (types.length === 0) return 'No accounts saved.';

    return types
      .map((t) => {
        const acc = this.accounts[t];
        const name = acc.displayName || acc.email || acc.username || 'Saved';
        return `  ${t}: ${name} (last used: ${acc.lastUsed ? new Date(acc.lastUsed).toLocaleDateString() : 'never'})`;
      })
      .join('\n');
  }

  /**
   * Remove an account
   */
  async removeAccount(type) {
    delete this.accounts[type.toLowerCase()];
    await this.save();
  }
}

module.exports = { AccountManager };
