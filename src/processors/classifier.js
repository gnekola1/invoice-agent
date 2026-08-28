const config = require('../../config/config');

const { invoiceKeywords } = config;

function scoreText(text, wordList) {
  if (!text) return 0;
  const lower = text.toLowerCase();
  return wordList.reduce((score, kw) => score + (lower.includes(kw.toLowerCase()) ? 1 : 0), 0);
}

/**
 * מקבל EmailCandidate ומחזיר { isInvoice, score, reasons }
 *
 * EmailCandidate = {
 *   subject: string,
 *   from: string,
 *   bodyText: string,
 *   attachments: [{ filename, mimeType }]
 * }
 */
function classifyEmail(candidate) {
  const reasons = [];
  let score = 0;

  const subjectScore = scoreText(candidate.subject, invoiceKeywords.subject);
  if (subjectScore > 0) {
    score += subjectScore * 3; // נושא שווה יותר
    reasons.push(`נושא מכיל מילות מפתח (${subjectScore})`);
  }

  const senderScore = scoreText(candidate.from, invoiceKeywords.sender);
  if (senderScore > 0) {
    score += senderScore * 2;
    reasons.push(`שולח מכיל מילות מפתח (${senderScore})`);
  }

  const bodyScore = scoreText(candidate.bodyText, invoiceKeywords.subject);
  if (bodyScore > 0) {
    score += bodyScore;
    reasons.push(`גוף מייל מכיל מילות מפתח (${bodyScore})`);
  }

  const attachmentScore = (candidate.attachments || []).reduce((s, att) => {
    const nameScore = scoreText(att.filename, invoiceKeywords.attachment);
    const isPdf = att.mimeType === 'application/pdf';
    const isImage = /^image\//i.test(att.mimeType);
    if (nameScore > 0) return s + nameScore * 2;
    if (isPdf || isImage) return s + 1;
    return s;
  }, 0);

  if (attachmentScore > 0) {
    score += attachmentScore * 2;
    reasons.push(`קבצים מצורפים רלוונטיים (score: ${attachmentScore})`);
  }

  // קובץ מצורף ששמו מכיל "invoice" / "חשבונית" / "קבלה" — תמיד חשבונית
  const hasNamedInvoice = (candidate.attachments || []).some(a =>
    /invoice|חשבונית|קבלה|receipt|חשבון|כרטסת/i.test(a.filename)
  );
  if (hasNamedInvoice) {
    score += 5;
    reasons.push('שם קובץ מצביע על חשבונית');
  }

  return {
    isInvoice: score >= 3,
    score,
    reasons,
  };
}

module.exports = { classifyEmail };
