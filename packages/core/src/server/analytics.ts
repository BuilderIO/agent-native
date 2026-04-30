/**
 * Opt-in analytics injection for SSR streams.
 * Supported environment variables:
 * - `GA_MEASUREMENT_ID` — Google Analytics 4 measurement ID
 *
 * Amplitude and Sentry are initialized client-side via their npm packages
 * (see `packages/core/src/client/analytics.ts`). Only GA requires script
 * tag injection because the gtag.js loader must be a `<script src>`.
 *
 * When set, the corresponding script tags are injected before `</head>`.
 * When not set, the stream passes through untouched (zero overhead).
 *
 * Usage in entry.server.tsx:
 * ```ts
 * import { wrapWithAnalytics } from "@agent-native/core/server";
 * return new Response(wrapWithAnalytics(body), { ... });
 * ```
 */

function getGaScript(): string | null {
  const id = process.env.GA_MEASUREMENT_ID;
  if (!id) return null;
  return (
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>` +
    `<script>` +
    `window.dataLayer=window.dataLayer||[];` +
    `function gtag(){dataLayer.push(arguments);}` +
    `gtag('js',new Date());` +
    `gtag('config','${id}');` +
    `if(typeof sessionStorage!=='undefined'&&sessionStorage.getItem('__an_signin')){` +
    `sessionStorage.removeItem('__an_signin');` +
    `gtag('event','sign_in');` +
    `}` +
    `</script>`
  );
}

export function wrapWithAnalytics(body: ReadableStream): ReadableStream {
  const scripts = [getGaScript()].filter(Boolean).join("");
  if (!scripts) return body;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let injected = false;

  return body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        if (injected) {
          controller.enqueue(chunk);
          return;
        }
        const text = decoder.decode(chunk, { stream: true });
        const headCloseIdx = text.indexOf("</head>");
        if (headCloseIdx !== -1) {
          const modified =
            text.slice(0, headCloseIdx) + scripts + text.slice(headCloseIdx);
          controller.enqueue(encoder.encode(modified));
          injected = true;
        } else {
          controller.enqueue(chunk);
        }
      },
    }),
  );
}
