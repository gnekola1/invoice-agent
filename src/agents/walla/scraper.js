const { chromium } = require('playwright');
const fse = require('fs-extra');
const path = require('path');
const config = require('../../../config/config');
const logger = require('../../utils/logger');

const SESSION_PATH = path.resolve(__dirname, '../../../credentials/walla-session.json');
const WALLA_LOGIN_URL = 'https://mail.walla.co.il';

async function launchBrowser() {
  return chromium.launch({ headless: true });
}

async function loadSession(context) {
  if (await fse.pathExists(SESSION_PATH)) {
    try {
      const state = await fse.readJson(SESSION_PATH);
      await context.addCookies(state.cookies || []);
      logger.info('Walla: טוען session קיים');
      return true;
    } catch { return false; }
  }
  return false;
}

async function saveSession(context) {
  const state = await context.storageState();
  await fse.ensureDir(path.dirname(SESSION_PATH));
  await fse.writeJson(SESSION_PATH, state, { spaces: 2 });
  logger.info('Walla: session נשמר');
}

async function dismissPopups(page) {
  // סגור כל popup שמופיע (אזהרת אבטחה וכדומה)
  const popupSelectors = [
    'button:has-text("הבנתי, תודה")',
    'button:has-text("הבנתי")',
    'button:has-text("סגור")',
    'button:has-text("close")',
    '.modal-close',
    '[aria-label="Close"]',
  ];
  for (const sel of popupSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        logger.info('Walla: popup נסגר');
        await page.waitForTimeout(500);
      }
    } catch {}
  }
}

async function login(page) {
  logger.info('Walla: מתחבר...');
  await page.goto(WALLA_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });

  // שלב 1 — מייל
  await page.waitForSelector('input[type="text"], input[placeholder*="מייל"]', { timeout: 15000 });
  await page.fill('input[type="text"], input[placeholder*="מייל"]', config.walla.user);
  await page.click('button:has-text("המשך")');

  // שלב 2 — סיסמה
  await page.waitForSelector('input[type="password"]', { timeout: 15000 });
  await page.fill('input[type="password"]', config.walla.pass);
  await page.click('button:has-text("חברו אותי")');

  // המתן לטעינת תיבת הדואר
  await page.waitForURL(/mail\.walla\.co\.il\/#\/mbox/, { timeout: 30000 });
  await page.waitForTimeout(2000);
  await dismissPopups(page);

  logger.info('Walla: כניסה הצליחה', { url: page.url() });
}

async function isLoggedIn(page) {
  try {
    await page.goto(WALLA_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);
    return page.url().includes('#/mbox');
  } catch { return false; }
}

async function scrapeInvoices() {
  if (!config.walla.user || !config.walla.pass) {
    throw new Error('WALLA_USER ו-WALLA_PASS חסרים ב-.env');
  }

  const browser = await launchBrowser();
  const context = await browser.newContext({
    locale: 'he-IL',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  });

  const candidates = [];
  const page = await context.newPage();

  try {
    const hasSession = await loadSession(context);
    if (hasSession && await isLoggedIn(page)) {
      logger.info('Walla: נכנס עם session קיים');
      await dismissPopups(page);
    } else {
      await login(page);
      await saveSession(context);
    }

    // אסוף מיילים עם קבצים מצורפים
    const emails = await collectEmailsWithAttachments(page, context);
    candidates.push(...emails);
    logger.info(`Walla: נאספו ${candidates.length} מיילים עם קבצים מצורפים`);

  } catch (err) {
    logger.error('Walla scraper נכשל', { err: err.message });
    await fse.remove(SESSION_PATH).catch(() => {});
    throw err;
  } finally {
    await browser.close();
  }

  return candidates;
}

async function collectEmailsWithAttachments(page, context) {
  const results = [];
  const daysBack = config.walla.daysBack || 90;
  const since = Date.now() - daysBack * 24 * 60 * 60 * 1000;

  // Walla: שורות עם אייקון קובץ מצורף מסומנות בסלקטור ייחודי
  // מחפש את כל שורות המייל עם paperclip icon
  await page.waitForSelector('.mail-list-item, tr[data-uid], .row-item', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);

  // לחץ על "דואר נכנס" כדי לוודא שאנחנו בinbox
  const inboxLink = page.locator('a:has-text("דואר נכנס"), li:has-text("דואר נכנס")').first();
  if (await inboxLink.isVisible({ timeout: 3000 }).catch(() => false)) {
    await inboxLink.click();
    await page.waitForTimeout(1500);
  }

  // מצא כל שורות עם קובץ מצורף (paperclip svg/icon)
  const rows = await page.$$([
    '.mail-list-item:has(.icon-attachment)',
    '.mail-list-item:has([class*="attachment"])',
    'tr:has(.attachment-icon)',
    'tr:has([data-has-attachment="true"])',
    // fallback — כל השורות
    '.mail-list-item',
    'tr[data-uid]',
  ].join(', '));

  logger.info(`Walla: נמצאו ${rows.length} שורות בinbox`);

  const MAX = Math.min(rows.length, config.gmail.maxResults);

  for (let i = 0; i < MAX; i++) {
    try {
      // רענן את הרשימה בכל איטרציה (DOM משתנה אחרי לחיצה)
      const freshRows = await page.$$('.mail-list-item, tr[data-uid]');
      if (i >= freshRows.length) break;

      const candidate = await processRow(page, context, freshRows[i], i, since);
      if (candidate) {
        results.push(candidate);
        logger.info(`Walla: מייל ${i + 1} עם קבצים מצורפים`, { subject: candidate.subject });
      }

      // חזור לinbox
      await page.goBack().catch(() => {});
      await page.waitForTimeout(1000);
      await dismissPopups(page);
    } catch (err) {
      logger.warn(`Walla: שגיאה בשורה ${i}`, { err: err.message });
      await page.goBack().catch(() => {});
    }
  }

  return results;
}

async function processRow(page, context, row, idx, since) {
  // בדוק אם יש קובץ מצורף בשורה
  const hasAttachment = await row.$('.icon-attachment, [class*="attach"], svg[class*="attach"]')
    .then(el => !!el).catch(() => false);

  // קרא תאריך מהשורה לפני הכניסה
  const dateText = await row.$eval('[class*="date"], td.date, .time', el => el.textContent?.trim()).catch(() => '');

  // לחץ לפתוח את המייל
  await row.click();
  await page.waitForTimeout(2000);
  await dismissPopups(page);

  // קרא נתוני המייל
  const subject = await page.$eval(
    'h1[class*="subject"], .mail-subject, [class*="subject"] h1, .subject',
    el => el.textContent?.trim()
  ).catch(() => '');

  const from = await page.$eval(
    '[class*="from"] [class*="name"], [class*="sender"] [class*="name"], .from-name, [class*="from"]',
    el => el.textContent?.trim()
  ).catch(() => '');

  const bodyText = await page.$eval(
    '[class*="body"], .mail-body, .message-body, iframe',
    el => el.tagName === 'IFRAME'
      ? ''
      : el.textContent?.trim()
  ).catch(() => '');

  // מצא ולחץ על כפתורי הורדת קבצים מצורפים
  const attachmentButtons = await page.$$([
    'a[download]',
    '[class*="attachment"] a',
    '[class*="attach"] button',
    'a[href*="download"]',
    'a[href*="attach"]',
    '[title*="הורד"]',
    '[title*="download"]',
  ].join(', '));

  const attachments = [];

  for (const btn of attachmentButtons) {
    const rawName = await btn.getAttribute('download')
      || await btn.getAttribute('title')
      || await btn.textContent().then(t => t?.trim())
      || `attachment_${idx}`;
    const filename = cleanFilename(rawName);

    try {
      const [download] = await Promise.all([
        context.waitForEvent('download', { timeout: 10000 }),
        btn.click(),
      ]);
      const tmpPath = await download.path();
      if (!tmpPath) continue;
      const buffer = await fse.readFile(tmpPath);
      attachments.push({
        filename: path.basename(filename.trim() || download.suggestedFilename()),
        mimeType: guessMime(filename || download.suggestedFilename()),
        buffer,
      });
      logger.info('Walla: קובץ הורד', { filename });
    } catch (err) {
      logger.warn('Walla: שגיאה בהורדת קובץ', { filename, err: err.message });
    }
  }

  if (attachments.length === 0 && !hasAttachment) return null;

  // אם subject ריק — נסה לחלץ מכותרת הדף
  const finalSubject = subject
    || await page.title().then(t => t.replace('וואלה דואר', '').trim()).catch(() => '')
    || attachments.map(a => a.filename).join(', ')
    || '(ללא נושא)';

  // sourceId יציב — מבוסס על שם הקובץ הראשון
  const stableId = `walla:${idx}:${attachments[0]?.filename || dateText}`;

  return {
    source: 'walla',
    sourceId: stableId,
    subject: finalSubject,
    from: from || 'walla-inbox',
    date: dateText,
    emailReceivedAt: new Date().toISOString(),
    bodyText,
    attachments,
  };
}

function cleanFilename(raw) {
  if (!raw) return 'attachment';
  // הסר סיומות כמו " (107.4K)" או " (2.3MB)"
  return raw.replace(/\s*\(\d+[\d.]*\s*[KMGkmg]?B?\)\s*$/, '').trim();
}

function guessMime(filename) {
  const clean = cleanFilename(filename);
  const ext = path.extname(clean).toLowerCase();
  const map = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.tiff': 'image/tiff', '.tif': 'image/tiff',
    '.webp': 'image/webp',
  };
  // אם לא ניתן לזהות — בדוק אם השם מכיל "invoice"/"חשבונית" ואז pdf
  if (!map[ext] && /invoice|חשבונית|קבלה|receipt/i.test(clean)) {
    return 'application/pdf';
  }
  return map[ext] || 'application/octet-stream';
}

module.exports = { scrapeInvoices };
