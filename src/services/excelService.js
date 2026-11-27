import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { config } from '../config.js';
import { formatMonthLabelKhmer, getNowDateTimeString } from '../utils/dateUtils.js';
import { SHEET_HEADERS, summarizeTransactions } from '../utils/financeUtils.js';

const HEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF0F4C5C' },
};

const SECTION_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1E293B' },
};

const SUBHEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE2E8F0' },
};

const ZEBRA_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF8FAFC' },
};

const THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
};

const USD_FORMAT = '$#,##0.00';
const KHR_FORMAT = '#,##0" ៛"';

function styleHeaderRow(row, fill = HEADER_FILL) {
  row.height = 24;
  row.eachCell((cell) => {
    cell.fill = fill;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = THIN_BORDER;
  });
}

function addBreakdownTable(sheet, startRow, title, rows, firstColHeader, keyField) {
  let r = startRow;

  sheet.mergeCells(r, 1, r, 6);
  const titleRow = sheet.getRow(r);
  titleRow.getCell(1).value = title;
  styleHeaderRow(titleRow, SECTION_FILL);
  titleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
  r += 1;

  const headRow = sheet.getRow(r);
  headRow.values = [
    firstColHeader,
    'ចំនួនប្រតិបត្តិការ (Count)',
    'ចំណូល ($)',
    'ចំណាយ ($)',
    'ចំណូល (៛)',
    'ចំណាយ (៛)',
  ];
  headRow.height = 22;
  headRow.eachCell((cell) => {
    cell.fill = SUBHEADER_FILL;
    cell.font = { bold: true, color: { argb: 'FF0F172A' }, size: 10.5 };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = THIN_BORDER;
  });
  r += 1;

  if (!rows.length) {
    sheet.mergeCells(r, 1, r, 6);
    const emptyRow = sheet.getRow(r);
    emptyRow.getCell(1).value = 'មិនមានទិន្នន័យ (No data)';
    emptyRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    emptyRow.getCell(1).border = THIN_BORDER;
    return r + 2;
  }

  for (let i = 0; i < rows.length; i += 1) {
    const item = rows[i];
    const row = sheet.getRow(r);
    row.values = [
      item[keyField],
      item.count,
      Number(item.usdIncome.toFixed(2)),
      Number(item.usdExpense.toFixed(2)),
      Math.round(item.khrIncome),
      Math.round(item.khrExpense),
    ];
    row.height = 20;
    row.eachCell((cell, colNumber) => {
      if (i % 2 === 1) cell.fill = ZEBRA_FILL;
      cell.border = THIN_BORDER;
      cell.alignment = {
        vertical: 'middle',
        horizontal: colNumber === 1 ? 'left' : 'right',
      };
      if (colNumber === 2) cell.alignment = { vertical: 'middle', horizontal: 'center' };
      if (colNumber === 3 || colNumber === 4) cell.numFmt = USD_FORMAT;
      if (colNumber === 5 || colNumber === 6) cell.numFmt = KHR_FORMAT;
    });
    r += 1;
  }

  return r + 1;
}

export async function buildMonthlyExcelBuffer(transactions, { monthKey, timezone = config.timezone } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Telegram Finance AI Assistant';
  workbook.created = new Date();

  const sorted = [...transactions].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  const summary = summarizeTransactions(sorted);
  const monthLabel = monthKey ? formatMonthLabelKhmer(monthKey) : 'All Time (ទិន្នន័យទាំងអស់)';

  // ========================
  // SHEET 1: Summary (សរុប)
  // ========================
  const summarySheet = workbook.addWorksheet('Summary (សរុប)', {
    views: [{ showGridLines: true }],
  });

  summarySheet.columns = [
    { width: 34 },
    { width: 22 },
    { width: 18 },
    { width: 18 },
    { width: 20 },
    { width: 20 },
  ];

  summarySheet.mergeCells('A1:F1');
  const banner = summarySheet.getRow(1);
  banner.getCell(1).value = 'របាយការណ៍ចំណូល-ចំណាយ (Income & Expense Monthly Report)';
  banner.height = 30;
  banner.getCell(1).fill = HEADER_FILL;
  banner.getCell(1).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  banner.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };

  summarySheet.getRow(2).values = ['ខែរបាយការណ៍ (Period):', monthLabel, '', 'កាលបរិច្ឆេទបង្កើត:', getNowDateTimeString(timezone), ''];
  summarySheet.getRow(2).font = { bold: true, size: 10.5 };
  summarySheet.getRow(3).values = ['ប្រតិបត្តិការសរុប (Total Entries):', summary.count];
  summarySheet.getRow(3).font = { bold: true, size: 10.5 };

  // Section A: Overall KPI Summary
  let rowIdx = 5;
  summarySheet.mergeCells(rowIdx, 1, rowIdx, 3);
  const kpiTitle = summarySheet.getRow(rowIdx);
  kpiTitle.getCell(1).value = 'សង្ខេបសមតុល្យសរុប (Overall Balance Summary)';
  styleHeaderRow(kpiTitle, SECTION_FILL);
  kpiTitle.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
  rowIdx += 1;

  const kpiHead = summarySheet.getRow(rowIdx);
  kpiHead.values = ['បរិយាយ (Metric)', 'ប្រាក់ដុល្លារ USD ($)', 'ប្រាក់រៀល KHR (៛)'];
  kpiHead.height = 22;
  kpiHead.eachCell((cell) => {
    cell.fill = SUBHEADER_FILL;
    cell.font = { bold: true };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = THIN_BORDER;
  });
  rowIdx += 1;

  const kpiRows = [
    ['ចំណូលសរុប (Total Income)', summary.totals.USD.income, summary.totals.KHR.income, 'FF15803D'],
    ['ចំណាយសរុប (Total Expense)', summary.totals.USD.expense, summary.totals.KHR.expense, 'FFB91C1C'],
    [
      'សមតុល្យសុទ្ធ (Net Balance)',
      summary.totals.USD.net,
      summary.totals.KHR.net,
      summary.totals.USD.net >= 0 ? 'FF0F4C5C' : 'FFB91C1C',
    ],
  ];

  for (const [label, usdVal, khrVal, color] of kpiRows) {
    const r = summarySheet.getRow(rowIdx);
    r.values = [label, usdVal, khrVal];
    r.height = 22;
    r.getCell(1).font = { bold: true };
    r.getCell(2).numFmt = USD_FORMAT;
    r.getCell(3).numFmt = KHR_FORMAT;
    r.getCell(2).font = { bold: true, color: { argb: color } };
    r.getCell(3).font = { bold: true, color: { argb: color } };
    r.eachCell((cell, col) => {
      cell.border = THIN_BORDER;
      cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'right' };
    });
    rowIdx += 1;
  }

  rowIdx += 1;
  rowIdx = addBreakdownTable(
    summarySheet,
    rowIdx,
    'សង្ខេបតាមប្រភេទ (Breakdown by Category)',
    summary.byCategory,
    'ប្រភេទ (Categories)',
    'category'
  );

  rowIdx = addBreakdownTable(
    summarySheet,
    rowIdx,
    'សង្ខេបតាមវិធីទូទាត់ (Breakdown by Payment Method)',
    summary.byPaymentMethod,
    'វិធីទូទាត់ (Payment Method)',
    'paymentMethod'
  );

  addBreakdownTable(
    summarySheet,
    rowIdx,
    'សង្ខេបប្រចាំថ្ងៃ (Daily Breakdown)',
    summary.byDate,
    'កាលបរិច្ឆេទ (Date)',
    'date'
  );

  // ============================
  // SHEET 2: Transactions (លម្អិត)
  // ============================
  const detailSheet = workbook.addWorksheet('Transactions (លម្អិត)', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  detailSheet.columns = [
    { key: 'date', width: 19 },
    { key: 'type', width: 14 },
    { key: 'categories', width: 28 },
    { key: 'amount', width: 15 },
    { key: 'currency', width: 11 },
    { key: 'description', width: 34 },
    { key: 'paymentMethod', width: 18 },
    { key: 'location', width: 28 },
  ];

  const headerRow = detailSheet.getRow(1);
  headerRow.values = SHEET_HEADERS;
  styleHeaderRow(headerRow);
  detailSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, sorted.length + 1), column: SHEET_HEADERS.length },
  };

  for (let i = 0; i < sorted.length; i += 1) {
    const tx = sorted[i];
    const r = detailSheet.getRow(i + 2);
    const isIncome = tx.type === 'ចំណូល';
    const isKhr = tx.currency === '៛';

    r.values = [
      tx.date || '',
      tx.type || 'ចំណាយ',
      tx.categories || '',
      Number(tx.amount || 0),
      isKhr ? '៛' : '$',
      tx.description || '',
      tx.paymentMethod || '',
      tx.location || '',
    ];
    r.height = 20;

    r.eachCell((cell, col) => {
      if (i % 2 === 1) cell.fill = ZEBRA_FILL;
      cell.border = THIN_BORDER;
      cell.alignment = {
        vertical: 'middle',
        horizontal: col === 4 ? 'right' : col === 2 || col === 5 ? 'center' : 'left',
        wrapText: col === 6 || col === 8,
      };
      if (col === 2) {
        cell.font = { bold: true, color: { argb: isIncome ? 'FF15803D' : 'FFB91C1C' } };
      }
      if (col === 4) {
        cell.numFmt = isKhr ? '#,##0' : '#,##0.00';
      }
    });
  }

  // Footer totals on Transactions sheet
  const footerStart = sorted.length + 3;
  const usdFooter = detailSheet.getRow(footerStart);
  usdFooter.values = [
    '',
    'សរុប USD ($)',
    `ចំណូល: $${summary.totals.USD.income.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    summary.totals.USD.net,
    '$',
    `ចំណាយ: $${summary.totals.USD.expense.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    '',
    '',
  ];
  usdFooter.font = { bold: true };
  usdFooter.getCell(4).numFmt = USD_FORMAT;

  const khrFooter = detailSheet.getRow(footerStart + 1);
  khrFooter.values = [
    '',
    'សរុប KHR (៛)',
    `ចំណូល: ${summary.totals.KHR.income.toLocaleString('en-US')} ៛`,
    summary.totals.KHR.net,
    '៛',
    `ចំណាយ: ${summary.totals.KHR.expense.toLocaleString('en-US')} ៛`,
    '',
    '',
  ];
  khrFooter.font = { bold: true };
  khrFooter.getCell(4).numFmt = KHR_FORMAT;

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(buffer),
    summary,
    filename: `Finance_Report_${monthKey || 'All'}.xlsx`,
  };
}

export async function saveMonthlyExcelReport(transactions, options = {}) {
  const result = await buildMonthlyExcelBuffer(transactions, options);
  await fs.mkdir(config.paths.reportsDir, { recursive: true });
  const filePath = path.join(config.paths.reportsDir, result.filename);
  await fs.writeFile(filePath, result.buffer);
  return { ...result, filePath };
}
