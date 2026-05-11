const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const tls = require('tls');
const path = require('path');

const emailTemplates = require('./emailTemplateService');

const appRoot = path.join(__dirname, '..', '..');
const logDir = path.join(appRoot, 'backups', 'logs');

function mailConfig() {
  return {
    provider: String(process.env.MAIL_PROVIDER || 'log').toLowerCase(),
    from: process.env.MAIL_FROM || 'Spotykaj <no-reply@spotykaj.pl>',
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    adminEmails: String(process.env.ADMIN_EMAILS || process.env.SECURITY_EMAIL || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  };
}

function appBaseUrl() {
  return (process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || 'https://spotykaj.pl').replace(/\/+$/, '');
}

function logMail(event, data) {
  fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(path.join(logDir, 'mail.log'), `${JSON.stringify({ timestamp: new Date().toISOString(), event, ...data })}\n`);
}

function parseAddress(value) {
  const match = String(value || '').match(/^(.*)<([^>]+)>$/);
  return match ? match[2].trim() : String(value || '').trim();
}

function encodeMessage({ from, to, subject, html, text }) {
  const boundary = `spotykaj-${crypto.randomBytes(12).toString('hex')}`;
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text || '',
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html || '',
    '',
    `--${boundary}--`,
    ''
  ].join('\r\n');
}

function readLine(socket) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    function onData(chunk) {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || '';
      if (/^\d{3} /.test(last)) {
        socket.off('data', onData);
        resolve(buffer);
      }
    }
    socket.on('data', onData);
    socket.once('error', reject);
  });
}

async function command(socket, line, expected) {
  socket.write(`${line}\r\n`);
  const response = await readLine(socket);
  if (expected && !String(response).startsWith(expected)) throw new Error(`SMTP odrzucił komendę: ${line}`);
  return response;
}

function connectSmtp(config) {
  return new Promise((resolve, reject) => {
    const socket = config.secure
      ? tls.connect(config.port, config.host, { servername: config.host }, () => resolve(socket))
      : net.connect(config.port, config.host, () => resolve(socket));
    socket.once('error', reject);
    socket.setTimeout(15000, () => {
      socket.destroy();
      reject(new Error('Timeout SMTP.'));
    });
  });
}

function upgradeTls(socket, host) {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({ socket, servername: host }, () => resolve(secureSocket));
    secureSocket.once('error', reject);
  });
}

async function sendSmtp(config, message) {
  let socket = await connectSmtp(config);
  await readLine(socket);
  await command(socket, `EHLO ${process.env.SMTP_HELO || 'spotykaj.pl'}`, '250');
  if (!config.secure && String(process.env.SMTP_STARTTLS || 'true').toLowerCase() !== 'false') {
    await command(socket, 'STARTTLS', '220');
    socket = await upgradeTls(socket, config.host);
    await command(socket, `EHLO ${process.env.SMTP_HELO || 'spotykaj.pl'}`, '250');
  }
  if (config.user && config.pass) {
    const auth = Buffer.from(`\u0000${config.user}\u0000${config.pass}`).toString('base64');
    await command(socket, `AUTH PLAIN ${auth}`, '235');
  }
  await command(socket, `MAIL FROM:<${parseAddress(message.from)}>`, '250');
  await command(socket, `RCPT TO:<${parseAddress(message.to)}>`, '250');
  await command(socket, 'DATA', '354');
  socket.write(`${encodeMessage(message).replace(/\r?\n\./g, '\r\n..')}\r\n.\r\n`);
  await readLine(socket);
  await command(socket, 'QUIT');
}

async function sendMail({ to, subject, html, text }) {
  const config = mailConfig();
  const message = { from: config.from, to, subject, html, text };
  if (!to) return { skipped: true };
  if (config.provider === 'smtp' && config.host) {
    await sendSmtp(config, message);
    logMail('sent', { to, subject, provider: 'smtp' });
    return { sent: true, provider: 'smtp' };
  }
  logMail('logged', { to, subject, provider: config.provider });
  return { sent: false, provider: 'log' };
}

async function notifyAdmins(template) {
  const config = mailConfig();
  await Promise.all(config.adminEmails.map((to) => sendMail({ to, ...template }).catch((error) => {
    logMail('admin_notification_failed', { to, subject: template.subject, error: error.message });
  })));
}

module.exports = {
  appBaseUrl,
  emailTemplates,
  mailConfig,
  notifyAdmins,
  sendMail
};
