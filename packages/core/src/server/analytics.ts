/**
 * Opt-in analytics injection for SSR streams.
 * Supported environment variables:
 * - `GA_MEASUREMENT_ID` — Google Analytics 4 measurement ID
 * - `GTM_CONTAINER_ID` — Google Tag Manager web container ID
 *
 * Netlify configuration-file env vars are build-time only for serverless
 * functions, so the Vite/Nitro build paths also bake this public value into
 * SSR bundles.
 *
 * Amplitude and Sentry are initialized client-side via their npm packages
 * (see `packages/core/src/client/analytics.ts`). GTM and GA require script
 * tag injection because their loaders must be `<script>` elements.
 *
 * When GTM is set, its head bootstrap is injected before `</head>` and its
 * noscript fallback immediately after `<body>`. GTM takes precedence over GA
 * so pageviews are not double-counted; configure the GA tag inside GTM.
 * When only GA is set, the corresponding script tags are injected before
 * `</head>`.
 * When not set, the stream passes through untouched (zero overhead).
 *
 * Usage in entry.server.tsx:
 * ```ts
 * import { wrapWithAnalytics } from "@agent-native/core/server";
 * return new Response(wrapWithAnalytics(body), { ... });
 * ```
 */

declare const __AGENT_NATIVE_BUILD_GA_MEASUREMENT_ID__: string | undefined;
declare const __AGENT_NATIVE_BUILD_GTM_CONTAINER_ID__: string | undefined;

function normalizeMeasurementId(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function getViteBakedGaMeasurementId(): string | undefined {
  return typeof __AGENT_NATIVE_BUILD_GA_MEASUREMENT_ID__ === "string"
    ? __AGENT_NATIVE_BUILD_GA_MEASUREMENT_ID__
    : undefined;
}

function normalizeContainerId(value: string | undefined): string | null {
  const trimmed = value?.trim().toUpperCase();
  return trimmed && /^GTM-[A-Z0-9]+$/.test(trimmed) ? trimmed : null;
}

function getViteBakedGtmContainerId(): string | undefined {
  return typeof __AGENT_NATIVE_BUILD_GTM_CONTAINER_ID__ === "string"
    ? __AGENT_NATIVE_BUILD_GTM_CONTAINER_ID__
    : undefined;
}

function getGtmContainerId(): string | null {
  return (
    normalizeContainerId(process.env.GTM_CONTAINER_ID) ||
    normalizeContainerId(process.env.AGENT_NATIVE_BUILD_GTM_CONTAINER_ID) ||
    normalizeContainerId(getViteBakedGtmContainerId())
  );
}

function getGaMeasurementId(): string | null {
  return (
    normalizeMeasurementId(process.env.GA_MEASUREMENT_ID) ||
    normalizeMeasurementId(process.env.AGENT_NATIVE_BUILD_GA_MEASUREMENT_ID) ||
    normalizeMeasurementId(getViteBakedGaMeasurementId())
  );
}

/**
 * The exact JS body (no surrounding `<script>` tags) of the inline gtag config
 * block injected next to the gtag.js loader.
 * Returns `null` when GA is not configured.
 */
export function getGaInlineConfigScriptBody(): string | null {
  const id = getGaMeasurementId();
  if (!id) return null;
  const jsId = JSON.stringify(id);
  return (
    `window.dataLayer=window.dataLayer||[];` +
    `function gtag(){dataLayer.push(arguments);}` +
    `gtag('js',new Date());` +
    `gtag('config',${jsId});` +
    `if(typeof sessionStorage!=='undefined'&&sessionStorage.getItem('__an_signin')){` +
    `sessionStorage.removeItem('__an_signin');` +
    `gtag('event','sign_in');` +
    `}`
  );
}

function getGaScript(): string | null {
  const id = getGaMeasurementId();
  if (!id) return null;
  const srcId = encodeURIComponent(id);
  const inlineBody = getGaInlineConfigScriptBody();
  return (
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${srcId}"></script>` +
    `<script>${inlineBody}</script>`
  );
}

function getGtmHeadScript(containerId: string): string {
  const jsId = JSON.stringify(containerId);
  return `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${jsId});</script>`;
}

function getGtmBodyFallback(containerId: string): string {
  const src = encodeURIComponent(containerId);
  return `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${src}" height="0" width="0" style="display:none;visibility:hidden" title="Google Tag Manager"></iframe></noscript>`;
}

type AnalyticsInjection = {
  head: string;
  body: string;
};

function getAnalyticsInjection(): AnalyticsInjection | null {
  const containerId = getGtmContainerId();
  if (containerId) {
    return {
      head: getGtmHeadScript(containerId),
      body: getGtmBodyFallback(containerId),
    };
  }

  const gaScript = getGaScript();
  return gaScript ? { head: gaScript, body: "" } : null;
}

const HEAD_CLOSE_PATTERN = /<\/head>/i;
const BODY_OPEN_PATTERN = /<body\b[^>]*>/i;

/**
 * Add the configured analytics scripts to a complete HTML document.
 *
 * The normal app document is streamed through `wrapWithAnalytics`, but
 * framework-owned documents such as `/signup` are returned as strings by the
 * auth guard and need the same injection path.
 */
export function injectAnalyticsIntoHtml(html: string): string {
  const injection = getAnalyticsInjection();
  if (!injection) return html;

  const headCloseMatch = HEAD_CLOSE_PATTERN.exec(html);
  if (!headCloseMatch || headCloseMatch.index === undefined) return html;

  let output =
    html.slice(0, headCloseMatch.index) +
    injection.head +
    html.slice(headCloseMatch.index);

  if (injection.body) {
    const bodyOpenMatch = BODY_OPEN_PATTERN.exec(output);
    if (bodyOpenMatch && bodyOpenMatch.index !== undefined) {
      const bodyEnd = bodyOpenMatch.index + bodyOpenMatch[0].length;
      output =
        output.slice(0, bodyEnd) + injection.body + output.slice(bodyEnd);
    }
  }

  return output;
}

export function wrapWithAnalytics(
  body: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const injection = getAnalyticsInjection();
  if (!injection) return body;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  let headInjected = false;
  let bodyInjected = !injection.body;

  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        pending += decoder.decode(chunk, { stream: true });

        if (!headInjected) {
          const headCloseMatch = HEAD_CLOSE_PATTERN.exec(pending);
          if (!headCloseMatch || headCloseMatch.index === undefined) return;

          const headEnd = headCloseMatch.index + headCloseMatch[0].length;
          controller.enqueue(
            encoder.encode(
              pending.slice(0, headCloseMatch.index) +
                injection.head +
                pending.slice(headCloseMatch.index, headEnd),
            ),
          );
          pending = pending.slice(headEnd);
          headInjected = true;
        }

        if (!bodyInjected) {
          const bodyOpenMatch = BODY_OPEN_PATTERN.exec(pending);
          if (!bodyOpenMatch || bodyOpenMatch.index === undefined) return;

          const bodyEnd = bodyOpenMatch.index + bodyOpenMatch[0].length;
          controller.enqueue(
            encoder.encode(pending.slice(0, bodyEnd) + injection.body),
          );
          pending = pending.slice(bodyEnd);
          bodyInjected = true;
        }

        if (pending) {
          controller.enqueue(encoder.encode(pending));
          pending = "";
        }
      },
      flush(controller) {
        pending += decoder.decode();

        if (!headInjected) {
          const headCloseMatch = HEAD_CLOSE_PATTERN.exec(pending);
          if (headCloseMatch && headCloseMatch.index !== undefined) {
            const headEnd = headCloseMatch.index + headCloseMatch[0].length;
            controller.enqueue(
              encoder.encode(
                pending.slice(0, headCloseMatch.index) +
                  injection.head +
                  pending.slice(headCloseMatch.index, headEnd),
              ),
            );
            pending = pending.slice(headEnd);
            headInjected = true;
          }
        }

        if (headInjected && !bodyInjected) {
          const bodyOpenMatch = BODY_OPEN_PATTERN.exec(pending);
          if (bodyOpenMatch && bodyOpenMatch.index !== undefined) {
            const bodyEnd = bodyOpenMatch.index + bodyOpenMatch[0].length;
            controller.enqueue(
              encoder.encode(pending.slice(0, bodyEnd) + injection.body),
            );
            pending = pending.slice(bodyEnd);
            bodyInjected = true;
          }
        }

        if (pending) controller.enqueue(encoder.encode(pending));
      },
    }),
  );
}
