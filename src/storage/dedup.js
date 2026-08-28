const crypto = require('crypto');
const fs = require('fs');
const fse = require('fs-extra');
const config = require('../../config/config');
const logger = require('../utils/logger');

const DB_PATH = config.storage.dbPath.replace('.db', '.json');

let cache = null;

function load() {
  if (cache) return cache;
  if (fse.pathExistsSync(DB_PATH)) {
    try { cache = fse.readJsonSync(DB_PATH); } catch { cache = { bySourceId: {}, byHash: {} }; }
  } else {
    cache = { bySourceId: {}, byHash: {} };
  }
  return cache;
}

function save() {
  fse.ensureDirSync(require('path').dirname(DB_PATH));
  fse.writeJsonSync(DB_PATH, cache, { spaces: 2 });
}

function hashFile(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function isSourceIdProcessed(source, sourceId) {
  const db = load();
  return !!db.bySourceId[`${source}:${sourceId}`];
}

function isHashProcessed(hash) {
  const db = load();
  return db.byHash[hash] || null;
}

function markProcessed({ source = 'gmail', sourceId, fileHash, filename, savedPath, meta = {} }) {
  const db = load();
  const key = `${source}:${sourceId}`;
  if (db.bySourceId[key]) {
    logger.warn('dedup: כבר קיים רשומה', { source, sourceId });
    return;
  }
  const record = {
    source, sourceId, fileHash, filename, savedPath,
    savedAt: new Date().toISOString(),
    invoiceDate: meta.invoiceDate || null,
    vendor: meta.vendor || null,
    amount: meta.amount || null,
    currency: meta.currency || null,
  };
  db.bySourceId[key] = record;
  if (fileHash) db.byHash[fileHash] = record;
  save();
}

function allProcessed() {
  return Object.values(load().bySourceId);
}

module.exports = { hashFile, hashBuffer, isSourceIdProcessed, isHashProcessed, markProcessed, allProcessed };
