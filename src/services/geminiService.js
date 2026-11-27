import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { getNowDateTimeString, getTodayDateString } from '../utils/dateUtils.js';
import { normalizeTransactionRecord, STANDARD_CATEGORIES } from '../utils/financeUtils.js';

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    isTransaction: {
      type: 'boolean',
      description: 'True if the input describes one or more income/expense transactions or a receipt; false otherwise.',
    },
    replyText: {
      type: 'string',
      description: 'Short helpful Khmer/English summary, transcript, or reason if not a transaction.',
    },
    transactions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Transaction date/time in YYYY-MM-DD HH:mm format (use provided current local datetime if omitted).',
          },
          type: {
            type: 'string',
            enum: ['ចំណូល', 'ចំណាយ'],
            description: 'Use ចំណូល for income/salary/sales/refund received, and ចំណាយ for expenses/purchases/bills.',
          },
          categories: {
            type: 'string',
            description: `Best matching category from: ${STANDARD_CATEGORIES.join(', ')}`,
          },
          amount: {
            type: 'number',
            description: 'Numeric amount without currency symbols.',
          },
          currency: {
            type: 'string',
            enum: ['$', '៛'],
            description: 'Use "$" for USD/dollars or "៛" for KHR/Riel.',
          },
          description: {
            type: 'string',
            description: 'Concise item or note in Khmer/English matching user input. Empty string if none.',
          },
          paymentMethod: {
            type: 'string',
            description: 'Payment method if mentioned or visible (e.g. Cash, ABA, ACLEDA, Wing, KHQR, Card), else empty string.',
          },
          location: {
            type: 'string',
            description: 'Shop/merchant/recipient name, branch, address, or place extracted from text, voice, printed receipt, or ABA/ACLEDA transfer slip. Empty string only if no place or merchant exists.',
          },
        },
        required: ['date', 'type', 'categories', 'amount', 'currency', 'description', 'paymentMethod', 'location'],
        additionalProperties: false,
      },
    },
  },
  required: ['isTransaction', 'replyText', 'transactions'],
  additionalProperties: false,
};

function buildSystemInstruction(timeZone) {
  const nowStr = getNowDateTimeString(timeZone);
  const todayStr = getTodayDateString(timeZone);

  return `You are a bilingual Khmer & English Personal Finance AI Assistant in Cambodia.
Current local date/time (${timeZone}): ${nowStr} (Today is ${todayStr}).

Your job is to inspect the user's text message, Khmer/English voice recording, or receipt image and extract ALL income or expense transactions into structured JSON.

Rules:
1. Language: Understand Khmer, English, and mixed Khmer+English fluently (including Khmer numerals like ១២០០០, colloquial expressions like "២ម៉ឺន" = 20000, "៥ពាន់" = 5000, "20k" = 20000).
2. Currency:
   - Only output "$" or "៛".
   - "$" for USD, dollar, ដុល្លារ, ដុល្លា, $.
   - "៛" for KHR, riel, រៀល, ៛.
   - If currency is omitted on a Cambodian receipt/voice/text: amounts >= 500 that are multiples of 100 (like 4000, 15000) are usually "៛" unless context clearly says "$"; small amounts like 2.5, 15, 50 are usually "$".
3. Type:
   - "ចំណូល" for salary, bonus, payment received, sales income, freelance income, gift received (ប្រាក់ខែ, ទទួលប្រាក់, ចំណូល, លក់បាន...).
   - "ចំណាយ" for purchases, food, fuel, bills, transfers out, expenses (ទិញ, ចំណាយ, អស់, បង់, ចាក់សាំង...).
4. Categories: Prefer one of: ${STANDARD_CATEGORIES.join(', ')}.
5. Date:
   - Use "YYYY-MM-DD HH:mm".
   - If a receipt shows a date (and time), extract it. If only date is visible, append current time or 12:00.
   - If user says "ម្សិលមិញ" (yesterday), subtract 1 day from ${todayStr}.
   - If no date is mentioned, use "${nowStr}".
6. Payment Method: Extract ABA, ACLEDA, Wing, KHQR, Pi Pay, Cash (សាច់ប្រាក់), Card, etc. if mentioned or shown on receipt (e.g. ABA Pay receipt -> "ABA"); otherwise "".
7. Location: ALWAYS extract any shop, merchant, recipient, branch, market, street, district, or place name from text, voice, printed receipts, and ABA/ACLEDA/KHQR screenshots (e.g., "To: BROWN COFFEE BKK1" -> "BROWN COFFEE BKK1", "Paid to LUCKY EXPRESS" -> "LUCKY EXPRESS", "ចាក់សាំង PTT" -> "PTT", "ទិញបាយផ្សារថ្មី" -> "ផ្សារថ្មី"). If a receipt shows both shop name and address/branch, combine them concisely (e.g. "Tube Coffee - Tuol Kork"). Leave "" only if no merchant or place is mentioned or visible anywhere.
8. Multiple items in one message (e.g. "កាហ្វេ 2.5$ និងបាយ 12000 រៀល") -> return multiple items in "transactions". If a receipt has many line items for one single purchase, combine into ONE total transaction with a concise description of the main items unless clearly separate receipts.
9. If the input is NOT a transaction (e.g. greeting or unrelated image), set isTransaction=false, transactions=[], and explain politely in Khmer inside replyText.`;
}

const STATIC_FALLBACK_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
];

const EXCLUDED_MODEL_TOKENS = [
  'tts',
  'image',
  'transcribe',
  'robotics',
  'computer-use',
  'omni',
  'live',
];

/**
 * Selects and ranks suitable multimodal Flash models from a Gemini models.list() payload.
 */
export function selectBestFlashModels(modelInfos = []) {
  const candidates = [];

  for (const info of modelInfos) {
    const actions = info?.supportedActions;
    if (Array.isArray(actions) && !actions.includes('generateContent')) continue;

    const id = String(info?.name || '').replace(/^models\//, '').trim();
    if (!id.startsWith('gemini-') || !id.includes('flash')) continue;
    if (EXCLUDED_MODEL_TOKENS.some((tok) => id.includes(tok))) continue;

    const isLatest = id.endsWith('-latest');
    const isLite = id.includes('lite');
    const isPreview = id.includes('preview');
    const versionMatch = id.match(/^gemini-(\d+(?:\.\d+)?)/);
    const version = versionMatch ? Number.parseFloat(versionMatch[1]) : 0;

    // Prioritize *-latest aliases and newer stable flash-lite / flash releases
    let score = version * 10;
    if (isLatest) score += 100;
    if (isLite) score += 2;
    if (!isPreview) score += 1;

    candidates.push({ id, score });
  }

  candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return [...new Set(candidates.map((c) => c.id))];
}

function isModelNotFoundError(err) {
  const msg = String(err?.message || err);
  return msg.includes('404') || msg.includes('NOT_FOUND') || msg.includes('no longer available');
}

function isRetryableGeminiError(err) {
  const msg = String(err?.message || err);
  return (
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('429') ||
    msg.includes('404') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('DEADLINE_EXCEEDED') ||
    msg.includes('NOT_FOUND') ||
    msg.includes('no longer available') ||
    msg.includes('high demand') ||
    msg.includes('fetch failed') ||
    msg.includes('timeout') ||
    msg.includes('aborted')
  );
}

export class GeminiService {
  constructor({
    apiKey = config.gemini.apiKey,
    model = config.gemini.model,
    timezone = config.timezone,
    client = null,
  } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.activeModel = model;
    this.timezone = timezone;
    this.client = client || (apiKey ? new GoogleGenAI({ apiKey }) : null);
    this.retiredModels = new Set();
    this._discoveredModels = [];
    this._lastDiscoveryAt = 0;
  }

  isConfigured() {
    return Boolean((this.apiKey || this.client) && this.client);
  }

  async parseInput({ text = '', mediaBuffer = null, mimeType = '', defaultLocation = '' } = {}) {
    if (!this.isConfigured()) {
      throw new Error('GEMINI_API_KEY is not configured in .env');
    }

    const parts = [];
    if (mediaBuffer && mimeType) {
      parts.push({
        inlineData: {
          mimeType,
          data: Buffer.isBuffer(mediaBuffer) ? mediaBuffer.toString('base64') : String(mediaBuffer),
        },
      });
    }

    const promptText = text
      ? `User input / caption: ${text}`
      : mimeType.startsWith('audio/')
        ? 'Transcribe this Khmer/English voice message and extract all income/expense transactions.'
        : 'Read this receipt/image carefully and extract the income/expense transaction details.';

    parts.push({ text: promptText });

    const response = await this._generateWithFallback(parts, {
      systemInstruction: buildSystemInstruction(this.timezone),
      responseMimeType: 'application/json',
      responseJsonSchema: RESPONSE_SCHEMA,
      temperature: 0.1,
    });

    const rawText = response.text || '';
    const parsed = JSON.parse(rawText);
    const defaultDate = getNowDateTimeString(this.timezone);

    const transactions = Array.isArray(parsed.transactions)
      ? parsed.transactions
          .map((tx) => normalizeTransactionRecord(tx, { defaultDate, defaultLocation }))
          .filter((tx) => tx.amount > 0)
      : [];

    return {
      isTransaction: Boolean(parsed.isTransaction) && transactions.length > 0,
      replyText: String(parsed.replyText || '').trim(),
      transactions,
    };
  }

  async _discoverLiveModels() {
    const now = Date.now();
    if (this._discoveredModels.length > 0 && now - this._lastDiscoveryAt < 10 * 60 * 1000) {
      return this._discoveredModels;
    }

    try {
      const pager = await this.client.models.list();
      const allModels = [];
      for await (const m of pager) {
        allModels.push(m);
      }
      this._discoveredModels = selectBestFlashModels(allModels);
      this._lastDiscoveryAt = now;
      return this._discoveredModels;
    } catch (err) {
      console.warn('[Gemini] Model auto-discovery failed:', err.message);
      return [];
    }
  }

  async _tryGenerate(modelName, contents, genConfig) {
    const modelConfig = {
      httpOptions: { timeout: 15000 },
      ...genConfig,
    };
    if (modelName.startsWith('gemini-2.5-') && !modelConfig.thinkingConfig) {
      modelConfig.thinkingConfig = { thinkingBudget: 0 };
    }
    return this.client.models.generateContent({
      model: modelName,
      contents,
      config: modelConfig,
    });
  }

  async _generateWithFallback(contents, genConfig) {
    const initialModels = [
      ...new Set([this.activeModel, this.model, ...STATIC_FALLBACK_MODELS]),
    ].filter((m) => m && !this.retiredModels.has(m));

    const tried = new Set();
    let lastError;

    const tryList = async (list) => {
      for (let i = 0; i < list.length; i += 1) {
        const modelName = list[i];
        if (tried.has(modelName) || this.retiredModels.has(modelName)) continue;
        tried.add(modelName);

        try {
          const res = await this._tryGenerate(modelName, contents, genConfig);
          if (modelName !== this.activeModel) {
            console.log(`[Gemini] Auto-healed active model -> ${modelName}`);
            this.activeModel = modelName;
          }
          return res;
        } catch (err) {
          lastError = err;
          if (isModelNotFoundError(err)) {
            this.retiredModels.add(modelName);
          }
          if (!isRetryableGeminiError(err)) {
            throw err;
          }
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      return null;
    };

    const primaryRes = await tryList(initialModels);
    if (primaryRes) return primaryRes;

    // Self-heal by querying live models from Google API when configured/static models fail
    const discovered = await this._discoverLiveModels();
    const extraCandidates = discovered
      .filter((m) => !tried.has(m) && !this.retiredModels.has(m))
      .slice(0, 4);

    if (extraCandidates.length > 0) {
      const healedRes = await tryList(extraCandidates);
      if (healedRes) return healedRes;
    }

    throw lastError || new Error('No available Gemini Flash models succeeded.');
  }

  async testConnection() {
    if (!this.isConfigured()) {
      return { ok: false, error: 'GEMINI_API_KEY missing' };
    }
    const response = await this._generateWithFallback('Reply with OK only.', { temperature: 0 });
    return { ok: true, reply: (response.text || '').trim(), model: this.activeModel };
  }
}

export const geminiService = new GeminiService();
