/**
 * Timezone-safe date utilities for Asia/Phnom_Penh (UTC+7).
 */

export function getDateParts(date = new Date(), timeZone = 'Asia/Phnom_Penh') {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      parts[part.type] = part.value;
    }
  }

  // Intl hour12:false can emit '24' for midnight on some locales/engines
  const hour = parts.hour === '24' ? '00' : parts.hour;

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour,
    minute: parts.minute,
    second: parts.second,
  };
}

export function getTodayDateString(timeZone = 'Asia/Phnom_Penh', date = new Date()) {
  const { year, month, day } = getDateParts(date, timeZone);
  return `${year}-${month}-${day}`;
}

export function getNowDateTimeString(timeZone = 'Asia/Phnom_Penh', date = new Date()) {
  const { year, month, day, hour, minute } = getDateParts(date, timeZone);
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

export function getCurrentMonthKey(timeZone = 'Asia/Phnom_Penh', date = new Date()) {
  const { year, month } = getDateParts(date, timeZone);
  return `${year}-${month}`;
}

/**
 * Extract YYYY-MM from a date string such as '2026-11-26 09:30' or '2026-11-26'.
 */
export function extractMonthKey(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const match = dateStr.trim().match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : '';
}

export function extractDateOnly(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const match = dateStr.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : dateStr.trim().slice(0, 10);
}

/**
 * Returns true if `date` falls on the last calendar day of its month in `timeZone`.
 */
export function isLastDayOfMonth(date = new Date(), timeZone = 'Asia/Phnom_Penh') {
  const { year, month, day } = getDateParts(date, timeZone);
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return Number(day) === lastDay;
}

export function formatMonthLabelKhmer(monthKey) {
  const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return monthKey;
  const [, year, month] = match;
  const khMonths = [
    'មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា',
    'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ',
  ];
  const idx = Number(month) - 1;
  return `${khMonths[idx] || month} ${year} (${monthKey})`;
}

export function parseMonthKey(monthKey) {
  const match = String(monthKey || '').trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function addMonthsToMonthKey(monthKey, deltaMonths) {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return '';
  const total = parsed.year * 12 + (parsed.month - 1) + deltaMonths;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}

export function isWaterBillMonth(monthKey, anchorMonth = '2027-01') {
  const target = parseMonthKey(monthKey);
  const anchor = parseMonthKey(anchorMonth);
  if (!target || !anchor) return false;
  const diff = (target.year * 12 + target.month) - (anchor.year * 12 + anchor.month);
  return Math.abs(diff) % 2 === 0;
}

export function isWaterBillReminderWindow(
  date = new Date(),
  timeZone = 'Asia/Phnom_Penh',
  anchorMonth = '2027-01',
  startDay = 16,
  endDay = 18
) {
  const { year, month, day } = getDateParts(date, timeZone);
  const monthKey = `${year}-${month}`;
  const dateKey = `${year}-${month}-${day}`;
  const dayNum = Number(day);
  const active = dayNum >= startDay && dayNum <= endDay && isWaterBillMonth(monthKey, anchorMonth);
  return { active, monthKey, dateKey, day: dayNum };
}

export function getNextWaterBillMonth(
  date = new Date(),
  timeZone = 'Asia/Phnom_Penh',
  anchorMonth = '2027-01',
  endDay = 18
) {
  const { year, month, day } = getDateParts(date, timeZone);
  const currentMonthKey = `${year}-${month}`;
  const dayNum = Number(day);

  if (isWaterBillMonth(currentMonthKey, anchorMonth) && dayNum <= endDay) {
    return currentMonthKey;
  }
  let candidate = addMonthsToMonthKey(currentMonthKey, 1);
  if (!isWaterBillMonth(candidate, anchorMonth)) {
    candidate = addMonthsToMonthKey(candidate, 1);
  }
  return candidate;
}
