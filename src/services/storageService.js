import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { extractMonthKey } from '../utils/dateUtils.js';
import { normalizeTransactionRecord } from '../utils/financeUtils.js';

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJsonFile(filePath, data) {
  await ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmpPath, filePath);
}

const DEFAULT_STATE = {
  ownerChatIds: [],
  recentLocations: {},
  lastMonthlyReportSent: {},
  waterBill: {
    anchorMonth: '',
    snoozedMonths: {},
    lastRemindedDate: {},
  },
};

export class StorageService {
  constructor({
    transactionsFile = config.paths.transactionsFile,
    botStateFile = config.paths.botStateFile,
  } = {}) {
    this.transactionsFile = transactionsFile;
    this.botStateFile = botStateFile;
    this._lock = Promise.resolve();
  }

  _enqueue(fn) {
    const next = this._lock.then(fn, fn);
    this._lock = next.catch(() => {});
    return next;
  }

  async getAllTransactions() {
    const list = await readJsonFile(this.transactionsFile, []);
    return Array.isArray(list) ? list : [];
  }

  async getTransactionsByMonth(monthKey) {
    const all = await this.getAllTransactions();
    if (!monthKey) return all;
    return all.filter((tx) => extractMonthKey(tx.date) === monthKey);
  }

  async addTransactions(records, meta = {}) {
    return this._enqueue(async () => {
      const list = await this.getAllTransactions();
      const created = records.map((rec) => {
        const normalized = normalizeTransactionRecord(rec);
        return {
          id: crypto.randomUUID(),
          ...normalized,
          chatId: meta.chatId ? String(meta.chatId) : '',
          messageType: meta.messageType || 'manual',
          syncedToSheet: Boolean(meta.syncedToSheet),
          createdAt: new Date().toISOString(),
        };
      });
      list.push(...created);
      await writeJsonFile(this.transactionsFile, list);
      return created;
    });
  }

  async markSynced(ids = []) {
    if (!ids.length) return;
    const idSet = new Set(ids);
    return this._enqueue(async () => {
      const list = await this.getAllTransactions();
      let changed = false;
      for (const tx of list) {
        if (idSet.has(tx.id) && !tx.syncedToSheet) {
          tx.syncedToSheet = true;
          changed = true;
        }
      }
      if (changed) {
        await writeJsonFile(this.transactionsFile, list);
      }
    });
  }

  async updateTransaction(id, updates) {
    return this._enqueue(async () => {
      const list = await this.getAllTransactions();
      const idx = list.findIndex((tx) => tx.id === id);
      if (idx === -1) return null;
      const merged = normalizeTransactionRecord({ ...list[idx], ...updates });
      list[idx] = {
        ...list[idx],
        ...merged,
        updatedAt: new Date().toISOString(),
      };
      await writeJsonFile(this.transactionsFile, list);
      return list[idx];
    });
  }

  async deleteTransaction(id) {
    return this._enqueue(async () => {
      const list = await this.getAllTransactions();
      const idx = list.findIndex((tx) => tx.id === id);
      if (idx === -1) return null;
      const [removed] = list.splice(idx, 1);
      await writeJsonFile(this.transactionsFile, list);
      return removed;
    });
  }

  async removeLastTransactionForChat(chatId) {
    return this._enqueue(async () => {
      const list = await this.getAllTransactions();
      const targetChat = String(chatId || '');
      let idx = -1;
      for (let i = list.length - 1; i >= 0; i -= 1) {
        if (!targetChat || list[i].chatId === targetChat) {
          idx = i;
          break;
        }
      }
      if (idx === -1) return null;
      const [removed] = list.splice(idx, 1);
      await writeJsonFile(this.transactionsFile, list);
      return removed;
    });
  }

  async attachLocationToRecentTransactions(chatId, locationLabel, maxAgeMs = 2 * 60 * 1000) {
    return this._enqueue(async () => {
      const list = await this.getAllTransactions();
      const targetChat = String(chatId);
      const now = Date.now();
      const updated = [];
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const tx = list[i];
        if (tx.chatId !== targetChat) continue;
        const age = now - new Date(tx.createdAt || 0).getTime();
        if (age > maxAgeMs) break;
        if (!tx.location) {
          tx.location = locationLabel;
          tx.updatedAt = new Date().toISOString();
          updated.push(tx);
        }
      }
      if (updated.length > 0) {
        await writeJsonFile(this.transactionsFile, list);
      }
      return updated.reverse();
    });
  }

  async getState() {
    const state = await readJsonFile(this.botStateFile, DEFAULT_STATE);
    return {
      ownerChatIds: Array.isArray(state.ownerChatIds) ? state.ownerChatIds : [],
      recentLocations: state.recentLocations && typeof state.recentLocations === 'object' ? state.recentLocations : {},
      lastMonthlyReportSent:
        state.lastMonthlyReportSent && typeof state.lastMonthlyReportSent === 'object'
          ? state.lastMonthlyReportSent
          : {},
      waterBill: {
        anchorMonth: String(state.waterBill?.anchorMonth || ''),
        snoozedMonths:
          state.waterBill?.snoozedMonths && typeof state.waterBill.snoozedMonths === 'object'
            ? state.waterBill.snoozedMonths
            : {},
        lastRemindedDate:
          state.waterBill?.lastRemindedDate && typeof state.waterBill.lastRemindedDate === 'object'
            ? state.waterBill.lastRemindedDate
            : {},
      },
    };
  }

  async registerOwnerChatId(chatId) {
    const id = String(chatId);
    return this._enqueue(async () => {
      const state = await this.getState();
      if (!state.ownerChatIds.includes(id)) {
        state.ownerChatIds.push(id);
        await writeJsonFile(this.botStateFile, state);
      }
      return state;
    });
  }

  async setRecentLocation(chatId, locationData) {
    const id = String(chatId);
    return this._enqueue(async () => {
      const state = await this.getState();
      state.recentLocations[id] = {
        ...locationData,
        savedAt: Date.now(),
      };
      await writeJsonFile(this.botStateFile, state);
      return state.recentLocations[id];
    });
  }

  async getRecentLocation(chatId, maxAgeMs = 30 * 60 * 1000) {
    const state = await this.getState();
    const entry = state.recentLocations[String(chatId)];
    if (!entry) return '';
    if (Date.now() - Number(entry.savedAt || 0) > maxAgeMs) return '';
    return entry.label || '';
  }

  async markMonthlyReportSent(monthKey) {
    return this._enqueue(async () => {
      const state = await this.getState();
      state.lastMonthlyReportSent[monthKey] = new Date().toISOString();
      await writeJsonFile(this.botStateFile, state);
    });
  }

  async wasMonthlyReportSent(monthKey) {
    const state = await this.getState();
    return Boolean(state.lastMonthlyReportSent[monthKey]);
  }

  async getWaterBillAnchorMonth(fallbackMonth) {
    const state = await this.getState();
    return state.waterBill.anchorMonth || fallbackMonth;
  }

  async setWaterBillAnchorMonth(monthKey) {
    return this._enqueue(async () => {
      const state = await this.getState();
      state.waterBill.anchorMonth = monthKey;
      await writeJsonFile(this.botStateFile, state);
      return state.waterBill;
    });
  }

  async snoozeWaterBillMonth(monthKey) {
    return this._enqueue(async () => {
      const state = await this.getState();
      state.waterBill.snoozedMonths[monthKey] = true;
      await writeJsonFile(this.botStateFile, state);
    });
  }

  async isWaterBillSnoozed(monthKey) {
    const state = await this.getState();
    return Boolean(state.waterBill.snoozedMonths[monthKey]);
  }

  async markWaterBillReminded(dateKey) {
    return this._enqueue(async () => {
      const state = await this.getState();
      state.waterBill.lastRemindedDate[dateKey] = new Date().toISOString();
      await writeJsonFile(this.botStateFile, state);
    });
  }

  async wasWaterBillRemindedToday(dateKey) {
    const state = await this.getState();
    return Boolean(state.waterBill.lastRemindedDate[dateKey]);
  }
}

export const storageService = new StorageService();
