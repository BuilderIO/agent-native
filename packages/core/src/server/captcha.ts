// ---------------------------------------------------------------------------
// Cloudflare Turnstile — server-side verification
// ---------------------------------------------------------------------------

export interface CaptchaVerifyResult {
  success: boolean;
  errorCodes?: string[];
}

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Verify a Cloudflare Turnstile token server-side.
 *
 * - If no secret key is provided (param or env), returns success (captcha is opt-in).
 * - In dev mode (NODE_ENV !== "production"), always returns success.
 */
export async function verifyCaptcha(
  token: string,
  secretKey?: string,
): Promise<CaptchaVerifyResult> {
  // Dev mode — skip captcha
  if (process.env.NODE_ENV !== "production") {
    return { success: true };
  }

  const secret = secretKey ?? process.env.TURNSTILE_SECRET_KEY;

  // No secret configured — captcha is opt-in, allow through
  if (!secret) {
    return { success: true };
  }

  // No token provided by client
  if (!token) {
    return { success: false, errorCodes: ["missing-input-response"] };
  }

  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
    });

    const data = (await res.json()) as {
      success: boolean;
      "error-codes"?: string[];
    };

    return {
      success: data.success,
      errorCodes: data["error-codes"],
    };
  } catch {
    return { success: false, errorCodes: ["network-error"] };
  }
}
