import { getAppConfig } from "../app-config/index.js";
import { SYNTHETIC_TRAFFIC_BETA_E2E } from "../shared/test-traffic.js";

declare const __AGENT_NATIVE_BUILD_GA_MEASUREMENT_ID__: string | undefined;
declare const __AGENT_NATIVE_BUILD_GTM_CONTAINER_ID__: string | undefined;

const AGENT_NATIVE_ANALYTICS_DEFAULT_ENDPOINT =
  "https://analytics.agent-native.com/track";

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

function getSyntheticTrafficBrowserGuard(): string {
  return `window.__AGENT_NATIVE_SYNTHETIC_TRAFFIC__!==${JSON.stringify(SYNTHETIC_TRAFFIC_BETA_E2E)}`;
}

function getGaMeasurementId(): string | null {
  return (
    normalizeMeasurementId(process.env.GA_MEASUREMENT_ID) ||
    normalizeMeasurementId(process.env.AGENT_NATIVE_BUILD_GA_MEASUREMENT_ID) ||
    normalizeMeasurementId(getViteBakedGaMeasurementId())
  );
}

function getAgentNativeAnalyticsPublicKey(): string | null {
  return normalizeMeasurementId(getAppConfig().analytics.agentNativePublicKey);
}

function getAgentNativeAnalyticsEndpoint(): string {
  return (
    normalizeMeasurementId(getAppConfig().analytics.agentNativeEndpoint) ||
    AGENT_NATIVE_ANALYTICS_DEFAULT_ENDPOINT
  );
}

export function getAgentNativeAnalyticsConfigScript(): string | null {
  const publicKey = getAgentNativeAnalyticsPublicKey();
  if (!publicKey) return null;
  return [
    "<script data-agent-native-analytics-config>",
    "window.__AGENT_NATIVE_CONFIG__=Object.assign({},window.__AGENT_NATIVE_CONFIG__,",
    JSON.stringify({
      agentNativeAnalyticsPublicKey: publicKey,
      agentNativeAnalyticsEndpoint: getAgentNativeAnalyticsEndpoint(),
    }),
    ");</script>",
  ].join("");
}

export function getGaInlineConfigScriptBody(options?: {
  dataLayerName?: string;
  sendPageView?: boolean;
}): string | null {
  const id = getGaMeasurementId();
  if (!id) return null;
  const dataLayerName = options?.dataLayerName ?? "dataLayer";
  const dataLayer = `window[${JSON.stringify(dataLayerName)}]`;
  const dataLayerQuery =
    dataLayerName === "dataLayer"
      ? ""
      : `&l=${encodeURIComponent(dataLayerName)}`;
  const gtagCall = dataLayerName === "dataLayer" ? "gtag" : "agentNativeGtag";
  const gtagBootstrap =
    dataLayerName === "dataLayer"
      ? `window.gtag=window.gtag||function(){${dataLayer}.push(arguments);};`
      : `var agentNativeGtag=function(){${dataLayer}.push(arguments);};window.__AGENT_NATIVE_GA_GTAG__=agentNativeGtag;`;
  const config =
    options?.sendPageView === false
      ? `${gtagCall}('config',${JSON.stringify(id)},{send_page_view:false});`
      : `${gtagCall}('config',${JSON.stringify(id)});`;
  const src = JSON.stringify(
    `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}${dataLayerQuery}`,
  );
  const guard = getSyntheticTrafficBrowserGuard();
  return (
    `if(${guard}){` +
    `${dataLayer}=${dataLayer}||[];` +
    gtagBootstrap +
    `${gtagCall}('js',new Date());` +
    config +
    `if(typeof sessionStorage!=='undefined'&&sessionStorage.getItem('__an_signin')){` +
    `sessionStorage.removeItem('__an_signin');` +
    `${gtagCall}('event','sign_in');` +
    `}` +
    `var agentNativeGtagScript=document.createElement('script');` +
    `agentNativeGtagScript.async=true;` +
    `agentNativeGtagScript.src=${src};` +
    `document.head.appendChild(agentNativeGtagScript);` +
    `}`
  );
}

function getGaScript(): string | null {
  const id = getGaMeasurementId();
  if (!id) return null;
  const inlineBody = getGaInlineConfigScriptBody();
  return `<script>${inlineBody}</script>`;
}

function getGtmGaFallbackScript(): string | null {
  const inlineBody = getGaInlineConfigScriptBody({
    dataLayerName: "__AGENT_NATIVE_GA_DATA_LAYER__",
    sendPageView: false,
  });
  return inlineBody ? `<script>${inlineBody}</script>` : null;
}

function getGtmHeadScript(containerId: string): string {
  const jsId = JSON.stringify(containerId);
  return `<script>if(${getSyntheticTrafficBrowserGuard()}){(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${jsId});}</script>`;
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
  const agentNativeAnalytics = getAgentNativeAnalyticsConfigScript();
  const containerId = getGtmContainerId();
  if (containerId) {
    return {
      head: [
        agentNativeAnalytics,
        getGtmHeadScript(containerId),
        getGtmGaFallbackScript(),
      ]
        .filter(Boolean)
        .join(""),
      body: getGtmBodyFallback(containerId),
    };
  }

  const gaScript = getGaScript();
  const head = [agentNativeAnalytics, gaScript].filter(Boolean).join("");
  return head ? { head, body: "" } : null;
}

const HEAD_CLOSE_PATTERN = /<\/head>/i;
const BODY_OPEN_PATTERN = /<body\b[^>]*>/i;

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
