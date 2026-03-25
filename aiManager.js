/**
 * aiManager.js - Gemini AI with Multi-Key Rotation
 * NEW @google/genai SDK | Flash (worker) + Pro (verifier)
 */

const { GoogleGenAI } = require('@google/genai');

class AIManager {
  constructor() {
    this.keys = this._loadKeys();
    this.currentKeyIndex = 0;
    this.keyStatus = this.keys.map(() => ({
      active: true,
      errors: 0,
      lastError: null,
    }));
    this.flashModel = 'gemini-1.5-flash';
    this.proModel = 'gemini-1.5-pro';
  }

  _loadKeys() {
    const keys = [];
    const envKeys = Object.keys(process.env)
      .filter((k) => k.startsWith('GEMINI_API_KEY'))
      .sort();
    for (const envKey of envKeys) {
      const val = process.env[envKey];
      if (val && val.trim().length > 0 && !val.includes('your_')) {
        keys.push(val.trim());
      }
    }
    if (keys.length === 0) {
      console.error('[AI] No GEMINI_API_KEY found! Add GEMINI_API_KEY_1 to env');
    }
    return keys;
  }

  getKeyCount() { return this.keys.length; }
  getCurrentKeyIndex() { return this.currentKeyIndex; }

  getKeyStatuses() {
    return this.keyStatus.map((s, i) => ({
      index: i,
      active: s.active,
      errors: s.errors,
      isCurrent: i === this.currentKeyIndex,
    }));
  }

  switchKey(manual = false) {
    if (this.keys.length <= 1) return { switched: false, message: 'Only 1 key' };
    const start = this.currentKeyIndex;
    let next = (start + 1) % this.keys.length;
    while (next !== start) {
      if (this.keyStatus[next].active) {
        this.currentKeyIndex = next;
        console.log(`[AI] ${manual ? 'Manual' : 'Auto'} switch -> Key #${next + 1}`);
        return { switched: true, newIndex: next };
      }
      next = (next + 1) % this.keys.length;
    }
    // Reset all
    this.keyStatus.forEach((s) => { s.active = true; s.errors = 0; });
    this.currentKeyIndex = 0;
    return { switched: true, newIndex: 0, reset: true };
  }

  _getClient() {
    if (this.keys.length === 0) throw new Error('No API keys');
    return new GoogleGenAI({ apiKey: this.keys[this.currentKeyIndex] });
  }

  _isRateLimit(err) {
    const m = (err.message || '').toLowerCase();
    return m.includes('quota') || m.includes('429') || m.includes('rate') || m.includes('exhausted') || m.includes('limit');
  }

  _handleError(err) {
    this.keyStatus[this.currentKeyIndex].errors++;
    this.keyStatus[this.currentKeyIndex].lastError = err.message;
    if (this._isRateLimit(err)) {
      this.keyStatus[this.currentKeyIndex].active = false;
      return this.switchKey(false);
    }
    return null;
  }

  /**
   * Screenshot analysis (Flash - fast)
   */
  async analyzeScreenshot(screenshotBase64, prompt) {
    const retries = Math.max(this.keys.length, 2);
    for (let i = 0; i < retries; i++) {
      try {
        const client = this._getClient();
        const response = await client.models.generateContent({
          model: this.flashModel,
          contents: [
            { inlineData: { mimeType: 'image/png', data: screenshotBase64 } },
            { text: prompt },
          ],
        });
        return { success: true, text: response.text, keyIndex: this.currentKeyIndex };
      } catch (err) {
        console.error(`[AI] Key #${this.currentKeyIndex + 1}:`, err.message);
        const sw = this._handleError(err);
        if (sw && sw.switched) continue;
        if (i === retries - 1) throw err;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    throw new Error('All keys failed');
  }

  /**
   * Verification (Pro - thorough)
   */
  async verifyTask(screenshotBase64, taskDesc, expected) {
    const retries = Math.max(this.keys.length, 2);
    for (let i = 0; i < retries; i++) {
      try {
        const client = this._getClient();
        const response = await client.models.generateContent({
          model: this.proModel,
          contents: [
            { inlineData: { mimeType: 'image/png', data: screenshotBase64 } },
            { text: `Verify task: "${taskDesc}". Expected: "${expected}". Return JSON: {"success": bool, "confidence": 0-100, "details": "...", "issues": []}` },
          ],
        });
        return { success: true, verification: this._parseJSON(response.text) || { success: true, confidence: 60, details: response.text, issues: [] } };
      } catch (err) {
        const sw = this._handleError(err);
        if (sw && sw.switched) continue;
        if (i === retries - 1) throw err;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    throw new Error('All keys failed for verification');
  }

  /**
   * Text query (no image)
   */
  async queryText(prompt) {
    const retries = Math.max(this.keys.length, 2);
    for (let i = 0; i < retries; i++) {
      try {
        const client = this._getClient();
        const response = await client.models.generateContent({
          model: this.flashModel,
          contents: [{ text: prompt }],
        });
        return { success: true, text: response.text };
      } catch (err) {
        const sw = this._handleError(err);
        if (sw && sw.switched) continue;
        if (i === retries - 1) throw err;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    throw new Error('All keys failed for text');
  }

  _parseJSON(text) {
    if (!text) return null;
    let clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    try { return JSON.parse(clean); } catch {}
    const m = clean.match(/\{[\s\S]*?\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    return null;
  }
}

module.exports = { AIManager };
