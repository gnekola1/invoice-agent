const sharp = require('sharp');
const { PDFDocument, rgb } = require('pdf-lib');
const logger = require('../utils/logger');

const SUPPORTED_IMAGE = /\.(jpe?g|png|tiff?|webp|gif|bmp)$/i;

function isImage(filename) {
  return SUPPORTED_IMAGE.test(filename);
}

/**
 * ממיר buffer תמונה ל-PDF buffer (עמוד אחד, מדויק לגודל התמונה)
 */
async function imageToPdfBuffer(imageBuffer, mimeType) {
  // המר תמיד ל-PNG לפני הטמעה — pdf-lib תומך ב-JPG ו-PNG
  const isJpeg = /jpe?g/i.test(mimeType);

  let embeddable;
  let meta;
  if (isJpeg) {
    embeddable = await sharp(imageBuffer).jpeg({ quality: 95 }).toBuffer();
    meta = await sharp(embeddable).metadata();
  } else {
    embeddable = await sharp(imageBuffer).png().toBuffer();
    meta = await sharp(embeddable).metadata();
  }

  const { width, height } = meta;

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([width, height]);

  const img = isJpeg
    ? await pdfDoc.embedJpg(embeddable)
    : await pdfDoc.embedPng(embeddable);

  page.drawImage(img, { x: 0, y: 0, width, height });

  const pdfBytes = await pdfDoc.save();
  logger.info('תמונה הומרה ל-PDF', { width, height });
  return Buffer.from(pdfBytes);
}

module.exports = { isImage, imageToPdfBuffer };
