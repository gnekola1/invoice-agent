const { PDFDocument, rgb, PageSizes } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fse = require('fs-extra');
const path = require('path');
const { isImage, imageToPdfBuffer } = require('./image-converter');
const { getMergedPdfPath, getOriginalsForMonth } = require('../storage/file-store');
const { loadMonthMetadata } = require('../storage/metadata-store');
const logger = require('../utils/logger');

const A4 = PageSizes.A4; // [595, 842]

// פונטים עם תמיכה בעברית — לפי סדר עדיפות
const HEBREW_FONTS = [
  'C:\\Windows\\Fonts\\arial.ttf',
  'C:\\Windows\\Fonts\\arialuni.ttf',
  'C:\\Windows\\Fonts\\times.ttf',
  'C:\\Windows\\Fonts\\calibri.ttf',
];

async function loadHebrewFont(pdfDoc) {
  for (const fontPath of HEBREW_FONTS) {
    if (await fse.pathExists(fontPath)) {
      const fontBytes = await fse.readFile(fontPath);
      pdfDoc.registerFontkit(fontkit);
      return pdfDoc.embedFont(fontBytes);
    }
  }
  throw new Error('לא נמצא פונט עברי ב-Windows Fonts');
}

// הפוך טקסט עברי לתצוגה נכונה ב-PDF (RTL workaround)
function reverseHebrew(text) {
  // pdf-lib לא תומך ב-BiDi — הפוך מחרוזות עם תווים עבריים
  if (/[\u0590-\u05FF\uFB00-\uFBFF]/.test(text)) {
    return text.split('').reverse().join('');
  }
  return text;
}

async function buildSeparatorPage(pdfDoc, font, index, meta) {
  const page = pdfDoc.addPage(A4);
  const [width, height] = A4;

  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.95, 0.95, 0.95) });
  page.drawLine({ start: { x: 40, y: height - 80 }, end: { x: width - 40, y: height - 80 }, thickness: 2, color: rgb(0.3, 0.3, 0.3) });
  page.drawLine({ start: { x: 40, y: 80 }, end: { x: width - 40, y: 80 }, thickness: 2, color: rgb(0.3, 0.3, 0.3) });

  // בנה שורות — ערכים בעברית הפוכים לתצוגה
  const lines = [
    { label: `Invoice ${index + 1}`, value: '' },
    meta?.vendor   ? { label: 'Vendor:', value: meta.vendor }           : null,
    meta?.invoiceDate ? { label: 'Date:', value: meta.invoiceDate }     : null,
    meta?.amount   ? { label: 'Amount:', value: `${meta.amount} ${meta.currency || ''}` } : null,
    meta?.invoiceNumber ? { label: 'No:', value: meta.invoiceNumber }   : null,
    meta?.originalFilename ? { label: 'File:', value: meta.originalFilename } : null,
  ].filter(Boolean);

  let y = height - 130;
  for (const { label, value } of lines) {
    const display = value ? `${label}  ${reverseHebrew(value)}` : label;
    try {
      page.drawText(display, { x: 60, y, size: 13, font, color: rgb(0.1, 0.1, 0.1) });
    } catch {
      // fallback: הצג רק תווים ASCII אם הפונט לא תומך
      const ascii = display.replace(/[^\x00-\x7F]/g, '?');
      page.drawText(ascii, { x: 60, y, size: 13, font, color: rgb(0.1, 0.1, 0.1) });
    }
    y -= 26;
  }
}

async function loadAsPdfBytes(filePath) {
  const buf = await fse.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (isImage(filePath)) {
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    return imageToPdfBuffer(buf, mime);
  }
  return buf;
}

async function buildMonthlyPdf(year, month) {
  const files = await getOriginalsForMonth(year, month);
  if (files.length === 0) {
    logger.info('אין קבצים לחודש', { year, month });
    return null;
  }

  const metadata = await loadMonthMetadata(year, month);
  const metaMap = {};
  for (const m of metadata) {
    if (m.savedPath) metaMap[path.resolve(m.savedPath)] = m;
  }

  const sorted = files.map(f => ({
    filePath: f,
    meta: metaMap[path.resolve(f)] || {},
    sortKey: metaMap[path.resolve(f)]?.invoiceDate || metaMap[path.resolve(f)]?.emailReceivedAt || '9999',
  })).sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const mergedPdf = await PDFDocument.create();
  const font = await loadHebrewFont(mergedPdf);

  for (let i = 0; i < sorted.length; i++) {
    const { filePath, meta } = sorted[i];
    logger.info(`מוסיף חשבונית ${i + 1}/${sorted.length}`, { file: path.basename(filePath) });

    await buildSeparatorPage(mergedPdf, font, i, meta);

    try {
      const pdfBytes = await loadAsPdfBytes(filePath);
      const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      const copiedPages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
      copiedPages.forEach(p => mergedPdf.addPage(p));
    } catch (err) {
      logger.error('שגיאה בטעינת קובץ', { filePath, err: err.message });
    }
  }

  const outPath = getMergedPdfPath(year, month);
  await fse.ensureDir(path.dirname(outPath));
  const bytes = await mergedPdf.save();
  await fse.writeFile(outPath, bytes);
  logger.info('PDF מאוחד נשמר', { path: outPath, invoices: sorted.length });
  return outPath;
}

module.exports = { buildMonthlyPdf };
