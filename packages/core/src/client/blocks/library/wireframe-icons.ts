const ICON_PATHS = {
  arrowLeft: [
    '<path d="M5 12l14 0" />',
    '<path d="M5 12l6 6" />',
    '<path d="M5 12l6 -6" />',
  ],
  arrowRight: [
    '<path d="M5 12l14 0" />',
    '<path d="M13 18l6 -6" />',
    '<path d="M13 6l6 6" />',
  ],
  bell: [
    '<path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6" />',
    '<path d="M9 17v1a3 3 0 0 0 6 0v-1" />',
  ],
  calendar: [
    '<path d="M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12z" />',
    '<path d="M16 3v4" />',
    '<path d="M8 3v4" />',
    '<path d="M4 11h16" />',
  ],
  check: ['<path d="M5 12l5 5l10 -10" />'],
  chevronDown: ['<path d="M6 9l6 6l6 -6" />'],
  chevronLeft: ['<path d="M15 6l-6 6l6 6" />'],
  chevronRight: ['<path d="M9 6l6 6l-6 6" />'],
  chevronUp: ['<path d="M6 15l6 -6l6 6" />'],
  dots: [
    '<path d="M5 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />',
    '<path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />',
    '<path d="M19 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />',
  ],
  edit: [
    '<path d="M4 20h4l10.5 -10.5a2.8 2.8 0 1 0 -4 -4l-10.5 10.5v4" />',
    '<path d="M13.5 6.5l4 4" />',
  ],
  lock: [
    '<path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6z" />',
    '<path d="M8 11v-4a4 4 0 1 1 8 0v4" />',
    '<path d="M12 16l0 .01" />',
  ],
  mail: [
    '<path d="M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10z" />',
    '<path d="M3 7l9 6l9 -6" />',
  ],
  plus: ['<path d="M12 5l0 14" />', '<path d="M5 12l14 0" />'],
  search: [
    '<path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" />',
    '<path d="M21 21l-6 -6" />',
  ],
  send: [
    '<path d="M10 14l11 -11" />',
    '<path d="M21 3l-6.5 18a.55 .55 0 0 1 -1 0l-3.5 -7l-7 -3.5a.55 .55 0 0 1 0 -1l18 -6.5" />',
  ],
  settings: [
    '<path d="M10.3 4.3a1 1 0 0 1 1.4 0l.6 .6a1 1 0 0 0 1 .24l.84 -.28a1 1 0 0 1 1.25 .6l.31 .9a1 1 0 0 0 .76 .65l.95 .16a1 1 0 0 1 .84 1.08l-.08 .98a1 1 0 0 0 .48 .9l.82 .52a1 1 0 0 1 .34 1.34l-.49 .86a1 1 0 0 0 0 1l.49 .86a1 1 0 0 1 -.34 1.34l-.82 .52a1 1 0 0 0 -.48 .9l.08 .98a1 1 0 0 1 -.84 1.08l-.95 .16a1 1 0 0 0 -.76 .65l-.31 .9a1 1 0 0 1 -1.25 .6l-.84 -.28a1 1 0 0 0 -1 .24l-.6 .6a1 1 0 0 1 -1.4 0l-.6 -.6a1 1 0 0 0 -1 -.24l-.84 .28a1 1 0 0 1 -1.25 -.6l-.31 -.9a1 1 0 0 0 -.76 -.65l-.95 -.16a1 1 0 0 1 -.84 -1.08l.08 -.98a1 1 0 0 0 -.48 -.9l-.82 -.52a1 1 0 0 1 -.34 -1.34l.49 -.86a1 1 0 0 0 0 -1l-.49 -.86a1 1 0 0 1 .34 -1.34l.82 -.52a1 1 0 0 0 .48 -.9l-.08 -.98a1 1 0 0 1 .84 -1.08l.95 -.16a1 1 0 0 0 .76 -.65l.31 -.9a1 1 0 0 1 1.25 -.6l.84 .28a1 1 0 0 0 1 -.24l.6 -.6z" />',
    '<path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" />',
  ],
  user: [
    '<path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" />',
    '<path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" />',
  ],
  x: ['<path d="M18 6l-12 12" />', '<path d="M6 6l12 12" />'],
} as const;

const ICON_ALIASES: Record<string, keyof typeof ICON_PATHS> = {
  add: "plus",
  back: "arrowLeft",
  close: "x",
  collapse: "chevronUp",
  caret: "chevronDown",
  chevron: "chevronDown",
  dropdown: "chevronDown",
  down: "chevronDown",
  email: "mail",
  expand: "chevronDown",
  forward: "arrowRight",
  gear: "settings",
  menu: "dots",
  more: "dots",
  next: "chevronRight",
  password: "lock",
  previous: "chevronLeft",
  profile: "user",
  right: "chevronRight",
  submit: "send",
  up: "chevronUp",
};

const ICON_MARKER_RE =
  /<(span|i)\b([^>]*\s)?data-icon\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))([^>]*)>(?:\s*)<\/\1>|<(span|i)\b([^>]*\s)?data-icon\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))([^>]*)\/>/gi;

function normalizeIconName(value: string): keyof typeof ICON_PATHS | null {
  const normalized = value
    .trim()
    .replace(/^icon/i, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .replace(/\s+([a-z0-9])/gi, (_match, char: string) => char.toUpperCase())
    .replace(/^./, (char) => char.toLowerCase());
  return normalized in ICON_PATHS
    ? (normalized as keyof typeof ICON_PATHS)
    : (ICON_ALIASES[normalized] ?? null);
}

function readAttribute(attrs: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = attrs.match(
    new RegExp(
      `\\b${escaped}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s"'=<>` + "`" + `]+)`,
      "i",
    ),
  );
  if (!match) return null;
  const raw = match[1] ?? "";
  return decodeAttrEntities(raw.replace(/^["']|["']$/g, ""));
}

function decodeAttrEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|apos|quot|lt|gt);/gi,
    (entity, body: string) => {
      const normalized = body.toLowerCase();
      if (normalized === "amp") return "&";
      if (normalized === "apos") return "'";
      if (normalized === "quot") return '"';
      if (normalized === "lt") return "<";
      if (normalized === "gt") return ">";

      const isHex = normalized.startsWith("#x");
      const digits = normalized.slice(isHex ? 2 : 1);
      const codePoint = Number.parseInt(digits, isHex ? 16 : 10);
      if (
        !Number.isFinite(codePoint) ||
        codePoint < 0 ||
        codePoint > 0x10ffff
      ) {
        return entity;
      }
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return entity;
      }
    },
  );
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function iconAccessibility(label: string | null): string {
  const accessibleLabel = label?.trim();
  return accessibleLabel
    ? `role="img" aria-label="${escapeAttr(accessibleLabel)}"`
    : 'aria-hidden="true"';
}

function iconSvg(name: keyof typeof ICON_PATHS, label: string | null): string {
  return `<svg class="wf-icon" data-icon="${name}" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${iconAccessibility(label)}>${ICON_PATHS[name].join("")}</svg>`;
}

function iconFallback(rawName: string, label: string | null): string {
  const iconName = rawName.trim() || "unknown";
  const accessibleLabel = label?.trim() || `Unsupported icon: ${iconName}`;
  return `<span class="wf-icon wf-icon-fallback" data-icon="unknown" data-icon-name="${escapeAttr(iconName)}" role="img" aria-label="${escapeAttr(accessibleLabel)}">?</span>`;
}

export function renderWireframeIconHtml(html: string): string {
  return html.replace(
    ICON_MARKER_RE,
    (
      _match,
      _tagA,
      beforeA,
      quotedA,
      doubleA,
      singleA,
      bareA,
      afterA,
      _tagB,
      beforeB,
      quotedB,
      doubleB,
      singleB,
      bareB,
      afterB,
    ) => {
      const rawName =
        doubleA ??
        singleA ??
        bareA ??
        doubleB ??
        singleB ??
        bareB ??
        quotedA ??
        quotedB ??
        "";
      const name = normalizeIconName(rawName);
      const attrs = `${beforeA ?? ""}${afterA ?? ""}${beforeB ?? ""}${afterB ?? ""}`;
      const label =
        readAttribute(attrs, "aria-label") ?? readAttribute(attrs, "title");
      return name ? iconSvg(name, label) : iconFallback(rawName, label);
    },
  );
}
