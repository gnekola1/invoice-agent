const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractFromText } = require('../src/processors/extractor');

test('מחלץ סכום בשקלים', () => {
  const { amount, currency } = extractFromText('סה"כ לתשלום: 1,250.00 ₪');
  assert.equal(amount, 1250);
  assert.equal(currency, 'ILS');
});

test('מחלץ תאריך', () => {
  const { invoiceDate } = extractFromText('תאריך: 15/08/2026');
  assert.equal(invoiceDate, '2026-08-15');
});

test('מחלץ מספר חשבונית', () => {
  const { invoiceNumber } = extractFromText('Invoice #: INV-2026-001');
  assert.ok(invoiceNumber?.includes('INV'));
});

test('טקסט ריק מחזיר ריק', () => {
  const result = extractFromText('');
  assert.equal(result.amount, null);
  assert.equal(result.invoiceDate, null);
});
