function baseTemplate({ title, lead, body, actionUrl, actionLabel }) {
  const action = actionUrl && actionLabel ? `
    <tr>
      <td style="padding:24px 0 8px;">
        <a href="${actionUrl}" style="display:inline-block;background:#a11d48;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:700;">${actionLabel}</a>
      </td>
    </tr>
  ` : '';
  return `<!doctype html>
<html lang="pl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f7f3f5;color:#21151b;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f3f5;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #eadde3;">
        <tr>
          <td style="background:#21151b;color:#ffffff;padding:26px 28px;">
            <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#f0b8ca;">Spotykaj</div>
            <h1 style="margin:8px 0 0;font-size:25px;line-height:1.25;">${title}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:28px;color:#21151b;font-size:16px;line-height:1.6;">
            <p style="margin:0 0 16px;font-size:18px;font-weight:700;">${lead}</p>
            ${body}
            <table role="presentation" cellspacing="0" cellpadding="0">${action}</table>
            <p style="margin:24px 0 0;color:#6d5963;font-size:13px;">Jeżeli to nie Ty wykonałeś tę akcję, zignoruj wiadomość albo skontaktuj się z administracją.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function textTemplate({ title, lead, bodyText, actionUrl, actionLabel }) {
  return [
    `Spotykaj - ${title}`,
    '',
    lead,
    '',
    bodyText,
    actionUrl ? `${actionLabel}: ${actionUrl}` : '',
    '',
    'Jeżeli to nie Ty wykonałeś tę akcję, zignoruj wiadomość albo skontaktuj się z administracją.'
  ].filter(Boolean).join('\n');
}

function verificationEmail({ url }) {
  return {
    subject: 'Potwierdź adres e-mail w Spotykaj',
    html: baseTemplate({
      title: 'Potwierdź adres e-mail',
      lead: 'Dokończ aktywację konta.',
      body: '<p>Kliknij przycisk poniżej, aby potwierdzić adres e-mail. Po potwierdzeniu możesz dodawać ogłoszenia, wysyłać wiadomości i korzystać z płatnych opcji.</p>',
      actionUrl: url,
      actionLabel: 'Potwierdź e-mail'
    }),
    text: textTemplate({
      title: 'Potwierdź adres e-mail',
      lead: 'Dokończ aktywację konta.',
      bodyText: 'Potwierdź adres e-mail, aby korzystać z pełnych funkcji konta.',
      actionUrl: url,
      actionLabel: 'Potwierdź e-mail'
    })
  };
}

function passwordResetEmail({ url }) {
  return {
    subject: 'Reset hasła w Spotykaj',
    html: baseTemplate({
      title: 'Reset hasła',
      lead: 'Otrzymaliśmy prośbę o zmianę hasła.',
      body: '<p>Link jest ważny przez 60 minut. Jeżeli nie prosiłeś o reset hasła, nie wykonuj żadnej akcji.</p>',
      actionUrl: url,
      actionLabel: 'Ustaw nowe hasło'
    }),
    text: textTemplate({
      title: 'Reset hasła',
      lead: 'Otrzymaliśmy prośbę o zmianę hasła.',
      bodyText: 'Link jest ważny przez 60 minut.',
      actionUrl: url,
      actionLabel: 'Ustaw nowe hasło'
    })
  };
}

function securityAlertEmail({ title, message }) {
  return {
    subject: title,
    html: baseTemplate({
      title,
      lead: 'Powiadomienie bezpieczeństwa konta.',
      body: `<p>${message}</p>`
    }),
    text: textTemplate({
      title,
      lead: 'Powiadomienie bezpieczeństwa konta.',
      bodyText: message
    })
  };
}

function moderationNoticeEmail({ title, message, actionUrl = null }) {
  return {
    subject: title,
    html: baseTemplate({
      title,
      lead: 'Wymagana uwaga administracji.',
      body: `<p>${message}</p>`,
      actionUrl,
      actionLabel: actionUrl ? 'Otwórz panel' : null
    }),
    text: textTemplate({
      title,
      lead: 'Wymagana uwaga administracji.',
      bodyText: message,
      actionUrl,
      actionLabel: 'Otwórz panel'
    })
  };
}

module.exports = {
  moderationNoticeEmail,
  passwordResetEmail,
  securityAlertEmail,
  verificationEmail
};
