import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';

import {
  extractMonthKey,
  formatMonthLabelKhmer,
  getCurrentPayCycleKey,
  getNextWaterBillMonth,
  getPayCycleRange,
  isDateInRange,
  isLastDayOfMonth,
  isMonthlyReportDay,
  isWaterBillMonth,
  isWaterBillReminderWindow,
} from '../src/utils/dateUtils.js';
import {
  isWaterBillTransaction,
  normalizeAmount,
  normalizeCurrency,
  normalizeTransactionRecord,
  normalizeType,
  SHEET_HEADERS,
  summarizeTransactions,
} from '../src/utils/financeUtils.js';
import { buildMonthlyExcelBuffer } from '../src/services/excelService.js';
import { GeminiService, selectBestFlashModels } from '../src/services/geminiService.js';
import { StorageService } from '../src/services/storageService.js';
import { createApp } from '../src/server.js';

test('dateUtils: isLastDayOfMonth handles 28, 29 (leap), 30, and 31 day months in Asia/Phnom_Penh', () => {
  // 2026-11-30 16:00 ICT == 2026-11-30T09:00:00Z
  assert.equal(isLastDayOfMonth(new Date('2026-11-30T09:00:00Z'), 'Asia/Phnom_Penh'), true);
  assert.equal(isLastDayOfMonth(new Date('2026-11-29T09:00:00Z'), 'Asia/Phnom_Penh'), false);
  // 2024-02-29 leap year
  assert.equal(isLastDayOfMonth(new Date('2024-02-29T09:00:00Z'), 'Asia/Phnom_Penh'), true);
  // 2026-02-28 non-leap year
  assert.equal(isLastDayOfMonth(new Date('2026-02-28T09:00:00Z'), 'Asia/Phnom_Penh'), true);
  // 2026-12-31
  assert.equal(isLastDayOfMonth(new Date('2026-12-31T09:00:00Z'), 'Asia/Phnom_Penh'), true);

  assert.equal(extractMonthKey('2026-11-26 09:15'), '2026-11');
  assert.match(formatMonthLabelKhmer('2026-11'), /2026-11/);
});

test('financeUtils: normalizes Khmer & English types, currencies ($ / ៛), amounts, and summaries', () => {
  assert.equal(normalizeType('Income'), 'ចំណូល');
  assert.equal(normalizeType('ចំណូល'), 'ចំណូល');
  assert.equal(normalizeType('Expense'), 'ចំណាយ');
  assert.equal(normalizeType('ចំណាយ'), 'ចំណាយ');

  assert.equal(normalizeCurrency('USD'), '$');
  assert.equal(normalizeCurrency('$'), '$');
  assert.equal(normalizeCurrency('KHR'), '៛');
  assert.equal(normalizeCurrency('រៀល'), '៛');
  assert.equal(normalizeCurrency('៛'), '៛');

  assert.equal(normalizeAmount('$12.50'), 12.5);
  assert.equal(normalizeAmount('20,000 ៛'), 20000);

  const sample = [
    normalizeTransactionRecord({
      date: '2026-11-26 08:30',
      type: 'ចំណូល',
      categories: 'Salary (ប្រាក់ខែ)',
      amount: 1000,
      currency: '$',
      description: 'Monthly salary',
      paymentMethod: 'ABA',
      location: 'Phnom Penh',
    }),
    normalizeTransactionRecord({
      date: '2026-11-26 09:00',
      type: 'ចំណាយ',
      categories: 'Food & Drink (អាហារ)',
      amount: 3.5,
      currency: '$',
      description: 'Coffee',
      paymentMethod: 'ABA',
      location: 'BKK1',
    }),
    normalizeTransactionRecord({
      date: '2026-11-26 12:15',
      type: 'ចំណាយ',
      categories: 'Food & Drink (អាហារ)',
      amount: 12000,
      currency: '៛',
      description: 'បាយថ្ងៃត្រង់',
      paymentMethod: 'Cash',
      location: 'ផ្សារថ្មី',
    }),
  ];

  const sum = summarizeTransactions(sample);
  assert.equal(sum.count, 3);
  assert.equal(sum.totals.USD.income, 1000);
  assert.equal(sum.totals.USD.expense, 3.5);
  assert.equal(sum.totals.USD.net, 996.5);
  assert.equal(sum.totals.KHR.income, 0);
  assert.equal(sum.totals.KHR.expense, 12000);
  assert.equal(sum.totals.KHR.net, -12000);
});

test('excelService: builds 2-sheet Excel workbook with Summary and 8-column Transactions sheet', async () => {
  const txs = [
    {
      date: '2026-11-26 08:00',
      type: 'ចំណូល',
      categories: 'Salary (ប្រាក់ខែ)',
      amount: 850,
      currency: '$',
      description: 'Salary',
      paymentMethod: 'ACLEDA',
      location: 'Office',
    },
    {
      date: '2026-11-26 09:30',
      type: 'ចំណាយ',
      categories: 'Transport (ដឹកជញ្ជូន)',
      amount: 20000,
      currency: '៛',
      description: 'ចាក់សាំង',
      paymentMethod: 'Cash',
      location: 'PTT Toul Kork',
    },
  ];

  const { buffer, filename, summary } = await buildMonthlyExcelBuffer(txs, { monthKey: '2026-11' });
  assert.equal(filename, 'Finance_Report_2026-11.xlsx');
  assert.equal(summary.totals.USD.income, 850);
  assert.equal(summary.totals.KHR.expense, 20000);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  assert.equal(wb.worksheets.length, 2);
  assert.equal(wb.worksheets[0].name, 'Summary (សរុប)');
  assert.equal(wb.worksheets[1].name, 'Transactions (លម្អិត)');

  const detailSheet = wb.getWorksheet('Transactions (លម្អិត)');
  const headers = detailSheet.getRow(1).values.slice(1);
  assert.deepEqual(headers, SHEET_HEADERS);
  assert.equal(detailSheet.getRow(1).getCell(1).font.name, 'Kantumruy Pro');
  assert.equal(detailSheet.getRow(1).getCell(1).font.bold, true);
  assert.equal(detailSheet.getRow(2).getCell(4).value, 850);
  assert.equal(detailSheet.getRow(2).getCell(5).value, '$');
  assert.equal(detailSheet.getRow(3).getCell(4).value, 20000);
  assert.equal(detailSheet.getRow(3).getCell(5).value, '៛');
  assert.equal(detailSheet.getRow(3).getCell(8).value, 'PTT Toul Kork');
});

test('storageService: handles transactions, recent location attachment, and undo', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kh-fin-test-'));
  const store = new StorageService({
    transactionsFile: path.join(tmpDir, 'transactions.json'),
    botStateFile: path.join(tmpDir, 'bot-state.json'),
  });

  const saved = await store.addTransactions(
    [
      {
        date: '2026-11-26 10:00',
        type: 'ចំណាយ',
        categories: 'Food & Drink (អាហារ)',
        amount: 4.5,
        currency: '$',
        description: 'Latte',
        paymentMethod: 'ABA',
        location: '',
      },
    ],
    { chatId: '12345', messageType: 'text' }
  );

  assert.equal(saved.length, 1);
  const attached = await store.attachLocationToRecentTransactions('12345', 'Brown BKK1');
  assert.equal(attached.length, 1);
  assert.equal(attached[0].location, 'Brown BKK1');

  const monthRows = await store.getTransactionsByMonth('2026-11');
  assert.equal(monthRows.length, 1);
  assert.equal(monthRows[0].location, 'Brown BKK1');

  const undone = await store.removeLastTransactionForChat('12345');
  assert.equal(undone.id, saved[0].id);
  assert.equal((await store.getAllTransactions()).length, 0);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('server HTTP endpoints respond cleanly', async () => {
  const app = createApp();
  const server = app.listen(0);
  const { port } = server.address();

  try {
    const healthRes = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.ok, true);

    const statusRes = await fetch(`http://127.0.0.1:${port}/api/status`);
    assert.equal(statusRes.status, 200);
    const status = await statusRes.json();
    assert.equal(status.ok, true);
    assert.equal(status.timezone, 'Asia/Phnom_Penh');

    const excelRes = await fetch(`http://127.0.0.1:${port}/api/report/excel?month=2026-11`);
    assert.equal(excelRes.status, 200);
    assert.match(excelRes.headers.get('content-type') || '', /spreadsheetml\.sheet/);

    const badCronRes = await fetch(`http://127.0.0.1:${port}/api/cron/monthly-report?secret=wrong`);
    assert.equal(badCronRes.status, 403);

    const badRemRes = await fetch(`http://127.0.0.1:${port}/api/cron/reminders?secret=wrong`);
    assert.equal(badRemRes.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('geminiService: auto-discovers and caches live Flash model when older models return 404', async () => {
  const ranked = selectBestFlashModels([
    { name: 'models/gemini-2.5-flash-preview-tts', supportedActions: ['generateContent'] },
    { name: 'models/gemini-3.5-flash-image', supportedActions: ['generateContent'] },
    { name: 'models/gemini-4.5-flash-lite', supportedActions: ['generateContent'] },
    { name: 'models/gemini-flash-lite-latest', supportedActions: ['generateContent'] },
    { name: 'models/gemini-4.5-pro', supportedActions: ['generateContent'] },
    { name: 'models/gemma-4-31b-it', supportedActions: ['generateContent'] },
  ]);
  assert.deepEqual(ranked, ['gemini-flash-lite-latest', 'gemini-4.5-flash-lite']);

  const calls = [];
  const mockClient = {
    models: {
      async list() {
        return {
          async *[Symbol.asyncIterator]() {
            yield { name: 'models/gemini-9.0-flash-lite', supportedActions: ['generateContent'] };
          },
        };
      },
      async generateContent({ model }) {
        calls.push(model);
        if (model === 'gemini-9.0-flash-lite') {
          return { text: 'OK' };
        }
        throw new Error('{"error":{"code":404,"status":"NOT_FOUND"}}');
      },
    },
  };

  const svc = new GeminiService({ apiKey: 'test-key', model: 'gemini-dead-model', client: mockClient });
  const first = await svc.testConnection();
  assert.equal(first.ok, true);
  assert.equal(first.model, 'gemini-9.0-flash-lite');

  calls.length = 0;
  const second = await svc.testConnection();
  assert.equal(second.ok, true);
  assert.deepEqual(calls, ['gemini-9.0-flash-lite']);
});

test('waterBill: detects bi-monthly days 16-18 window and matches water utility transactions accurately', () => {
  assert.equal(isWaterBillMonth('2026-12', '2026-12'), true);
  assert.equal(isWaterBillMonth('2027-01', '2026-12'), false);
  assert.equal(isWaterBillMonth('2027-02', '2026-12'), true);

  assert.equal(
    isWaterBillReminderWindow(new Date('2026-12-16T02:00:00Z'), 'Asia/Phnom_Penh', '2026-12', 16, 18).active,
    true
  );
  assert.equal(
    isWaterBillReminderWindow(new Date('2026-12-18T02:00:00Z'), 'Asia/Phnom_Penh', '2026-12', 16, 18).active,
    true
  );
  assert.equal(
    isWaterBillReminderWindow(new Date('2026-12-15T02:00:00Z'), 'Asia/Phnom_Penh', '2026-12', 16, 18).active,
    false
  );
  assert.equal(
    isWaterBillReminderWindow(new Date('2027-01-17T02:00:00Z'), 'Asia/Phnom_Penh', '2026-12', 16, 18).active,
    false
  );

  assert.equal(getNextWaterBillMonth(new Date('2026-11-27T09:00:00Z'), 'Asia/Phnom_Penh', '2026-12', 18), '2026-12');
  assert.equal(getNextWaterBillMonth(new Date('2026-12-19T09:00:00Z'), 'Asia/Phnom_Penh', '2026-12', 18), '2027-02');
  assert.equal(getNextWaterBillMonth(new Date('2026-11-27T09:00:00Z'), 'Asia/Phnom_Penh', '2027-01', 18), '2027-01');
  assert.equal(isWaterBillMonth('2026-12', '2027-01'), false);
  assert.equal(isWaterBillMonth('2027-01', '2027-01'), true);
  assert.equal(isWaterBillMonth('2027-03', '2027-01'), true);

  assert.equal(isWaterBillTransaction({ description: 'បង់វិក្កយបត្រទឹក PPWSA', categories: 'Bills & Utilities' }), true);
  assert.equal(isWaterBillTransaction({ description: 'ទិញទឹកសុទ្ធ ២ដប', categories: 'Food & Drink' }), false);
});

test('paydayCycle: sends on day 27 and aggregates 28th prev month through 27th current month', () => {
  assert.equal(isMonthlyReportDay(new Date('2026-12-27T09:00:00Z'), 'Asia/Phnom_Penh', 27), true);
  assert.equal(isMonthlyReportDay(new Date('2026-12-28T09:00:00Z'), 'Asia/Phnom_Penh', 27), false);

  // On Nov 28 (payday!), transactions belong to the Dec cycle (2026-11-28 -> 2026-12-27)
  assert.equal(getCurrentPayCycleKey(new Date('2026-11-28T09:00:00Z'), 'Asia/Phnom_Penh', 28), '2026-12');
  assert.equal(getCurrentPayCycleKey(new Date('2026-12-27T09:00:00Z'), 'Asia/Phnom_Penh', 28), '2026-12');
  assert.equal(getCurrentPayCycleKey(new Date('2026-12-28T09:00:00Z'), 'Asia/Phnom_Penh', 28), '2027-01');

  const decRange = getPayCycleRange('2026-12', 28, 27);
  assert.equal(decRange.startDate, '2026-11-28');
  assert.equal(decRange.endDate, '2026-12-27');

  const janRange = getPayCycleRange('2027-01', 28, 27);
  assert.equal(janRange.startDate, '2026-12-28');
  assert.equal(janRange.endDate, '2027-01-27');

  assert.equal(isDateInRange('2026-11-28 08:00', decRange.startDate, decRange.endDate), true);
  assert.equal(isDateInRange('2026-12-27 15:59', decRange.startDate, decRange.endDate), true);
  assert.equal(isDateInRange('2026-11-27 23:59', decRange.startDate, decRange.endDate), false);
  assert.equal(isDateInRange('2026-12-28 08:00', decRange.startDate, decRange.endDate), false);
});
