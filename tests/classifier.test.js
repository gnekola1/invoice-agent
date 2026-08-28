const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyEmail } = require('../src/processors/classifier');

test('חשבונית ברורה מזוהה', () => {
  const { isInvoice, score } = classifyEmail({
    subject: 'חשבונית מספר 1234',
    from: 'billing@company.com',
    bodyText: 'סה"כ לתשלום 250 ₪',
    attachments: [{ filename: 'invoice.pdf', mimeType: 'application/pdf' }],
  });
  assert.equal(isInvoice, true);
  assert.ok(score >= 3);
});

test('מייל רגיל לא מזוהה כחשבונית', () => {
  const { isInvoice } = classifyEmail({
    subject: 'שלום איך אתה?',
    from: 'friend@gmail.com',
    bodyText: 'נתראה מחר',
    attachments: [],
  });
  assert.equal(isInvoice, false);
});

test('קבלה באנגלית מזוהה', () => {
  const { isInvoice } = classifyEmail({
    subject: 'Your receipt from Amazon',
    from: 'auto-confirm@amazon.com',
    bodyText: 'Thank you for your order. Total: $49.99',
    attachments: [{ filename: 'receipt.pdf', mimeType: 'application/pdf' }],
  });
  assert.equal(isInvoice, true);
});
