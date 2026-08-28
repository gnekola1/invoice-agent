const fse = require('fs-extra');
const path = require('path');
const config = require('../../config/config');

function getMetaFilePath(year, month) {
  const mm = String(month).padStart(2, '0');
  return path.join(config.storage.metadataDir, `${year}-${mm}.json`);
}

async function loadMonthMetadata(year, month) {
  const filePath = getMetaFilePath(year, month);
  if (!(await fse.pathExists(filePath))) return [];
  return fse.readJson(filePath);
}

async function appendInvoiceMetadata(year, month, entry) {
  const filePath = getMetaFilePath(year, month);
  await fse.ensureDir(path.dirname(filePath));
  const existing = await loadMonthMetadata(year, month);
  existing.push({ ...entry, recordedAt: new Date().toISOString() });
  await fse.writeJson(filePath, existing, { spaces: 2 });
}

async function getAllMetadata() {
  const files = await fse.readdir(config.storage.metadataDir).catch(() => []);
  const all = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const data = await fse.readJson(path.join(config.storage.metadataDir, f)).catch(() => []);
    all.push(...data);
  }
  return all;
}

module.exports = { loadMonthMetadata, appendInvoiceMetadata, getAllMetadata };
