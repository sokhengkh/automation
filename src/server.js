import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config, ROOT_DIR } from './config.js';
import { buildMonthlyExcelBuffer } from './services/excelService.js';
import { geminiService } from './services/geminiService.js';
import { ngrokService } from './services/ngrokService.js';
import { schedulerService } from './services/schedulerService.js';
import { sheetsService } from './services/sheetsService.js';
import { storageService } from './services/storageService.js';
import { telegramService } from './services/telegramService.js';
import {
  formatMonthLabelKhmer,
  getCurrentMonthKey,
  getCurrentPayCycleKey,
  getPayCycleRange,
  isDateInRange,
} from './utils/dateUtils.js';
import { STANDARD_CATEGORIES, summarizeTransactions } from './utils/financeUtils.js';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.static(config.paths.publicDir));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.get('/api/status', async (_req, res) => {
    try {
      const state = await storageService.getState();
      const all = await storageService.getAllTransactions();
      const pendingSyncCount = all.filter((tx) => !tx.syncedToSheet).length;
      const sheetMode = await sheetsService.getMode();

      const currentCycle = getCurrentPayCycleKey(
        new Date(),
        config.timezone,
        config.schedule.cycleStartDay
      );
      const cycleRange = getPayCycleRange(
        currentCycle,
        config.schedule.cycleStartDay,
        config.schedule.day
      );

      res.json({
        ok: true,
        timezone: config.timezone,
        currentMonth: getCurrentMonthKey(config.timezone),
        currentCycle,
        cycleRange,
        categories: STANDARD_CATEGORIES,
        telegram: {
          configured: telegramService.isConfigured(),
          mode: telegramService.mode,
          username: telegramService.botInfo?.username || null,
          webhookUrl: telegramService.webhookUrl || null,
          ownerChatIds: state.ownerChatIds,
        },
        ngrok: {
          publicUrl: ngrokService.publicUrl || (await ngrokService.getExistingTunnelUrl()) || null,
        },
        gemini: {
          configured: geminiService.isConfigured(),
          model: geminiService.activeModel || config.gemini.model,
        },
        googleSheet: {
          sheetId: config.googleSheet.sheetId,
          sheetUrl: config.googleSheet.sheetId
            ? `https://docs.google.com/spreadsheets/d/${config.googleSheet.sheetId}/edit`
            : null,
          mode: sheetMode,
          appsScriptConfigured: Boolean(config.googleSheet.appsScriptUrl),
          appsScriptSecret: config.googleSheet.appsScriptSecret,
          pendingSyncCount,
        },
        schedule: {
          day: config.schedule.day,
          cycleStartDay: config.schedule.cycleStartDay,
          hour: config.schedule.hour,
          minute: config.schedule.minute,
        },
        reminders: {
          waterBill: config.reminders.waterBill,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/test-connections', async (_req, res) => {
    const results = {
      gemini: { ok: false },
      telegram: { ok: false },
      googleSheet: { ok: false },
    };

    try {
      results.gemini = await geminiService.testConnection();
    } catch (err) {
      results.gemini = { ok: false, error: err.message };
    }

    try {
      const me = await telegramService.apiCall('getMe');
      results.telegram = { ok: true, username: me.username, id: me.id };
    } catch (err) {
      results.telegram = { ok: false, error: err.message };
    }

    try {
      results.googleSheet = await sheetsService.testConnection();
    } catch (err) {
      results.googleSheet = { ok: false, error: err.message };
    }

    res.json({ ok: true, results });
  });

  app.get('/api/transactions', async (req, res) => {
    try {
      const cycle = String(req.query.cycle || '').trim();
      const month = String(req.query.month || '').trim();
      const type = String(req.query.type || '').trim();
      const currency = String(req.query.currency || '').trim();
      const q = String(req.query.q || '').trim().toLowerCase();
      const source = String(req.query.source || 'auto').trim();

      const range = cycle
        ? getPayCycleRange(cycle, config.schedule.cycleStartDay, config.schedule.day)
        : null;

      let transactions;
      let dataSource = 'local_cache';

      if (range) {
        if (source === 'sheet') {
          const sheetData = await sheetsService.getTransactionsForDateRange(range.startDate, range.endDate);
          transactions = sheetData.transactions;
          dataSource = sheetData.source;
        } else {
          const allLocal = await storageService.getAllTransactions();
          transactions = allLocal.filter((tx) => isDateInRange(tx.date, range.startDate, range.endDate));
          if (source === 'auto' && transactions.length === 0 && (await sheetsService.getMode()) !== 'local_only') {
            const sheetData = await sheetsService.getTransactionsForDateRange(range.startDate, range.endDate);
            transactions = sheetData.transactions;
            dataSource = sheetData.source;
          }
        }
      } else if (source === 'sheet') {
        const sheetData = await sheetsService.getTransactionsForMonth(month);
        transactions = sheetData.transactions;
        dataSource = sheetData.source;
      } else {
        transactions = month
          ? await storageService.getTransactionsByMonth(month)
          : await storageService.getAllTransactions();

        if (source === 'auto' && transactions.length === 0 && (await sheetsService.getMode()) !== 'local_only') {
          const sheetData = await sheetsService.getTransactionsForMonth(month);
          transactions = sheetData.transactions;
          dataSource = sheetData.source;
        }
      }

      const filtered = transactions.filter((tx) => {
        if (type && tx.type !== type) return false;
        if (currency && tx.currency !== currency) return false;
        if (q) {
          const hay = `${tx.categories} ${tx.description} ${tx.paymentMethod} ${tx.location} ${tx.date}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });

      filtered.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      const summary = summarizeTransactions(filtered);

      res.json({
        ok: true,
        source: dataSource,
        summary,
        transactions: filtered,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/transactions', async (req, res) => {
    try {
      const { useAi, text } = req.body || {};
      let records = [];

      if (useAi && text) {
        const parsed = await geminiService.parseInput({ text: String(text) });
        if (!parsed.isTransaction) {
          return res.status(400).json({
            ok: false,
            error: parsed.replyText || 'AI could not detect an income/expense transaction in that text.',
          });
        }
        records = parsed.transactions;
      } else {
        records = [req.body];
      }

      const saved = await storageService.addTransactions(records, {
        messageType: useAi ? 'web_ai' : 'web_manual',
        syncedToSheet: false,
      });

      let syncResult = { synced: false, mode: await sheetsService.getMode() };
      try {
        syncResult = await sheetsService.appendTransactions(saved);
      } catch (err) {
        syncResult = { synced: false, error: err.message };
      }

      res.status(201).json({ ok: true, transactions: saved, syncResult });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.put('/api/transactions/:id', async (req, res) => {
    try {
      const updated = await storageService.updateTransaction(req.params.id, req.body || {});
      if (!updated) return res.status(404).json({ ok: false, error: 'Transaction not found' });
      res.json({ ok: true, transaction: updated });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.delete('/api/transactions/:id', async (req, res) => {
    try {
      const removed = await storageService.deleteTransaction(req.params.id);
      if (!removed) return res.status(404).json({ ok: false, error: 'Transaction not found' });
      res.json({ ok: true, removed });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/sync', async (_req, res) => {
    try {
      const result = await sheetsService.syncPending();
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/config/apps-script', async (req, res) => {
    try {
      const url = String(req.body?.url || '').trim();
      if (!url || !url.startsWith('https://script.google.com/')) {
        return res.status(400).json({
          ok: false,
          error: 'Please enter a valid Google Apps Script Web App URL starting with https://script.google.com/',
        });
      }

      config.googleSheet.appsScriptUrl = url;
      const envPath = path.join(ROOT_DIR, '.env');
      try {
        let envContent = await fs.readFile(envPath, 'utf8');
        if (/^GOOGLE_APPS_SCRIPT_URL=.*$/m.test(envContent)) {
          envContent = envContent.replace(/^GOOGLE_APPS_SCRIPT_URL=.*$/m, `GOOGLE_APPS_SCRIPT_URL=${url}`);
        } else {
          envContent += `\nGOOGLE_APPS_SCRIPT_URL=${url}\n`;
        }
        await fs.writeFile(envPath, envContent, 'utf8');
      } catch {
        // Ignore if .env missing in tests
      }

      const test = await sheetsService.testConnection();
      let sync = null;
      if (test.ok) {
        sync = await sheetsService.syncPending();
      }
      res.json({ ok: test.ok, test, sync });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/report/excel', async (req, res) => {
    try {
      const monthKey =
        String(req.query.month || '').trim() ||
        getCurrentPayCycleKey(new Date(), config.timezone, config.schedule.cycleStartDay);
      const range = getPayCycleRange(
        monthKey,
        config.schedule.cycleStartDay,
        config.schedule.day
      );
      const { transactions } = range
        ? await sheetsService.getTransactionsForDateRange(range.startDate, range.endDate)
        : await sheetsService.getTransactionsForMonth(monthKey);
      const periodLabel = range
        ? `${formatMonthLabelKhmer(monthKey)} [${range.startDate} → ${range.endDate}]`
        : formatMonthLabelKhmer(monthKey);

      const { buffer, filename } = await buildMonthlyExcelBuffer(transactions, {
        monthKey,
        periodLabel,
        timezone: config.timezone,
      });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/report/send-telegram', async (req, res) => {
    try {
      const monthKey =
        String(req.body?.month || '').trim() ||
        getCurrentPayCycleKey(new Date(), config.timezone, config.schedule.cycleStartDay);
      const chatIds = req.body?.chatId
        ? [String(req.body.chatId)]
        : await telegramService.getTargetReportChatIds();

      if (!chatIds.length) {
        return res.status(400).json({
          ok: false,
          error: 'No Telegram chat ID found yet. Open your Telegram Bot and send /start first.',
        });
      }

      const results = [];
      for (const id of chatIds) {
        results.push(await telegramService.sendMonthlyReportToChat(id, monthKey));
      }
      res.json({ ok: true, monthKey, sentTo: chatIds, results });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.all('/api/cron/monthly-report', async (req, res) => {
    const providedSecret = String(req.query.secret || req.get('x-cron-secret') || '').trim();
    if (config.cronSecret && providedSecret !== config.cronSecret) {
      return res.status(403).json({ ok: false, error: 'Invalid cron secret' });
    }
    try {
      const force = String(req.query.force || '').toLowerCase() === 'true';
      const monthKey = String(req.query.month || '').trim() || null;
      const result = await schedulerService.runMonthlyCheck({ force, monthKey });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.all('/api/cron/reminders', async (req, res) => {
    const providedSecret = String(req.query.secret || req.get('x-cron-secret') || '').trim();
    if (config.cronSecret && providedSecret !== config.cronSecret) {
      return res.status(403).json({ ok: false, error: 'Invalid cron secret' });
    }
    try {
      const force = String(req.query.force || '').toLowerCase() === 'true';
      const waterBill = await schedulerService.runWaterBillCheck({ force });
      res.json({ ok: true, waterBill });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/webhook/telegram', async (req, res) => {
    const incomingSecret = req.get('x-telegram-bot-api-secret-token') || '';
    if (config.telegram.webhookSecret && incomingSecret !== config.telegram.webhookSecret) {
      return res.status(403).json({ ok: false, error: 'Invalid webhook secret' });
    }
    try {
      await telegramService.handleUpdate(req.body);
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[WebhookAsyncError]', err);
      res.status(200).json({ ok: false });
    }
  });

  return app;
}

async function startServer() {
  const app = createApp();
  const server = app.listen(config.port, async () => {
    console.log(`\n==================================================`);
    console.log(`🚀 Finance AI Automation Server running on http://localhost:${config.port}`);
    console.log(`⏰ Timezone: ${config.timezone}`);
    console.log(`==================================================\n`);

    let publicHttpsUrl = config.publicUrl || '';
    if (publicHttpsUrl) {
      console.log(`[Cloud] Using configured public URL: ${publicHttpsUrl}`);
    } else if (config.telegram.mode !== 'polling') {
      publicHttpsUrl = await ngrokService.startTunnel(config.port);
    }

    try {
      await telegramService.initialize(publicHttpsUrl);
    } catch (err) {
      console.error('[Startup] Telegram initialization failed:', err.message);
    }

    schedulerService.start();
  });

  const shutdown = () => {
    console.log('\n[Shutdown] Stopping services...');
    schedulerService.stop();
    telegramService.stop();
    ngrokService.stop();
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  startServer();
}
