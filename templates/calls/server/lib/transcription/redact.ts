const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// Phone numbers: US and international. Handles optional +, country code, and
// separators (spaces, dots, dashes, parentheses). Requires at least 7 digits
// total to avoid matching short numeric runs.
const PHONE_RE =
  /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{1,4}(?:[\s.-]\d{1,4}){1,4}\b/g;

// 13-19 consecutive digits, possibly separated by spaces or dashes. Catches
// typical credit-card-like number runs.
const CARD_RE = /\b(?:\d[\s-]?){13,19}\b/g;

function countDigits(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c >= 48 && c <= 57) n += 1;
  }
  return n;
}

export function redactPII(text: string): string {
  if (typeof text !== "string" || !text) return "";

  let out = text.replace(EMAIL_RE, "[redacted-email]");

  out = out.replace(CARD_RE, (match) => {
    const digits = countDigits(match);
    if (digits >= 13 && digits <= 19) return "[redacted-number]";
    return match;
  });

  out = out.replace(PHONE_RE, (match) => {
    const digits = countDigits(match);
    if (digits < 7 || digits > 15) return match;
    return "[redacted-phone]";
  });

  return out;
}
