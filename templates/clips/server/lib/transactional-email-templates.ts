import {
  emailStrong,
  getAppProductionUrl,
  renderEmail,
  sendEmail,
} from "@agent-native/core/server";

const CLIPS_BRAND_NAME = "Clips";
const EMAIL_SEND_TIMEOUT_MS = 60_000;
const FRIENDLY_REPLY_TO = "hello@agent-native.com";
const UNTITLED_CLIP = "Untitled Clip";
const ACTIVITY_EMAIL_FOOTER =
  "You received this because email notifications are on in your Clips settings.";

interface TransactionalEmailBase {
  to: string;
}

export type ClipsTransactionalEmailInput =
  | (TransactionalEmailBase & {
      kind: "first-view";
      recordingId: string;
      title?: string | null;
      viewerEmail?: string | null;
    })
  | (TransactionalEmailBase & {
      kind: "unviewed-reminder";
      recordingId: string;
      title?: string | null;
      senderEmail?: string | null;
      senderName?: string | null;
      brandLogoUrl?: string | null;
    })
  | (TransactionalEmailBase & {
      kind: "first-import";
      recordingId: string;
      title?: string | null;
    })
  | (TransactionalEmailBase & {
      kind: "two-clips";
      generatedSummary?: string | null;
    })
  | (TransactionalEmailBase & {
      kind: "activity-comment";
      recordingId: string;
      title?: string | null;
      authorEmail?: string | null;
      authorName?: string | null;
      content: string;
      videoTimestampMs?: number | null;
      isReply?: boolean;
    })
  | (TransactionalEmailBase & {
      kind: "activity-reaction";
      recordingId: string;
      title?: string | null;
      emoji: string;
      authorEmail?: string | null;
      authorName?: string | null;
      videoTimestampMs?: number | null;
    });

export interface ClipsTransactionalEmailRenderOptions {
  appUrl: string;
  appBasePath?: string;
}

export interface RenderedClipsTransactionalEmail {
  subject: string;
  html: string;
  text: string;
}

function singleLine(value: string | null | undefined): string {
  return (value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function clipTitle(value: string | null | undefined): string {
  return singleLine(value) || UNTITLED_CLIP;
}

export function normalizeEmailDisplayName(
  value: string | null | undefined,
  fallback: string,
): string {
  const email = singleLine(value);
  const match = /^([A-Za-z]+(?:[._-][A-Za-z]+)*)@[^\s@]+$/.exec(email);
  if (!match) return email || fallback;

  return match[1]
    .split(/[._-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeBasePath(value: string | undefined): string {
  const normalized = singleLine(value).replace(/^\/+/, "").replace(/\/+$/, "");
  return normalized ? `/${normalized}` : "";
}

function appUrlForPath(
  path: string,
  { appUrl, appBasePath }: ClipsTransactionalEmailRenderOptions,
): string {
  const url = new URL(appUrl);
  let basePath = normalizeBasePath(url.pathname);
  const configuredBasePath = normalizeBasePath(appBasePath);

  if (
    configuredBasePath &&
    basePath !== configuredBasePath &&
    !basePath.endsWith(configuredBasePath)
  ) {
    basePath = `${basePath}${configuredBasePath}`;
  }

  return new URL(`${basePath}${path}`, url.origin).toString();
}

function clipUrl(
  recordingId: string,
  options: ClipsTransactionalEmailRenderOptions,
): string {
  return appUrlForPath(`/r/${encodeURIComponent(recordingId)}`, options);
}

function clipCommentsUrl(
  recordingId: string,
  videoTimestampMs: number | null | undefined,
  options: ClipsTransactionalEmailRenderOptions,
): string {
  const url = new URL(clipUrl(recordingId, options));
  url.searchParams.set("panel", "comments");
  if (typeof videoTimestampMs === "number" && videoTimestampMs > 0) {
    url.searchParams.set("t", String(Math.floor(videoTimestampMs / 1000)));
  }
  return url.toString();
}

function formatTimestamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function quotedExcerpt(value: string): string {
  const text = singleLine(value);
  return text.length > 280 ? `${text.slice(0, 277)}…` : text;
}

function recordUrl(options: ClipsTransactionalEmailRenderOptions): string {
  return appUrlForPath("/record", options);
}

function resolveBrandLogoUrl(
  value: string | null | undefined,
  options: ClipsTransactionalEmailRenderOptions,
): string | undefined {
  const candidate = singleLine(value);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate, options.appUrl);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function validReplyTo(value: string | null | undefined): string | undefined {
  const candidate = singleLine(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : undefined;
}

export function renderClipsTransactionalEmail(
  input: ClipsTransactionalEmailInput,
  options: ClipsTransactionalEmailRenderOptions,
): RenderedClipsTransactionalEmail {
  const title = input.kind === "two-clips" ? undefined : clipTitle(input.title);

  switch (input.kind) {
    case "first-view": {
      const viewer = normalizeEmailDisplayName(input.viewerEmail, "Someone");
      const subject = `Your Clip “${title}” got its first view`;
      const rendered = renderEmail({
        brandName: CLIPS_BRAND_NAME,
        preheader: subject,
        heading: "Someone watched your Clip",
        paragraphs: [
          `${emailStrong(viewer)} registered the first view of ${emailStrong(title!)}.`,
          "Clips tracks advanced analytics on your viewers' activity, and can even tell you whether your recipient took AI actions with your link. Come back to Clips to view analytics, or configure Clips AI to take agentic actions on your behalf.",
        ],
        cta: {
          label: "See Clip activity",
          url: clipUrl(input.recordingId, options),
        },
        footer:
          "You received this one-time note because this Clip got its first registered view.",
      });
      return { subject, ...rendered };
    }

    case "unviewed-reminder": {
      const sender =
        singleLine(input.senderName) ||
        normalizeEmailDisplayName(input.senderEmail, "Someone");
      const subject = `Still need to watch “${title}”?`;
      const url = clipUrl(input.recordingId, options);
      const rendered = renderEmail({
        brandName: CLIPS_BRAND_NAME,
        brandLogoUrl: resolveBrandLogoUrl(input.brandLogoUrl, options),
        preheader: subject,
        heading: `${sender} shared a Clip with you`,
        paragraphs: [
          `${emailStrong(title!)} is waiting whenever you have a moment.`,
        ],
        linkBlock: {
          intro:
            "Don't have a moment to spare? Share the below link with your own AI agent and ask it for a summary:",
          url,
        },
        cta: {
          label: "Watch the Clip Manually",
          url,
        },
        footer: `You received this reminder because ${sender} shared this Clip with you two days ago.`,
      });
      return { subject, ...rendered };
    }

    case "first-import": {
      const subject = "Your first imported video is now Agent-Native";
      const url = clipUrl(input.recordingId, options);
      const rendered = renderEmail({
        brandName: CLIPS_BRAND_NAME,
        preheader: subject,
        heading: "Your video is ready for more than playback",
        paragraphs: [
          `${emailStrong(title!)} is now an Agent-Native Clip.`,
          "Its speech and on-screen visuals are available as agent-readable context for summaries, exact-moment lookup, tickets, emails, and follow-up work.",
        ],
        cta: {
          label: "Open your Agent-Native Clip",
          url,
        },
        linkBlock: {
          intro: "Or just feed this link to your own AI agent:",
          url,
          placement: "after-cta",
        },
        footer:
          "You received this one-time note because your first imported video is ready.",
      });
      return { subject, ...rendered };
    }

    case "two-clips": {
      const summary =
        singleLine(input.generatedSummary) ||
        "Two people shared Clips with you, giving you a quick look at what Agent-Native video can do.";
      const subject = "You've received two Clips. What would you create?";
      const rendered = renderEmail({
        brandName: CLIPS_BRAND_NAME,
        preheader: subject,
        heading: "You’ve received two Agent-Native Clips",
        paragraphs: [
          emailStrong(summary),
          "Clips are screen recordings that are friendly for both human viewing and AI agent use. What would you create with yours?",
        ],
        cta: {
          label: "Record an Agent-Native Clip",
          url: recordUrl(options),
        },
        footer:
          "This one-time note was sent after two Clips were shared with you.",
      });
      return { subject, ...rendered };
    }

    case "activity-comment": {
      const author =
        singleLine(input.authorName) ||
        normalizeEmailDisplayName(input.authorEmail, "Someone");
      const at =
        typeof input.videoTimestampMs === "number" && input.videoTimestampMs > 0
          ? ` at ${formatTimestamp(input.videoTimestampMs)}`
          : "";
      const subject = input.isReply
        ? `${author} replied on “${title}”`
        : `${author} commented on “${title}”`;
      const rendered = renderEmail({
        brandName: CLIPS_BRAND_NAME,
        preheader: subject,
        heading: input.isReply
          ? `${author} replied on your Clip`
          : `${author} commented on your Clip`,
        paragraphs: [
          `${emailStrong(author)} left a ${input.isReply ? "reply" : "comment"} on ${emailStrong(title!)}${at}.`,
          `“${quotedExcerpt(input.content)}”`,
        ],
        cta: {
          label: "Read and reply",
          url: clipCommentsUrl(
            input.recordingId,
            input.videoTimestampMs,
            options,
          ),
        },
        footer: ACTIVITY_EMAIL_FOOTER,
      });
      return { subject, ...rendered };
    }

    case "activity-reaction": {
      const author =
        singleLine(input.authorName) ||
        normalizeEmailDisplayName(input.authorEmail, "Someone");
      const at =
        typeof input.videoTimestampMs === "number" && input.videoTimestampMs > 0
          ? ` at ${formatTimestamp(input.videoTimestampMs)}`
          : "";
      const subject = `${author} reacted ${input.emoji} on “${title}”`;
      const rendered = renderEmail({
        brandName: CLIPS_BRAND_NAME,
        preheader: subject,
        heading: "Someone reacted to your Clip",
        paragraphs: [
          `${emailStrong(author)} reacted ${emailStrong(input.emoji)} on ${emailStrong(title!)}${at}.`,
        ],
        cta: {
          label: "See Clip activity",
          url: clipCommentsUrl(
            input.recordingId,
            input.videoTimestampMs,
            options,
          ),
        },
        footer: ACTIVITY_EMAIL_FOOTER,
      });
      return { subject, ...rendered };
    }
  }
}

export async function sendClipsTransactionalEmail(
  input: ClipsTransactionalEmailInput,
): Promise<void> {
  const rendered = renderClipsTransactionalEmail(input, {
    appUrl: getAppProductionUrl(),
    appBasePath: process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH,
  });

  const reminderSender =
    input.kind === "unviewed-reminder"
      ? singleLine(input.senderName) ||
        normalizeEmailDisplayName(input.senderEmail, "Someone")
      : undefined;

  await sendEmail({
    to: input.to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    fromName: reminderSender
      ? `${reminderSender} (via Agent-Native Clips)`
      : undefined,
    replyTo:
      input.kind === "unviewed-reminder"
        ? (validReplyTo(input.senderEmail) ?? FRIENDLY_REPLY_TO)
        : FRIENDLY_REPLY_TO,
    timeoutMs: EMAIL_SEND_TIMEOUT_MS,
  });
}

export const renderTransactionalEmail = renderClipsTransactionalEmail;
export const sendTransactionalEmail = sendClipsTransactionalEmail;
export type TransactionalEmailInput = ClipsTransactionalEmailInput;
