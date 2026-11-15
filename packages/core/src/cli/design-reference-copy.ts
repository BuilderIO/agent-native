import { parse, serialize, type DefaultTreeAdapterMap } from "parse5";

import { ssrfSafeFetch } from "../extensions/url-safety.js";

const MAX_REFERENCE_BYTES = 2 * 1024 * 1024;
const REFERENCE_CSP =
  "default-src 'none'; img-src http: https: data:; style-src http: https: 'unsafe-inline'; font-src http: https: data:; base-uri http: https:; form-action 'none'; frame-src 'none'; connect-src 'none'";
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

export class ReferenceCopyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function inertReferenceHtml(html: string, url: string): string {
  const document = parse(html);
  const visit = (node: DefaultTreeAdapterMap["parentNode"]) => {
    node.childNodes = node.childNodes.filter(
      (child) => !("tagName" in child && OMIT_TAGS.has(child.tagName)),
    );
    for (const child of node.childNodes) {
      if ("attrs" in child) {
        if (child.tagName === "head") child.attrs = [];
        child.attrs = child.attrs.filter(({ name, value }) => {
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
            return false;
          if (
            ["href", "src", "xlink:href"].includes(name) &&
            /^\s*(javascript|vbscript):/i.test(value)
          )
            return false;
          return true;
        });
      }
      if ("childNodes" in child) visit(child);
    }
  };
  visit(document);
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;");
  return serialize(document).replace(
    "<head>",
    `<head><meta http-equiv="Content-Security-Policy" content="${escape(REFERENCE_CSP)}"><base href="${escape(url)}"><meta name="referrer" content="no-referrer">`,
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
    html: inertReferenceHtml(Buffer.concat(chunks).toString("utf8"), finalUrl),
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
