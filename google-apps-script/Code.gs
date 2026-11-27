/**
 * Google Apps Script Web App for Telegram Finance Tracker
 * Target Google Sheet ID: 1X1bPfJXvijvYggVK3osxfcCXY30HBBrWMtHhWeEjZpA
 *
 * Setup steps:
 * 1. Select all in Code.gs (Ctrl+A), paste this ENTIRE file (Ctrl+V), then Save (Ctrl+S).
 * 2. Click Run (myFunction or setupTest) and Allow permissions.
 * 3. Click Deploy -> New deployment -> Type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy the Web app URL (https://script.google.com/macros/s/.../exec).
 */

var SECRET_TOKEN = 'kh_sheet_sync_2026';
var SPREADSHEET_ID = '1X1bPfJXvijvYggVK3osxfcCXY30HBBrWMtHhWeEjZpA';
var TRANSACTIONS_TAB = 'Transactions';
var SUMMARY_TAB = 'Summary';
var HEADERS = [
  'Date',
  'Type',
  'Categories',
  'Amount',
  'Currency',
  'Description',
  'Payment Method',
  'Location',
];

function getTargetSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID);
}

function myFunction() {
  setupTest();
}

function setupTest() {
  var sheet = getOrCreateTransactionsSheet();
  Logger.log('Ready: ' + sheet.getName());
}

function jsonOut(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function getOrCreateTransactionsSheet() {
  var ss = getTargetSpreadsheet();
  var sheet = ss.getSheetByName(TRANSACTIONS_TAB);
  if (!sheet) {
    var first = ss.getSheets()[0];
    if (first && first.getLastRow() === 0 && first.getName() === 'Sheet1') {
      first.setName(TRANSACTIONS_TAB);
      sheet = first;
    } else {
      sheet = ss.insertSheet(TRANSACTIONS_TAB);
    }
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange.setFontFamily('Kantumruy Pro');
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#0F4C5C');
    headerRange.setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
    sheet.setColumnWidths(1, HEADERS.length, 150);
    sheet.setColumnWidth(6, 240);
    sheet.setColumnWidth(8, 220);
  }
  return sheet;
}

function updateSummarySheet(ss, txSheet) {
  var summary = ss.getSheetByName(SUMMARY_TAB);
  if (!summary) {
    summary = ss.insertSheet(SUMMARY_TAB);
  }
  summary.clear();

  var lastRow = txSheet.getLastRow();
  var data = lastRow > 1 ? txSheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues() : [];

  var usdIncome = 0;
  var usdExpense = 0;
  var khrIncome = 0;
  var khrExpense = 0;

  for (var i = 0; i < data.length; i++) {
    var type = String(data[i][1] || '').trim();
    var amount = Number(data[i][3] || 0);
    var currency = String(data[i][4] || '$').trim();
    var isIncome = type === 'ចំណូល' || type.toLowerCase() === 'income';
    if (currency === '៛') {
      if (isIncome) khrIncome += amount;
      else khrExpense += amount;
    } else {
      if (isIncome) usdIncome += amount;
      else usdExpense += amount;
    }
  }

  var rows = [
    ['របាយការណ៍សរុប (Google Sheet Live Summary)', '', ''],
    ['Total Transactions', data.length, ''],
    ['', 'USD ($)', 'KHR (៛)'],
    ['ចំណូលសរុប (Total Income)', usdIncome, khrIncome],
    ['ចំណាយសរុប (Total Expense)', usdExpense, khrExpense],
    ['សមតុល្យ (Net Balance)', usdIncome - usdExpense, khrIncome - khrExpense],
  ];

  summary.getRange(1, 1, rows.length, 3).setValues(rows).setFontFamily('Kantumruy Pro');
  summary.getRange(1, 1, 1, 3).merge().setFontWeight('bold').setFontSize(13).setBackground('#0F4C5C').setFontColor('#FFFFFF');
  summary.getRange(3, 1, 1, 3).setFontWeight('bold').setBackground('#E2E8F0');
  summary.getRange(4, 1, 3, 1).setFontWeight('bold');
  summary.getRange(4, 2, 3, 1).setNumberFormat('$#,##0.00');
  summary.getRange(4, 3, 3, 1).setNumberFormat('#,##0" ៛"');
  summary.setColumnWidth(1, 240);
  summary.setColumnWidth(2, 160);
  summary.setColumnWidth(3, 180);
}

function normalizeCellDate(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone() || 'Asia/Phnom_Penh', 'yyyy-MM-dd HH:mm');
  }
  return String(val || '').trim();
}

function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    if (SECRET_TOKEN && params.secret !== SECRET_TOKEN) {
      return jsonOut({ ok: false, error: 'Unauthorized: invalid secret' });
    }
    var action = params.action || 'ping';
    var sheet = getOrCreateTransactionsSheet();

    if (action === 'ping') {
      return jsonOut({
        ok: true,
        spreadsheetName: getTargetSpreadsheet().getName(),
        sheetName: sheet.getName(),
        rowCount: Math.max(0, sheet.getLastRow() - 1),
      });
    }

    if (action === 'list') {
      var month = String(params.month || '').trim();
      var lastRow = sheet.getLastRow();
      if (lastRow <= 1) return jsonOut({ ok: true, rows: [] });
      var values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
      var rows = [];
      for (var i = 0; i < values.length; i++) {
        var dateStr = normalizeCellDate(values[i][0]);
        if (month && dateStr.indexOf(month) !== 0) continue;
        rows.push([
          dateStr,
          values[i][1],
          values[i][2],
          Number(values[i][3] || 0),
          values[i][4],
          values[i][5],
          values[i][6],
          values[i][7],
        ]);
      }
      return jsonOut({ ok: true, rows: rows });
    }

    return jsonOut({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (SECRET_TOKEN && body.secret !== SECRET_TOKEN) {
      return jsonOut({ ok: false, error: 'Unauthorized: invalid secret' });
    }

    var ss = getTargetSpreadsheet();
    var sheet = getOrCreateTransactionsSheet();
    var action = body.action || 'append';

    if (action === 'ping') {
      return jsonOut({
        ok: true,
        spreadsheetName: ss.getName(),
        sheetName: sheet.getName(),
        rowCount: Math.max(0, sheet.getLastRow() - 1),
      });
    }

    if (action === 'append') {
      var rows = Array.isArray(body.rows) ? body.rows : [];
      if (rows.length > 0) {
        var startRow = sheet.getLastRow() + 1;
        var appendRange = sheet.getRange(startRow, 1, rows.length, HEADERS.length);
        appendRange.setValues(rows).setFontFamily('Kantumruy Pro');
        sheet.getRange(startRow, 1, rows.length, 1).setNumberFormat('@');
        updateSummarySheet(ss, sheet);
      }
      return jsonOut({ ok: true, appended: rows.length, totalRows: Math.max(0, sheet.getLastRow() - 1) });
    }

    if (action === 'list') {
      var month = String(body.month || '').trim();
      var lastRow = sheet.getLastRow();
      if (lastRow <= 1) return jsonOut({ ok: true, rows: [] });
      var values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
      var listRows = [];
      for (var i = 0; i < values.length; i++) {
        var dateStr = normalizeCellDate(values[i][0]);
        if (month && dateStr.indexOf(month) !== 0) continue;
        listRows.push([
          dateStr,
          values[i][1],
          values[i][2],
          Number(values[i][3] || 0),
          values[i][4],
          values[i][5],
          values[i][6],
          values[i][7],
        ]);
      }
      return jsonOut({ ok: true, rows: listRows });
    }

    if (action === 'deleteLast') {
      var lastRowIdx = sheet.getLastRow();
      if (lastRowIdx <= 1) return jsonOut({ ok: true, deleted: false });
      sheet.deleteRow(lastRowIdx);
      updateSummarySheet(ss, sheet);
      return jsonOut({ ok: true, deleted: true });
    }

    return jsonOut({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}
