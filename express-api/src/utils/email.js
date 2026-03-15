const nodemailer = require('nodemailer');

const FROM_ADDRESS = '"ShyTalk" <noreply@shytalk.shyden.co.uk>';

async function sendEmail(to, subject, html) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP not configured');
  }

  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || '587', 10),
    secure: false,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  return transport.sendMail({
    from: FROM_ADDRESS,
    to,
    subject,
    html,
  });
}

module.exports = { sendEmail };
