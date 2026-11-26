import {
  defaultTreeAdapter,
  parse,
  serialize,
  type DefaultTreeAdapterMap,
} from "parse5";

import { ssrfSafeFetch } from "../extensions/url-safety.js";

const MAX_REFERENCE_BYTES = 2 * 1024 * 1024;
const MAX_RESOURCE_BYTES = 5 * 1024 * 1024;
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

export class ReferenceCopyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type UrlRewrite = (raw: string) => string | null;

function rewriteCssUrls(css: string, rewrite: UrlRewrite): string {
  const rewriteUrl = (full: string, quote: string, raw: string) => {
    const next = rewrite(raw);
    return next ? `url(${quote}${next}${quote})` : full;
  };
  return css
    .replace(
      /url\(\s*(["']?)([^"'()]+)\1\s*\)/gi,
      (full, quote: string, raw: string) => rewriteUrl(full, quote, raw.trim()),
    )
    .replace(
      /(@import\s+)(["'])([^"']+)\2/gi,
      (full, prefix: string, quote: string, raw: string) => {
        const next = rewrite(raw);
        return next ? `${prefix}${quote}${next}${quote}` : full;
      },
    )
    .replace(
      /((?:-webkit-)?image-set\s*\([^)]*?)(["'])([^"']+\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#][^"']*)?)\2/gi,
      (full, prefix: string, quote: string, raw: string) => {
        const next = rewrite(raw);
        return next ? `${prefix}${quote}${next}${quote}` : full;
      },
    );
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
            if (name === "href" && child.tagName === "a") return [attr];
            if (/^\s*data:image\//i.test(value) && name !== "href")
              return [attr];
            const next = rewrite(value);
            return next ? [{ ...attr, value: next }] : [];
          }
          if (SRCSET_ATTRIBUTES.has(name))
            return [{ ...attr, value: rewriteSrcset(value, rewrite) }];
          if (name === "style") return [];
          return [attr];
        });
      }
      if ("childNodes" in child) visit(child);
      if ("tagName" in child && child.tagName === "style") {
        for (const text of child.childNodes) {
          if ("value" in text)
            text.value = rewriteCssUrls(
              text.value,
              rewrite,
            ) as typeof text.value;
        }
      }
      // parse5 keeps <template> children in `content`, not `childNodes`, and
      // they serialize back out, so they need the same pass.
      if ("content" in child) visit(child.content);
    }
  };
  visit(document);
}

export function rewriteReferenceCss(
  css: string,
  baseUrl: string,
  bridgeUrl: string,
  token: string,
): string {
  return rewriteCssUrls(css, (raw) =>
    resourceProxyUrl(raw, baseUrl, bridgeUrl, token),
  );
}

function resourceProxyUrl(
  raw: string,
  pageUrl: string,
  bridgeUrl: string,
  token: string,
) {
  if (!URL.canParse(raw.trim(), pageUrl)) return null;
  if (raw.trim().startsWith("#")) return null;
  const target = new URL(raw.trim(), pageUrl);
  if (
    !["http:", "https:"].includes(target.protocol) ||
    target.username ||
    target.password
  )
    return null;
  const proxy = new URL("/reference-resource", bridgeUrl);
  proxy.searchParams.set("url", target.href);
  proxy.searchParams.set("previewToken", token);
  return proxy.href;
}

function inertReferenceHtml(
  html: string,
  url: string,
  bridgeUrl: string,
  token: string,
): string {
  const document = parse(html, { scriptingEnabled: false });
  sanitizeReferenceTree(document, (raw) => {
    return resourceProxyUrl(raw, url, bridgeUrl, token);
  });
  const htmlNode = document.childNodes.find(
    (node) => "tagName" in node && node.tagName === "html",
  );
  if (!htmlNode || !("childNodes" in htmlNode))
    throw new ReferenceCopyError("Reference document has no HTML root.", 422);
  const existingHead = htmlNode.childNodes.find(
    (node) => "tagName" in node && node.tagName === "head",
  );
  let headNode: DefaultTreeAdapterMap["element"];
  if (existingHead && "tagName" in existingHead) {
    headNode = existingHead;
  } else {
    headNode = defaultTreeAdapter.createElement(
      "head",
      htmlNode.namespaceURI,
      [],
    );
    const firstChild = htmlNode.childNodes[0];
    if (firstChild)
      defaultTreeAdapter.insertBefore(htmlNode, headNode, firstChild);
    else defaultTreeAdapter.appendChild(htmlNode, headNode);
  }
  const bridgeOrigin = new URL(bridgeUrl).origin;
  const csp = [
    "default-src 'none'",
    `img-src data: ${bridgeOrigin}`,
    `style-src 'unsafe-inline' ${bridgeOrigin}`,
    `font-src data: ${bridgeOrigin}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "connect-src 'none'",
  ]
    .map((directive) => directive.trim())
    .join("; ");
  const cspMeta = defaultTreeAdapter.createElement(
    "meta",
    headNode.namespaceURI,
    [
      { name: "http-equiv", value: "Content-Security-Policy" },
      { name: "content", value: csp },
    ],
  );
  const referrerMeta = defaultTreeAdapter.createElement(
    "meta",
    headNode.namespaceURI,
    [
      { name: "name", value: "referrer" },
      { name: "content", value: "no-referrer" },
    ],
  );
  const firstHeadChild = headNode.childNodes[0];
  if (firstHeadChild) {
    defaultTreeAdapter.insertBefore(headNode, referrerMeta, firstHeadChild);
    defaultTreeAdapter.insertBefore(headNode, cspMeta, referrerMeta);
  } else {
    defaultTreeAdapter.appendChild(headNode, cspMeta);
    defaultTreeAdapter.appendChild(headNode, referrerMeta);
  }
  return serialize(document);
}

export async function fetchDesignReferenceResource(rawUrl: string) {
  const target = new URL(rawUrl);
  if (
    !["http:", "https:"].includes(target.protocol) ||
    target.username ||
    target.password
  )
    throw new ReferenceCopyError("Invalid reference resource URL.", 400);
  const response = await ssrfSafeFetch(
    target.href,
    {
      method: "GET",
      credentials: "omit",
      headers: {
        accept:
          "image/*, text/css, font/*, application/font-woff, application/vnd.ms-fontobject",
      },
      signal: AbortSignal.timeout(8_000),
    },
    { requireDispatcher: true },
  );
  const contentType =
    response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ??
    "";
  const css = contentType === "text/css";
  if (
    !response.ok ||
    !(
      css ||
      contentType.startsWith("image/") ||
      /font|woff|opentype|truetype/.test(contentType)
    )
  ) {
    await response.body?.cancel();
    throw new ReferenceCopyError("Unsupported reference resource.", 415);
  }
  const reader = response.body?.getReader();
  if (!reader)
    throw new ReferenceCopyError(
      "Reference resource returned no content.",
      422,
    );
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESOURCE_BYTES)
        throw new ReferenceCopyError(
          "Reference resource exceeds the 5 MiB limit.",
          413,
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = Buffer.concat(chunks);
  return {
    body: css ? new TextDecoder().decode(bytes) : bytes,
    contentType,
    css,
    baseUrl: response.url || target.href,
  };
}

/** Public reference copies deliberately have no authenticated upstream session. */
async function loadReferenceCopy(
  url: string,
  bridgeUrl: string,
  token: string,
) {
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
    html: inertReferenceHtml(
      Buffer.concat(chunks).toString("utf8"),
      finalUrl,
      bridgeUrl,
      token,
    ),
    framingBlocked:
      response.headers.has("x-frame-options") ||
      /(?:^|;)\s*frame-ancestors\s/i.test(
        response.headers.get("content-security-policy") ?? "",
      ),
  };
}

export async function fetchDesignReferenceCopy(
  url: string,
  bridgeUrl: string,
  token: string,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      loadReferenceCopy(url, bridgeUrl, token),
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
