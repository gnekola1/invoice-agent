const fse = require('fs-extra');
const path = require('path');
const config = require('../../config/config');
const { toYYYY, toMM } = require('../utils/date-utils');
const logger = require('../utils/logger');

function getInvoiceDir(date) {
  const d = date || new Date();
  return path.join(config.storage.invoicesDir, toYYYY(d), toMM(d), 'originals');
}

async function saveInvoiceFile(buffer, filename, date) {
  const dir = getInvoiceDir(date);
  await fse.ensureDir(dir);
  const destPath = path.join(dir, filename);

  // Se il file esiste già, aggiungi un suffisso numerico
  let finalPath = destPath;
  let counter = 1;
  while (await fse.pathExists(finalPath)) {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    finalPath = path.join(dir, `${base}_${counter}${ext}`);
    counter++;
  }

  await fse.writeFile(finalPath, buffer);
  logger.info('קובץ נשמר', { path: finalPath });
  return finalPath;
}

async function getOriginalsForMonth(year, month) {
  const dir = path.join(config.storage.invoicesDir, String(year), String(month).padStart(2, '0'), 'originals');
  if (!(await fse.pathExists(dir))) return [];
  const files = await fse.readdir(dir);
  return files
    .filter(f => /\.(pdf|jpg|jpeg|png|tiff|tif|webp)$/i.test(f))
    .map(f => path.join(dir, f));
}

function getMergedPdfPath(year, month) {
  const mm = String(month).padStart(2, '0');
  return path.join(config.storage.invoicesDir, String(year), mm, `חשבוניות-מאוחד-${mm}-${year}.pdf`);
}

module.exports = { saveInvoiceFile, getOriginalsForMonth, getMergedPdfPath, getInvoiceDir };
