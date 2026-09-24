/**
 * Redact credential-bearing content from a rendered email body before it is
 * persisted to `email_log`. `email_log` is org-admin readable
 * (`authorizeTransactionalEmailRead`), and transactional email routinely
 * embeds a one-time magic-link, password-reset link, or verification/OTP
 * code — each bearer-token-equivalent for the recipient. Storing (or
 * rendering) those verbatim would let anyone with read access to the send
 * log sign in as, or reset the credentials of, the recipient.
 *
 * This is a regex-based scrub, not an HTML parser: it runs over the raw
 * HTML/text body so it catches an `href` attribute value and matching
 * visible link text in one pass. Only content that looks like a credential
 * is replaced — subject-relevant copy, branding, and ordinary links are left
 * intact so the send log stays useful for deliverability/rendering
 * debugging.
 */

/**
 * Explicit-scheme URLs match unconditionally, same as before. Protocol-
 * relative URLs (`//host/path`, common in `href` attributes) only match
 * when preceded by a quote, whitespace, or the start of the string, so a
 * stray `//` in unrelated text (a code comment, a fraction) isn't treated
 * as a link.
 */
const URL_PATTERN = /https?:\/\/[^\s"'<>)]+|(?<=["'\s]|^)\/\/[^\s"'<>)]+/gi;

/** Path segments that indicate the URL itself is a one-time credential. */
const SENSITIVE_URL_PATH_PATTERN =
  /\/(?:reset-password|password-reset|magic-link|magic_link|verify-email|email-verification|verification|confirm-email|auth\/callback|sso\/callback|unlock-account)(?:[/?]|$)/i;

/**
 * Query-param (or fragment) names that carry the actual secret, regardless
 * of path. Checked after `?`, `&`, the HTML-entity-escaped `&amp;` (raw HTML
 * bodies routinely encode the separator that way), or `#` — OAuth implicit-
 * flow tokens (`access_token`, `id_token`) and Firebase-style action codes
 * (`oobCode`) commonly land in the fragment, not the query string. Includes
 * both snake_case and camelCase spellings since `/i` doesn't add or remove
 * underscores.
 */
const SENSITIVE_QUERY_PARAM_PATTERN =
  /(?:\?|#|&(?:amp;)?)(?:token|code|otp|otp_code|otpcode|verification_code|verificationcode|verify_token|verifytoken|reset_token|resettoken|magic|auth|auth_token|authtoken|session|sid|sig|signature|secret|key|nonce|access_token|accesstoken|id_token|idtoken|oobcode)=/i;

/** `eyJ...` base64url JWT shape: header.payload.signature. */
const JWT_PATTERN =
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;

/**
 * Phrases that mean a nearby digit run is a one-time code, not an arbitrary
 * number. Multi-word phrases use `\s+` rather than a literal space because
 * the window tested against this is HTML-tag-stripped (see
 * `stripMarkupForKeywordMatch`), which can leave the words separated by more
 * than one space where a tag used to sit.
 */
const OTP_KEYWORD_PATTERN =
  /\b(?:otp|one[- ]time\s+(?:password|code|pin)|verification\s+code|security\s+code|access\s+code|passcode|pin\s+code|login\s+code)\b/i;

const OTP_CODE_CANDIDATE_PATTERN = /\b\d{4,8}\b/g;

/** How far (in characters) an OTP keyword can be from the digit run and still count. */
const OTP_KEYWORD_WINDOW = 40;

/**
 * Drop tags and decode the handful of entities email templates actually use
 * (`&nbsp;` above all) before testing for an OTP keyword. Without this,
 * `Your <strong>verification</strong> code is 482913` or
 * `verification&nbsp;code` never matches the keyword phrase even though a
 * person reading the rendered email sees "verification code" as one run of
 * words — the code is only for the KEYWORD CHECK; the digit run itself is
 * matched and replaced in the original, untouched string.
 */
function stripMarkupForKeywordMatch(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"');
}

function isSensitiveUrl(url: string): boolean {
  return (
    SENSITIVE_URL_PATH_PATTERN.test(url) ||
    SENSITIVE_QUERY_PARAM_PATTERN.test(url)
  );
}

function redactSensitiveUrls(value: string): string {
  return value.replace(URL_PATTERN, (url) =>
    isSensitiveUrl(url) ? "[REDACTED LINK]" : url,
  );
}

function redactJwtLikeTokens(value: string): string {
  return value.replace(JWT_PATTERN, "[REDACTED]");
}

function redactOtpCodes(value: string): string {
  return value.replace(OTP_CODE_CANDIDATE_PATTERN, (match, offset: number) => {
    const start = Math.max(0, offset - OTP_KEYWORD_WINDOW);
    const end = Math.min(
      value.length,
      offset + match.length + OTP_KEYWORD_WINDOW,
    );
    const window = stripMarkupForKeywordMatch(value.slice(start, end));
    return OTP_KEYWORD_PATTERN.test(window) ? "[REDACTED]" : match;
  });
}

/**
 * Scrub magic links, password-reset links, verification/callback links, JWT-
 * shaped tokens, and keyword-adjacent OTP/verification codes from an email
 * body. Order matters: URLs are redacted whole first so a token embedded in
 * a query string is not also (partially) matched by the JWT/OTP passes.
 */
export function redactSensitiveEmailBodyContent(value: string): string {
  let redacted = redactSensitiveUrls(value);
  redacted = redactJwtLikeTokens(redacted);
  redacted = redactOtpCodes(redacted);
  return redacted;
}
