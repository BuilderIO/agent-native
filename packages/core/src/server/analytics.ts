/**
 * Opt-in analytics injection for SSR streams.
 * Supported environment variables:
 * - `GA_MEASUREMENT_ID` — Google Analytics 4 measurement ID
 *
 * Netlify configuration-file env vars are build-time only for serverless
 * functions, so the Vite plugin also bakes this public value into SSR bundles
 * as `__AGENT_NATIVE_BUILD_GA_MEASUREMENT_ID__`.
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

declare const __AGENT_NATIVE_BUILD_GA_MEASUREMENT_ID__: string | undefined;

function normalizeMeasurementId(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function getGaMeasurementId(): string | null {
  return (
    normalizeMeasurementId(process.env.GA_MEASUREMENT_ID) ||
    normalizeMeasurementId(
      typeof __AGENT_NATIVE_BUILD_GA_MEASUREMENT_ID__ === "string"
        ? __AGENT_NATIVE_BUILD_GA_MEASUREMENT_ID__
        : undefined,
    )
  );
}

function getGaScript(): string | null {
  const id = getGaMeasurementId();
  if (!id) return null;
  const srcId = encodeURIComponent(id);
  const jsId = JSON.stringify(id);
  return (
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${srcId}"></script>` +
    `<script>` +
    `window.dataLayer=window.dataLayer||[];` +
    `function gtag(){dataLayer.push(arguments);}` +
    `gtag('js',new Date());` +
    `gtag('config',${jsId});` +
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
