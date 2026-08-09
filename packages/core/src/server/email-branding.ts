/**
 * Deployment-level default branding for every email rendered by `renderEmail`.
 *
 * Most emails an app sends are not sent by app code: signup verification,
 * magic links, password resets, org invites, share notifications, and review
 * comments are rendered inside the framework, which has no call site an app can
 * reach. Without a default, those emails carry the Agent Native logo no matter
 * how the app brands itself.
 *
 * Configured once at startup from a server plugin, next to
 * `registerEmailRenderer`:
 *
 *   configureEmailBranding({
 *     logoUrl: "https://cdn.acme.com/mark.png",
 *     color: "#0e7c86",
 *   });
 *
 * Values are validated here, at the call site that set them, so a malformed
 * color fails at boot with a stack trace pointing at the plugin — rather than
 * at send time, months later, as an email that quietly looks wrong.
 *
 * The brand *name* is deliberately absent. `APP_NAME` already resolves it, and
 * a second source for the same string is how the email header and the subject
 * line start disagreeing. Pass `brandName` per call to override one message.
 */

/**
 * Why globalThis: under Vite HMR and some Nitro/Rollup bundle splits this
 * module is evaluated more than once — the plugin that calls
 * `configureEmailBranding` lands in one module instance and `renderEmail`
 * lands in another, so the render would read empty branding even though the
 * call succeeded. Pinning the state to the process makes registration order
 * the only thing that matters. Mirrors `file-upload/registry.ts`.
 */
const BRANDING_KEY = Symbol.for("@agent-native/core/email.branding");

interface GlobalWithBranding {
  [BRANDING_KEY]?: EmailBranding;
}

export interface EmailBranding {
  /** Absolute `https://` URL shown in the email header. */
  logoUrl?: string;
  /** `#rrggbb` accent for the CTA button and inline links. */
  color?: string;
}

/**
 * Only accept a strict `#rrggbb` hex color. Anything else could inject CSS into
 * the inline `style` attribute (`red; background:url(…)`).
 */
export function sanitizeHexColor(
  input: string | undefined,
): string | undefined {
  if (!input) return undefined;
  return /^#[0-9a-fA-F]{6}$/.test(input) ? input : undefined;
}

/**
 * Only accept an absolute `https://` URL for a brand logo. Email clients drop
 * relative and mixed-content images, and an unvalidated string in `src` is an
 * injection surface.
 */
export function sanitizeLogoUrl(input: string | undefined): string | undefined {
  if (!input) return undefined;
  try {
    return new URL(input).protocol === "https:" ? input : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Set the deployment's default email branding. Call once from a server plugin.
 * Throws on a value that would be silently dropped at render time.
 */
export function configureEmailBranding(branding: EmailBranding): void {
  const logoUrl = branding.logoUrl?.trim() || undefined;
  if (logoUrl && !sanitizeLogoUrl(logoUrl)) {
    throw new Error(
      "configureEmailBranding: logoUrl must be an absolute https:// URL. " +
        "Email clients drop relative and mixed-content images.",
    );
  }

  const color = branding.color?.trim() || undefined;
  if (color && !sanitizeHexColor(color)) {
    throw new Error(
      "configureEmailBranding: color must be a six-digit hex such as #0e7c86.",
    );
  }

  const globals = globalThis as typeof globalThis & GlobalWithBranding;
  globals[BRANDING_KEY] = { logoUrl, color };
}

/** The configured branding, or an empty object when nothing was configured. */
export function getEmailBranding(): EmailBranding {
  const globals = globalThis as typeof globalThis & GlobalWithBranding;
  return globals[BRANDING_KEY] ?? {};
}

/** Clear the configured branding. Tests and app teardown. */
export function resetEmailBranding(): void {
  const globals = globalThis as typeof globalThis & GlobalWithBranding;
  delete globals[BRANDING_KEY];
}
