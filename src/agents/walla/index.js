const { scrapeInvoices } = require('./scraper');
const { classifyEmail } = require('../../processors/classifier');
const { extractFromPdfBuffer, extractFromText } = require('../../processors/extractor');
const { isImage, imageToPdfBuffer } = require('../../processors/image-converter');
const { saveInvoiceFile } = require('../../storage/file-store');
const { appendInvoiceMetadata } = require('../../storage/metadata-store');
const { isSourceIdProcessed, isHashProcessed, markProcessed, hashBuffer } = require('../../storage/dedup');
const config = require('../../../config/config');
const logger = require('../../utils/logger');
const path = require('path');

const INVOICE_MIME = new Set([
  'application/pdf',
  'image/jpeg', 'image/jpg', 'image/png', 'image/tiff',
  'image/webp', 'image/gif', 'image/bmp',
]);

async function run() {
  if (!config.walla.user || !config.walla.pass) {
    logger.warn('Walla agent: חסרים פרטי IMAP — הגדר WALLA_USER ו-WALLA_PASS ב-.env');
    return { processed: 0, saved: 0, skipped: 0 };
  }

  logger.info('=== Walla Invoice Agent מתחיל ===');

  let saved = 0, skipped = 0, processed = 0;

  const emailCandidates = await scrapeInvoices();

  for (const candidate of emailCandidates) {
    processed++;

    if (isSourceIdProcessed('walla', candidate.sourceId)) {
      skipped++;
      continue;
    }

    const relevantAttachments = candidate.attachments.filter(a => INVOICE_MIME.has(a.mimeType));
    const { isInvoice, score, reasons } = classifyEmail({ ...candidate, attachments: relevantAttachments });

    if (!isInvoice) {
      logger.debug('לא חשבונית', { subject: candidate.subject, score });
      continue;
    }

    logger.info('חשבונית זוהתה', { subject: candidate.subject, score, from: candidate.from });

    for (const att of relevantAttachments) {
      await processAttachment({ candidate, att });
      saved++;
    }

    // אם אין קבצים מצורפים אך זוהה כחשבונית — סמן כמעובד
    if (relevantAttachments.length === 0) {
      markProcessed({ source: 'walla', sourceId: candidate.sourceId });
    }
  }

  logger.info('=== Walla Agent סיים ===', { processed, saved, skipped });
  return { processed, saved, skipped };
}

async function processAttachment({ candidate, att }) {
  const { sourceId, from, emailReceivedAt } = candidate;

  // ב-Walla הbuffer כבר הורד בזמן ה-scraping
  const buffer = att.buffer;
  if (!buffer || buffer.length === 0) {
    logger.warn('Walla: buffer ריק', { filename: att.filename });
    return;
  }

  const hash = hashBuffer(buffer);
  const existing = isHashProcessed(hash);
  if (existing) {
    logger.info('קובץ זהה כבר קיים', { existing: existing.filename, current: att.filename });
    markProcessed({ source: 'walla', sourceId, fileHash: hash, filename: att.filename, savedPath: existing.savedPath });
    return;
  }

  let meta = att.mimeType === 'application/pdf'
    ? await extractFromPdfBuffer(buffer)
    : extractFromText(candidate.bodyText);

  meta.vendor = meta.vendor || extractVendor(from);
  meta.emailReceivedAt = emailReceivedAt;
  meta.originalFilename = att.filename;
  meta.sourceId = sourceId;
  meta.source = 'walla';

  const invoiceDate = meta.invoiceDate ? new Date(meta.invoiceDate) : new Date(emailReceivedAt);
  const savedPath = await saveInvoiceFile(buffer, sanitizeFilename(att.filename), invoiceDate);
  meta.savedPath = savedPath;

  if (isImage(att.filename)) {
    const pdfBuffer = await imageToPdfBuffer(buffer, att.mimeType);
    const pdfName = path.basename(att.filename, path.extname(att.filename)) + '.pdf';
    const pdfPath = await saveInvoiceFile(pdfBuffer, pdfName, invoiceDate);
    meta.convertedPdfPath = pdfPath;
    logger.info('תמונה הומרה ל-PDF', { pdfPath });
  }

  markProcessed({ source: 'walla', sourceId, fileHash: hash, filename: att.filename, savedPath, meta });

  const d = invoiceDate;
  await appendInvoiceMetadata(d.getFullYear(), d.getMonth() + 1, meta);

  logger.info('חשבונית נשמרה', { vendor: meta.vendor, amount: meta.amount, currency: meta.currency, path: savedPath });
}

function extractVendor(from) {
  const m = from.match(/^"?(.+?)"?\s*</);
  if (m) return m[1].trim();
  return from.split('@')[0] || from;
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 200);
}

module.exports = { run };
