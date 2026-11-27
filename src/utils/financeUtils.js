import { extractDateOnly, getNowDateTimeString } from './dateUtils.js';

export const SHEET_HEADERS = [
  'Date',
  'Type',
  'Categories',
  'Amount',
  'Currency',
  'Description',
  'Payment Method',
  'Location',
];

export const STANDARD_CATEGORIES = [
  'Food & Drink (អាហារ)',
  'Transport (ដឹកជញ្ជូន)',
  'Shopping (ទិញទំនិញ)',
  'Bills & Utilities (ទឹកភ្លើង/អ៊ីនធឺណិត)',
  'Health (សុខភាព)',
  'Education (អប់រំ)',
  'Entertainment (កម្សាន្ត)',
  'Salary (ប្រាក់ខែ)',
  'Business (អាជីវកម្ម)',
  'Transfer & Gift (ផ្ទេរប្រាក់/អំណោយ)',
  'Other (ផ្សេងៗ)',
];

export function normalizeType(rawType) {
  const s = String(rawType || '').trim().toLowerCase();
  if (
    s.includes('ចំណូល') ||
    s.includes('income') ||
    s.includes('salary') ||
    s.includes('revenue') ||
    s.includes('earning') ||
    s === 'in' ||
    s === '+'
  ) {
    return 'ចំណូល';
  }
  return 'ចំណាយ';
}

export function normalizeCurrency(rawCurrency) {
  const s = String(rawCurrency || '').trim().toLowerCase();
  if (
    s === '៛' ||
    s.includes('khr') ||
    s.includes('riel') ||
    s.includes('រៀល') ||
    s === 'r'
  ) {
    return '៛';
  }
  return '$';
}

export function normalizeAmount(rawAmount) {
  if (typeof rawAmount === 'number') {
    return Number.isFinite(rawAmount) ? Math.abs(rawAmount) : 0;
  }
  const cleaned = String(rawAmount || '')
    .replace(/[,$\s៛]/g, '')
    .replace(/[^\d.-]/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}

export function formatMoney(amount, currency) {
  const num = Number(amount || 0);
  if (currency === '៛') {
    return `${Math.round(num).toLocaleString('en-US')} ៛`;
  }
  return `$${num.toLocaleString('en-US', {
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function normalizeTransactionRecord(raw, { defaultDate, defaultLocation = '' } = {}) {
  const fallbackDate = defaultDate || getNowDateTimeString();
  let date = String(raw.date || raw.Date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(date)) {
    date = fallbackDate;
  } else if (date.length === 10) {
    const timeSuffix = fallbackDate.slice(11, 16) || '00:00';
    date = `${date} ${timeSuffix}`;
  }

  const type = normalizeType(raw.type || raw.Type);
  const categories = String(raw.categories || raw.category || raw.Categories || 'Other (ផ្សេងៗ)').trim() || 'Other (ផ្សេងៗ)';
  const amount = normalizeAmount(raw.amount ?? raw.Amount);
  const currency = normalizeCurrency(raw.currency || raw.Currency);
  const description = String(raw.description ?? raw.Description ?? '').trim();
  const paymentMethod = String(raw.paymentMethod || raw.payment_method || raw['Payment Method'] || '').trim();
  const location = String(raw.location || raw.Location || defaultLocation || '').trim();

  return {
    date,
    type,
    categories,
    amount,
    currency,
    description,
    paymentMethod,
    location,
  };
}

export function toSheetRow(tx) {
  return [
    tx.date || '',
    tx.type || 'ចំណាយ',
    tx.categories || 'Other (ផ្សេងៗ)',
    Number(tx.amount || 0),
    tx.currency === '៛' ? '៛' : '$',
    tx.description || '',
    tx.paymentMethod || '',
    tx.location || '',
  ];
}

export function fromSheetRow(row, index = 0) {
  if (Array.isArray(row)) {
    return {
      id: `sheet-${index + 1}`,
      date: String(row[0] ?? '').trim(),
      type: normalizeType(row[1]),
      categories: String(row[2] ?? 'Other (ផ្សេងៗ)').trim(),
      amount: normalizeAmount(row[3]),
      currency: normalizeCurrency(row[4]),
      description: String(row[5] ?? '').trim(),
      paymentMethod: String(row[6] ?? '').trim(),
      location: String(row[7] ?? '').trim(),
      source: 'google_sheet',
    };
  }
  return {
    id: row.id || `sheet-${index + 1}`,
    ...normalizeTransactionRecord(row),
    source: row.source || 'google_sheet',
  };
}

function emptyBucket() {
  return { usdIncome: 0, usdExpense: 0, khrIncome: 0, khrExpense: 0, count: 0 };
}

function addToBucket(bucket, tx) {
  const isIncome = normalizeType(tx.type) === 'ចំណូល';
  const cur = normalizeCurrency(tx.currency);
  const amt = normalizeAmount(tx.amount);
  bucket.count += 1;

  if (cur === '$') {
    if (isIncome) bucket.usdIncome += amt;
    else bucket.usdExpense += amt;
  } else {
    if (isIncome) bucket.khrIncome += amt;
    else bucket.khrExpense += amt;
  }
}

export function summarizeTransactions(transactions = []) {
  const totals = {
    USD: { income: 0, expense: 0, net: 0 },
    KHR: { income: 0, expense: 0, net: 0 },
  };
  const categoryMap = new Map();
  const paymentMap = new Map();
  const dateMap = new Map();

  for (const rawTx of transactions) {
    const isIncome = normalizeType(rawTx.type) === 'ចំណូល';
    const cur = normalizeCurrency(rawTx.currency);
    const amt = normalizeAmount(rawTx.amount);

    if (cur === '$') {
      if (isIncome) totals.USD.income += amt;
      else totals.USD.expense += amt;
    } else {
      if (isIncome) totals.KHR.income += amt;
      else totals.KHR.expense += amt;
    }

    const cat = (rawTx.categories || 'Other (ផ្សេងៗ)').trim() || 'Other (ផ្សេងៗ)';
    if (!categoryMap.has(cat)) categoryMap.set(cat, emptyBucket());
    addToBucket(categoryMap.get(cat), rawTx);

    const pm = (rawTx.paymentMethod || 'Unspecified (មិនបញ្ជាក់)').trim() || 'Unspecified (មិនបញ្ជាក់)';
    if (!paymentMap.has(pm)) paymentMap.set(pm, emptyBucket());
    addToBucket(paymentMap.get(pm), rawTx);

    const dateOnly = extractDateOnly(rawTx.date) || 'Unknown';
    if (!dateMap.has(dateOnly)) dateMap.set(dateOnly, emptyBucket());
    addToBucket(dateMap.get(dateOnly), rawTx);
  }

  totals.USD.net = Number((totals.USD.income - totals.USD.expense).toFixed(2));
  totals.USD.income = Number(totals.USD.income.toFixed(2));
  totals.USD.expense = Number(totals.USD.expense.toFixed(2));

  totals.KHR.net = Math.round(totals.KHR.income - totals.KHR.expense);
  totals.KHR.income = Math.round(totals.KHR.income);
  totals.KHR.expense = Math.round(totals.KHR.expense);

  const byCategory = Array.from(categoryMap.entries())
    .map(([category, stats]) => ({ category, ...stats }))
    .sort((a, b) => (b.usdExpense + b.usdIncome) - (a.usdExpense + a.usdIncome) || b.count - a.count);

  const byPaymentMethod = Array.from(paymentMap.entries())
    .map(([paymentMethod, stats]) => ({ paymentMethod, ...stats }))
    .sort((a, b) => b.count - a.count);

  const byDate = Array.from(dateMap.entries())
    .map(([date, stats]) => ({ date, ...stats }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    count: transactions.length,
    totals,
    byCategory,
    byPaymentMethod,
    byDate,
  };
}

export function isWaterBillTransaction(tx) {
  const text = `${tx?.categories || ''} ${tx?.description || ''} ${tx?.location || ''}`.toLowerCase();
  if (/ទឹកសុទ្ធ|ផឹក|drinking\s*water|mineral\s*water|ទឹកដោះគោ|ទឹកក្រូច/i.test(text)) {
    return false;
  }
  if (/វិក្កយបត្រទឹក|ថ្លៃទឹក|បង់ទឹក|រដ្ឋាករទឹក|water\s*bill|ppwsa|srwsa|water\s*supply/i.test(text)) {
    return true;
  }
  const isBillCategory = /bills|utilities|ទឹកភ្លើង/i.test(String(tx?.categories || ''));
  const hasWaterWord = /ទឹក|water/i.test(`${tx?.description || ''} ${tx?.location || ''}`);
  return isBillCategory && hasWaterWord;
}
