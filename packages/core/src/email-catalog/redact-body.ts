const URL_PATTERN = /https?:\/\/[^\s"'<>)]+|(?<=["'\s]|^)\/\/[^\s"'<>)]+/gi;

const SENSITIVE_URL_PATH_PATTERN =
  /\/(?:reset-password|password-reset|magic-link|magic_link|verify-email|email-verification|verification|confirm-email|auth\/callback|sso\/callback|unlock-account)(?:[/?]|$)/i;

const SENSITIVE_QUERY_PARAM_PATTERN =
  /(?:\?|#|&(?:amp;)?)(?:token|code|otp|otp_code|otpcode|verification_code|verificationcode|verify_token|verifytoken|reset_token|resettoken|magic|auth|auth_token|authtoken|session|sid|sig|signature|secret|key|nonce|access_token|accesstoken|id_token|idtoken|oobcode)=/i;

const JWT_PATTERN =
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;

const OTP_KEYWORD_PATTERN =
  /\b(?:otp|one[- ]time\s+(?:password|code|pin)|verification\s+code|security\s+code|access\s+code|passcode|pin\s+code|login\s+code)\b/i;

const OTP_CODE_CANDIDATE_PATTERN = /\b\d{4,8}\b/g;

const OTP_KEYWORD_WINDOW = 40;

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

export function redactSensitiveEmailBodyContent(value: string): string {
  let redacted = redactSensitiveUrls(value);
  redacted = redactJwtLikeTokens(redacted);
  redacted = redactOtpCodes(redacted);
  return redacted;
}
