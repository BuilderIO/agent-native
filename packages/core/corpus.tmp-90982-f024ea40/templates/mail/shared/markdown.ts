export function normalizeMarkdownHardBreaks(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  let inFence = false;
  let fenceChar: "`" | "~" | null = null;

  return lines
    .map((line) => {
      const fence = line.match(/^\s*(`{3,}|~{3,})/);
      if (fence) {
        const marker = fence[1][0] as "`" | "~";
        if (!inFence) {
          inFence = true;
          fenceChar = marker;
        } else if (marker === fenceChar) {
          inFence = false;
          fenceChar = null;
        }
        return line;
      }

      if (inFence) return line;
      return line.endsWith("\\") ? line.slice(0, -1) : line;
    })
    .join("\n");
}

export function decodeCommonHtmlEntities(value: string): string {
  return value.replace(
    /&(amp|lt|gt|quot|apos|#39|nbsp);/g,
    (match, entity: string) => {
      switch (entity) {
        case "amp":
          return "&";
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "quot":
          return '"';
        case "apos":
        case "#39":
          return "'";
        case "nbsp":
          return " ";
        default:
          return match;
      }
    },
  );
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type InlineTokenStore = {
  put: (html: string) => string;
  restore: (html: string) => string;
};

function createInlineTokenStore(): InlineTokenStore {
  const tokens: string[] = [];
  return {
    put: (html) => `\uE000${tokens.push(html) - 1}\uE001`,
    restore: (html) =>
      html.replace(/\uE000(\d+)\uE001/g, (match, index: string) => {
        return tokens[Number(index)] ?? match;
      }),
  };
}

function count(value: string, char: string): number {
  return [...value].filter((c) => c === char).length;
}

function trimBareUrl(rawUrl: string): { url: string; trailing: string } {
  let url = rawUrl;
  let trailing = "";

  while (/[>.,!?;:]$/.test(url)) {
    trailing = url.slice(-1) + trailing;
    url = url.slice(0, -1);
  }

  for (const [open, close] of [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ]) {
    while (url.endsWith(close) && count(url, close) > count(url, open)) {
      trailing = close + trailing;
      url = url.slice(0, -1);
    }
  }

  return { url, trailing };
}

function renderInlineLabel(label: string): string {
  const store = createInlineTokenStore();
  const text = label.replace(/`([^`]+)`/g, (_match, code: string) =>
    store.put(`<code>${escapeHtml(code)}</code>`),
  );
  const escaped = escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, "$1<em>$2</em>");
  return store.restore(escaped);
}

function anchorHtml(url: string, label = url): string {
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${renderInlineLabel(label)}</a>`;
}

export function renderInlineMarkdown(markdown: string): string {
  const store = createInlineTokenStore();
  let text = markdown;

  text = text.replace(/`([^`]+)`/g, (_match, code: string) =>
    store.put(`<code>${escapeHtml(code)}</code>`),
  );

  text = text.replace(
    /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g,
    (_match, alt: string, url: string) =>
      store.put(
        `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" style="max-width:100%;height:auto;" />`,
      ),
  );

  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_match, label: string, url: string) => store.put(anchorHtml(url, label)),
  );

  text = text.replace(/<((?:https?:\/\/)[^<>\s]+)>/g, (_match, url: string) =>
    store.put(anchorHtml(url)),
  );

  text = text.replace(
    /(^|[^\w"'=])(https?:\/\/[^\s<]+)/g,
    (_match, prefix: string, rawUrl: string) => {
      const { url, trailing } = trimBareUrl(rawUrl);
      if (!url) return `${prefix}${rawUrl}`;
      return `${prefix}${store.put(anchorHtml(url))}${trailing}`;
    },
  );

  const escaped = escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, "$1<em>$2</em>");

  return store.restore(escaped);
}

export function extractMarkdownUrls(markdown: string): string[] {
  const urls = new Set<string>();
  let text = decodeCommonHtmlEntities(normalizeMarkdownHardBreaks(markdown));

  const add = (rawUrl: string) => {
    const { url } = trimBareUrl(rawUrl);
    if (url) urls.add(url);
  };

  text = text.replace(/`[^`]+`/g, " ");
  text = text.replace(
    /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g,
    (_match, url: string) => {
      add(url);
      return " ";
    },
  );
  text = text.replace(
    /\[[^\]]+\]\((https?:\/\/[^\s)]+)\)/g,
    (_match, url: string) => {
      add(url);
      return " ";
    },
  );
  text = text.replace(/<((?:https?:\/\/)[^<>\s]+)>/g, (_match, url: string) => {
    add(url);
    return " ";
  });
  text = text.replace(
    /(^|[^\w"'=])(https?:\/\/[^\s<]+)/g,
    (_match, _prefix: string, url: string) => {
      add(url);
      return "";
    },
  );

  return [...urls];
}

export function markdownPreviewSnippet(
  markdown: string,
  maxLength = 120,
): string {
  return decodeCommonHtmlEntities(normalizeMarkdownHardBreaks(markdown))
    .slice(0, maxLength)
    .replace(/\n/g, " ");
}
