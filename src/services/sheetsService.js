import fs from 'node:fs/promises';
import { google } from 'googleapis';
import { config } from '../config.js';
import { extractMonthKey, isDateInRange } from '../utils/dateUtils.js';
import { fromSheetRow, SHEET_HEADERS, toSheetRow } from '../utils/financeUtils.js';
import { storageService } from './storageService.js';

export class SheetsService {
  constructor() {
    this._sheetsClient = null;
  }

  async _hasServiceAccountFile() {
    try {
      await fs.access(config.googleSheet.serviceAccountPath);
      return true;
    } catch {
      return false;
    }
  }

  async getMode() {
    if (config.googleSheet.appsScriptUrl) return 'apps_script';
    if (config.googleSheet.sheetId && (await this._hasServiceAccountFile())) return 'service_account';
    return 'local_only';
  }

  async _getGoogleSheetsClient() {
    if (this._sheetsClient) return this._sheetsClient;
    const auth = new google.auth.GoogleAuth({
      keyFile: config.googleSheet.serviceAccountPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this._sheetsClient = google.sheets({ version: 'v4', auth });
    return this._sheetsClient;
  }

  async _ensureHeaderRowServiceAccount() {
    const sheets = await this._getGoogleSheetsClient();
    const spreadsheetId = config.googleSheet.sheetId;
    const tab = config.googleSheet.tabName;

    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existingTabs = (meta.data.sheets || []).map((s) => s.properties?.title);
    if (!existingTabs.includes(tab)) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: tab } } }],
        },
      });
    }

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!A1:H1`,
    });
    const firstRow = res.data.values?.[0] || [];
    if (firstRow.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tab}!A1:H1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [SHEET_HEADERS] },
      });
    }
  }

  async _callAppsScript(payload) {
    const url = config.googleSheet.appsScriptUrl;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: config.googleSheet.appsScriptSecret,
        ...payload,
      }),
      redirect: 'follow',
    });

    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Apps Script returned non-JSON response (${res.status}): ${text.slice(0, 200)}`);
    }
    if (!parsed.ok) {
      throw new Error(parsed.error || 'Apps Script error');
    }
    return parsed;
  }

  async appendTransactions(transactions) {
    if (!transactions.length) return { synced: false, mode: await this.getMode() };
    const mode = await this.getMode();
    const rows = transactions.map(toSheetRow);

    if (mode === 'apps_script') {
      await this._callAppsScript({ action: 'append', rows });
      await storageService.markSynced(transactions.map((t) => t.id));
      return { synced: true, mode };
    }

    if (mode === 'service_account') {
      await this._ensureHeaderRowServiceAccount();
      const sheets = await this._getGoogleSheetsClient();
      await sheets.spreadsheets.values.append({
        spreadsheetId: config.googleSheet.sheetId,
        range: `${config.googleSheet.tabName}!A:H`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: rows },
      });
      await storageService.markSynced(transactions.map((t) => t.id));
      return { synced: true, mode };
    }

    return { synced: false, mode: 'local_only', reason: 'Google Sheet connector not configured yet' };
  }

  async syncPending() {
    const mode = await this.getMode();
    if (mode === 'local_only') {
      return { syncedCount: 0, mode, message: 'Configure GOOGLE_APPS_SCRIPT_URL or Service Account JSON first.' };
    }
    const all = await storageService.getAllTransactions();
    const pending = all.filter((tx) => !tx.syncedToSheet);
    if (!pending.length) {
      return { syncedCount: 0, mode, message: 'All records are already synced.' };
    }
    await this.appendTransactions(pending);
    return { syncedCount: pending.length, mode, message: `Synced ${pending.length} pending transaction(s).` };
  }

  async deleteLastRowFromSheet() {
    const mode = await this.getMode();
    if (mode === 'apps_script') {
      return this._callAppsScript({ action: 'deleteLast' });
    }
    return { ok: false, mode };
  }

  async getTransactionsForMonth(monthKey) {
    const mode = await this.getMode();

    if (mode === 'apps_script') {
      try {
        const res = await this._callAppsScript({ action: 'list', month: monthKey || '' });
        const rows = (res.rows || []).map((r, idx) => fromSheetRow(r, idx));
        if (rows.length > 0) {
          return { transactions: rows, source: 'google_sheet_apps_script' };
        }
      } catch (err) {
        console.warn('[SheetsService] Failed reading from Apps Script, falling back to local cache:', err.message);
      }
    } else if (mode === 'service_account') {
      try {
        const sheets = await this._getGoogleSheetsClient();
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: config.googleSheet.sheetId,
          range: `${config.googleSheet.tabName}!A2:H`,
        });
        const allRows = (res.data.values || []).map((r, idx) => fromSheetRow(r, idx));
        const filtered = monthKey
          ? allRows.filter((tx) => extractMonthKey(tx.date) === monthKey)
          : allRows;
        if (filtered.length > 0) {
          return { transactions: filtered, source: 'google_sheet_api' };
        }
      } catch (err) {
        console.warn('[SheetsService] Failed reading from Google Sheets API, falling back to local cache:', err.message);
      }
    }

    const localRows = await storageService.getTransactionsByMonth(monthKey);
    return { transactions: localRows, source: 'local_cache' };
  }

  async getTransactionsForDateRange(startDate, endDate) {
    const mode = await this.getMode();

    if (mode === 'apps_script') {
      try {
        const res = await this._callAppsScript({ action: 'list', month: '' });
        const allRows = (res.rows || []).map((r, idx) => fromSheetRow(r, idx));
        const filtered = allRows.filter((tx) => isDateInRange(tx.date, startDate, endDate));
        if (allRows.length > 0) {
          return { transactions: filtered, source: 'google_sheet_apps_script' };
        }
      } catch (err) {
        console.warn('[SheetsService] Failed reading range from Apps Script, falling back to local cache:', err.message);
      }
    } else if (mode === 'service_account') {
      try {
        const sheets = await this._getGoogleSheetsClient();
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: config.googleSheet.sheetId,
          range: `${config.googleSheet.tabName}!A2:H`,
        });
        const allRows = (res.data.values || []).map((r, idx) => fromSheetRow(r, idx));
        const filtered = allRows.filter((tx) => isDateInRange(tx.date, startDate, endDate));
        if (allRows.length > 0) {
          return { transactions: filtered, source: 'google_sheet_api' };
        }
      } catch (err) {
        console.warn('[SheetsService] Failed reading range from Google Sheets API, falling back to local cache:', err.message);
      }
    }

    const allLocal = await storageService.getAllTransactions();
    return {
      transactions: allLocal.filter((tx) => isDateInRange(tx.date, startDate, endDate)),
      source: 'local_cache',
    };
  }

  async testConnection() {
    const mode = await this.getMode();
    if (mode === 'apps_script') {
      try {
        const res = await this._callAppsScript({ action: 'ping' });
        return { ok: true, mode, details: res };
      } catch (err) {
        return { ok: false, mode, error: err.message };
      }
    }
    if (mode === 'service_account') {
      try {
        const sheets = await this._getGoogleSheetsClient();
        const meta = await sheets.spreadsheets.get({ spreadsheetId: config.googleSheet.sheetId });
        return {
          ok: true,
          mode,
          details: { title: meta.data.properties?.title },
        };
      } catch (err) {
        return { ok: false, mode, error: err.message };
      }
    }
    return {
      ok: false,
      mode: 'local_only',
      error: 'GOOGLE_APPS_SCRIPT_URL or credentials/google-service-account.json not set',
    };
  }
}

export const sheetsService = new SheetsService();
