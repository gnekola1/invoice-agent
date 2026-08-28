require('dotenv').config();
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

module.exports = {
  google: {
    credentialsPath: path.resolve(ROOT, process.env.GOOGLE_CREDENTIALS_PATH || 'credentials/credentials.json'),
    tokenPath: path.resolve(ROOT, process.env.GOOGLE_TOKEN_PATH || 'credentials/token.json'),
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  },
  gmail: {
    maxResults: parseInt(process.env.GMAIL_MAX_RESULTS || '100', 10),
    daysBack: parseInt(process.env.GMAIL_DAYS_BACK || '90', 10),
  },
  walla: {
    host: process.env.WALLA_IMAP_HOST || 'mail.walla.co.il',
    port: parseInt(process.env.WALLA_IMAP_PORT || '993', 10),
    user: process.env.WALLA_USER || '',
    pass: process.env.WALLA_PASS || '',
    daysBack: parseInt(process.env.WALLA_DAYS_BACK || '90', 10),
  },
  storage: {
    invoicesDir: path.resolve(ROOT, process.env.INVOICES_DIR || 'data/invoices'),
    metadataDir: path.resolve(ROOT, process.env.METADATA_DIR || 'data/metadata'),
    dbPath: path.resolve(ROOT, process.env.DB_PATH || 'data/processed.db'),
    logsDir: path.resolve(ROOT, 'logs'),
  },
  // מילות מפתח לזיהוי חשבוניות — עברית ואנגלית
  invoiceKeywords: {
    subject: [
      'חשבונית', 'קבלה', 'חיוב', 'invoice', 'receipt', 'payment', 'bill',
      'order confirmation', 'אישור הזמנה', 'אישור תשלום', 'פקטורה',
      'tax invoice', 'חשבון', 'תשלום', 'purchase', 'subscription',
    ],
    sender: [
      'noreply', 'billing', 'invoice', 'payment', 'no-reply', 'accounts',
      'finance', 'חשבונות',
    ],
    attachment: [
      'invoice', 'receipt', 'חשבונית', 'קבלה', 'bill', 'חשבון',
    ],
  },
};
