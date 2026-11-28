import { config } from '../config.js';
import {
  formatMonthLabelKhmer,
  getCurrentMonthKey,
  getCurrentPayCycleKey,
  getNextWaterBillMonth,
  getPayCycleRange,
  getTodayDateString,
  parseMonthKey,
} from '../utils/dateUtils.js';
import {
  formatMoney,
  isWaterBillTransaction,
  summarizeTransactions,
} from '../utils/financeUtils.js';
import { buildMonthlyExcelBuffer } from './excelService.js';
import { geminiService } from './geminiService.js';
import { sheetsService } from './sheetsService.js';
import { storageService } from './storageService.js';

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export class TelegramService {
  constructor() {
    this.token = config.telegram.botToken;
    this.mode = 'idle'; // 'webhook' | 'polling' | 'idle'
    this.webhookUrl = '';
    this.pollingActive = false;
    this.pollingOffset = 0;
    this.botInfo = null;
  }

  isConfigured() {
    return Boolean(this.token);
  }

  async apiCall(method, body = null) {
    if (!this.token) throw new Error('TELEGRAM_BOT_TOKEN missing');
    const url = `https://api.telegram.org/bot${this.token}/${method}`;
    const options = body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : { method: 'GET' };

    const res = await fetch(url, options);
    const data = await res.json();
    if (!data.ok) {
      throw new Error(`Telegram API ${method} failed: ${data.description || res.status}`);
    }
    return data.result;
  }

  async sendMessage(chatId, htmlText, extra = {}) {
    return this.apiCall('sendMessage', {
      chat_id: chatId,
      text: htmlText,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra,
    });
  }

  async editMessageText(chatId, messageId, htmlText, extra = {}) {
    return this.apiCall('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: htmlText,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra,
    });
  }

  async answerCallbackQuery(callbackQueryId, text = '') {
    try {
      await this.apiCall('answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        text,
      });
    } catch {
      // Ignore expired callback query warnings
    }
  }

  async sendChatAction(chatId, action = 'typing') {
    try {
      await this.apiCall('sendChatAction', { chat_id: chatId, action });
    } catch {
      // Ignore typing indicator errors
    }
  }

  async sendDocument(chatId, buffer, filename, caption = '') {
    if (!this.token) throw new Error('TELEGRAM_BOT_TOKEN missing');
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (caption) {
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');
    }
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    form.append('document', blob, filename);

    const res = await fetch(`https://api.telegram.org/bot${this.token}/sendDocument`, {
      method: 'POST',
      body: form,
    });
    const data = await res.json();
    if (!data.ok) {
      throw new Error(`Telegram sendDocument failed: ${data.description || res.status}`);
    }
    return data.result;
  }

  async downloadFile(fileId) {
    const fileInfo = await this.apiCall('getFile', { file_id: fileId });
    const filePath = fileInfo.file_path;
    const res = await fetch(`https://api.telegram.org/file/bot${this.token}/${filePath}`);
    if (!res.ok) {
      throw new Error(`Failed to download Telegram file (${res.status})`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      filePath,
    };
  }

  async isChatAllowed(chatId) {
    const id = String(chatId);
    if (config.telegram.allowedChatIds.length > 0) {
      return config.telegram.allowedChatIds.includes(id);
    }
    // Auto-remember active chat ID as owner when allowed list isn't locked
    await storageService.registerOwnerChatId(id);
    return true;
  }

  async getTargetReportChatIds() {
    if (config.telegram.allowedChatIds.length > 0) {
      return config.telegram.allowedChatIds;
    }
    const state = await storageService.getState();
    return state.ownerChatIds;
  }

  async sendMonthlyReportToChat(
    chatId,
    monthKey = getCurrentPayCycleKey(new Date(), config.timezone, config.schedule.cycleStartDay)
  ) {
    const range = getPayCycleRange(
      monthKey,
      config.schedule.cycleStartDay,
      config.schedule.day
    );
    const { transactions, source } = range
      ? await sheetsService.getTransactionsForDateRange(range.startDate, range.endDate)
      : await sheetsService.getTransactionsForMonth(monthKey);

    const periodLabel = range
      ? `${formatMonthLabelKhmer(monthKey)} [${range.startDate} → ${range.endDate}]`
      : formatMonthLabelKhmer(monthKey);

    const { buffer, summary, filename } = await buildMonthlyExcelBuffer(transactions, {
      monthKey,
      periodLabel,
      timezone: config.timezone,
    });

    const caption = [
      `📊 <b>របាយការណ៍ចំណូល-ចំណាយប្រចាំខែ ${escapeHtml(formatMonthLabelKhmer(monthKey))}</b>`,
      range ? `📅 វដ្ត: <b>${escapeHtml(range.startDate)}</b> ដល់ <b>${escapeHtml(range.endDate)}</b>` : null,
      `- ប្រតិបត្តិការសរុប: <b>${summary.count}</b>`,
      `- ចំណូល USD: <b>${escapeHtml(formatMoney(summary.totals.USD.income, '$'))}</b> | ចំណាយ: <b>${escapeHtml(formatMoney(summary.totals.USD.expense, '$'))}</b>`,
      `- សមតុល្យ USD: <b>${escapeHtml(formatMoney(summary.totals.USD.net, '$'))}</b>`,
      `- ចំណូល KHR: <b>${escapeHtml(formatMoney(summary.totals.KHR.income, '៛'))}</b> | ចំណាយ: <b>${escapeHtml(formatMoney(summary.totals.KHR.expense, '៛'))}</b>`,
      `- សមតុល្យ KHR: <b>${escapeHtml(formatMoney(summary.totals.KHR.net, '៛'))}</b>`,
      `📁 មាន ២ Sheets: <i>Summary (សរុប)</i> និង <i>Transactions (លម្អិត)</i>`,
      `<i>ប្រភពទិន្នន័យ: ${escapeHtml(source)}</i>`,
    ]
      .filter(Boolean)
      .join('\n');

    await this.sendDocument(chatId, buffer, filename, caption);
    return { filename, count: summary.count, summary };
  }

  async sendWaterBillReminderToChat(chatId, monthKey = getCurrentMonthKey(config.timezone)) {
    const msg = [
      `💧 <b>រំលឹកបង់វិក្កយបត្រទឹក (${escapeHtml(formatMonthLabelKhmer(monthKey))})</b>`,
      ``,
      `ដល់វដ្តបង់វិក្កយបត្រទឹក (២ ខែម្តង · ថ្ងៃទី 16-18) ហើយ!`,
      `បើអ្នកបានបង់រួច សូមផ្ញើ <b>រូបវិក្កយបត្រ ABA/ACLEDA</b> ឬវាយចំនួនទឹកប្រាក់ (ឧ. <i>"បង់ថ្លៃទឹក 25000 រៀល ABA"</i>) ដើម្បីកត់ចូល Google Sheet ហើយឈប់រំលឹកដោយស្វ័យប្រវត្តិ។`,
    ].join('\n');

    await this.sendMessage(chatId, msg, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ របៀបកត់ត្រា', callback_data: 'wb:paid_prompt' },
            { text: '⏭ ឈប់រំលឹកខែនេះ', callback_data: `wb:snooze:${monthKey}` },
          ],
        ],
      },
    });
  }

  async sendWaterBillStatusToChat(chatId) {
    const wbCfg = config.reminders.waterBill;
    const anchorMonth = await storageService.getWaterBillAnchorMonth(wbCfg.anchorMonth);
    const nextMonth = getNextWaterBillMonth(new Date(), config.timezone, anchorMonth, wbCfg.endDay);
    const currentMonth = getCurrentMonthKey(config.timezone);
    const snoozed = await storageService.isWaterBillSnoozed(nextMonth);
    const { transactions } = await sheetsService.getTransactionsForMonth(currentMonth);
    const paidThisMonth = transactions.some(isWaterBillTransaction);
    const hh = String(wbCfg.hour).padStart(2, '0');
    const mm = String(wbCfg.minute).padStart(2, '0');

    const msg = [
      `💧 <b>ការរំលឹកបង់វិក្កយបត្រទឹក (២ ខែម្តង)</b>`,
      `- ថ្ងៃរំលឹក: <b>ថ្ងៃទី ${wbCfg.startDay} ដល់ ${wbCfg.endDay}</b> (ម៉ោង ${hh}:${mm})`,
      `- ខែបន្ទាប់: <b>${escapeHtml(formatMonthLabelKhmer(nextMonth))}</b>`,
      `- វដ្តគោល (Anchor): <code>${escapeHtml(anchorMonth)}</code>`,
      `- ស្ថានភាពខែនេះ: ${paidThisMonth ? '✅ បង់រួចហើយ' : snoozed ? '⏭ បានផ្អាកខែនេះ' : '⏳ រង់ចាំបង់តាមវដ្ត'}`,
      ``,
      `<i>អាចវាយ /waterbill YYYY-MM (ឧ. /waterbill 2027-01) ឬចុចប៊ូតុងខាងក្រោមដើម្បីប្តូរវដ្ត។</i>`,
    ].join('\n');

    await this.sendMessage(chatId, msg, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📅 ខែគូ (ធ្នូ, កុម្ភៈ, មេសា...)', callback_data: 'wb:cycle:2026-12' },
            { text: '📅 ខែសេស (មករា, មីនា, ឧសភា...)', callback_data: 'wb:cycle:2027-01' },
          ],
          [
            { text: '🔔 សាកផ្ញើសាររំលឹកឥឡូវ', callback_data: `wb:test:${nextMonth}` },
            { text: '⏭ ឈប់រំលឹកខែបន្ទាប់', callback_data: `wb:snooze:${nextMonth}` },
          ],
        ],
      },
    });
  }

  async handleCommand(chatId, text) {
    const [cmdRaw, argRaw] = text.trim().split(/\s+/, 2);
    const cmd = cmdRaw.toLowerCase().split('@')[0];

    if (cmd === '/start' || cmd === '/help') {
      await storageService.registerOwnerChatId(chatId);
      const replyMarkup = {
        keyboard: [
          [{ text: '/summary' }, { text: '/report' }, { text: '/waterbill' }],
        ],
        resize_keyboard: true,
      };

      const msg = [
        `សួស្តី! 🤖 <b>ជំនួយការកត់ត្រាចំណូល-ចំណាយ AI</b>`,
        ``,
        `អ្នកអាចផ្ញើមកខ្ញុំបានគ្រប់ទម្រង់:`,
        `1️⃣ <b>សារអក្សរ (ខ្មែរ/អង់គ្លេស):</b> ឧ. <i>"កាហ្វេ Amazon 2.5$ ABA នៅ BKK1"</i> ឬ <i>"ទទួលប្រាក់ខែ 800$ ACLEDA"</i>`,
        `2️⃣ <b>សារសំឡេង (Voice):</b> និយាយប្រាប់ចំណូល ឬ ចំណាយជាភាសាខ្មែរ/អង់គ្លេស`,
        `3️⃣ <b>រូបភាពវិក្កយបត្រ (Receipt Photo):</b> ថតរូបវិក្កយបត្រ ឬ Screenshot ផ្ទេរប្រាក់ ABA/ACLEDA`,
        `4️⃣ <b>ទីតាំង (Location):</b> AI ចាប់យកឈ្មោះហាង អ្នកទទួល ឬទីកន្លែងដោយស្វ័យប្រវត្តិពីសារ សំឡេង និងវិក្កយបត្រ`,
        ``,
        `<b>ពាក្យបញ្ជាសំខាន់ៗ:</b>`,
        `- /summary : មើលសង្ខេបថ្ងៃនេះ និងវដ្តប្រាក់ខែ (${config.schedule.cycleStartDay}→${config.schedule.day})`,
        `- /report : ទាញយក File Excel វដ្តប្រាក់ខែបច្ចុប្បន្ន (${config.schedule.cycleStartDay}→${config.schedule.day})`,
        `- /report 2026-12 : ទាញយក Excel វដ្តជាក់លាក់ (2026-11-28 → 2026-12-27)`,
        `- /undo : លុបកំណត់ត្រាចុងក្រោយ`,
        `- /sync : រុញទិន្នន័យដែលមិនទាន់ចូល Google Sheet`,
        `- /waterbill : កំណត់ និងមើលការរំលឹកវិក្កយបត្រទឹក (២ ខែម្តង ថ្ងៃ 16-18)`,
        `- /myid : មើល Chat ID របស់អ្នក (<code>${escapeHtml(chatId)}</code>)`,
      ].join('\n');

      await this.sendMessage(chatId, msg, { reply_markup: replyMarkup });
      return;
    }

    if (cmd === '/myid') {
      await this.sendMessage(chatId, `🆔 Chat ID របស់អ្នកគឺ៖ <code>${escapeHtml(chatId)}</code>`);
      return;
    }

    if (cmd === '/location') {
      await this.sendMessage(
        chatId,
        'សូមចុចប៊ូតុង <b>"📍 Share Location (ចែករំលែកទីតាំង)"</b> ឬផ្ញើ Location pin ពី Telegram (📎 → Location)។',
        {
          reply_markup: {
            keyboard: [[{ text: '📍 Share Location (ចែករំលែកទីតាំង)', request_location: true }]],
            resize_keyboard: true,
          },
        }
      );
      return;
    }

    if (cmd === '/summary' || cmd === '/today') {
      const cycleKey = getCurrentPayCycleKey(
        new Date(),
        config.timezone,
        config.schedule.cycleStartDay
      );
      const range = getPayCycleRange(cycleKey, config.schedule.cycleStartDay, config.schedule.day);
      const todayKey = getTodayDateString(config.timezone);
      const { transactions } = await sheetsService.getTransactionsForDateRange(
        range.startDate,
        range.endDate
      );
      const monthSum = summarizeTransactions(transactions);
      const todayTxs = transactions.filter((t) => String(t.date || '').startsWith(todayKey));
      const todaySum = summarizeTransactions(todayTxs);

      const msg = [
        `📈 <b>សង្ខេបចំណូល-ចំណាយ</b>`,
        ``,
        `<b>📅 ថ្ងៃនេះ (${escapeHtml(todayKey)}) (${todaySum.count} ប្រតិបត្តិការ):</b>`,
        `- USD ($): ចំណូល <b>${escapeHtml(formatMoney(todaySum.totals.USD.income, '$'))}</b> | ចំណាយ <b>${escapeHtml(formatMoney(todaySum.totals.USD.expense, '$'))}</b>`,
        `- KHR (៛): ចំណូល <b>${escapeHtml(formatMoney(todaySum.totals.KHR.income, '៛'))}</b> | ចំណាយ <b>${escapeHtml(formatMoney(todaySum.totals.KHR.expense, '៛'))}</b>`,
        ``,
        `<b>🗓 វដ្តប្រាក់ខែ (${escapeHtml(range.startDate)} → ${escapeHtml(range.endDate)}) (${monthSum.count} ប្រតិបត្តិការ):</b>`,
        `- USD ($): ចំណូល <b>${escapeHtml(formatMoney(monthSum.totals.USD.income, '$'))}</b> | ចំណាយ <b>${escapeHtml(formatMoney(monthSum.totals.USD.expense, '$'))}</b> | សល់ <b>${escapeHtml(formatMoney(monthSum.totals.USD.net, '$'))}</b>`,
        `- KHR (៛): ចំណូល <b>${escapeHtml(formatMoney(monthSum.totals.KHR.income, '៛'))}</b> | ចំណាយ <b>${escapeHtml(formatMoney(monthSum.totals.KHR.expense, '៛'))}</b> | សល់ <b>${escapeHtml(formatMoney(monthSum.totals.KHR.net, '៛'))}</b>`,
      ].join('\n');

      await this.sendMessage(chatId, msg);
      return;
    }

    if (cmd === '/report') {
      await this.sendChatAction(chatId, 'upload_document');
      const monthKey = /^\d{4}-\d{2}$/.test(argRaw || '')
        ? argRaw
        : getCurrentPayCycleKey(new Date(), config.timezone, config.schedule.cycleStartDay);
      await this.sendMonthlyReportToChat(chatId, monthKey);
      return;
    }

    if (cmd === '/undo') {
      const removed = await storageService.removeLastTransactionForChat(chatId);
      if (!removed) {
        await this.sendMessage(chatId, 'មិនមានកំណត់ត្រាសម្រាប់លុបទេ។');
        return;
      }
      let sheetNote = '';
      if (removed.syncedToSheet) {
        const res = await sheetsService.deleteLastRowFromSheet();
        sheetNote = res.deleted
          ? '\n✅ បានលុបជួរចុងក្រោយពី Google Sheet ផងដែរ។'
          : '\nℹ️ កំណត់ត្រានៅលើ Google Sheet អាចត្រូវលុបដោយដៃបើអ្នកប្រើ Service Account។';
      }
      await this.sendMessage(
        chatId,
        `🗑 បានលុបកំណត់ត្រាចុងក្រោយ៖ <b>${escapeHtml(removed.type)}</b> ${escapeHtml(formatMoney(removed.amount, removed.currency))} (${escapeHtml(removed.categories)})${sheetNote}`
      );
      return;
    }

    if (cmd === '/sync') {
      const res = await sheetsService.syncPending();
      await this.sendMessage(chatId, `🔄 ${escapeHtml(res.message)}`);
      return;
    }

    if (cmd === '/waterbill') {
      if (argRaw === 'test') {
        const anchor = await storageService.getWaterBillAnchorMonth(config.reminders.waterBill.anchorMonth);
        const nextMonth = getNextWaterBillMonth(new Date(), config.timezone, anchor, config.reminders.waterBill.endDay);
        await this.sendWaterBillReminderToChat(chatId, nextMonth);
        return;
      }
      if (parseMonthKey(argRaw)) {
        await storageService.setWaterBillAnchorMonth(argRaw);
        await this.sendMessage(chatId, `✅ បានប្តូរវដ្តរំលឹកវិក្កយបត្រទឹក ២ ខែម្តង ចាប់ពីខែ <b>${escapeHtml(argRaw)}</b>!`);
      }
      await this.sendWaterBillStatusToChat(chatId);
      return;
    }

    await this.sendMessage(chatId, 'មិនស្គាល់ពាក្យបញ្ជានេះទេ។ វាយ /help ដើម្បីមើលការណែនាំ។');
  }

  async handleCallbackQuery(callbackQuery) {
    const chatId = callbackQuery?.message?.chat?.id;
    const messageId = callbackQuery?.message?.message_id;
    const data = String(callbackQuery?.data || '');
    if (!chatId) return;

    const allowed = await this.isChatAllowed(chatId);
    if (!allowed) {
      await this.answerCallbackQuery(callbackQuery.id, 'Unauthorized');
      return;
    }

    if (data === 'wb:paid_prompt') {
      await this.answerCallbackQuery(callbackQuery.id, 'ផ្ញើវិក្កយបត្រឬចំនួនទឹកប្រាក់មក Bot!');
      await this.sendMessage(
        chatId,
        '💧 សូមផ្ញើ <b>រូបវិក្កយបត្រ ABA/ACLEDA</b> ឬវាយ/និយាយប្រាប់ (ឧ. <i>"បង់ថ្លៃទឹក 25000 រៀល ABA"</i>) ដើម្បីកត់ចូល Google Sheet។ ពេលកត់រួច ប្រព័ន្ធនឹងឈប់រំលឹកខែនេះដោយស្វ័យប្រវត្តិ!'
      );
      return;
    }

    if (data.startsWith('wb:snooze:')) {
      const monthKey = data.slice('wb:snooze:'.length);
      await storageService.snoozeWaterBillMonth(monthKey);
      await this.answerCallbackQuery(callbackQuery.id, `បានឈប់រំលឹកខែ ${monthKey}`);
      if (messageId) {
        await this.editMessageText(
          chatId,
          messageId,
          `✅ បានឈប់រំលឹកវិក្កយបត្រទឹកសម្រាប់ខែ <b>${escapeHtml(monthKey)}</b> រួចរាល់!`
        ).catch(() => {});
      }
      return;
    }

    if (data.startsWith('wb:cycle:')) {
      const anchor = data.slice('wb:cycle:'.length);
      if (parseMonthKey(anchor)) {
        await storageService.setWaterBillAnchorMonth(anchor);
        await this.answerCallbackQuery(callbackQuery.id, `ប្តូរវដ្តទៅ ${anchor}`);
        await this.sendWaterBillStatusToChat(chatId);
      }
      return;
    }

    if (data.startsWith('wb:test:')) {
      const monthKey = data.slice('wb:test:'.length) || getCurrentMonthKey(config.timezone);
      await this.answerCallbackQuery(callbackQuery.id, 'កំពុងផ្ញើសាររំលឹកសាកល្បង...');
      await this.sendWaterBillReminderToChat(chatId, monthKey);
    }
  }

  async handleLocationMessage(chatId, message) {
    const loc = message.location || message.venue?.location;
    if (!loc) return;

    const coords = `${Number(loc.latitude).toFixed(5)}, ${Number(loc.longitude).toFixed(5)}`;
    const venueTitle = message.venue?.title ? `${message.venue.title} (${coords})` : `https://maps.google.com/?q=${loc.latitude},${loc.longitude}`;

    await storageService.setRecentLocation(chatId, {
      latitude: loc.latitude,
      longitude: loc.longitude,
      label: venueTitle,
    });

    const attached = await storageService.attachLocationToRecentTransactions(chatId, venueTitle);
    if (attached.length > 0) {
      await this.sendMessage(
        chatId,
        `📍 បានចាប់ទីតាំង និងភ្ជាប់ទៅកំណត់ត្រាថ្មីៗចំនួន <b>${attached.length}</b> រួចហើយ៖\n<code>${escapeHtml(venueTitle)}</code>\n<i>(ទីតាំងនេះក៏នឹងប្រើដោយស្វ័យប្រវត្តិសម្រាប់សារបន្ទាប់ក្នុងរយៈពេល 30 នាទី)</i>`
      );
    } else {
      await this.sendMessage(
        chatId,
        `📍 បានរក្សាទុកទីតាំងបច្ចុប្បន្នរួចហើយ៖\n<code>${escapeHtml(venueTitle)}</code>\n<i>(រាល់ការផ្ញើសារ សំឡេង ឬវិក្កយបត្រក្នុងរយៈពេល 30 នាទីខាងមុខ នឹងភ្ជាប់ទីតាំងនេះដោយស្វ័យប្រវត្តិ)</i>`
      );
    }
  }

  async saveAndConfirmTransactions(chatId, parsed, messageType) {
    if (!parsed.isTransaction || !parsed.transactions.length) {
      await this.sendMessage(
        chatId,
        parsed.replyText
          ? `🤖 ${escapeHtml(parsed.replyText)}`
          : '🤔 ខ្ញុំមិនទាន់យល់ពីចំនួនទឹកប្រាក់ទេ។ សូមសរសេរ ឬនិយាយបញ្ជាក់ចំនួនទឹកប្រាក់ និងប្រភេទចំណូល/ចំណាយ (ឧ. "កាហ្វេ 2.5$ ABA")។'
      );
      return;
    }

    const saved = await storageService.addTransactions(parsed.transactions, {
      chatId,
      messageType,
      syncedToSheet: false,
    });

    const lines = saved.map((tx, i) => {
      const icon = tx.type === 'ចំណូល' ? '🟢' : '🔴';
      const prefix = saved.length > 1 ? `#${i + 1} ` : '';
      return [
        `${prefix}${icon} <b>${escapeHtml(tx.type)}: ${escapeHtml(formatMoney(tx.amount, tx.currency))}</b>`,
        `📅 កាលបរិច្ឆេទ: ${escapeHtml(tx.date)}`,
        `🏷 ប្រភេទ: ${escapeHtml(tx.categories)}`,
        tx.description ? `📝 ពណ៌នា: ${escapeHtml(tx.description)}` : null,
        tx.paymentMethod ? `💳 ទូទាត់: ${escapeHtml(tx.paymentMethod)}` : null,
        tx.location ? `📍 ទីតាំង: ${escapeHtml(tx.location)}` : null,
      ]
        .filter(Boolean)
        .join('\n');
    });

    const buildBody = (statusLine) =>
      `${lines.join('\n\n')}\n\n${escapeHtml(statusLine)}\n<i>វាយ /undo បើចង់លុប ឬ /summary ដើម្បីមើលសរុប។</i>`;

    const sheetMode = await sheetsService.getMode();
    if (sheetMode === 'local_only') {
      await this.sendMessage(
        chatId,
        buildBody('💾 រក្សាទុកក្នុង Local (មិនទាន់ភ្ជាប់ Google Sheet ទេ)')
      );
      return;
    }

    // Reply immediately after AI parsing, then sync to Google Sheet and update status
    const sentMsg = await this.sendMessage(chatId, buildBody('⏳ កំពុងបញ្ជូនចូល Google Sheet...'));

    try {
      const syncRes = await sheetsService.appendTransactions(saved);
      const finalStatus = syncRes.synced
        ? '📊 កត់ចូល Google Sheet រួចរាល់!'
        : '💾 រក្សាទុកក្នុង Local (មិនទាន់ភ្ជាប់ Google Sheet ទេ)';
      await this.editMessageText(chatId, sentMsg.message_id, buildBody(finalStatus)).catch(() => {});
    } catch (err) {
      console.error('[SheetsSyncError]', err);
      await this.editMessageText(
        chatId,
        sentMsg.message_id,
        buildBody(`⚠️ រក្សាទុកក្នុង Local រួច តែភ្ជាប់ Google Sheet មានបញ្ហា៖ ${err.message}`)
      ).catch(() => {});
    }
  }

  async handleUpdate(update) {
    if (update?.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
      return;
    }

    const message = update?.message || update?.edited_message;
    if (!message || !message.chat) return;

    const chatId = message.chat.id;
    const allowed = await this.isChatAllowed(chatId);
    if (!allowed) {
      await this.sendMessage(chatId, `⛔ Chat ID (${escapeHtml(chatId)}) មិនត្រូវបានអនុញ្ញាតទេ។`);
      return;
    }

    try {
      const text = (message.text || '').trim();
      if (text.startsWith('/')) {
        await this.handleCommand(chatId, text);
        return;
      }

      if (message.location || message.venue) {
        await this.handleLocationMessage(chatId, message);
        return;
      }

      const defaultLocation = await storageService.getRecentLocation(chatId);

      if (message.voice || message.audio) {
        void this.sendChatAction(chatId, 'typing');
        const mediaObj = message.voice || message.audio;
        const { buffer } = await this.downloadFile(mediaObj.file_id);
        const mimeType = mediaObj.mime_type || 'audio/ogg';
        const parsed = await geminiService.parseInput({
          text: message.caption || '',
          mediaBuffer: buffer,
          mimeType,
          defaultLocation,
        });
        await this.saveAndConfirmTransactions(chatId, parsed, 'voice');
        return;
      }

      if (Array.isArray(message.photo) && message.photo.length > 0) {
        void this.sendChatAction(chatId, 'typing');
        const largest = message.photo[message.photo.length - 1];
        const { buffer } = await this.downloadFile(largest.file_id);
        const parsed = await geminiService.parseInput({
          text: message.caption || '',
          mediaBuffer: buffer,
          mimeType: 'image/jpeg',
          defaultLocation,
        });
        await this.saveAndConfirmTransactions(chatId, parsed, 'photo');
        return;
      }

      if (message.document && String(message.document.mime_type || '').startsWith('image/')) {
        void this.sendChatAction(chatId, 'typing');
        const { buffer } = await this.downloadFile(message.document.file_id);
        const parsed = await geminiService.parseInput({
          text: message.caption || '',
          mediaBuffer: buffer,
          mimeType: message.document.mime_type,
          defaultLocation,
        });
        await this.saveAndConfirmTransactions(chatId, parsed, 'photo_document');
        return;
      }

      if (text) {
        void this.sendChatAction(chatId, 'typing');
        const parsed = await geminiService.parseInput({
          text,
          defaultLocation,
        });
        await this.saveAndConfirmTransactions(chatId, parsed, 'text');
        return;
      }

      await this.sendMessage(
        chatId,
        'សូមផ្ញើជាសារអក្សរ, សារសំឡេង (Voice), រូបភាពវិក្កយបត្រ, ឬ Location។'
      );
    } catch (err) {
      console.error('[TelegramUpdateError]', err);
      await this.sendMessage(
        chatId,
        `❌ មានបញ្ហាក្នុងការដំណើរការ៖ <code>${escapeHtml(err.message)}</code>`
      );
    }
  }

  async startWebhook(publicHttpsUrl) {
    const cleanBase = publicHttpsUrl.replace(/\/+$/, '');
    const webhookUrl = `${cleanBase}/webhook/telegram`;
    await this.apiCall('setWebhook', {
      url: webhookUrl,
      secret_token: config.telegram.webhookSecret,
      allowed_updates: ['message', 'edited_message', 'callback_query'],
    });
    this.mode = 'webhook';
    this.webhookUrl = webhookUrl;
    this.pollingActive = false;
    console.log(`[Telegram] Webhook active: ${webhookUrl}`);
  }

  async startPolling() {
    await this.apiCall('deleteWebhook', { drop_pending_updates: false });
    this.mode = 'polling';
    this.webhookUrl = '';
    this.pollingActive = true;
    console.log('[Telegram] Long polling started');
    this._pollLoop();
  }

  async _pollLoop() {
    while (this.pollingActive) {
      try {
        const updates = await this.apiCall('getUpdates', {
          offset: this.pollingOffset,
          timeout: 25,
          allowed_updates: ['message', 'edited_message', 'callback_query'],
        });
        for (const update of updates) {
          this.pollingOffset = Math.max(this.pollingOffset, update.update_id + 1);
          await this.handleUpdate(update);
        }
      } catch (err) {
        console.error('[TelegramPollingError]', err.message);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  async initialize(publicHttpsUrl = '') {
    if (!this.isConfigured()) {
      console.warn('[Telegram] TELEGRAM_BOT_TOKEN not configured.');
      return;
    }
    this.botInfo = await this.apiCall('getMe');
    console.log(`[Telegram] Connected bot @${this.botInfo.username}`);

    if (config.telegram.mode === 'polling') {
      await this.startPolling();
      return;
    }

    if (publicHttpsUrl) {
      try {
        await this.startWebhook(publicHttpsUrl);
        return;
      } catch (err) {
        console.warn('[Telegram] Webhook setup failed, falling back to polling:', err.message);
      }
    }

    if (config.telegram.mode === 'webhook') {
      console.warn('[Telegram] TELEGRAM_MODE=webhook but no public HTTPS URL was available; starting polling fallback.');
    }
    await this.startPolling();
  }

  stop() {
    this.pollingActive = false;
  }
}

export const telegramService = new TelegramService();
