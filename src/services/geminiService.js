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
            description: 'Merchant, shop, branch, or place name if mentioned or printed on receipt, else empty string.',
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
7. Location: Extract shop/merchant/branch/place name (e.g. "Brown Coffee BKK1", "Aeon Mall 2", "PTT Station", "ផ្សារថ្មី") if mentioned or printed on receipt; otherwise "".
8. Multiple items in one message (e.g. "កាហ្វេ 2.5$ និងបាយ 12000 រៀល") -> return multiple items in "transactions". If a receipt has many line items for one single purchase, combine into ONE total transaction with a concise description of the main items unless clearly separate receipts.
9. If the input is NOT a transaction (e.g. greeting or unrelated image), set isTransaction=false, transactions=[], and explain politely in Khmer inside replyText.`;
}

export class GeminiService {
  constructor({ apiKey = config.gemini.apiKey, model = config.gemini.model, timezone = config.timezone } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.timezone = timezone;
    this.client = apiKey ? new GoogleGenAI({ apiKey }) : null;
  }

  isConfigured() {
    return Boolean(this.apiKey && this.client);
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

  async _generateWithFallback(contents, genConfig) {
    const models = [
      ...new Set([
        this.model,
        'gemini-3.5-flash-lite',
        'gemini-flash-lite-latest',
        'gemini-3-flash-preview',
        'gemini-2.5-flash',
      ]),
    ];
    let lastError;

    for (let i = 0; i < models.length; i += 1) {
      const modelName = models[i];
      const modelConfig = {
        httpOptions: { timeout: 15000 },
        ...genConfig,
      };
      if (modelName.startsWith('gemini-2.5-') && !modelConfig.thinkingConfig) {
        modelConfig.thinkingConfig = { thinkingBudget: 0 };
      }
      try {
        return await this.client.models.generateContent({
          model: modelName,
          contents,
          config: modelConfig,
        });
      } catch (err) {
        lastError = err;
        const msg = String(err?.message || err);
        const isRetryable =
          msg.includes('503') ||
          msg.includes('504') ||
          msg.includes('429') ||
          msg.includes('404') ||
          msg.includes('UNAVAILABLE') ||
          msg.includes('DEADLINE_EXCEEDED') ||
          msg.includes('NOT_FOUND') ||
          msg.includes('high demand') ||
          msg.includes('fetch failed') ||
          msg.includes('timeout') ||
          msg.includes('aborted');
        if (!isRetryable || i === models.length - 1) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    throw lastError;
  }

  async testConnection() {
    if (!this.isConfigured()) {
      return { ok: false, error: 'GEMINI_API_KEY missing' };
    }
    const response = await this._generateWithFallback('Reply with OK only.', { temperature: 0 });
    return { ok: true, reply: (response.text || '').trim(), model: this.model };
  }
}

export const geminiService = new GeminiService();
