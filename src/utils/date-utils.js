const { parse, isValid, format } = require('date-fns');

const DATE_FORMATS = [
  'dd/MM/yyyy', 'dd-MM-yyyy', 'dd.MM.yyyy',
  'yyyy-MM-dd', 'MM/dd/yyyy', 'MM-dd-yyyy',
  'd/M/yyyy',   'd-M-yyyy',   'd.M.yyyy',
  'dd/MM/yy',   'dd-MM-yy',
  "d 'ב'MMMM yyyy", // עברי מפורש (לא standard, fallback)
];

function parseDate(str) {
  if (!str) return null;
  const cleaned = str.trim().replace(/[^\d\/\-\.]/g, ' ').trim();
  for (const fmt of DATE_FORMATS) {
    try {
      const d = parse(cleaned, fmt, new Date());
      if (isValid(d)) return d;
    } catch {}
  }
  // ניסיון גנרי
  const d = new Date(str);
  return isValid(d) ? d : null;
}

function toYYYY(date) {
  return format(date || new Date(), 'yyyy');
}

function toMM(date) {
  return format(date || new Date(), 'MM');
}

function toISODate(date) {
  if (!date) return null;
  return format(date, 'yyyy-MM-dd');
}

module.exports = { parseDate, toYYYY, toMM, toISODate };
