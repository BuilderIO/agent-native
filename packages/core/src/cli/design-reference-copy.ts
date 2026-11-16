import { parse, serialize, type DefaultTreeAdapterMap } from "parse5";

import {
  isBlockedExtensionUrl,
  isBlockedExtensionUrlWithDns,
  ssrfSafeFetch,
} from "../extensions/url-safety.js";

const MAX_REFERENCE_BYTES = 2 * 1024 * 1024;
const MAX_REFERENCE_ORIGINS = 32;
const OMIT_TAGS = new Set([
  "script",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "form",
  "base",
  "meta",
]);
const URL_ATTRIBUTES = new Set([
  "href",
  "src",
  "xlink:href",
  "poster",
  "background",
]);
const SRCSET_ATTRIBUTES = new Set(["srcset", "imagesrcset"]);
const LINK_RELS = new Set([
  "stylesheet",
  "icon",
  "shortcut",
  "apple-touch-icon",
]);
const NONPUBLIC_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".corp",
  ".home.arpa",
];
const CSS_URL = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
const CSS_IMPORT = /@import\s+(['"])([^'"]*)\1/gi;

export class ReferenceCopyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * The copy renders in the viewer's browser, outside ssrfSafeFetch, so every
 * subresource must point at a public HTTPS origin. Hosts that only resolve on
 * a local network are rejected by name, and the remaining origins are checked
 * in DNS once here. A host that rebinds between this check and the browser's
 * own lookup is the residual risk.
 */
function publicReferenceOrigin(raw: string, pageUrl: string): string | null {
  if (!URL.canParse(raw.trim(), pageUrl)) return null;
  const url = new URL(raw.trim(), pageUrl);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !host.includes(".") ||
    /^[\d.]+$/.test(host) ||
    host.startsWith("[") ||
    NONPUBLIC_SUFFIXES.some((suffix) => host.endsWith(suffix)) ||
    isBlockedExtensionUrl(url.href)
  )
    return null;
  return url.origin;
}

type UrlRewrite = (raw: string) => string | null;

function rewriteCss(css: string, rewrite: UrlRewrite): string {
  return css
    .replace(CSS_IMPORT, (_match, _quote, raw: string) => {
      const next = rewrite(raw);
      return next ? `@import "${next}"` : '@import ""';
    })
    .replace(CSS_URL, (match, _quote, raw: string) => {
      if (/^\s*(data:|#)/i.test(raw)) return match;
      const next = rewrite(raw);
      return next ? `url("${next}")` : 'url("")';
    });
}

function rewriteSrcset(value: string, rewrite: UrlRewrite): string {
  return value
    .split(",")
    .flatMap((candidate) => {
      const [raw, ...descriptor] = candidate.trim().split(/\s+/);
      const next = raw ? rewrite(raw) : null;
      return next ? [[next, ...descriptor].join(" ")] : [];
    })
    .join(", ");
}

function sanitizeReferenceTree(
  document: DefaultTreeAdapterMap["document"],
  rewrite: UrlRewrite,
) {
  const visit = (node: DefaultTreeAdapterMap["parentNode"]) => {
    node.childNodes = node.childNodes.filter((child) => {
      if (!("tagName" in child)) return true;
      if (OMIT_TAGS.has(child.tagName)) return false;
      if (child.tagName !== "link") return true;
      const rel = child.attrs.find((attr) => attr.name === "rel")?.value ?? "";
      return rel
        .toLowerCase()
        .split(/\s+/)
        .some((token) => LINK_RELS.has(token));
    });
    for (const child of node.childNodes) {
      if ("tagName" in child && child.tagName === "style") {
        for (const text of child.childNodes)
          if ("value" in text) text.value = rewriteCss(text.value, rewrite);
      }
      if ("attrs" in child) {
        if (child.tagName === "head") child.attrs = [];
        child.attrs = child.attrs.flatMap((attr) => {
          const { name, value } = attr;
          if (
            name.startsWith("on") ||
            [
              "srcdoc",
              "action",
              "formaction",
              "target",
              "ping",
              "autofocus",
            ].includes(name)
          )
            return [];
          if (URL_ATTRIBUTES.has(name)) {
            if (/^\s*#/.test(value)) return [attr];
            if (/^\s*data:image\//i.test(value) && name !== "href")
              return [attr];
            const next = rewrite(value);
            return next ? [{ ...attr, value: next }] : [];
          }
          if (SRCSET_ATTRIBUTES.has(name))
            return [{ ...attr, value: rewriteSrcset(value, rewrite) }];
          if (name === "style")
            return [{ ...attr, value: rewriteCss(value, rewrite) }];
          return [attr];
        });
      }
      if ("childNodes" in child) visit(child);
    }
  };
  visit(document);
}

async function inertReferenceHtml(html: string, url: string): Promise<string> {
  const candidates = new Set<string>();
  sanitizeReferenceTree(parse(html), (raw) => {
    const origin = publicReferenceOrigin(raw, url);
    if (origin) candidates.add(origin);
    return raw;
  });
  const checked = await Promise.all(
    [...candidates]
      .slice(0, MAX_REFERENCE_ORIGINS)
      .map(async (origin) =>
        (await isBlockedExtensionUrlWithDns(origin)) ? null : origin,
      ),
  );
  const allowed = new Set(checked.filter((origin) => origin !== null));
  const document = parse(html);
  sanitizeReferenceTree(document, (raw) => {
    const origin = publicReferenceOrigin(raw, url);
    return origin && allowed.has(origin) ? new URL(raw.trim(), url).href : null;
  });
  const sources = [...allowed].join(" ");
  const csp = [
    "default-src 'none'",
    `img-src data: ${sources}`,
    `style-src 'unsafe-inline' ${sources}`,
    `font-src data: ${sources}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "connect-src 'none'",
  ]
    .map((directive) => directive.trim())
    .join("; ");
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;");
  return serialize(document).replace(
    "<head>",
    `<head><meta http-equiv="Content-Security-Policy" content="${escape(csp)}"><meta name="referrer" content="no-referrer">`,
  );
}

/** Public reference copies deliberately have no authenticated upstream session. */
async function loadReferenceCopy(url: string) {
  const target = new URL(url);
  if (
    !["http:", "https:"].includes(target.protocol) ||
    target.username ||
    target.password
  ) {
    throw new ReferenceCopyError(
      "Reference copies require a public HTTP(S) URL without credentials.",
      400,
    );
  }
  const response = await ssrfSafeFetch(
    target.href,
    {
      method: "GET",
      credentials: "omit",
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(10_000),
    },
    { requireDispatcher: true },
  );
  if (!response.ok || response.headers.has("www-authenticate")) {
    await response.body?.cancel();
    throw new ReferenceCopyError(
      "This page cannot be loaded as a public reference copy. Capture a screenshot and DOM snapshot instead.",
      422,
    );
  }
  if (
    !response.headers.get("content-type")?.toLowerCase().includes("text/html")
  ) {
    await response.body?.cancel();
    throw new ReferenceCopyError(
      "Reference copies support HTML pages only.",
      415,
    );
  }
  const reader = response.body?.getReader();
  if (!reader)
    throw new ReferenceCopyError("Reference page returned no content.", 422);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REFERENCE_BYTES)
        throw new ReferenceCopyError(
          "Reference page exceeds the 2 MiB limit. Capture a screenshot and DOM snapshot instead.",
          413,
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const finalUrl = response.url || target.href;
  return {
    mode: "reference-copy" as const,
    url: finalUrl,
    html: await inertReferenceHtml(
      Buffer.concat(chunks).toString("utf8"),
      finalUrl,
    ),
    framingBlocked:
      response.headers.has("x-frame-options") ||
      /(?:^|;)\s*frame-ancestors\s/i.test(
        response.headers.get("content-security-policy") ?? "",
      ),
  };
}

export async function fetchDesignReferenceCopy(url: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      loadReferenceCopy(url),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new ReferenceCopyError(
                "Reference page exceeded the 10 second timeout.",
                504,
              ),
            ),
          10_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
