export interface EmailPreviewMarkup {
  html: string;
  plainText: string;
}

export interface EmailPreviewOptions {
  title: string;
  shareUrl: string;
  thumbnailUrl: string;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

function requireHttpUrl(value: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${field} must be an absolute HTTP URL`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${field} must be an absolute HTTP URL`);
  }

  return parsed.toString();
}

export function buildEmailPreviewMarkup(
  options: EmailPreviewOptions,
): EmailPreviewMarkup {
  const title = options.title.trim();
  if (!title) throw new Error("Email preview title cannot be empty");

  const shareUrl = requireHttpUrl(options.shareUrl, "shareUrl");
  const thumbnailUrl = requireHttpUrl(options.thumbnailUrl, "thumbnailUrl");
  const escapedTitle = escapeHtml(title);
  const escapedShareUrl = escapeHtml(shareUrl);
  const escapedThumbnailUrl = escapeHtml(thumbnailUrl);
  const escapedAlt = escapeHtml(`Play ${title}`);

  return {
    plainText: `${title}\n${shareUrl}`,
    html: [
      '<div style="max-width:640px">',
      `<p style="margin:0 0 12px;font-size:16px;font-weight:600"><a href="${escapedShareUrl}" style="text-decoration:none">${escapedTitle}</a></p>`,
      `<a href="${escapedShareUrl}" style="display:block;text-decoration:none"><img src="${escapedThumbnailUrl}" alt="${escapedAlt}" width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0" /></a>`,
      "</div>",
    ].join(""),
  };
}
