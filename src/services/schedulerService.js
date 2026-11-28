import cron from 'node-cron';
import { config } from '../config.js';
import {
  getCurrentPayCycleKey,
  isMonthlyReportDay,
  isWaterBillReminderWindow,
} from '../utils/dateUtils.js';
import { isWaterBillTransaction } from '../utils/financeUtils.js';
import { sheetsService } from './sheetsService.js';
import { storageService } from './storageService.js';
import { telegramService } from './telegramService.js';

export class SchedulerService {
  constructor() {
    this.task = null;
    this.waterTask = null;
  }

  async runMonthlyCheck({ force = false, monthKey = null } = {}) {
    const now = new Date();
    const targetMonth =
      monthKey || getCurrentPayCycleKey(now, config.timezone, config.schedule.cycleStartDay);

    if (!force && !isMonthlyReportDay(now, config.timezone, config.schedule.day)) {
      return {
        skipped: true,
        reason: `Not monthly report day (day ${config.schedule.day})`,
      };
    }

    if (!force && (await storageService.wasMonthlyReportSent(targetMonth))) {
      return { skipped: true, reason: `Report for ${targetMonth} already sent` };
    }

    const chatIds = await telegramService.getTargetReportChatIds();
    if (!chatIds.length) {
      console.warn('[Scheduler] No Telegram chatId registered yet. Send /start to the bot first.');
      return { skipped: true, reason: 'No target chat IDs' };
    }

    const results = [];
    for (const chatId of chatIds) {
      const res = await telegramService.sendMonthlyReportToChat(chatId, targetMonth);
      results.push({ chatId, ...res });
    }

    await storageService.markMonthlyReportSent(targetMonth);
    console.log(`[Scheduler] Monthly Excel report for ${targetMonth} sent to ${results.length} chat(s).`);
    return { skipped: false, monthKey: targetMonth, results };
  }

  async runWaterBillCheck({ force = false } = {}) {
    const wbCfg = config.reminders.waterBill;
    if (!force && !wbCfg.enabled) {
      return { skipped: true, reason: 'Water bill reminder disabled' };
    }

    const now = new Date();
    const anchorMonth = await storageService.getWaterBillAnchorMonth(wbCfg.anchorMonth);
    const windowInfo = isWaterBillReminderWindow(
      now,
      config.timezone,
      anchorMonth,
      wbCfg.startDay,
      wbCfg.endDay
    );

    if (!force && !windowInfo.active) {
      return {
        skipped: true,
        reason: `Outside water bill reminder window (${wbCfg.startDay}-${wbCfg.endDay} of bi-monthly cycle from ${anchorMonth})`,
      };
    }

    if (!force && (await storageService.isWaterBillSnoozed(windowInfo.monthKey))) {
      return { skipped: true, reason: `Water bill snoozed for ${windowInfo.monthKey}` };
    }

    if (!force && (await storageService.wasWaterBillRemindedToday(windowInfo.dateKey))) {
      return { skipped: true, reason: `Already reminded on ${windowInfo.dateKey}` };
    }

    const { transactions } = await sheetsService.getTransactionsForMonth(windowInfo.monthKey);
    if (!force && transactions.some(isWaterBillTransaction)) {
      return { skipped: true, reason: `Water bill already recorded for ${windowInfo.monthKey}` };
    }

    const chatIds = await telegramService.getTargetReportChatIds();
    if (!chatIds.length) {
      return { skipped: true, reason: 'No target chat IDs' };
    }

    for (const chatId of chatIds) {
      await telegramService.sendWaterBillReminderToChat(chatId, windowInfo.monthKey);
    }

    await storageService.markWaterBillReminded(windowInfo.dateKey);
    console.log(`[Scheduler] Water bill reminder sent for ${windowInfo.dateKey} to ${chatIds.length} chat(s).`);
    return { skipped: false, dateKey: windowInfo.dateKey, monthKey: windowInfo.monthKey, sentCount: chatIds.length };
  }

  start() {
    const minute = Number.isFinite(config.schedule.minute) ? config.schedule.minute : 0;
    const hour = Number.isFinite(config.schedule.hour) ? config.schedule.hour : 16;
    const expression = `${minute} ${hour} * * *`;

    this.task = cron.schedule(
      expression,
      async () => {
        try {
          await this.runMonthlyCheck();
        } catch (err) {
          console.error('[Scheduler] Monthly report error:', err);
        }
      },
      { timezone: config.timezone }
    );

    const wb = config.reminders.waterBill;
    if (wb.enabled) {
      const wbExpr = `${Number.isFinite(wb.minute) ? wb.minute : 0} ${Number.isFinite(wb.hour) ? wb.hour : 9} * * *`;
      this.waterTask = cron.schedule(
        wbExpr,
        async () => {
          try {
            await this.runWaterBillCheck();
          } catch (err) {
            console.error('[Scheduler] Water bill reminder error:', err);
          }
        },
        { timezone: config.timezone }
      );
      console.log(
        `[Scheduler] Water bill bi-monthly check armed: ${String(wb.hour).padStart(2, '0')}:${String(wb.minute).padStart(2, '0')} (${config.timezone}, days ${wb.startDay}-${wb.endDay})`
      );
    }

    console.log(
      `[Scheduler] Monthly payday-cycle report check armed: day ${config.schedule.day} at ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} (${config.timezone}, cycle ${config.schedule.cycleStartDay}->${config.schedule.day})`
    );
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
    if (this.waterTask) {
      this.waterTask.stop();
      this.waterTask = null;
    }
  }
}

export const schedulerService = new SchedulerService();
