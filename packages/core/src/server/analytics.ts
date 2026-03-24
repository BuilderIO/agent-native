/**
 * Opt-in Google Analytics injection for SSR streams.
 *
 * When the `GA_MEASUREMENT_ID` environment variable is set, this module
 * injects GA script tags into the HTML response before `</head>`.
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

/**
 * Wrap an SSR ReadableStream to inject Google Analytics scripts before `</head>`.
 * Returns the stream untouched if `GA_MEASUREMENT_ID` is not set.
 */
export function wrapWithAnalytics(body: ReadableStream): ReadableStream {
  const gaScript = getGaScript();
  if (!gaScript) return body;

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
            text.slice(0, headCloseIdx) + gaScript + text.slice(headCloseIdx);
          controller.enqueue(encoder.encode(modified));
          injected = true;
        } else {
          controller.enqueue(chunk);
        }
      },
    }),
  );
}
