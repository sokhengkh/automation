import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const allowedChatIdsRaw = process.env.TELEGRAM_ALLOWED_CHAT_IDS || '';

export const config = {
  port: Number(process.env.PORT || 3000),
  timezone: process.env.TIMEZONE || 'Asia/Phnom_Penh',
  publicUrl: (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, ''),
  cronSecret: (process.env.CRON_SECRET || process.env.TELEGRAM_WEBHOOK_SECRET || 'kh_finance_bot_secret').trim(),

  telegram: {
    botToken: (process.env.TELEGRAM_BOT_TOKEN || '').trim(),
    mode: (process.env.TELEGRAM_MODE || 'auto').trim().toLowerCase(),
    webhookSecret: (process.env.TELEGRAM_WEBHOOK_SECRET || 'kh_finance_bot_secret').trim(),
    allowedChatIds: allowedChatIdsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  gemini: {
    apiKey: (process.env.GEMINI_API_KEY || '').trim(),
    model: (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite').trim(),
  },

  ngrok: {
    authtoken: (process.env.NGROK_AUTHTOKEN || '').trim(),
    autostart: String(process.env.NGROK_AUTOSTART || 'true').toLowerCase() === 'true',
    binary: (process.env.NGROK_BINARY || 'ngrok').trim(),
    domain: (process.env.NGROK_DOMAIN || '').trim(),
  },

  googleSheet: {
    sheetId: (process.env.GOOGLE_SHEET_ID || '').trim(),
    tabName: (process.env.GOOGLE_SHEET_TAB || 'Transactions').trim(),
    appsScriptUrl: (process.env.GOOGLE_APPS_SCRIPT_URL || '').trim(),
    appsScriptSecret: (process.env.GOOGLE_APPS_SCRIPT_SECRET || '').trim(),
    serviceAccountPath: path.resolve(
      ROOT_DIR,
      process.env.GOOGLE_SERVICE_ACCOUNT_PATH || './credentials/google-service-account.json'
    ),
  },

  schedule: {
    hour: Number(process.env.MONTHLY_REPORT_HOUR ?? 16),
    minute: Number(process.env.MONTHLY_REPORT_MINUTE ?? 0),
  },

  reminders: {
    waterBill: {
      enabled: String(process.env.WATER_BILL_ENABLED || 'true').toLowerCase() === 'true',
      anchorMonth: (process.env.WATER_BILL_ANCHOR_MONTH || '2026-12').trim(),
      startDay: Number(process.env.WATER_BILL_START_DAY ?? 16),
      endDay: Number(process.env.WATER_BILL_END_DAY ?? 18),
      hour: Number(process.env.WATER_BILL_REMINDER_HOUR ?? 9),
      minute: Number(process.env.WATER_BILL_REMINDER_MINUTE ?? 0),
    },
  },

  paths: {
    dataDir: path.join(ROOT_DIR, 'data'),
    reportsDir: path.join(ROOT_DIR, 'reports'),
    publicDir: path.join(ROOT_DIR, 'public'),
    transactionsFile: path.join(ROOT_DIR, 'data', 'transactions.json'),
    botStateFile: path.join(ROOT_DIR, 'data', 'bot-state.json'),
  },
};
