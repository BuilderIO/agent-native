/**
 * Opt-in analytics & error-tracking injection for SSR streams.
 *
 * Supported environment variables:
 * - `GA_MEASUREMENT_ID` — Google Analytics 4 measurement ID
 * - `AMPLITUDE_API_KEY` — Amplitude browser SDK client key
 * - `SENTRY_CLIENT_KEY` — Sentry browser SDK loader key (the hex portion of the CDN URL)
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
    // Auto-track sign-in event if flag was set before OAuth redirect
    `if(typeof sessionStorage!=='undefined'&&sessionStorage.getItem('__an_signin')){` +
    `sessionStorage.removeItem('__an_signin');` +
    `gtag('event','sign_in');` +
    `}` +
    `</script>`
  );
}

function getAmplitudeScript(): string | null {
  const key = process.env.AMPLITUDE_API_KEY;
  if (!key) return null;
  return (
    `<script src="https://cdn.amplitude.com/script/${key}.js"></script>` +
    `<script>window.amplitude.init('${key}',{autocapture:true});</script>`
  );
}

function getSentryScript(): string | null {
  const key = process.env.SENTRY_CLIENT_KEY;
  if (!key) return null;
  return `<script src="https://js.sentry-cdn.com/${key}.min.js" crossorigin="anonymous"></script>`;
}

/**
 * Wrap an SSR ReadableStream to inject analytics/error-tracking scripts before `</head>`.
 * Returns the stream untouched if no tracking env vars are set.
 */
export function wrapWithAnalytics(body: ReadableStream): ReadableStream {
  const scripts = [getGaScript(), getAmplitudeScript(), getSentryScript()]
    .filter(Boolean)
    .join("");
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
