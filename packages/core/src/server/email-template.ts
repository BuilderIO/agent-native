import { getAppConfig } from "../app-config/index.js";

export const AGENT_NATIVE_EMAIL_LOGO_CONTENT_ID = "agent-native-logo";

export interface EmailCta {
  label: string;
  url: string;
}

export interface EmailLinkBlock {
  intro: string;
  url: string;
  placement?: "before-cta" | "after-cta";
}

export interface EmailResourceBlock {
  name: string;
}

export interface RenderEmailArgs {
  preheader?: string;
  heading: string;
  paragraphs: string[];
  cta?: EmailCta;
  secondaryCta?: EmailCta;
  linkBlock?: EmailLinkBlock;
  resourceBlock?: EmailResourceBlock;
  heroHtml?: string;
  closingParagraphs?: string[];
  footer?: string;
  brandName?: string;
  brandLogoUrl?: string;
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

function sanitizeHexColor(input: string | undefined): string | undefined {
  if (!input) return undefined;
  return /^#[0-9a-fA-F]{6}$/.test(input) ? input : undefined;
}

function sanitizeLogoUrl(input: string | undefined): string | undefined {
  if (!input) return undefined;
  try {
    return new URL(input).protocol === "https:" ? input : undefined;
  } catch {
    return undefined;
  }
}

export function renderEmail(args: RenderEmailArgs): RenderedEmail {
  const preheader = args.preheader || "";
  const brand = sanitizeHexColor(args.brandColor);
  const brandName =
    args.brandName?.trim() || getAppConfig().app.name || "Agent-Native";
  const logoSrc =
    sanitizeLogoUrl(args.brandLogoUrl) ??
    `cid:${AGENT_NATIVE_EMAIL_LOGO_CONTENT_ID}`;

  const ctaBg = brand ?? "#fafafa";
  const ctaFg = brand ? "#ffffff" : "#0a0a0c";
  const linkColor = brand ?? "#a1a1aa";
  const resourceBorder = "#3f3f46"; // guard:allow-raw-color — email markup must inline colors for clients.
  const resourceBackground = "#0a0a0c"; // guard:allow-raw-color — email markup must inline colors for clients.
  const resourceText = "#fafafa"; // guard:allow-raw-color — email markup must inline colors for clients.

  // Trusted markup supplied by the caller (template code, not user input),
  // injected as-is so a template can own app-specific previews (e.g. a video
  // thumbnail with a play badge). Callers are responsible for escaping any
  // dynamic values they interpolate.
  const heroHtml = args.heroHtml ?? "";

  const renderParagraphs = (paragraphs: string[] | undefined): string =>
    (paragraphs ?? [])
      .map(
        (p) =>
          `<p style="margin:0 0 16px 0; font-size:16px; line-height:1.6; color:#d4d4d8;">${p}</p>`,
      )
      .join("");

  const paragraphsHtml = renderParagraphs(args.paragraphs);
  const closingParagraphsHtml = args.closingParagraphs?.length
    ? `<div style="margin:28px 0 0 0;">${renderParagraphs(args.closingParagraphs)}</div>`
    : "";

  const linkBlockHtml = args.linkBlock
    ? `
      <p style="margin:24px 0 12px 0; font-size:15px; line-height:1.6; color:#d4d4d8;">${escapeHtml(args.linkBlock.intro)}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0; border:1px solid #3f3f46; border-radius:10px; background:#0a0a0c;">
        <tr>
          <td style="padding:14px 16px;">
            <a href="${escapeAttr(args.linkBlock.url)}" style="display:block; color:#d4d4d8; font-family:'SFMono-Regular', Consolas, 'Liberation Mono', monospace; font-size:13px; line-height:1.5; text-decoration:none; word-break:break-all; overflow-wrap:anywhere;">${escapeHtml(args.linkBlock.url)}</a>
          </td>
        </tr>
      </table>
    `
    : "";

  const resourceBlockHtml = args.resourceBlock
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0 0 0; border:1px solid ${resourceBorder}; border-radius:10px; background:${resourceBackground};">
        <tr><td style="padding:14px 16px; font-size:15px; line-height:1.5; font-weight:600; color:${resourceText};">${escapeHtml(args.resourceBlock.name)}</td></tr>
      </table>`
    : "";

  const ctaButtonCell = (
    cta: EmailCta,
    background: string,
    color: string,
    border: string,
  ): string => `
          <td style="border-radius:10px; background:${background}; border:${border};">
            <a href="${escapeAttr(cta.url)}"
               style="display:inline-block; padding:14px 26px; font-family:'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; font-weight:600; color:${color}; text-decoration:none; border-radius:10px;">
              ${escapeHtml(cta.label)}
            </a>
          </td>`;

  const secondaryCtaHtml = args.secondaryCta
    ? `<td style="width:12px;">&nbsp;</td>${ctaButtonCell(args.secondaryCta, "#141417", "#fafafa", "1px solid #3f3f46")}`
    : "";

  const ctaHtml = args.cta
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0 0;">
        <tr>${ctaButtonCell(args.cta, ctaBg, ctaFg, "0")}${secondaryCtaHtml}
        </tr>
      </table>
    `
    : "";

  const footerHtml = args.footer
    ? `<p style="margin:28px 0 0 0; font-size:13px; line-height:1.5; color:#71717a;">${escapeHtml(args.footer)}</p>`
    : "";

  const brandHeaderHtml = `
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 28px 0; padding:0 0 24px 0; border-bottom:1px solid #27272a;">
                  <tr>
                    <td align="center">
                      <img src="${escapeAttr(logoSrc)}" alt="${escapeAttr(brandName)}" width="28" height="28" style="display:inline-block; vertical-align:middle; width:28px; height:28px; margin:0 8px 0 0; border:0;" />
                      <span style="font-size:18px; line-height:28px; font-weight:600; color:#fafafa; vertical-align:middle;">${escapeHtml(brandName)}</span>
                    </td>
                  </tr>
                </table>`;

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
                ${brandHeaderHtml}
                <h1 style="margin:0 0 20px 0; font-size:24px; line-height:1.3; font-weight:600; color:#fafafa; letter-spacing:-0.02em;">
                  ${escapeHtml(args.heading)}
                </h1>
                ${paragraphsHtml}
                ${args.linkBlock?.placement !== "after-cta" ? linkBlockHtml : ""}
                ${resourceBlockHtml}
                ${heroHtml}
                ${ctaHtml}
                ${args.linkBlock?.placement === "after-cta" ? linkBlockHtml : ""}
                ${closingParagraphsHtml}
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
  if (args.linkBlock && args.linkBlock.placement !== "after-cta") {
    textLines.push(args.linkBlock.intro);
    textLines.push(args.linkBlock.url);
    textLines.push("");
  }
  if (args.resourceBlock) {
    textLines.push(args.resourceBlock.name);
    textLines.push("");
  }
  if (args.cta) {
    textLines.push(`${args.cta.label}: ${args.cta.url}`);
    textLines.push("");
  }
  if (args.secondaryCta) {
    textLines.push(`${args.secondaryCta.label}: ${args.secondaryCta.url}`);
    textLines.push("");
  }
  if (args.linkBlock?.placement === "after-cta") {
    textLines.push(args.linkBlock.intro);
    textLines.push(args.linkBlock.url);
    textLines.push("");
  }
  for (const p of args.closingParagraphs ?? []) {
    textLines.push(stripTags(p));
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

export function emailStrong(text: string): string {
  return `<strong style="color:#fafafa; font-weight:600;">${escapeHtml(text)}</strong>`;
}

export function emailQuote(text: string): string {
  const content = escapeHtml(text.trim()).replace(/\r?\n/g, "<br />");
  // guard:allow-raw-color — quoted blocks intentionally use a fixed email-safe accent
  return `<div style="margin:0 0 16px 0; padding:12px 16px; border-left:3px solid #52525b; background:#18181b; color:#e4e4e7; font-size:16px; line-height:1.6;">${content}</div>`;
}

export function emailLink(label: string, url: string): string {
  return `<a href="${escapeAttr(url)}" style="color:#a1a1aa; text-decoration:underline;">${escapeHtml(label)}</a>`;
}
