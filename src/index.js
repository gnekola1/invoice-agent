require('dotenv').config();
const fse = require('fs-extra');
const config = require('../config/config');
const logger = require('./utils/logger');
const { buildMonthlyPdf } = require('./processors/pdf-builder');

async function main() {
  // ודא שהתיקיות קיימות
  await fse.ensureDir(config.storage.invoicesDir);
  await fse.ensureDir(config.storage.metadataDir);
  await fse.ensureDir(config.storage.logsDir);

  const args = process.argv.slice(2);
  const mode = args[0] || '--fetch';

  if (mode === '--fetch' || mode === '--all') {
    await runFetch();
  }

  if (mode === '--build-pdf' || mode === '--all') {
    await runBuildPdf(args);
  }

  if (!['--fetch', '--build-pdf', '--all', '--auth'].includes(mode)) {
    printHelp();
  }
}

async function runFetch() {
  logger.info('מצב: איסוף חשבוניות');

  const gmailAgent = require('./agents/gmail/index');
  await gmailAgent.run();

  const wallaAgent = require('./agents/walla/index');
  await wallaAgent.run().catch(err => {
    logger.error('Walla agent נכשל', { err: err.message });
  });
}

async function runBuildPdf(args) {
  logger.info('מצב: בניית PDF מאוחד');
  const now = new Date();
  const year = parseInt(args[1] || now.getFullYear());
  const month = parseInt(args[2] || now.getMonth() + 1);
  const outPath = await buildMonthlyPdf(year, month);
  if (outPath) {
    logger.info(`PDF חודשי נוצר: ${outPath}`);
  } else {
    logger.info('לא נמצאו חשבוניות לחודש זה');
  }
}

function printHelp() {
  console.log(`
Invoice Agent — שימוש:

  node src/index.js [mode] [year] [month]

מצבים:
  --fetch          אסוף חשבוניות מ-Gmail (ברירת מחדל)
  --build-pdf      בנה PDF מאוחד לחודש הנוכחי
  --build-pdf 2026 8   בנה PDF לאוגוסט 2026
  --all            אסוף ואז בנה PDF

הרשאת Gmail (פעם ראשונה):
  npm run auth
`);
}

main().catch(err => {
  logger.error('שגיאה קריטית', { err: err.message, stack: err.stack });
  process.exit(1);
});
