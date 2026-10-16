import { getAppConfig } from "../app-config/index.js";
import {
  CONSENT_REGION_PATH,
  CONSENT_REGION_TIME_ZONE_LIST,
  type ConsentCategory,
} from "../shared/consent.js";
import { SYNTHETIC_TRAFFIC_BETA_E2E } from "../shared/test-traffic.js";
import { publicFrameworkPath } from "./framework-route-prefix.js";

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
      authSessionReplay: getAppConfig().analytics.authSessionReplay,
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

/**
 * Queue `body` until the visitor's region and choice allow `category`; the
 * bootstrap after it, or `client/consent.ts` once loaded, runs it. A reject
 * then a fresh accept calls it again, so it loads its tag only once a page.
 */
function consentGatedScript(category: ConsentCategory, body: string): string {
  return `<script>(window.__AN_CONSENT_QUEUE__=window.__AN_CONSENT_QUEUE__||[]).push([${JSON.stringify(category)},(function(){var ran=false;return function(){if(ran)return;ran=true;${body}}})()]);</script>`;
}

const GA_FALLBACK_DATA_LAYER = "__AGENT_NATIVE_GA_DATA_LAYER__";

// gtag reads an `arguments` object from the data layer, never an array.
const GOOGLE_CONSENT_PUSH =
  `function push(g){for(var i=0;i<L.length;i++){var l=w[L[i]]=w[L[i]]||[];` +
  `(function(){l.push(arguments)})("consent",g.mode,{analytics_storage:g.p?"granted":"denied",ad_storage:g.t?"granted":"denied",ad_user_data:g.t?"granted":"denied",ad_personalization:g.t?"granted":"denied"})}}`;

/**
 * Google Consent Mode: before any Google tag loads, tell each data layer
 * what the stored choice allows (nothing, without one), so tags already on
 * the page stop storing and sending when `client/consent.ts` later pushes a
 * reject. Lists the layers there, under `__AN_CONSENT_LAYERS__`.
 */
function getGoogleConsentDefaultScript(dataLayers: string[]): string {
  return (
    `<script data-agent-native-consent-mode>(function(w,d){var L=${JSON.stringify(dataLayers)};w.__AN_CONSENT_LAYERS__=L;` +
    GOOGLE_CONSENT_PUSH +
    `var m=/(?:^|;\\s*)an_consent=1\\.p([01])\\.t([01])(?:;|$)/.exec(d.cookie||"");` +
    `push({mode:"default",p:!!m&&m[1]==="1",t:!!m&&m[2]==="1"})` +
    `})(window,document);</script>`
  );
}

/**
 * Runs the queued tags on pages that never load the app bundle, like the
 * plain sign-in page, and runs them without waiting for it elsewhere: at once
 * for a stored choice or a region already known this session, else after
 * asking the server, with the time zone as fallback. Once
 * `client/consent.ts` replaces the queue it owns what's left, so nothing runs
 * twice. Keep its cookie and region rules in step with that module.
 */
function getConsentBootstrapScript(): string {
  const zones = JSON.stringify(CONSENT_REGION_TIME_ZONE_LIST);
  const regionPath = JSON.stringify(publicFrameworkPath(CONSENT_REGION_PATH));
  return (
    `<script data-agent-native-consent>(function(w,d){var Q="__AN_CONSENT_QUEUE__",K="an_consent_region";` +
    `function choice(){var m=/(?:^|;\\s*)an_consent=1\\.p([01])\\.t([01])(?:;|$)/.exec(d.cookie||"");return m?{performance:m[1]==="1",targeting:m[2]==="1"}:null}` +
    `function allows(c,k,region){return c?c[k]:region==="none"}` +
    `function run(region){var q=w[Q];if(!Array.isArray(q))return;var c=choice(),keep=[],L=w.__AN_CONSENT_LAYERS__||[];` +
    GOOGLE_CONSENT_PUSH +
    `push({mode:"update",p:allows(c,"performance",region),t:allows(c,"targeting",region)});` +
    `for(var i=0;i<q.length;i++){var e=q[i];if(allows(c,e[0],region)){e[1]()}else{keep.push(e)}}q.length=0;q.push.apply(q,keep)}` +
    `function zone(){try{return ${zones}.indexOf(Intl.DateTimeFormat().resolvedOptions().timeZone)>-1?"consent":"none"}catch(e){return"consent"}}` +
    // coercion-ok: a page without session storage asks the server again.
    `var cached=null;try{cached=w.sessionStorage.getItem(K)}catch(e){}` +
    `if(choice()||cached==="consent"||cached==="none"){run(cached);return}` +
    // An unreachable server falls back to the time zone.
    // coercion-ok: a region it can't save is asked again on the next page.
    `fetch(${regionPath},{credentials:"same-origin"}).then(function(r){return r.ok?r.json():{}}).then(function(b){return b&&(b.region==="consent"||b.region==="none")?b.region:zone()},zone).then(function(region){try{w.sessionStorage.setItem(K,region)}catch(e){}run(region)})` +
    `})(window,document);</script>`
  );
}

function getGaScript(): string | null {
  const id = getGaMeasurementId();
  if (!id) return null;
  const inlineBody = getGaInlineConfigScriptBody();
  return inlineBody ? consentGatedScript("performance", inlineBody) : null;
}

function getGtmGaFallbackScript(): string | null {
  const inlineBody = getGaInlineConfigScriptBody({
    dataLayerName: GA_FALLBACK_DATA_LAYER,
    sendPageView: false,
  });
  return inlineBody ? consentGatedScript("performance", inlineBody) : null;
}

// The container carries the ad pixels (Meta, LinkedIn, Reddit, X, Bing,
// Google Ads, OpenAI) and B2B identification tags alongside GA events, so it
// all waits for targeting. Its <noscript> iframe can't wait, so there is none.
function getGtmHeadScript(containerId: string): string {
  const jsId = JSON.stringify(containerId);
  return consentGatedScript(
    "targeting",
    `if(${getSyntheticTrafficBrowserGuard()}){(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${jsId});}`,
  );
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
        getGoogleConsentDefaultScript(["dataLayer", GA_FALLBACK_DATA_LAYER]),
        getGtmHeadScript(containerId),
        getGtmGaFallbackScript(),
        getConsentBootstrapScript(),
      ]
        .filter(Boolean)
        .join(""),
      body: "",
    };
  }

  const gaScript = getGaScript();
  const head = [
    agentNativeAnalytics,
    gaScript ? getGoogleConsentDefaultScript(["dataLayer"]) : null,
    gaScript,
    gaScript ? getConsentBootstrapScript() : null,
  ]
    .filter(Boolean)
    .join("");
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
