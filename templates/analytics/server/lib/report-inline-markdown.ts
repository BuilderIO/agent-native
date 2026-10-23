/**
 * Inline markdown as email HTML, for the text dashboards put in callout rows:
 * links (`[text](url)` and bare http(s) URLs), **bold**, `code` and backslash
 * escapes. Anything else stays literal text, and every piece of text is
 * escaped, so a row can never inject markup.
 */

export interface ReportInlineMarkdownOptions {
  /** Absolute URL that relative links such as "/dashboards/x" resolve against. */
  baseUrl?: string;
  linkStyle: string;
  codeStyle: string;
}

const ESCAPABLE = /[!-/:-@[-`{-~]/;
// Bare URLs end before a trailing sentence mark, as GFM autolinks do.
const AUTOLINK = /^https?:\/\/[^\s<]+/;
const AUTOLINK_TRAILING = /[.,:;!?'"*_~]+$/;

function escapeReportHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The URL a report link may point at, or null to show the link's text alone:
 * http(s) only, and a relative path resolves against the dashboard's origin,
 * except the framework's own `/_agent-native/` endpoints.
 */
export function safeReportLinkHref(
  href: string,
  baseUrl: string | undefined,
): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("//")) return null;
  if (trimmed.startsWith("/")) {
    if (!baseUrl || !URL.canParse(baseUrl)) return null;
    const resolved = new URL(trimmed, new URL(baseUrl).origin);
    if (resolved.pathname.startsWith("/_agent-native/")) return null;
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.href
      : null;
  }
  if (!URL.canParse(trimmed)) return null;
  const protocol = new URL(trimmed).protocol;
  return protocol === "http:" || protocol === "https:" ? trimmed : null;
}

/** Index just past the `]` closing the bracket at `open`, or -1. */
function closingBracket(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const char = text[i];
    if (char === "\\") {
      i += 1;
    } else if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** The destination of `(url)` starting at `open`, or null; parentheses in the URL must balance. */
function linkDestination(
  text: string,
  open: number,
): { href: string; end: number } | null {
  if (text[open] !== "(") return null;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const char = text[i];
    if (char === "\\") {
      i += 1;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        // A link title ("…" after a space) is dropped.
        const [href] = text
          .slice(open + 1, i)
          .trim()
          .split(/\s+/, 1);
        return { href, end: i + 1 };
      }
    }
  }
  return null;
}

function render(
  text: string,
  options: ReportInlineMarkdownOptions,
  allowLinks: boolean,
): string {
  let html = "";
  let plain = "";
  const flush = () => {
    html += escapeReportHtml(plain);
    plain = "";
  };

  let i = 0;
  while (i < text.length) {
    const char = text[i];
    const rest = text.slice(i);

    if (char === "\\" && ESCAPABLE.test(text[i + 1] ?? "")) {
      plain += text[i + 1];
      i += 2;
      continue;
    }

    if (char === "`") {
      let run = i;
      while (text[run] === "`") run += 1;
      const ticks = text.slice(i, run);
      const close = text.indexOf(ticks, run);
      if (close !== -1) {
        flush();
        const code = text.slice(run, close).trim();
        html += `<code style="${options.codeStyle}">${escapeReportHtml(code)}</code>`;
        i = close + ticks.length;
        continue;
      }
      plain += ticks;
      i += ticks.length;
      continue;
    }

    if (allowLinks && char === "[") {
      const labelEnd = closingBracket(text, i);
      const destination =
        labelEnd === -1 ? null : linkDestination(text, labelEnd);
      if (destination) {
        flush();
        const label = render(text.slice(i + 1, labelEnd - 1), options, false);
        const href = safeReportLinkHref(destination.href, options.baseUrl);
        html += href
          ? `<a href="${escapeReportHtml(href)}" style="${options.linkStyle}">${label}</a>`
          : label;
        i = destination.end;
        continue;
      }
    }

    if (allowLinks && (char === "h" || char === "H")) {
      const previous = text[i - 1];
      const match =
        previous === undefined || /[\s(]/.test(previous)
          ? AUTOLINK.exec(rest)
          : null;
      if (match) {
        let url = match[0].replace(AUTOLINK_TRAILING, "");
        // A closing parenthesis the URL never opened belongs to the sentence.
        while (
          url.endsWith(")") &&
          (url.match(/\)/g) ?? []).length > (url.match(/\(/g) ?? []).length
        ) {
          url = url.slice(0, -1);
        }
        const href = safeReportLinkHref(url, options.baseUrl);
        flush();
        html += href
          ? `<a href="${escapeReportHtml(href)}" style="${options.linkStyle}">${escapeReportHtml(url)}</a>`
          : escapeReportHtml(url);
        i += url.length;
        continue;
      }
    }

    if (rest.startsWith("**")) {
      const close = text.indexOf("**", i + 2);
      if (close > i + 2) {
        flush();
        html += `<strong>${render(text.slice(i + 2, close), options, allowLinks)}</strong>`;
        i = close + 2;
        continue;
      }
    }

    plain += char;
    i += 1;
  }
  flush();
  return html;
}

export function reportInlineMarkdownHtml(
  markdown: string,
  options: ReportInlineMarkdownOptions,
): string {
  return render(markdown, options, true);
}
