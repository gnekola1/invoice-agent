const { getAuthClient } = require('./auth');
const { fetchEmailCandidates, downloadAttachment } = require('./fetcher');
const { classifyEmail } = require('../../processors/classifier');
const { extractFromPdfBuffer, extractFromText } = require('../../processors/extractor');
const { isImage, imageToPdfBuffer } = require('../../processors/image-converter');
const { saveInvoiceFile } = require('../../storage/file-store');
const { appendInvoiceMetadata } = require('../../storage/metadata-store');
const { isSourceIdProcessed, isHashProcessed, markProcessed, hashBuffer } = require('../../storage/dedup');
const logger = require('../../utils/logger');
const path = require('path');

const INVOICE_MIME = new Set([
  'application/pdf',
  'image/jpeg', 'image/jpg', 'image/png', 'image/tiff',
  'image/webp', 'image/gif', 'image/bmp',
]);

async function run() {
  logger.info('=== Gmail Invoice Agent מתחיל ===');
  const auth = await getAuthClient();

  let saved = 0;
  let skipped = 0;
  let processed = 0;

  for await (const candidate of fetchEmailCandidates(auth)) {
    processed++;

    // בדיקת dedup ברמת המייל
    if (isSourceIdProcessed('gmail', candidate.sourceId)) {
      logger.debug('מייל כבר עובד', { id: candidate.sourceId });
      skipped++;
      continue;
    }

    // סינון קבצים מצורפים רלוונטיים
    const relevantAttachments = candidate.attachments.filter(a => INVOICE_MIME.has(a.mimeType));
    const candidateWithRelevant = { ...candidate, attachments: relevantAttachments };

    const { isInvoice, score, reasons } = classifyEmail(candidateWithRelevant);

    if (!isInvoice) {
      logger.debug('לא חשבונית', { subject: candidate.subject, score });
      continue;
    }

    logger.info('חשבונית זוהתה', { subject: candidate.subject, score, from: candidate.from, reasons });

    // עיבוד כל קובץ מצורף רלוונטי
    for (const att of relevantAttachments) {
      await processAttachment({ candidate, att, auth, saved });
      saved++;
    }
  }

  logger.info('=== Gmail Agent סיים ===', { processed, saved, skipped });
  return { processed, saved, skipped };
}

async function processAttachment({ candidate, att, auth }) {
  const { sourceId, from, emailReceivedAt, subject } = candidate;
  const gmail = candidate._gmail;

  let buffer;
  try {
    buffer = await downloadAttachment(gmail, sourceId, att.attachmentId);
  } catch (err) {
    logger.error('שגיאה בהורדת קובץ', { filename: att.filename, err: err.message });
    return;
  }

  const hash = hashBuffer(buffer);

  // dedup לפי hash
  const existing = isHashProcessed(hash);
  if (existing) {
    logger.info('קובץ זהה כבר קיים', { existing: existing.filename, current: att.filename });
    markProcessed({ source: 'gmail', sourceId, fileHash: hash, filename: att.filename, savedPath: existing.saved_path });
    return;
  }

  // חילוץ metadata
  let meta = {};
  const isPdf = att.mimeType === 'application/pdf';
  if (isPdf) {
    meta = await extractFromPdfBuffer(buffer);
  } else {
    meta = extractFromText(candidate.bodyText);
  }

  // vendor מהשם השולח
  const vendor = extractVendor(from);
  meta.vendor = meta.vendor || vendor;
  meta.emailReceivedAt = emailReceivedAt;
  meta.originalFilename = att.filename;
  meta.sourceId = sourceId;
  meta.source = 'gmail';

  // תאריך לשמירה
  const invoiceDate = meta.invoiceDate ? new Date(meta.invoiceDate) : new Date(emailReceivedAt);

  // שמירת הקובץ המקורי
  const savedPath = await saveInvoiceFile(buffer, sanitizeFilename(att.filename), invoiceDate);
  meta.savedPath = savedPath;

  // אם תמונה — שמור גם PDF
  if (isImage(att.filename)) {
    const pdfBuffer = await imageToPdfBuffer(buffer, att.mimeType);
    const pdfName = path.basename(att.filename, path.extname(att.filename)) + '.pdf';
    const pdfPath = await saveInvoiceFile(pdfBuffer, pdfName, invoiceDate);
    meta.convertedPdfPath = pdfPath;
    logger.info('תמונה הומרה ל-PDF', { pdfPath });
  }

  // dedup
  markProcessed({
    source: 'gmail',
    sourceId,
    fileHash: hash,
    filename: att.filename,
    savedPath,
    meta,
  });

  // metadata חודשי
  const d = invoiceDate;
  await appendInvoiceMetadata(d.getFullYear(), d.getMonth() + 1, meta);

  logger.info('חשבונית נשמרה', { vendor: meta.vendor, amount: meta.amount, currency: meta.currency, path: savedPath });
}

function extractVendor(from) {
  const m = from.match(/^(.+?)\s*</);
  if (m) return m[1].replace(/"/g, '').trim();
  return from.split('@')[0] || from;
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 200);
}

module.exports = { run };
