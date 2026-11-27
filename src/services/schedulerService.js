import cron from 'node-cron';
import { config } from '../config.js';
import { getCurrentMonthKey, isLastDayOfMonth } from '../utils/dateUtils.js';
import { storageService } from './storageService.js';
import { telegramService } from './telegramService.js';

export class SchedulerService {
  constructor() {
    this.task = null;
  }

  async runMonthlyCheck({ force = false, monthKey = null } = {}) {
    const now = new Date();
    const targetMonth = monthKey || getCurrentMonthKey(config.timezone, now);

    if (!force && !isLastDayOfMonth(now, config.timezone)) {
      return { skipped: true, reason: 'Not last day of month' };
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

    console.log(
      `[Scheduler] End-of-month afternoon check armed: ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} (${config.timezone})`
    );
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }
}

export const schedulerService = new SchedulerService();
