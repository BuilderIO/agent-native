/** Sanitize HTML: strip script tags and on* event handlers */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<script[\s\S]*?>/gi, "")
    .replace(/\bon\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\bon\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\bon\w+\s*=\s*[^\s>]*/gi, "");
}

/**
 * Strip Google Calendar invitation boilerplate from event descriptions.
 * GCal embeds the full invitation HTML (guest list, RSVP buttons, "More options",
 * meeting details, "Invitation from Google Calendar" footer) into the description.
 * We render all of that natively, so strip it out to avoid ugly duplication.
 */
export function stripGcalInviteHtml(html: string): string {
  let cleaned = html;

  // Remove "Reply for <email>" section with Yes/No/Maybe buttons
  cleaned = cleaned.replace(
    /<(table|div)[^>]*>[\s\S]*?Reply\s+for[\s\S]*?<\/(table|div)>/gi,
    "",
  );

  // Remove standalone Yes/No/Maybe buttons (various Google formats)
  cleaned = cleaned.replace(
    /<(table|div)[^>]*>[\s\S]*?(?:>Yes<|>No<|>Maybe<)[\s\S]*?<\/(table|div)>/gi,
    "",
  );

  // Remove "More options" link/button
  cleaned = cleaned.replace(/<a[^>]*>[\s]*More\s+options[\s]*<\/a>/gi, "");
  cleaned = cleaned.replace(
    /<(table|div)[^>]*>[\s\S]*?More\s+options[\s\S]*?<\/(table|div)>/gi,
    "",
  );

  // Remove "Invitation from Google Calendar" footer
  cleaned = cleaned.replace(
    /Invitation\s+from\s+<a[^>]*>Google\s+Calendar<\/a>/gi,
    "",
  );
  cleaned = cleaned.replace(/Invitation\s+from\s+Google\s+Calendar/gi, "");

  // Remove "You are receiving this email" disclaimer
  cleaned = cleaned.replace(/You\s+are\s+receiving\s+this[\s\S]*?$/gi, "");

  // Remove "View all guest info" links
  cleaned = cleaned.replace(
    /<a[^>]*>[\s]*View\s+all\s+guest\s+info[\s]*<\/a>/gi,
    "",
  );

  // Remove the "When" / "Guests" sections that duplicate our native UI
  cleaned = cleaned.replace(
    /<b>When<\/b>[\s\S]*?(?=<b>|<hr|<br\s*\/?>[\s]*<br\s*\/?>|$)/gi,
    "",
  );

  // Remove "Join Zoom Meeting" / "Join by phone" blocks that duplicate our meeting link
  cleaned = cleaned.replace(
    /<b>Join\s+Zoom\s+Meeting<\/b>[\s\S]*?(?=<b>Joining\s+notes|<hr|<br\s*\/?>[\s]*<br\s*\/?>[\s]*<br|$)/gi,
    "",
  );
  cleaned = cleaned.replace(
    /<b>Join\s+by\s+phone<\/b>[\s\S]*?(?=<b>|<hr|$)/gi,
    "",
  );

  // Remove "Joining instructions" links
  cleaned = cleaned.replace(
    /<a[^>]*>[\s]*Joining\s+instructions[\s]*<\/a>/gi,
    "",
  );

  // Clean up leftover separators and whitespace
  cleaned = cleaned.replace(/(<hr\s*\/?>[\s]*){2,}/gi, "<hr/>");
  cleaned = cleaned.replace(/(<br\s*\/?>[\s]*){4,}/gi, "<br/><br/>");
  cleaned = cleaned.replace(/([-─]{5,}[\s]*){2,}/g, "");

  // Trim leading/trailing whitespace and empty elements
  cleaned = cleaned.replace(/^[\s<br\/>]*(<hr\s*\/?>)?[\s<br\/>]*/i, "");
  cleaned = cleaned.replace(/[\s<br\/>]*(<hr\s*\/?>)?[\s<br\/>]*$/i, "");

  return cleaned.trim();
}

/** Check if a string looks like HTML */
export function isHtml(str: string): boolean {
  return /<[a-z][\s\S]*>/i.test(str);
}
