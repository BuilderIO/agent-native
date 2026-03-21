import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";

/**
 * Proxies any URL and strips X-Frame-Options / CSP frame-ancestors headers
 * so the content can be loaded in an iframe inside our app.
 */
export const proxyUrl = defineEventHandler(async (event: H3Event) => {
  const query = getQuery(event);
  const url = query.url as string;
  if (!url) {
    setResponseStatus(event, 400);
    return { error: "url parameter is required" };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    // Forward status
    setResponseStatus(event, response.status);

    // Forward headers, but strip frame-blocking ones
    const skipHeaders = new Set([
      "x-frame-options",
      "content-security-policy",
      "content-security-policy-report-only",
      "content-encoding", // we're reading the decoded body
      "transfer-encoding",
      "connection",
    ]);

    response.headers.forEach((value, key) => {
      if (!skipHeaders.has(key.toLowerCase())) {
        event.node.res.setHeader(key, value);
      }
    });

    // Inject a <base> tag so relative URLs resolve correctly
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      let html = await response.text();

      // Determine the base URL from the final (possibly redirected) URL
      const finalUrl = response.url || url;
      const baseUrl = new URL("/", finalUrl).href;

      // Inject <base> tag right after <head> if not already present
      if (!/<base\s/i.test(html)) {
        html = html.replace(/(<head[^>]*>)/i, `$1<base href="${baseUrl}" />`);
      }

      event.node.res.setHeader("Content-Type", "text/html; charset=utf-8");
      event.node.res.end(html);
      return;
    } else {
      // For non-HTML, just send through
      const buffer = await response.arrayBuffer();
      event.node.res.end(Buffer.from(buffer));
      return;
    }
  } catch (err: any) {
    if (err.name === "AbortError") {
      setResponseStatus(event, 504);
      return { error: "Timed out fetching URL" };
    }
    setResponseStatus(event, 500);
    return { error: `Proxy fetch failed: ${err.message}` };
  }
});
