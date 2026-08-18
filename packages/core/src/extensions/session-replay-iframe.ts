import {
  isTrustedSessionReplayIframeParentOrigin,
  SESSION_REPLAY_IFRAME_PROBE,
  SESSION_REPLAY_IFRAME_START,
  SESSION_REPLAY_IFRAME_STOP,
} from "../session-replay-iframe-protocol.js";

export const RRWEB_RECORD_IFRAME_CDN_URL =
  "https://cdn.jsdelivr.net/npm/@rrweb/record@2.1.0/umd/record.min.js";
export const RRWEB_RECORD_IFRAME_SRI =
  "sha384-MrD66HBNSykaP2N95+6hQCFlF5oH2tvL3TD/zyvHNkP/sAFWZx98DX9MEDy8MdVT";

/**
 * Installs the cooperative side of rrweb's cross-origin iframe protocol.
 * Nothing is fetched or recorded until a trusted first-party parent asks the
 * frame to start. rrweb then forwards its events directly to that parent.
 */
export function buildSessionReplayIframeBootstrap(): string {
  const probeType = JSON.stringify(SESSION_REPLAY_IFRAME_PROBE);
  const startType = JSON.stringify(SESSION_REPLAY_IFRAME_START);
  const stopType = JSON.stringify(SESSION_REPLAY_IFRAME_STOP);
  const scriptUrl = JSON.stringify(RRWEB_RECORD_IFRAME_CDN_URL);
  const integrity = JSON.stringify(RRWEB_RECORD_IFRAME_SRI);

  return `<script>
    (function() {
      var recorderStop = null;
      var recorderLoad = null;
      var startGeneration = 0;
      var isTrustedParentOrigin = ${isTrustedSessionReplayIframeParentOrigin.toString()};

      function stopRecorder() {
        startGeneration += 1;
        if (typeof recorderStop === 'function') {
          try { recorderStop(); } catch (_) {}
        }
        recorderStop = null;
      }

      function getRecord() {
        return window.rrwebRecord && typeof window.rrwebRecord.record === 'function'
          ? window.rrwebRecord.record
          : null;
      }

      function loadRecorder() {
        if (recorderLoad) return recorderLoad;
        recorderLoad = new Promise(function(resolve, reject) {
          var script = document.createElement('script');
          script.src = ${scriptUrl};
          script.integrity = ${integrity};
          script.crossOrigin = 'anonymous';
          script.referrerPolicy = 'no-referrer';
          script.async = true;
          script.onload = function() {
            var record = getRecord();
            if (record) resolve(record);
            else reject(new Error('rrweb recorder did not initialize'));
          };
          script.onerror = function() {
            recorderLoad = null;
            reject(new Error('rrweb recorder failed to load'));
          };
          document.head.appendChild(script);
        });
        return recorderLoad;
      }

      function validOptions(options) {
        return !!options &&
          typeof options === 'object' &&
          typeof options.blockSelector === 'string' &&
          typeof options.ignoreSelector === 'string' &&
          typeof options.maskTextSelector === 'string' &&
          typeof options.maskAllInputs === 'boolean' &&
          typeof options.recordCanvas === 'boolean' &&
          typeof options.collectFonts === 'boolean' &&
          typeof options.inlineImages === 'boolean' &&
          !!options.sampling && typeof options.sampling === 'object';
      }

      function startRecorder(options) {
        if (!validOptions(options)) return;
        stopRecorder();
        var generation = startGeneration;
        loadRecorder().then(function(record) {
          if (generation !== startGeneration) return;
          recorderStop = record({
            blockSelector: options.blockSelector,
            ignoreSelector: options.ignoreSelector,
            maskTextClass: options.maskTextClass,
            maskTextSelector: options.maskTextSelector,
            maskAllInputs: options.maskAllInputs,
            maskInputOptions: options.maskInputOptions,
            recordCanvas: options.recordCanvas,
            collectFonts: options.collectFonts,
            inlineImages: options.inlineImages,
            sampling: options.sampling,
            recordCrossOriginIframes: true
          }) || null;
        }).catch(function() {});
      }

      window.addEventListener('message', function(event) {
        if (event.source !== window.parent || !isTrustedParentOrigin(event.origin, window.location.href)) return;
        var message = event.data;
        if (!message || typeof message !== 'object') return;
        if (message.type === ${startType}) startRecorder(message.options);
        else if (message.type === ${stopType}) stopRecorder();
      });
      window.addEventListener('pagehide', stopRecorder);

      if (window.parent !== window) {
        window.parent.postMessage({ type: ${probeType} }, '*');
      }
    })();
  </script>`;
}

export function injectSessionReplayIframeBootstrap(html: string): string {
  const bootstrap = buildSessionReplayIframeBootstrap();
  const headClose = html.search(/<\/head\s*>/i);
  if (headClose >= 0) {
    return `${html.slice(0, headClose)}${bootstrap}${html.slice(headClose)}`;
  }
  const bodyOpen = html.search(/<body(?:\s[^>]*)?>/i);
  if (bodyOpen >= 0) {
    return `${html.slice(0, bodyOpen)}${bootstrap}${html.slice(bodyOpen)}`;
  }
  return `${bootstrap}${html}`;
}
