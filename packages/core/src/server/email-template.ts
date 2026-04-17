/**
 * Reusable dark-themed HTML email template.
 *
 * Email clients have limited CSS support, so everything is inlined and layout
 * uses tables for Outlook compatibility. The design mirrors the app's dark UI:
 * near-black card on neutral background, Inter typography with safe fallbacks.
 *
 * Default is monochrome (white CTA on dark). Pass `brandColor` to tint the
 * CTA button and inline links — Clips, for example, passes its purple.
 *
 * Usage:
 *   const { html, text } = renderEmail({
 *     preheader: "…",
 *     heading: "You're invited to join Acme",
 *     paragraphs: ["Alice invited you to join…"],
 *     cta: { label: "Accept invite", url: "https://…" },
 *     footer: "If you weren't expecting this, ignore this email.",
 *   });
 */

export interface EmailCta {
  label: string;
  url: string;
}

export interface RenderEmailArgs {
  /** Short preview text shown by email clients next to the subject. */
  preheader?: string;
  /** Large headline at the top of the card. */
  heading: string;
  /** Body paragraphs rendered after the heading. Plain strings — escaped. */
  paragraphs: string[];
  /** Primary call-to-action rendered as a real button. */
  cta?: EmailCta;
  /** Small muted text under the CTA (e.g. expiry note). */
  footer?: string;
  /**
   * Optional brand hex color for the CTA button and inline links. Defaults to
   * a monochrome near-white button with dark text.
   */
  brandColor?: string;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

/**
 * Only accept a strict `#rrggbb` hex color for `brandColor`. Anything else
 * could inject CSS into the inline `style` attribute (`red; background:url(…)`).
 */
function sanitizeHexColor(input: string | undefined): string | undefined {
  if (!input) return undefined;
  return /^#[0-9a-fA-F]{6}$/.test(input) ? input : undefined;
}

export function renderEmail(args: RenderEmailArgs): RenderedEmail {
  const preheader = args.preheader || "";
  const brand = sanitizeHexColor(args.brandColor);

  // Monochrome default: near-white button with dark text. Brand override:
  // colored button with white text.
  const ctaBg = brand ?? "#fafafa";
  const ctaFg = brand ? "#ffffff" : "#0a0a0c";
  const linkColor = brand ?? "#a1a1aa";

  const paragraphsHtml = args.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px 0; font-size:16px; line-height:1.6; color:#d4d4d8;">${p}</p>`,
    )
    .join("");

  const ctaHtml = args.cta
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0 0;">
        <tr>
          <td style="border-radius:10px; background:${ctaBg};">
            <a href="${escapeAttr(args.cta.url)}"
               style="display:inline-block; padding:14px 26px; font-family:'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; font-weight:600; color:${ctaFg}; text-decoration:none; border-radius:10px;">
              ${escapeHtml(args.cta.label)}
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:20px 0 0 0; font-size:13px; line-height:1.5; color:#71717a; word-break:break-all;">
        Or paste this link into your browser:<br/>
        <a href="${escapeAttr(args.cta.url)}" style="color:${linkColor}; text-decoration:none;">${escapeHtml(args.cta.url)}</a>
      </p>
    `
    : "";

  const footerHtml = args.footer
    ? `<p style="margin:28px 0 0 0; font-size:13px; line-height:1.5; color:#71717a;">${escapeHtml(args.footer)}</p>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark light" />
    <meta name="supported-color-schemes" content="dark light" />
    <title>${escapeHtml(args.heading)}</title>
    <style>
      @media (prefers-color-scheme: light) {
        .bg-outer { background-color: #0a0a0c !important; }
      }
      a { color: ${linkColor}; }
    </style>
  </head>
  <body style="margin:0; padding:0; background-color:#0a0a0c; font-family:'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; -webkit-font-smoothing:antialiased;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
      ${escapeHtml(preheader)}
    </div>
    <table role="presentation" class="bg-outer" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#0a0a0c; padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;">
            <tr>
              <td style="background-color:#141417; border:1px solid #27272a; border-radius:16px; padding:36px 36px 32px 36px;">
                <h1 style="margin:0 0 20px 0; font-size:24px; line-height:1.3; font-weight:600; color:#fafafa; letter-spacing:-0.02em;">
                  ${escapeHtml(args.heading)}
                </h1>
                ${paragraphsHtml}
                ${ctaHtml}
                ${footerHtml}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const textLines: string[] = [];
  textLines.push(args.heading);
  textLines.push("");
  for (const p of args.paragraphs) {
    textLines.push(stripTags(p));
    textLines.push("");
  }
  if (args.cta) {
    textLines.push(`${args.cta.label}: ${args.cta.url}`);
    textLines.push("");
  }
  if (args.footer) {
    textLines.push(args.footer);
  }

  return { html, text: textLines.join("\n").trim() };
}

function stripTags(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Build an inline `<strong>` tag with consistent styling for use inside
 * paragraph strings passed to `renderEmail`. Escapes the content.
 */
export function emailStrong(text: string): string {
  return `<strong style="color:#fafafa; font-weight:600;">${escapeHtml(text)}</strong>`;
}
