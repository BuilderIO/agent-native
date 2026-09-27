import {
  emailLink,
  getAppProductionUrl,
  withConfiguredAppBasePath,
} from "@agent-native/core/server";
import type { ShareEmailExtras } from "@agent-native/core/sharing";

function appBaseUrl(): string {
  return withConfiguredAppBasePath(getAppProductionUrl());
}

export function absoluteUrl(
  url: string | null | undefined,
): string | undefined {
  const trimmed = url?.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith("/") ? `${appBaseUrl()}${trimmed}` : trimmed;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeCssUrl(url: string): string {
  return url.replace(
    /['"()\\\s]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

export function recordingShareEmailExtras(ctx: {
  href: string;
  senderEmail: string;
}): ShareEmailExtras {
  const summarizeUrl = new URL(ctx.href);
  summarizeUrl.searchParams.set("panel", "agent");
  return {
    secondaryCta: { label: "Summarize with AI", url: summarizeUrl.toString() },
    linkBlock: {
      intro: "Copy and paste this link for your own AI agent to summarize:",
      url: ctx.href,
      placement: "after-cta",
    },
    closingParagraphs: [
      "Clips is a 100% free, open-source, Agent-Native app for sharing screengrabs with friends and colleagues. No download required.",
      `Just reply to this email if you want to get back to ${emailLink(
        ctx.senderEmail,
        `mailto:${ctx.senderEmail}`,
      )} directly.`,
    ],
  };
}

export type ShareHeroRecording = {
  thumbnailUrl?: string | null;
  animatedThumbnailUrl?: string | null;
};

export function recordingShareHeroHtml(
  recording: ShareHeroRecording,
  ctx: { href: string; alt?: string },
): string | undefined {
  const thumb = absoluteUrl(
    recording.thumbnailUrl || recording.animatedThumbnailUrl,
  );
  if (!thumb || !isHttpUrl(thumb)) return undefined;
  const url = escapeAttr(thumb);
  const cssUrl = escapeAttr(escapeCssUrl(thumb));
  const href = escapeAttr(ctx.href);
  const title = escapeAttr(ctx.alt ?? "Play video");
  const badge = escapeAttr(`${appBaseUrl()}/play-badge.png`);
  const W = 488;
  const H = 275;
  return `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0 0 0;">
        <tr>
          <td>
            <a href="${href}" style="display:block; text-decoration:none;" title="${title}">
              <!--[if mso]>
              <v:image xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:${W}px;height:${H}px;" src="${url}" />
              <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="false" stroke="false" style="position:absolute;width:${W}px;height:${H}px;">
              <v:textbox inset="0,0,0,0"><center>
              <![endif]-->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${W}" height="${H}" background="${url}" style="width:100%; max-width:${W}px; height:${H}px; background-image:url('${cssUrl}'); background-size:cover; background-position:center; background-color:#141417; border-radius:12px;">
                <tr>
                  <td align="center" valign="middle" height="${H}" style="height:${H}px;">
                    <img src="${badge}" alt="Play video" width="64" height="64" style="width:64px; height:64px; border:0; display:inline-block;" />
                  </td>
                </tr>
              </table>
              <!--[if mso]></center></v:textbox></v:rect><![endif]-->
            </a>
          </td>
        </tr>
      </table>`;
}
