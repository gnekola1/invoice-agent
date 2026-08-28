const pdfParse = require('pdf-parse');
const { parseDate, toISODate } = require('../utils/date-utils');
const logger = require('../utils/logger');

// ביטויים רגולריים לחילוץ metadata
const PATTERNS = {
  amount: [
    /(?:סה"כ|סכום|total|amount|לתשלום)[:\s]*(\d[\d,\.]+)\s*(?:₪|nis|usd|\$|eur|€|ils)?/i,
    /(\d[\d,\.]+)\s*(?:₪|nis|ils)\b/i,
    /\$\s*(\d[\d,\.]+)/i,
    /€\s*(\d[\d,\.]+)/i,
  ],
  currency: [
    /(\₪|nis|ils)/i,
    /(\$|usd)/i,
    /(\€|eur)/i,
  ],
  invoiceNumber: [
    /(?:מספר חשבונית|invoice\s*#?|invoice number|חשבונית מס\.?)[:\s]*([A-Z0-9\-\/]+)/i,
    /(?:receipt\s*#?|קבלה מס\.?)[:\s]*([A-Z0-9\-\/]+)/i,
    /#\s*([A-Z0-9\-]{4,})/i,
  ],
  date: [
    /(?:תאריך|date)[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
    /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/,
    /(\d{4}-\d{2}-\d{2})/,
  ],
};

function extractFirst(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return null;
}

function normalizeCurrency(raw) {
  if (!raw) return null;
  const r = raw.toLowerCase();
  if (r.includes('₪') || r.includes('nis') || r.includes('ils')) return 'ILS';
  if (r.includes('$') || r.includes('usd')) return 'USD';
  if (r.includes('€') || r.includes('eur')) return 'EUR';
  return raw.toUpperCase();
}

function normalizeAmount(raw) {
  if (!raw) return null;
  const n = parseFloat(raw.replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

async function extractFromPdfBuffer(buffer) {
  try {
    const data = await pdfParse(buffer);
    return extractFromText(data.text);
  } catch (err) {
    logger.warn('extractFromPdfBuffer נכשל', { err: err.message });
    return {};
  }
}

function extractFromText(text) {
  const empty = { amount: null, currency: null, invoiceDate: null, invoiceNumber: null };
  if (!text) return empty;
  const amountRaw = extractFirst(text, PATTERNS.amount);
  const currencyRaw = extractFirst(text, PATTERNS.currency) ||
    (amountRaw ? (amountRaw.includes('₪') ? '₪' : null) : null);
  const dateRaw = extractFirst(text, PATTERNS.date);
  const parsed = dateRaw ? parseDate(dateRaw) : null;

  return {
    amount: normalizeAmount(amountRaw),
    currency: normalizeCurrency(currencyRaw),
    invoiceDate: toISODate(parsed),
    invoiceNumber: extractFirst(text, PATTERNS.invoiceNumber),
  };
}

module.exports = { extractFromPdfBuffer, extractFromText };
