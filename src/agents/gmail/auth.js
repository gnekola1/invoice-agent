const { google } = require('googleapis');
const fse = require('fs-extra');
const readline = require('readline');
const config = require('../../../config/config');
const logger = require('../../utils/logger');

async function getAuthClient() {
  if (!(await fse.pathExists(config.google.credentialsPath))) {
    throw new Error(
      `credentials.json לא נמצא ב-${config.google.credentialsPath}\n` +
      'הורד אותו מ-Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs'
    );
  }

  const credentials = await fse.readJson(config.google.credentialsPath);
  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  // אם יש token שמור — טען אותו
  if (await fse.pathExists(config.google.tokenPath)) {
    const token = await fse.readJson(config.google.tokenPath);
    oAuth2Client.setCredentials(token);

    // רענן אוטומטית אם פג תוקף
    oAuth2Client.on('tokens', async (tokens) => {
      const existing = await fse.readJson(config.google.tokenPath).catch(() => ({}));
      await fse.writeJson(config.google.tokenPath, { ...existing, ...tokens }, { spaces: 2 });
      logger.info('Token רוענן ונשמר');
    });

    return oAuth2Client;
  }

  // הרצה ראשונה — פתח דפדפן לאישור
  return authorizeFirstTime(oAuth2Client);
}

async function authorizeFirstTime(oAuth2Client) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: config.google.scopes,
    prompt: 'consent',
  });

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  הרשאת Gmail — הרצה ראשונה');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\nפתח את הכתובת הבאה בדפדפן:');
  console.log('\n' + authUrl + '\n');

  // נסה לפתוח אוטומטית
  try {
    const open = require('open');
    await open(authUrl);
    console.log('(הדפדפן נפתח אוטומטית)');
  } catch {}

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const code = await new Promise(resolve => {
    rl.question('\nהדבק את הקוד שקיבלת מ-Google: ', ans => {
      rl.close();
      resolve(ans.trim());
    });
  });

  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);

  await fse.ensureDir(require('path').dirname(config.google.tokenPath));
  await fse.writeJson(config.google.tokenPath, tokens, { spaces: 2 });
  logger.info('Token נשמר', { path: config.google.tokenPath });

  return oAuth2Client;
}

// הרצה ישירה: node src/agents/gmail/auth.js
if (require.main === module) {
  getAuthClient()
    .then(() => { console.log('\nהרשאה הושלמה בהצלחה!'); process.exit(0); })
    .catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = { getAuthClient };
