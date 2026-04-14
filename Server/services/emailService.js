const nodemailer = require("nodemailer");
const config = require("../config");
const { logger } = require("../logger");

async function sendPasswordResetEmail(email, resetUrl) {
  if (!config.smtpHost) {
    logger.info("DEV reset link", { email, resetUrl });
    return;
  }

  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass,
    },
  });

  await transporter.sendMail({
    from: `"SyncDev" <${config.smtpUser}>`,
    to: email,
    subject: "SyncDev password reset",
    html: `
      <p>You requested a password reset.</p>
      <p><a href="${resetUrl}">Reset your password</a></p>
      <p>If you did not request this, ignore this email.</p>
    `,
  });
}

module.exports = { sendPasswordResetEmail };
