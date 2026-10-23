export const HUBSPOT_EMAIL_FRAME_TYPE = "hubspot-email";

export function isHubSpotEmailHtml(content: string): boolean {
  return /<meta\b(?=[^>]*\bname\s*=\s*["']agent-native:frame-type["'])(?=[^>]*\bcontent\s*=\s*["']hubspot-email["'])[^>]*>/i.test(
    content,
  );
}

export function createHubSpotEmailHtml({
  title = "Email",
}: { title?: string } = {}): string {
  const escapedTitle = title.replace(/[&<>"']/g, (character) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[character]!;
  });
  return `<!--
  templateType: email
  isAvailableForNewContent: true
-->
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="agent-native:frame-type" content="hubspot-email">
  <title>${escapedTitle}</title>
  <style>
    body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
    table { border-collapse: collapse; }
    td { font-family: Arial, sans-serif; }
    .email-container { width: 100%; max-width: 600px; }
    .email-content { padding: 32px; }
    .email-footer { padding: 24px 32px; font-size: 14px; line-height: 20px; }
    @media only screen and (max-width: 620px) {
      .email-content { padding: 24px 20px !important; }
      .email-footer { padding: 20px !important; }
    }
  </style>
</head>
<body>
  <div data-email-preheader style="display:none;max-height:0;overflow:hidden;mso-hide:all">A short preview of your email.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="600" class="email-container" cellpadding="0" cellspacing="0">
      <tr><td class="email-content">
        <h1>${escapedTitle}</h1>
        <p>Hello {{ personalization_token('contact.firstname', 'there') }},</p>
        <p>Your email content goes here.</p>
      </td></tr>
      <tr><td class="email-footer">
        <p>{{ site_settings.company_name }}<br>
        {{ site_settings.company_street_address_1 }}<br>
        {{ site_settings.company_city }}, {{ site_settings.company_state }}</p>
        <a href="{{ unsubscribe_link }}">Unsubscribe</a>
      </td></tr>
    </table>
  </td></tr></table>
</body>
</html>`;
}
