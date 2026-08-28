const { ImapFlow } = require('imapflow');
const config = require('../../../config/config');
const logger = require('../../utils/logger');
const { subDays } = require('date-fns');

function getClient() {
  return new ImapFlow({
    host: config.walla.host,
    port: config.walla.port,
    secure: true,
    auth: {
      user: config.walla.user,
      pass: config.walla.pass,
    },
    logger: false,
    tls: { rejectUnauthorized: false },
  });
}

/**
 * מחזיר generator של EmailCandidate — אותו פורמט כמו Gmail agent
 */
async function* fetchEmailCandidates() {
  const client = getClient();

  try {
    await client.connect();
    logger.info('Walla IMAP — מחובר', { user: config.walla.user });

    await client.mailboxOpen('INBOX');

    const since = subDays(new Date(), config.gmail.daysBack);
    const sinceStr = since.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/\//g, '-');

    // חיפוש מיילים עם קבצים מצורפים מהתאריך הנדרש
    const uids = await client.search({ since, header: {} }, { uid: true });
    logger.info(`Walla: נמצאו ${uids.length} מיילים לעיבוד`);

    let count = 0;
    for await (const msg of client.fetch(uids.length > 0 ? uids : '1:*', {
      uid: true,
      envelope: true,
      bodyStructure: true,
      source: false,
    })) {
      if (count >= config.gmail.maxResults) break;
      count++;

      const candidate = buildCandidate(msg);
      if (!candidate) continue;

      // הורד תוכן מלא רק אם יש קבצים מצורפים
      if (candidate.attachments.length > 0) {
        const full = await client.fetchOne(msg.uid, { source: true }, { uid: true });
        candidate._rawSource = full?.source;
        candidate._client = client;
        candidate._uid = msg.uid;
      }

      yield candidate;
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

function buildCandidate(msg) {
  if (!msg?.envelope) return null;

  const from = msg.envelope.from?.[0];
  const fromStr = from
    ? `"${from.name || ''}" <${from.mailbox}@${from.host}>`
    : '';

  return {
    source: 'walla',
    sourceId: `walla:${msg.uid}`,
    subject: msg.envelope.subject || '',
    from: fromStr,
    date: msg.envelope.date?.toISOString() || '',
    emailReceivedAt: msg.envelope.date?.toISOString() || new Date().toISOString(),
    bodyText: '',
    attachments: collectAttachments(msg.bodyStructure),
    _uid: msg.uid,
  };
}

function collectAttachments(part, result = []) {
  if (!part) return result;

  const disposition = part.disposition?.toLowerCase();
  const isAttachment = disposition === 'attachment' || disposition === 'inline';
  const hasFilename = part.parameters?.name || part.dispositionParameters?.filename;

  if (hasFilename && part.type !== 'multipart') {
    result.push({
      filename: part.parameters?.name || part.dispositionParameters?.filename || 'attachment',
      mimeType: `${part.type}/${part.subtype}`.toLowerCase(),
      partId: part.part || '1',
      size: part.size || 0,
    });
  }

  for (const child of part.childNodes || []) {
    collectAttachments(child, result);
  }

  return result;
}

async function downloadAttachment(client, uid, partId) {
  const chunks = [];
  const dl = await client.download(uid, partId, { uid: true });
  for await (const chunk of dl.content) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = { fetchEmailCandidates, downloadAttachment };
