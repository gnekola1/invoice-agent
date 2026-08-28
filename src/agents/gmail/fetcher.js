const { google } = require('googleapis');
const { subDays, formatISO } = require('date-fns');
const config = require('../../../config/config');
const logger = require('../../utils/logger');

/**
 * מחזיר רשימת מיילים עם קבצים מצורפים שנראים כחשבוניות
 * @param {OAuth2Client} auth
 * @returns {AsyncGenerator<EmailCandidate>}
 */
async function* fetchEmailCandidates(auth) {
  const gmail = google.gmail({ version: 'v1', auth });

  const after = formatISO(subDays(new Date(), config.gmail.daysBack), { representation: 'date' });
  const query = `has:attachment after:${after}`;

  logger.info('מחפש מיילים ב-Gmail', { query, maxResults: config.gmail.maxResults });

  let pageToken;
  let total = 0;

  do {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: Math.min(config.gmail.maxResults - total, 100),
      pageToken,
    });

    const messages = res.data.messages || [];
    pageToken = res.data.nextPageToken;

    for (const { id } of messages) {
      if (total >= config.gmail.maxResults) return;
      total++;

      const candidate = await fetchMessageDetails(gmail, id);
      if (candidate) yield candidate;
    }
  } while (pageToken && total < config.gmail.maxResults);

  logger.info(`סיום סריקה — ${total} מיילים נסרקו`);
}

async function fetchMessageDetails(gmail, messageId) {
  try {
    const msg = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const headers = Object.fromEntries(
      (msg.data.payload?.headers || []).map(h => [h.name.toLowerCase(), h.value])
    );

    const candidate = {
      source: 'gmail',
      sourceId: messageId,
      subject: headers['subject'] || '',
      from: headers['from'] || '',
      date: headers['date'] || '',
      emailReceivedAt: new Date(parseInt(msg.data.internalDate)).toISOString(),
      bodyText: extractBody(msg.data.payload),
      attachments: [],
    };

    // איסוף קבצים מצורפים
    candidate.attachments = collectAttachmentMeta(msg.data.payload);

    // שמור reference ל-gmail object לצורך הורדה מאוחרת
    candidate._gmail = gmail;
    candidate._payload = msg.data.payload;

    return candidate;
  } catch (err) {
    logger.warn('שגיאה בטעינת מייל', { messageId, err: err.message });
    return null;
  }
}

function extractBody(payload) {
  if (!payload) return '';
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf8');
  }
  for (const part of payload.parts || []) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf8');
    }
    const nested = extractBody(part);
    if (nested) return nested;
  }
  return '';
}

function collectAttachmentMeta(payload, result = []) {
  if (!payload) return result;
  if (payload.filename && payload.body?.attachmentId) {
    result.push({
      filename: payload.filename,
      mimeType: payload.mimeType,
      attachmentId: payload.body.attachmentId,
      size: payload.body.size || 0,
    });
  }
  for (const part of payload.parts || []) {
    collectAttachmentMeta(part, result);
  }
  return result;
}

/**
 * מוריד קובץ מצורף מ-Gmail
 * @returns {Buffer}
 */
async function downloadAttachment(gmail, messageId, attachmentId) {
  const res = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachmentId,
  });
  return Buffer.from(res.data.data, 'base64');
}

module.exports = { fetchEmailCandidates, downloadAttachment };
