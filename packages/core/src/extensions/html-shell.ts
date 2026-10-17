// Import-free on purpose: this shell is also built in the browser
// (ExtensionViewer, InlineExtensionFrame), so it must not import the
// app-config store. Configured sources are resolved server-side in
// ./iframe-csp.ts: the render route passes them in, and the client renderers
// fetch them from EXTENSION_IFRAME_DISPLAY_SOURCES_PATH.
import {
  DEFAULT_EXTENSION_DISPLAY_SOURCES,
  extensionDisplaySourcesError,
} from "../app-config/extension-display-sources.js";
import { buildSessionReplayIframeBootstrap } from "./session-replay-iframe.js";

/**
 * Builds the iframe CSP from the img-src / media-src lists.
 *
 * SECURITY: both lists are validated again here, at the point they are
 * interpolated, rather than trusted because they came from app config. The
 * resolved config is a cached, mutable object, and the client renderers pass
 * lists fetched from the server, so neither is guaranteed to still be what the
 * schema accepted. A list that fails validation throws instead of producing a
 * policy with an injected directive.
 */
export function extensionIframeCspBase(
  imageSources: readonly string[],
  mediaSources: readonly string[],
): string {
  const imageError = extensionDisplaySourcesError(imageSources);
  if (imageError) {
    throw new TypeError(`Invalid extension iframe img-src: ${imageError}`);
  }
  const mediaError = extensionDisplaySourcesError(mediaSources);
  if (mediaError) {
    throw new TypeError(`Invalid extension iframe media-src: ${mediaError}`);
  }
  return `default-src 'none'; script-src 'self' https://cdn.jsdelivr.net 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src ${imageSources.join(" ")}; media-src ${mediaSources.join(" ")}; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';`;
}

export const EXTENSION_FRAME_ANCESTORS = [
  "'self'",
  "https://agent-native.com",
  "https://*.agent-native.com",
  "https://agent-workspace.builder.io",
  "http://localhost:*",
  "http://127.0.0.1:*",
  "https://*.claudemcpcontent.com",
  "https://*.web-sandbox.oaiusercontent.com",
].join(" ");

// The two constants below are the policy an app gets before it configures
// anything. `buildExtensionIframeCsp()` (server-only, ./iframe-csp.ts) resolves `extensions.iframeImageSources`
// and `extensions.iframeMediaSources` and is what the render route sets, so a
// deployment that widens img-src / media-src still gets the same
// `connect-src 'self'` as one that does not. A remote image or media
// origin is its own egress permission: the browser requests that URL.
export const EXTENSION_IFRAME_CSP = `${extensionIframeCspBase(DEFAULT_EXTENSION_DISPLAY_SOURCES, DEFAULT_EXTENSION_DISPLAY_SOURCES)} frame-ancestors ${EXTENSION_FRAME_ANCESTORS};`;

export const EXTENSION_IFRAME_META_CSP = extensionIframeCspBase(
  DEFAULT_EXTENSION_DISPLAY_SOURCES,
  DEFAULT_EXTENSION_DISPLAY_SOURCES,
);

/**
 * Authenticated endpoint that returns the deployment's validated
 * `{ imageSources, mediaSources }`, so the client-rendered `srcDoc` frames
 * (`ExtensionViewer`, `InlineExtensionFrame`) can apply the same img-src /
 * media-src policy as the server render route without importing app config.
 */
export const EXTENSION_IFRAME_DISPLAY_SOURCES_PATH =
  "/_agent-native/extensions/iframe/display-sources";

export const EXTENSION_LINK_CHANNEL_HELLO_MESSAGE_TYPE =
  "agent-native-extension.hello-link-channel";
export const EXTENSION_LINK_CHANNEL_HOST_PORT_MESSAGE_TYPE =
  "agent-native-extension.host-bridge-port";
export const EXTENSION_LINK_CHANNEL_ACK_MESSAGE_TYPE =
  "agent-native-extension.link-channel-ready-ack";
export const EXTENSION_LINK_CHANNEL_READY_MESSAGE_TYPE =
  "agent-native-extension.link-channel-ready";
export const EXTENSION_OPEN_EXTERNAL_LINK_MESSAGE_TYPE =
  "agent-native-extension.open-external-link";
export const EXTENSION_NAVIGATE_SAME_ORIGIN_MESSAGE_TYPE =
  "agent-native-extension.navigate-same-origin";

/**
 * Builds the meta CSP for a client-rendered frame from the
 * `EXTENSION_IFRAME_DISPLAY_SOURCES_PATH` response. Anything that is not a
 * valid pair of source lists falls back to the default policy, which blocks
 * every remote image and media source (fail closed).
 */
export function extensionIframeMetaCspFromDisplaySources(
  value: unknown,
): string {
  if (typeof value !== "object" || value === null) {
    return EXTENSION_IFRAME_META_CSP;
  }
  const { imageSources, mediaSources } = value as Record<string, unknown>;
  try {
    return extensionIframeCspBase(
      imageSources as readonly string[],
      mediaSources as readonly string[],
    );
  } catch {
    return EXTENSION_IFRAME_META_CSP;
  }
}

/**
 * SECURITY — EXTENSION CONTENT IS UNTRUSTED.
 *
 * `${content}` (line ~Body) interpolates raw HTML/JS authored by a user. This
 * file is the boundary between framework-controlled HTML and user-controlled
 * HTML. Two non-negotiable invariants for every change here:
 *
 *   1. The iframe MUST be rendered with a `sandbox` attribute that does NOT
 *      include `allow-same-origin`. The viewer (`ExtensionViewer.tsx`,
 *      `EmbeddedExtension.tsx`) normalizes the sandbox through
 *      `normalizeAgentNativeExtensionSandbox()`, which permits scripts, forms,
 *      and downloads. External anchors ask the parent to open a fresh tab;
 *      extensions never receive top-level navigation or popup permission. Adding
 *      `allow-same-origin` would give the extension full DOM access to the
 *      parent window via cross-frame script.
 *
 *   2. Every reachable parent action must treat the postMessage payload as
 *      hostile. The bridge in `iframe-bridge.ts` enforces a path allowlist,
 *      header sanitization, and method allowlist; do not relax those gates
 *      for "convenience" in this file or any caller.
 *
 *   3. `connect-src` stays `'self'` and stays out of app config. Remote
 *      images and media are `extensions.iframeImageSources` /
 *      `iframeMediaSources`, which reach only `img-src` / `media-src`.
 *      Each allowed remote origin is an explicit egress permission: the
 *      browser sends the URL, and extension script can encode data into
 *      it. API calls stay on the permission-gated host bridge. Token
 *      validation still stops a value from appending another directive.
 *
 * For the trust model rationale, see audit 05-tools-sandbox.md (C1) and the
 * `extensions` skill. When in doubt, fail closed.
 *
 * BACKWARDS COMPAT — the iframe injects helpers under both their canonical
 * `extension*` names (`extensionFetch`, `extensionData`, `extensionId`,
 * `extensionBinding`) AND legacy `tool*` aliases (`toolFetch`, `toolData`,
 * `toolId`, `toolBinding`) so existing user-authored extension bodies that
 * pre-date the rename keep working. Same for layout opt-ins:
 * `data-extension-layout="full-bleed"` / `data-extension-padding="none"` /
 * class `agent-native-extension-bleed` / CSS var
 * `--agent-native-extension-padding` are canonical; the `data-tool-*`,
 * `agent-native-tool-bleed`, and `--agent-native-tool-padding` variants are
 * accepted as aliases.
 */

export interface ExtensionRenderBinding {
  authorEmail: string;
  viewerEmail: string;
  isAuthor: boolean;
  /**
   * Resolved role for the viewer ("owner" | "admin" | "editor" | "commenter" | "viewer").
   *
   * TODO(security, audit H4): the host-side bridge does not yet gate any
   * helper based on this value — every viewer gets the same powers as the
   * author. The role is plumbed through so a follow-up PR can constrain
   * `appAction` / `dbExec` / `extensionFetch` for non-author viewers (and
   * eventually require an explicit consent step before running a shared
   * extension, audit C1). For now this is metadata only.
   */
  role: "owner" | "admin" | "editor" | "commenter" | "viewer";
  source?: "database" | "local-files";
  permissions?: {
    appActions?: string[];
    extensionData?: boolean;
    sql?: boolean;
    externalFetch?: boolean;
  };
}

export function buildExtensionExternalLinkTargetBootstrap(
  linkNonce?: string,
): string {
  const nonceAttribute = linkNonce
    ? ` data-link-nonce="${escapeHtmlAttribute(linkNonce)}"`
    : "";
  return `<script${nonceAttribute}>
    (function() {
      var sendExternalLink = null;
      var NativeMessageChannel = window.MessageChannel;
      var messagePortPrototype = window.MessagePort && window.MessagePort.prototype;
      var eventTargetPrototype = window.EventTarget && window.EventTarget.prototype;
      var portAddEventListener = messagePortPrototype && messagePortPrototype.addEventListener || eventTargetPrototype && eventTargetPrototype.addEventListener;
      var portPostMessage = messagePortPrototype && messagePortPrototype.postMessage;
      var portClose = messagePortPrototype && messagePortPrototype.close;
      var portStart = messagePortPrototype && messagePortPrototype.start;
      var parentWindow = window.parent;
      var parentPostMessage = parentWindow.postMessage.bind(parentWindow);
      var bootstrapScript = document.currentScript;
      var pendingPorts = [];
      var handshakeTimer = null;
      var handshakeRetryTimer = null;
      var handshakePendingPort = null;
      var activeChildPort = null;
      var activeHostPort = null;
      var handshakeAttempts = 0;
      var linkNonce = bootstrapScript && bootstrapScript.getAttribute('data-link-nonce');
      // Route URLs carry the nonce separately from the extension's app fragment.
      var routeHashMatch = /^__agent_native_link_nonce=([0-9a-f]{48})&__agent_native_app_fragment=([^&=]*)$/.exec(window.location.hash.slice(1));
      if (!linkNonce && routeHashMatch) {
        try {
          var appFragment = decodeURIComponent(routeHashMatch[2]);
          history.replaceState(
            history.state,
            '',
            window.location.pathname + window.location.search + (appFragment ? '#' + appFragment : '')
          );
          linkNonce = routeHashMatch[1];
        } catch (_) {
          linkNonce = '';
        }
      }
      if (!linkNonce) linkNonce = ${JSON.stringify(linkNonce ?? "")};
      if (linkNonce) {
        Object.defineProperty(window, '__agentNativeExternalLinkBridgeActive', {
          value: true
        });
      }
      if (bootstrapScript) bootstrapScript.remove();

      function sendLinkChannelRequest() {
        if (!linkNonce || !NativeMessageChannel || sendExternalLink || handshakePendingPort || handshakeAttempts >= 20) return;

        handshakeAttempts += 1;
        var channel = new NativeMessageChannel();
        var childPort = channel.port1;
        handshakePendingPort = childPort;
        portAddEventListener.call(childPort, 'message', function(event) {
          if (
            event.data &&
            event.data.type === ${JSON.stringify(EXTENSION_LINK_CHANNEL_HOST_PORT_MESSAGE_TYPE)} &&
            event.ports.length === 1
          ) {
            if (activeHostPort) portClose.call(activeHostPort);
            activeHostPort = event.ports[0];
            window.__agentNativeExtensionHostPort = activeHostPort;
            window.dispatchEvent(new Event('agent-native-extension-host-port-ready'));
            return;
          }
          if (!event.data || event.data.type !== ${JSON.stringify(EXTENSION_LINK_CHANNEL_READY_MESSAGE_TYPE)}) return;
          if (pendingPorts.indexOf(childPort) === -1) return;
          if (handshakeRetryTimer) clearTimeout(handshakeRetryTimer);
          handshakeRetryTimer = null;
          handshakePendingPort = null;
          sendExternalLink = portPostMessage.bind(childPort);
          activeChildPort = childPort;
          if (handshakeTimer) clearInterval(handshakeTimer);
          handshakeTimer = null;
          pendingPorts.forEach(function(port) {
            if (port !== childPort) portClose.call(port);
          });
          pendingPorts = [childPort];
          portPostMessage.call(childPort, {
            type: ${JSON.stringify(EXTENSION_LINK_CHANNEL_ACK_MESSAGE_TYPE)}
          });
        });
        portStart.call(childPort);
        pendingPorts.push(childPort);
        parentPostMessage({
          type: ${JSON.stringify(EXTENSION_LINK_CHANNEL_HELLO_MESSAGE_TYPE)},
          nonce: linkNonce
        }, '*', [channel.port2]);
        handshakeRetryTimer = setTimeout(function() {
          if (handshakePendingPort !== childPort) return;
          handshakePendingPort = null;
          handshakeRetryTimer = null;
          if (handshakeAttempts >= 20) {
            if (handshakeTimer) clearInterval(handshakeTimer);
            handshakeTimer = null;
            pendingPorts.forEach(function(port) { portClose.call(port); });
            pendingPorts = [];
            return;
          }
          sendLinkChannelRequest();
        }, 500);
      }

      function startLinkChannel() {
        if (!linkNonce) return;
        sendLinkChannelRequest();
        handshakeTimer = setInterval(function() {
          sendLinkChannelRequest();
          if (handshakeAttempts >= 20 && handshakeTimer) {
            clearInterval(handshakeTimer);
            handshakeTimer = null;
          }
        }, 100);
      }
      if (document.readyState === 'complete') {
        startLinkChannel();
      } else {
        window.addEventListener('load', startLinkChannel, { once: true });
      }
      window.addEventListener('pagehide', function() {
        if (handshakeTimer) clearInterval(handshakeTimer);
        handshakeTimer = null;
        if (handshakeRetryTimer) clearTimeout(handshakeRetryTimer);
        handshakeRetryTimer = null;
        handshakePendingPort = null;
        var activeChildWasPending = activeChildPort && pendingPorts.indexOf(activeChildPort) !== -1;
        pendingPorts.forEach(function(port) { portClose.call(port); });
        pendingPorts = [];
        if (activeChildPort && !activeChildWasPending) portClose.call(activeChildPort);
        activeChildPort = null;
        sendExternalLink = null;
        handshakeAttempts = 0;
        if (activeHostPort) portClose.call(activeHostPort);
        activeHostPort = null;
        window.__agentNativeExtensionHostPort = null;
      });
      window.addEventListener('pageshow', function(event) {
        if (event.persisted) startLinkChannel();
      });

      function linkFromEvent(event) {
        var path = typeof event.composedPath === 'function'
          ? event.composedPath()
          : [];
        if (!path || path.length === 0) path = [event.target];
        for (var i = 0; i < path.length; i += 1) {
          var element = path[i];
          if (!element || element.nodeType !== 1) continue;
          var name = String(element.localName || element.tagName || '').toLowerCase();
          if (
            (name === 'a' || name === 'area') &&
            (element.hasAttribute('href') ||
              element.hasAttributeNS('http://www.w3.org/1999/xlink', 'href'))
          ) return element;
        }
        return null;
      }

      function linkTarget(link) {
        if (link.hasAttribute('target')) return link.getAttribute('target') || '';
        var base = document.querySelector('base[target]');
        return base ? base.getAttribute('target') || '' : '';
      }

      function opensNewContext(event, link) {
        if (event.type === 'auxclick') return event.button === 1;
        var target = linkTarget(link);
        var namedTarget = target && !/^_(self|parent|top|blank)$/i.test(target);
        return event.type === 'click' && event.button === 0 && !event.altKey &&
          (event.metaKey || event.ctrlKey || event.shiftKey || /^_blank$/i.test(target) || namedTarget);
      }

      var routedLinkEvents = new WeakSet();

      function routeExternalLinkAfterHandlers(event, request) {
        var path = typeof event.composedPath === 'function'
          ? event.composedPath()
          : [event.target];
        var targets = [];
        for (var i = 0; i < path.length; i += 1) {
          var target = path[i];
          if (
            target &&
            typeof target.addEventListener === 'function' &&
            targets.indexOf(target) === -1
          ) targets.push(target);
        }
        if (targets.indexOf(window) === -1) targets.push(window);

        var finished = false;
        var handlerPrevented = false;
        var routerPrevented = false;
        var settingRouterPrevented = false;
        var originalPreventDefault = event.preventDefault;
        var originalStopPropagation = event.stopPropagation;
        var originalStopImmediatePropagation = event.stopImmediatePropagation;
        var defaultPreventedDescriptor = Object.getOwnPropertyDescriptor(event, 'defaultPrevented');
        var preventDefaultDescriptor = Object.getOwnPropertyDescriptor(event, 'preventDefault');
        var stopPropagationDescriptor = Object.getOwnPropertyDescriptor(event, 'stopPropagation');
        var stopImmediatePropagationDescriptor = Object.getOwnPropertyDescriptor(event, 'stopImmediatePropagation');
        var defaultPreventedGetter = null;
        var eventPrototype = event;
        while (!defaultPreventedGetter && eventPrototype) {
          var defaultPreventedCandidate = Object.getOwnPropertyDescriptor(eventPrototype, 'defaultPrevented');
          if (defaultPreventedCandidate && defaultPreventedCandidate.get) {
            defaultPreventedGetter = defaultPreventedCandidate.get;
          }
          eventPrototype = Object.getPrototypeOf(eventPrototype);
        }
        function restoreEventMethod(name, descriptor) {
          if (descriptor) {
            Object.defineProperty(event, name, descriptor);
          } else {
            delete event[name];
          }
        }
        function restoreEventMethods() {
          restoreEventMethod('defaultPrevented', defaultPreventedDescriptor);
          restoreEventMethod('preventDefault', preventDefaultDescriptor);
          restoreEventMethod('stopPropagation', stopPropagationDescriptor);
          restoreEventMethod('stopImmediatePropagation', stopImmediatePropagationDescriptor);
        }
        Object.defineProperty(event, 'defaultPrevented', {
          configurable: true,
          get: function() {
            if (routerPrevented) return handlerPrevented;
            return handlerPrevented || (defaultPreventedGetter && defaultPreventedGetter.call(event));
          }
        });
        Object.defineProperty(event, 'preventDefault', {
          configurable: true,
          value: function() {
            if (!settingRouterPrevented) handlerPrevented = true;
            return originalPreventDefault.call(event);
          }
        });
        function preventDefaultForStoppedEvent() {
          if (handlerPrevented || routerPrevented) return;
          // Stopping propagation leaves the anchor's native action enabled unless canceled now.
          routerPrevented = true;
          settingRouterPrevented = true;
          try {
            originalPreventDefault.call(event);
          } finally {
            settingRouterPrevented = false;
          }
          queueMicrotask(function() { finish(event.cancelBubble); });
        }
        Object.defineProperty(event, 'stopPropagation', {
          configurable: true,
          value: function() {
            originalStopPropagation.call(event);
            preventDefaultForStoppedEvent();
          }
        });
        Object.defineProperty(event, 'stopImmediatePropagation', {
          configurable: true,
          value: function() {
            originalStopImmediatePropagation.call(event);
            preventDefaultForStoppedEvent();
          }
        });
        function cleanup() {
          targets.forEach(function(target) {
            target.removeEventListener(event.type, observeCapture, true);
            target.removeEventListener(event.type, observeBubble, false);
          });
        }
        function finish(shouldRoute) {
          if (finished) return;
          finished = true;
          cleanup();
          restoreEventMethods();
          if (
            !shouldRoute ||
            handlerPrevented ||
            (!routerPrevented && defaultPreventedGetter && defaultPreventedGetter.call(event))
          ) return;
          if (!sendExternalLink && parentWindow === window) return;
          event.preventDefault();
          if (sendExternalLink) {
            sendExternalLink(request);
            return;
          }
          var fallbackRequest = {
            type: request.type,
            href: request.href,
            nonce: linkNonce
          };
          if (request.target) fallbackRequest.target = request.target;
          if (request.openInNewContext) fallbackRequest.openInNewContext = true;
          parentPostMessage(fallbackRequest, '*');
        }
        function observe(isCapture) {
          if (routerPrevented) return;
          if (event.defaultPrevented) {
            finish(false);
          } else if (
            event.cancelBubble &&
            (!isCapture || event.currentTarget !== event.target)
          ) {
            finish(true);
          } else if (
            !isCapture &&
            event.currentTarget === window &&
            event.eventPhase === Event.BUBBLING_PHASE
          ) {
            finish(true);
          }
        }
        function observeCapture() { observe(true); }
        function observeBubble() { observe(false); }

        targets.forEach(function(target) {
          target.addEventListener(event.type, observeCapture, true);
          target.addEventListener(event.type, observeBubble, false);
        });
        setTimeout(function() { finish(event.cancelBubble); }, 0);
      }

      function routeExternalLink(event) {
        if (!event.isTrusted) return;
        if (!linkNonce) return;
        if (event.defaultPrevented) return;
        if (routedLinkEvents.has(event)) return;
        if (event.type === 'click' && event.button !== 0) return;
        if (event.type === 'auxclick' && event.button !== 1) return;
        if (event.type !== 'click' && event.type !== 'auxclick') return;
        var link = linkFromEvent(event);
        if (!link) return;
        if (event.type === 'click' && event.altKey) return;
        var href = link.getAttribute('href');
        if (href === null) href = link.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        if (href === null) href = link.getAttribute('xlink:href');
        if (href === null) return;
        var destination;
        try {
          destination = new URL(href, document.baseURI);
        } catch (_) {
          return;
        }
        if (destination.protocol !== 'http:' && destination.protocol !== 'https:') return;
        var sameOrigin = destination.origin === new URL(document.baseURI).origin;
        if (link.hasAttribute('download') && sameOrigin) return;
        var target = linkTarget(link);
        var openInNewContext = opensNewContext(event, link);
        if (sameOrigin && !openInNewContext) {
          if (href.trim().charAt(0) === '#') return;
          routedLinkEvents.add(event);
          routeExternalLinkAfterHandlers(event, {
            type: ${JSON.stringify(EXTENSION_NAVIGATE_SAME_ORIGIN_MESSAGE_TYPE)},
            href: destination.href,
            target: target || '_self'
          });
          return;
        }

        var request = {
          type: ${JSON.stringify(EXTENSION_OPEN_EXTERNAL_LINK_MESSAGE_TYPE)},
          href: destination.href
        };
        if (openInNewContext) request.openInNewContext = true;
        routedLinkEvents.add(event);
        routeExternalLinkAfterHandlers(event, request);
      }

      if (linkNonce && typeof Element !== 'undefined' && Element.prototype.attachShadow) {
        var nativeAttachShadow = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function(init) {
          var root = nativeAttachShadow.apply(this, arguments);
          if (init && init.mode === 'closed') {
            root.addEventListener('click', routeExternalLink, true);
            root.addEventListener('auxclick', routeExternalLink, true);
          }
          return root;
        };
      }

      document.addEventListener('click', routeExternalLink, true);
      document.addEventListener('auxclick', routeExternalLink, true);

      document.addEventListener('submit', function(event) {
        if (!linkNonce) return;
        var form = event.target;
        if (!form || form.tagName !== 'FORM') return;
        var submitter = event.submitter;
        var action = submitter && submitter.hasAttribute('formaction')
          ? submitter.formAction
          : form.action;
        try {
          var destination = new URL(action, document.baseURI);
          if (
            (destination.protocol === 'http:' || destination.protocol === 'https:') &&
            destination.origin !== new URL(document.baseURI).origin
          ) event.preventDefault();
        } catch (_) {
          event.preventDefault();
        }
      }, true);
    })();
  </script>`;
}

export function buildExtensionHtml(
  content: string,
  themeVars: string,
  isDark: boolean,
  extensionId?: string,
  binding?: ExtensionRenderBinding,
  metaCsp: string = EXTENSION_IFRAME_META_CSP,
  linkNonce?: string,
  enableExternalLinkBridge = true,
): string {
  const extensionIdJson = JSON.stringify(extensionId ?? "");
  const extensionIdAttr = escapeHtmlAttribute(extensionId ?? "");
  const bindingJson = JSON.stringify(
    binding ?? {
      authorEmail: "",
      viewerEmail: "",
      isAuthor: true,
      role: "owner",
    },
  );

  return `<!DOCTYPE html>
<html lang="en"${isDark ? ' class="dark"' : ""}>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="${metaCsp}" />
  ${binding && !binding.isAuthor ? `<meta name="agent-native-extension-author" content="${escapeHtmlAttribute(binding.authorEmail)}" />` : ""}
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300..700&display=swap" rel="stylesheet" />
  <script>
    var _extensionErrors = [];
    var _extensionErrorDetails = [];
    var _consoleLogs = [];
    var _networkLogs = [];

    var _origConsole = { log: console.log, warn: console.warn, error: console.error, info: console.info };
    function _wrapConsole(level, orig) {
      return function() {
        var args = Array.prototype.slice.call(arguments);
        var msg = args.map(function(a) {
          try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
          catch(e) { return String(a); }
        }).join(' ');
        if (_consoleLogs.length >= 50) _consoleLogs.shift();
        _consoleLogs.push({ level: level, message: msg });
        orig.apply(console, arguments);
      };
    }
    console.log = _wrapConsole('log', _origConsole.log);
    console.warn = _wrapConsole('warn', _origConsole.warn);
    console.error = _wrapConsole('error', _origConsole.error);
    console.info = _wrapConsole('info', _origConsole.info);

    function _collectError(message, stack) {
      if (!message) return;
      if (message === 'Script error.' || message === 'Script error') message = 'Runtime error';
      if (_extensionErrors.indexOf(message) !== -1) return;
      _extensionErrors.push(message);
      _extensionErrorDetails.push({ message: message, stack: stack || '' });
      _renderErrorToast();
    }

    function _renderErrorToast() {
      var toast = document.getElementById('__extension-error-toast');
      if (!toast) return;
      var msg = document.getElementById('__extension-error-msg');
      if (!msg || _extensionErrors.length === 0) return;
      if (_extensionErrors.length === 1) {
        msg.textContent = _extensionErrors[0];
      } else {
        msg.textContent = _extensionErrors.length + ' errors — ' + _extensionErrors[_extensionErrors.length - 1];
      }
      toast.style.display = 'block';
    }

    window.addEventListener('error', function(event) {
      var msg = event.message || '';
      if (msg.indexOf('Alpine Expression Error') === 0) return;
      var stack = event.error && event.error.stack ? event.error.stack : '';
      _collectError(msg, stack);
    });

    window.addEventListener('unhandledrejection', function(event) {
      var msg = event.reason && event.reason.message ? event.reason.message : String(event.reason);
      var stack = event.reason && event.reason.stack ? event.reason.stack : '';
      _collectError(msg, stack);
    });
  </script>
  ${enableExternalLinkBridge ? buildExtensionExternalLinkTargetBootstrap(linkNonce) : ""}
  <!--
    SECURITY: pinned to exact patch versions + SRI integrity hashes. A
    malicious republish of @tailwindcss/browser@4.x or alpinejs@3.x would
    otherwise inject code into every extension. To bump these versions:
      1. npm view @tailwindcss/browser version  (or alpinejs)
      2. curl -sL https://cdn.jsdelivr.net/npm/@tailwindcss/browser@<v> \\
         | openssl dgst -sha384 -binary | openssl base64 -A
      3. Update the URL + integrity hash below in lockstep.
  -->
  <script
    src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.2.4"
    integrity="sha384-yNSZBFvuOWcmww494a9+1zNuvgUGEXoWkein7cxP8wHUTi3iXCU4vJ7hr3tzBCml"
    crossorigin="anonymous"
  ></script>
  <script
    defer
    src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"
    integrity="sha384-WPtu0YHhJ3arcykfnv1JgUffWDSKRnqnDeTpJUbOc2os2moEmLkIdaeR0trPN4be"
    crossorigin="anonymous"
  ></script>
  <style>${themeVars}</style>
  <style type="text/tailwindcss">
    @custom-variant dark (&:where(.dark, .dark *));
    @theme {
      --color-border: hsl(var(--border));
      --color-input: hsl(var(--input));
      --color-ring: hsl(var(--ring));
      --color-background: hsl(var(--background));
      --color-foreground: hsl(var(--foreground));
      --color-primary: hsl(var(--primary));
      --color-primary-foreground: hsl(var(--primary-foreground));
      --color-secondary: hsl(var(--secondary));
      --color-secondary-foreground: hsl(var(--secondary-foreground));
      --color-destructive: hsl(var(--destructive));
      --color-destructive-foreground: hsl(var(--destructive-foreground));
      --color-muted: hsl(var(--muted));
      --color-muted-foreground: hsl(var(--muted-foreground));
      --color-accent: hsl(var(--accent));
      --color-accent-foreground: hsl(var(--accent-foreground));
      --color-popover: hsl(var(--popover));
      --color-popover-foreground: hsl(var(--popover-foreground));
      --color-card: hsl(var(--card));
      --color-card-foreground: hsl(var(--card-foreground));
      --color-sidebar: hsl(var(--sidebar-background));
      --color-sidebar-foreground: hsl(var(--sidebar-foreground));
      --color-sidebar-primary: hsl(var(--sidebar-primary));
      --color-sidebar-primary-foreground: hsl(var(--sidebar-primary-foreground));
      --color-sidebar-accent: hsl(var(--sidebar-accent));
      --color-sidebar-accent-foreground: hsl(var(--sidebar-accent-foreground));
      --color-sidebar-border: hsl(var(--sidebar-border));
      --color-sidebar-ring: hsl(var(--sidebar-ring));
      --radius-lg: var(--radius);
      --radius-md: calc(var(--radius) - 2px);
      --radius-sm: calc(var(--radius) - 4px);
    }
  </style>
	  <style>
	    *, *::before, *::after { border-color: hsl(var(--border)); }
	    /* Alpine only honours x-cloak when a stylesheet hides it, and extension
	       content is a body snippet that cannot supply one. Without this, an
	       x-cloak overlay paints over the whole extension until Alpine boots —
	       and forever if it never does. */
	    [x-cloak] { display: none !important; }
	    html, body {
	      /* Transparent so the iframe inherits the host surface (dashboard panel,
	         sidebar, chat) instead of painting the browser's default white canvas.
	         The dark class still flips the theme vars; content paints its own
	         bg-background / bg-card surfaces. */
	      background: transparent;
	    }
	    body {
	      --agent-native-extension-padding: clamp(16px, 2vw, 24px);
	      /* Legacy alias for pre-rename extension content (do not remove). */
	      --agent-native-tool-padding: var(--agent-native-extension-padding);
	      box-sizing: border-box;
	      color: hsl(var(--foreground));
	      font-family: 'Inter', sans-serif;
	      margin: 0;
	      padding: var(--agent-native-extension-padding);
	    }
	    body:has(> [data-extension-layout="full-bleed"]),
	    body:has(> [data-extension-padding="none"]),
	    body:has(> .agent-native-extension-bleed),
	    /* Legacy aliases (do not remove). */
	    body:has(> [data-tool-layout="full-bleed"]),
	    body:has(> [data-tool-padding="none"]),
	    body:has(> .agent-native-tool-bleed) {
	      padding: 0;
	    }
	  </style>
	  <script>
	    var _extensionRequestSeq = 0;
	    var _extensionPendingRequests = {};

	    window.addEventListener('message', function(event) {
	      if (event.source !== window.parent) return;
	      var message = event.data || {};
	      if (
	        message.type !== 'agent-native-extension-response' &&
	        message.type !== 'agent-native-tool-response'
	      ) return;
	      var pending = _extensionPendingRequests[message.requestId];
	      if (!pending) return;
	      delete _extensionPendingRequests[message.requestId];
	      if (message.error) {
	        pending.reject(new Error(message.error));
	      } else {
	        pending.resolve(message.response);
	      }
	    });

	    function hostRequest(path, options) {
	      options = options || {};
	      return new Promise(function(resolve, reject) {
	        var requestId = 'extension-req-' + (++_extensionRequestSeq);
	        _extensionPendingRequests[requestId] = { resolve: resolve, reject: reject };
	        window.parent.postMessage({
	          type: 'agent-native-extension-request',
	          requestId: requestId,
	          path: path,
	          options: {
	            method: options.method || 'GET',
	            headers: options.headers || {},
	            body: options.body,
	          },
	        }, '*');
	        setTimeout(function() {
	          var pending = _extensionPendingRequests[requestId];
	          if (!pending) return;
	          delete _extensionPendingRequests[requestId];
	          pending.reject(new Error('Extension host request timed out'));
	        }, 30000);
	      });
	    }

	    var _origHostRequest = hostRequest;
	    hostRequest = function(path, options) {
	      var entry = { path: path, method: (options && options.method) || 'GET' };
	      return _origHostRequest(path, options).then(function(res) {
	        entry.ok = res.ok;
	        entry.status = res.status;
	        if (!res.ok && res.body) {
	          try { entry.error = typeof res.body === 'string' ? res.body.slice(0, 200) : JSON.stringify(res.body).slice(0, 200); } catch(e) {}
	        }
	        if (_networkLogs.length >= 20) _networkLogs.shift();
	        _networkLogs.push(entry);
	        return res;
	      }, function(err) {
	        entry.ok = false;
	        entry.error = err.message;
	        if (_networkLogs.length >= 20) _networkLogs.shift();
	        _networkLogs.push(entry);
	        throw err;
	      });
	    };

	    function extensionFetch(url, options) {
	      var opts = options || {};
	      return hostRequest('/_agent-native/extensions/proxy', {
	        method: 'POST',
	        headers: { 'Content-Type': 'application/json' },
	        body: JSON.stringify({
	          url: url,
          method: opts.method || 'GET',
          headers: opts.headers,
          body: opts.body,
        }),
	      }).then(function(res) {
	        var data = res.body;
	          if (data.error && data.status === undefined) {
	            throw new Error(data.error);
	          }
          return {
            ok: data.status >= 200 && data.status < 300,
            status: data.status,
	            json: function() { return Promise.resolve(data.body); },
	            text: function() { return Promise.resolve(typeof data.body === 'string' ? data.body : JSON.stringify(data.body)); },
	          };
	      });
	    }

	    function _appendActionQuery(path, params) {
	      var search = new URLSearchParams();
	      params = params || {};
	      Object.keys(params).forEach(function(key) {
	        var value = params[key];
	        if (value === undefined || value === null) return;
	        if (Array.isArray(value)) {
	          value.forEach(function(item) {
	            if (item !== undefined && item !== null) {
	              search.append(key, String(item));
	            }
	          });
	          return;
	        }
	        search.set(key, String(value));
	      });
	      var qs = search.toString();
	      return qs ? path + '?' + qs : path;
	    }

	    function _methodHintFromActionResponse(res) {
	      if (!res || res.status !== 405) return null;
	      var body = res.body || {};
	      var message = typeof body === 'string' ? body : body.error;
	      if (!message) return null;
	      var match = String(message).match(/Use (GET|POST|PUT|PATCH|DELETE|HEAD)\\.?/i);
	      return match ? match[1].toUpperCase() : null;
	    }

	    async function appAction(name, params) {
	      params = params || {};
	      if (name === 'navigate') {
	        var navRes = await hostRequest('/_agent-native/application-state/navigate', {
	          method: 'PUT',
	          headers: { 'Content-Type': 'application/json' },
	          body: JSON.stringify(params),
	        });
	        if (!navRes.ok) {
	          var navErr = navRes.body || { error: navRes.statusText };
	          throw new Error(navErr.error || 'Navigation failed: ' + navRes.status);
	        }
	        return navRes.body;
	      }
	      var path = '/_agent-native/actions/' + encodeURIComponent(name);
	      var res = await hostRequest(path, {
	        method: 'POST',
	        headers: { 'Content-Type': 'application/json' },
	        body: JSON.stringify(params),
	      });

	      var retryMethod = _methodHintFromActionResponse(res);
	      if (!res.ok && retryMethod && retryMethod !== 'POST') {
	        var retryPath = path;
	        var retryOptions = {
	          method: retryMethod,
	          headers: { 'Content-Type': 'application/json' },
	        };
	        if (retryMethod === 'GET' || retryMethod === 'HEAD') {
	          retryPath = _appendActionQuery(path, params);
	        } else {
	          retryOptions.body = JSON.stringify(params);
	        }
	        res = await hostRequest(retryPath, retryOptions);
	      }

	      if (!res.ok) {
	        var err = res.body || {};
	        var rawError = typeof err === 'string' ? err : err.error;
	        var message = (typeof rawError === 'string' && rawError.trim())
	          ? rawError
	          : (res.status === 404
	            ? "Action '" + name + "' is not available over HTTP (404). It may be agent-only (http: false); expose it with an HTTP-mounted action to call it from an extension."
	            : "Action '" + name + "' failed (" + (res.status || 'network error') + ")");
	        throw new Error(message);
	      }
	      return res.body;
	    }

    var mcp = {
      listTools: function(serverId) {
        var params = serverId ? { serverId: String(serverId) } : {};
        return appAction('list-mcp-tools', params);
      },
      callTool: function(serverId, toolName, args) {
        if (!serverId || !toolName) {
          return Promise.reject(new Error('MCP serverId and toolName are required'));
        }
        return appAction('call-mcp-tool', {
          serverId: String(serverId),
          toolName: String(toolName),
          arguments: args || {},
        });
      },
    };

    var providerApi = {
      catalog: function(params) {
        return appAction('provider-api-catalog', params || {});
      },
      docs: function(params) {
        return appAction('provider-api-docs', params || {});
      },
    };

    async function appFetch(path, options) {
	      options = options || {};
	      var res = await hostRequest(path, {
	        ...options,
	        headers: {
	          'Content-Type': 'application/json',
	          ...(options.headers || {}),
	        },
	      });
	      if (!res.ok) {
	        var err = typeof res.body === 'object' && res.body ? res.body : { error: res.statusText };
	        throw new Error(err.error || 'Request failed: ' + res.status);
	      }
	      return res.body;
	    }

	    function sendToChat(message, options) {
	      options = options || {};
	      var text = typeof message === 'string' ? message : JSON.stringify(message);
	      window.parent.postMessage({
	        type: 'agent-native-send-to-chat',
	        message: text,
	        context: options.context,
	        // Extension code can run polling and error handlers without a user
	        // gesture; submitting is opt-in for an explicit user action.
	        submit: options.submit === true,
	        openSidebar: options.openSidebar !== false,
	      }, '*');
	      return { ok: true };
	    }

	    function inlineUiOutputKey() {
	      var safeId = String(_extensionId || 'unknown').replace(/[^A-Za-z0-9_:-]/g, '') || 'unknown';
	      return 'inline-ui:' + safeId + ':output';
	    }

	    async function outputToUi(value, options) {
	      options = options || {};
	      var key = inlineUiOutputKey();
	      var payload = {
	        value: value,
	        updatedAt: new Date().toISOString(),
	        extensionId: _extensionId,
	        source: 'inline-ui',
	      };
	      if (options.label !== undefined) payload.label = options.label;
	      if (options.context !== undefined) payload.context = options.context;
	      if (options.meta !== undefined) payload.meta = options.meta;
	      var output = await appFetch('/_agent-native/application-state/' + key, {
	        method: 'PUT',
	        headers: { 'X-Request-Source': 'inline-ui' },
	        body: JSON.stringify(payload),
	      });
	      try {
	        window.parent.postMessage({
	          type: 'agent-native-ui-output',
	          extensionId: _extensionId,
	          key: key,
	          value: value,
	          output: output,
	        }, '*');
	      } catch (_) {}
	      return { ok: true, key: key, output: output };
	    }

    async function dbQuery(sql, args) {
      var body = { sql: sql };
      if (args) body.args = args;
      return appFetch('/_agent-native/extensions/sql/query', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    }

    async function dbExec(sql, args) {
      var body = { sql: sql };
      if (args) body.args = args;
      return appFetch('/_agent-native/extensions/sql/exec', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    }

    var _extensionId = ${extensionIdJson};
    var _extensionBinding = ${bindingJson};
    // Proves an open-url request comes from this shell document, not from a
    // page the iframe later navigated to. Announced with the binding below.
    // Without secure randomness there is no token, the host never offers to
    // open links, and links keep their native behavior.
    var _openUrlToken =
      window.crypto && typeof window.crypto.getRandomValues === 'function'
        ? Array.prototype.map.call(window.crypto.getRandomValues(new Uint8Array(16)), function(b) {
            return ('0' + b.toString(16)).slice(-2);
          }).join('')
        : '';
    window.extensionBinding = _extensionBinding;
    // Legacy alias for extension bodies authored before the rename.
    window.toolBinding = _extensionBinding;
    // SECURITY (audit H4): announce the resolved binding to the parent so the
    // host bridge can gate dangerous helpers based on viewer role. Sent
    // BEFORE the user-authored content has a chance to run, so a malicious
    // extension body cannot suppress or rewrite the announcement. The parent
    // ignores subsequent announcements for the same iframe; see
    // ExtensionViewer.tsx / EmbeddedExtension.tsx.
    try {
      window.parent.postMessage(
        {
          type: 'agent-native-extension-binding',
          extensionId: _extensionId,
          binding: _extensionBinding,
          openUrlToken: _openUrlToken,
        },
        '*',
      );
    } catch (_) {}
    // A tab opened from this sandboxed iframe inherits the sandbox (an opaque
    // origin with no cookies), so apps like HubSpot render blank. Once the host
    // says it can, hand new-tab web links to it: it opens them unsandboxed with
    // noopener, so the new tab gets no handle on the host page. Without that
    // reply (no host, a standalone /render, or no token) links stay native, and
    // window.open is never touched. Set up here, before extension content runs,
    // so the reply can't be missed and extension globals can't interfere.
    (function(token) {
      if (!token) return;
      var hostOpensLinks = false;
      window.addEventListener('message', function(event) {
        if (event.source !== window.parent) return;
        var msg = event.data;
        if (msg && msg.type === 'agent-native-extension-open-url-ready') hostOpensLinks = true;
      });
      function linkOf(e) {
        var path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
        for (var i = 0; i < path.length; i++) {
          var node = path[i];
          if (node instanceof HTMLAnchorElement || node instanceof HTMLAreaElement) {
            if (node.hasAttribute('href')) return { element: node, url: node };
          } else if (node && node.namespaceURI === 'http://www.w3.org/2000/svg' && node.localName === 'a') {
            // An SVG link's href isn't a URL string; resolve it the way an HTML
            // link would, against the document's base URL.
            var raw = node.getAttribute('href') || node.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
            if (raw) {
              var resolved = document.createElement('a');
              resolved.href = raw;
              return { element: node, url: resolved };
            }
          }
        }
        return null;
      }
      function targetOf(link) {
        if (link.hasAttribute('target')) return link.getAttribute('target');
        var base = document.querySelector('base[target]');
        return base ? base.getAttribute('target') : '';
      }
      function route(e) {
        if (window.__agentNativeExternalLinkBridgeActive || !hostOpensLinks || !e.isTrusted || e.defaultPrevented) return;
        if (e.type === 'click' && e.button !== 0) return;
        if (e.type === 'auxclick' && e.button !== 1) return;
        if (e.type !== 'click' && e.type !== 'auxclick') return;
        var link = linkOf(e);
        if (!link || link.element.hasAttribute('download')) return;
        if (link.url.protocol !== 'http:' && link.url.protocol !== 'https:') return;
        var newTab = e.type === 'auxclick'
          ? e.button === 1
          : e.button === 0 && !e.altKey &&
            (e.metaKey || e.ctrlKey || e.shiftKey || /^_blank$/i.test(targetOf(link.element)));
        if (!newTab) return;
        e.preventDefault();
        window.parent.postMessage({ type: 'agent-native-extension-open-url', url: link.url.href, token: token }, '*');
      }
      // On window, so extension handlers delegated on document run first.
      window.addEventListener('click', route);
      window.addEventListener('auxclick', route);
    })(_openUrlToken);
    // SECURITY: when the viewer is not the author of this extension, emit a
    // clear console warning. The bridge currently runs every helper with the
    // viewer's session — a malicious shared extension can call any action,
    // read any owned table row in scope, and resolve any user-scope secret.
    // A full consent step is tracked as TODO C1 in audit 05-tools-sandbox.md.
    if (_extensionBinding && !_extensionBinding.isAuthor) {
      try {
        console.warn(
          '[agent-native] Shared extension — running with viewer\\'s session. ' +
            'Author: ' + (_extensionBinding.authorEmail || '<unknown>') + '. ' +
            'Bridge calls (appAction, dbExec, extensionFetch) execute under ' +
            'your account; they are gated by your permissions, not the ' +
            'author\\'s. Do not run untrusted shared extensions.',
        );
      } catch (_) {}
    }

    var extensionData = {
	      async list(collection, opts) {
	        var limit = (opts && opts.limit) || 100;
	        var scope = (opts && opts.scope) || 'user';
	        var res = await hostRequest('/_agent-native/extensions/data/' + _extensionId + '/' + encodeURIComponent(collection) + '?limit=' + limit + '&scope=' + scope);
	        if (!res.ok) throw new Error('Failed to list extension data');
	        return res.body;
	      },
      async get(collection, id, opts) {
        var scope = (opts && opts.scope) || 'user';
        var items = await this.list(collection, { scope: scope });
        return (items || []).find(function(item) { return item.id === id; }) || null;
      },
      async set(collection, id, data, opts) {
	        var scope = (opts && opts.scope) || 'user';
	        var res = await hostRequest('/_agent-native/extensions/data/' + _extensionId + '/' + encodeURIComponent(collection), {
	          method: 'POST',
	          headers: { 'Content-Type': 'application/json' },
	          body: JSON.stringify({ id: id, data: data, scope: scope }),
	        });
	        if (!res.ok) throw new Error('Failed to save extension data');
	        return res.body;
	      },
	      async remove(collection, id, opts) {
	        var scope = (opts && opts.scope) || 'user';
	        var res = await hostRequest('/_agent-native/extensions/data/' + _extensionId + '/' + encodeURIComponent(collection) + '/' + encodeURIComponent(id) + '?scope=' + scope, {
	          method: 'DELETE',
	        });
	        if (!res.ok) throw new Error('Failed to delete extension data');
	        return res.body;
	      },
	    };

	    // Legacy aliases — extension bodies authored before the rename use
	    // toolFetch, toolData, toolId. Keep these working forever.
	    var toolFetch = extensionFetch;
	    var toolData = extensionData;
	    var _toolId = _extensionId;
	    window.agentNative = Object.assign(window.agentNative || {}, {
	      extensionId: _extensionId,
	      extensionBinding: _extensionBinding,
	      appAction: appAction,
	      appFetch: appFetch,
	      dbQuery: dbQuery,
	      dbExec: dbExec,
	      extensionFetch: extensionFetch,
	      extensionData: extensionData,
	      data: extensionData,
	      mcp: mcp,
	      providerApi: providerApi,
	      connectors: Object.assign({}, (window.agentNative && window.agentNative.connectors) || {}, {
	        mcp: mcp,
	        providerApi: providerApi,
	      }),
	      sendToChat: sendToChat,
	      chat: Object.assign({}, (window.agentNative && window.agentNative.chat) || {}, {
	        send: sendToChat,
	      }),
	      ui: Object.assign({}, (window.agentNative && window.agentNative.ui) || {}, {
	        output: outputToUi,
	      }),
	    });
	    window.sendToAgentChat = sendToChat;
	  </script>
	  <style>
	    #__extension-error-toast {
	      display: none;
	      position: fixed;
	      bottom: 16px;
	      right: 16px;
	      max-width: 420px;
	      background: hsl(var(--destructive));
	      color: hsl(var(--destructive-foreground));
	      border: 1px solid hsl(var(--destructive) / .6);
	      border-radius: calc(var(--radius, .5rem) + 2px);
	      padding: 12px 16px;
	      font-size: 13px;
	      line-height: 1.4;
	      font-family: 'Inter', sans-serif;
	      z-index: 9999;
	      box-shadow: 0 4px 12px rgba(0,0,0,.15), 0 1px 3px rgba(0,0,0,.1);
	      animation: __toast-in 0.2s ease-out;
	    }
	    @keyframes __toast-in {
	      from { opacity: 0; transform: translateY(8px); }
	      to { opacity: 1; transform: translateY(0); }
	    }
	  </style>
	  <script>
	    // Extension-point slot context: when an extension is rendered embedded
	    // inside an ExtensionSlot, the host pushes a context object via
	    // postMessage. Extensions read it synchronously via window.slotContext
	    // or subscribe to changes via window.onSlotContext(fn). When rendered
	    // full-page (no ?slot= param), slotContext stays null and extensions
	    // branch on that.
	    window.slotContext = null;
	    var _slotContextSubscribers = [];
	    window.onSlotContext = function(fn) {
	      _slotContextSubscribers.push(fn);
	      if (window.slotContext !== null) {
	        try { fn(window.slotContext); } catch(_) {}
	      }
	      return function() {
	        _slotContextSubscribers = _slotContextSubscribers.filter(function(f) { return f !== fn; });
	      };
	    };
	    window.addEventListener('message', function(event) {
	      if (event.source !== window.parent) return;
	      var msg = event.data;
	      if (!msg || msg.type !== 'agent-native-slot-context') return;
	      window.slotContext = msg.context || {};
	      _slotContextSubscribers.forEach(function(fn) {
	        try { fn(window.slotContext); } catch(_) {}
	      });
	    });

	    // Auto-resize iframe renders. Persisted extension slots include ?slot=;
	    // transient inline chat UI uses srcdoc, so detect that by parent frame.
	    // The host listens for agent-native-extension-resize and adjusts height.
	    if (new URLSearchParams(location.search).get('slot') || window.parent !== window) {
      var _ro = null;
      var _positionedElements = new Set();
      var _motionElements = new Set();
      var _observedPositionedElements = new Set();
	      var _isExcludedFromHeight = function(element, body) {
	        if (!element) return false;
	        if (window.getComputedStyle(element).position === 'fixed') return true;
	        var current = element.parentElement;
        while (current && current !== body) {
	          var style = window.getComputedStyle(current);
	          if (
	            style.position === 'fixed' ||
	            /^(?:auto|scroll|overlay|hidden|clip)$/.test(style.overflowY)
	          ) return true;
	          current = current.parentElement;
	        }
	        return false;
	      };
	      var _trackPositionedElement = function(element) {
	        if (!element || element.nodeType !== 1 || _motionElements.has(element)) {
	          return false;
	        }
	        _motionElements.add(element);
	        return true;
	      };
      var _observePositioned = function() {
        if (!document.body) return;
        _positionedElements.clear();
        _motionElements.forEach(function(element) {
          if (!document.body.contains(element)) _motionElements.delete(element);
        });
        var _nextObservedPositionedElements = new Set();
        if (_ro) {
          _ro.observe(document.documentElement);
          _ro.observe(document.body);
        }
        Array.prototype.forEach.call(document.body.querySelectorAll('*'), function(element) {
	          var style = window.getComputedStyle(element);
		          if (style.position !== 'static' || style.transform !== 'none') {
		            _positionedElements.add(element);
          }
          if (_ro && style.position === 'absolute') {
            _ro.observe(element);
            _nextObservedPositionedElements.add(element);
          }
        });
        if (_ro && typeof _ro.unobserve === 'function') {
          _observedPositionedElements.forEach(function(element) {
            if (!_nextObservedPositionedElements.has(element)) {
              _ro.unobserve(element);
            }
          });
        }
        _observedPositionedElements = _nextObservedPositionedElements;
	      };
	      var _enqueueResizeWork = function(callback) {
	        if (typeof window.requestAnimationFrame === 'function') {
	          window.requestAnimationFrame(callback);
	        } else {
	          window.setTimeout(callback, 16);
	        }
	      };
	      var _resizeWorkScheduled = false;
	      var _positionObservationScheduled = false;
	      var _positionMonitorScheduled = false;
	      var _positionMonitorActive = false;
	      var _activeCssMotionCount = 0;
      // ponytail: cap polling for motion without a reliable completion signal.
      var _positionMonitorFramesRemaining = 0;
	      var _activeAnimations = function() {
	        if (typeof document.getAnimations !== 'function') return null;
	        var animations;
	        try {
	          animations = document.getAnimations();
		          // coercion-ok: animation introspection can be unavailable; CSS events remain authoritative.
		        } catch (_) {
	          return null;
	        }
	        var active = [];
	        for (var i = 0; i < animations.length; i++) {
	          if (
	            animations[i].playState === 'running' ||
	            animations[i].playState === 'pending'
	          ) {
	            active.push(animations[i]);
	          }
	        }
	        return active;
	      };
	      var _scheduleResizeWork = function() {
	        if (_resizeWorkScheduled) return;
	        _resizeWorkScheduled = true;
	        _enqueueResizeWork(function() {
	          _resizeWorkScheduled = false;
	          _reportHeight();
	        });
	      };
	      var _watchedAnimations = [];
	      var _removeWatchedAnimation = function(animation) {
	        var index = _watchedAnimations.indexOf(animation);
	        if (index !== -1) _watchedAnimations.splice(index, 1);
	      };
	      var _watchAnimationCompletion = function(animation) {
	        if (_watchedAnimations.indexOf(animation) !== -1) return false;
	        _watchedAnimations.push(animation);
	        try {
	          var finished = animation.finished;
          if (finished && typeof finished.then === 'function') {
            finished.then(function() {
              _removeWatchedAnimation(animation);
              _reportHeight();
              _motionElements.delete(animation.effect && animation.effect.target);
              _scheduleResizeWork();
            }, function() {
              _removeWatchedAnimation(animation);
              _reportHeight();
              _motionElements.delete(animation.effect && animation.effect.target);
              _scheduleResizeWork();
            });
	          }
	        } catch (_) {
	          _removeWatchedAnimation(animation);
	        }
	        return true;
	      };
	      var _schedulePositionObservation = function() {
	        if (_positionObservationScheduled) return;
	        _positionObservationScheduled = true;
	        _enqueueResizeWork(function() {
	          _positionObservationScheduled = false;
	          _observePositioned();
	        });
	      };
      var _schedulePositionMonitor = function() {
        if (!_positionMonitorActive) return;
        if (_positionMonitorScheduled) return;
        _positionMonitorScheduled = true;
        _enqueueResizeWork(function() {
          _positionMonitorScheduled = false;
          if (!_positionMonitorActive) return;
          var body = document.body;
          if (!body) return;
          _reportHeight();
          var animations = _activeAnimations();
          var hasFiniteAnimation = false;
          var hasIndefiniteAnimation =
            animations === null || _activeCssMotionCount > 0;
          if (animations) {
            animations.forEach(function(animation) {
              var effect = animation.effect;
              _trackPositionedElement(effect && effect.target);
              _watchAnimationCompletion(animation);
              var timing =
                effect && typeof effect.getComputedTiming === 'function'
                  ? effect.getComputedTiming()
                  : null;
              if (timing && timing.endTime !== Infinity) {
                hasFiniteAnimation = true;
              } else {
                hasIndefiniteAnimation = true;
              }
            });
          }
          if (hasFiniteAnimation || hasIndefiniteAnimation) {
            _positionMonitorFramesRemaining -= 1;
          }
          if (
            (hasFiniteAnimation || hasIndefiniteAnimation) &&
            _positionMonitorFramesRemaining > 0
          ) {
            _schedulePositionMonitor();
            return;
          }
          _positionMonitorActive = false;
          if (!hasFiniteAnimation && !hasIndefiniteAnimation) {
            _motionElements.clear();
          }
          _scheduleResizeWork();
        });
      };
	      var _startPositionMonitor = function(event) {
	        _trackPositionedElement(event && event.target);
	        if (
            event &&
            (event.type === 'animationstart' ||
              event.type === 'transitionrun')
	        ) {
	          _activeCssMotionCount += 1;
	        }
	        _positionMonitorActive = true;
        _positionMonitorFramesRemaining = 120;
        _schedulePositionObservation();
	        _scheduleResizeWork();
        _schedulePositionMonitor();
        if (typeof _scheduleAnimationProbe === 'function') {
          _scheduleAnimationProbe();
        }
      };
	      var _startPositionMonitorIfActive = function() {
	        var animations = _activeAnimations();
	        if (animations && animations.length) {
	          var newlyObserved = false;
	          animations.forEach(function(animation) {
	            var effect = animation.effect;
            _trackPositionedElement(effect && effect.target);
            if (_watchAnimationCompletion(animation)) newlyObserved = true;
          });
	          if (newlyObserved) _startPositionMonitor();
          else if (_positionMonitorActive) _schedulePositionMonitor();
        }
      };
      var _finishPositionMonitor = function(event) {
        if (_activeCssMotionCount > 0) _activeCssMotionCount -= 1;
	        var animations = _activeAnimations();
	        if (animations) {
	          animations.forEach(function(animation) {
	            var effect = animation.effect;
	            _trackPositionedElement(effect && effect.target);
	          });
	        }
        _positionMonitorActive =
          (animations && animations.length > 0) ||
          (animations === null && _activeCssMotionCount > 0);
        if (!_positionMonitorActive) {
          _reportHeight();
          _motionElements.clear();
        }
        _scheduleResizeWork();
        if (_positionMonitorActive) _schedulePositionMonitor();
      };
      if (
        typeof Element !== 'undefined' &&
        typeof Element.prototype.animate === 'function'
      ) {
        var _nativeAnimate = Element.prototype.animate;
        Element.prototype.animate = function() {
          var animation = _nativeAnimate.apply(this, arguments);
          _trackPositionedElement(this);
          _watchAnimationCompletion(animation);
          _startPositionMonitor();
          return animation;
        };
      }
      var _lastH = null;
      var _measurePositionedContent = function(body, bodyTop) {
        var bottom = 0;
        var measure = function(element) {
          if (!element || !body.contains(element) || _isExcludedFromHeight(element, body)) {
            return;
          }
          bottom = Math.max(bottom, element.getBoundingClientRect().bottom - bodyTop);
        };
        _positionedElements.forEach(measure);
        _motionElements.forEach(measure);
        return bottom;
      };
      var _reportHeight = function() {
        try {
          var body = document.body;
          if (!body) return;
          var bodyRect = body.getBoundingClientRect();
          var bodyStyle = window.getComputedStyle(body);
          var paddingTop = parseFloat(bodyStyle.paddingTop) || 0;
          var paddingBottom = parseFloat(bodyStyle.paddingBottom) || 0;
          var contentBottom = Math.max(
            paddingTop,
            bodyRect.height - paddingBottom,
            _measurePositionedContent(body, bodyRect.top),
          );
          var h = Math.ceil(contentBottom + paddingBottom);
          if (h !== _lastH) {
            _lastH = h;
            window.parent.postMessage({ type: 'agent-native-extension-resize', height: h }, '*');
          }
          // coercion-ok: transient measurement failures are retried by later reports.
        } catch (_) {}
      };
	      window.addEventListener('scroll', _scheduleResizeWork, true);
	      window.addEventListener('resize', _scheduleResizeWork);
	      document.addEventListener('animationstart', _startPositionMonitor, true);
	      document.addEventListener('transitionrun', _startPositionMonitor, true);
	      document.addEventListener('transitionstart', _startPositionMonitor, true);
	      document.addEventListener('animationend', _finishPositionMonitor, true);
	      document.addEventListener('animationcancel', _finishPositionMonitor, true);
	      document.addEventListener('transitionend', _finishPositionMonitor, true);
	      document.addEventListener('transitioncancel', _finishPositionMonitor, true);
	      if (typeof ResizeObserver !== 'undefined') {
	        _ro = new ResizeObserver(_scheduleResizeWork);
		        document.addEventListener('DOMContentLoaded', function() {
		          _observePositioned();
		          _scheduleResizeWork();
		          _startPositionMonitorIfActive();
	          if (typeof MutationObserver !== 'undefined' && document.body) {
	            new MutationObserver(function() {
	              _schedulePositionObservation();
	              _scheduleResizeWork();
	              _startPositionMonitorIfActive();
	            }).observe(document.body, {
	              attributes: true,
	              characterData: true,
	              childList: true,
	              subtree: true,
	            });
	          }
	        });
	      } else {
	        setInterval(function() {
	          _observePositioned();
	          _reportHeight();
	        }, 1000);
	      }
	      // Initial reports — Alpine takes a tick to render after DOMContentLoaded.
	      setTimeout(_reportHeight, 50);
	      setTimeout(_reportHeight, 250);
	      var _animationProbeTimer = null;
      var _scheduleAnimationProbe = function() {
        if (_animationProbeTimer !== null) return;
        _animationProbeTimer = window.setTimeout(function() {
          _animationProbeTimer = null;
          _startPositionMonitorIfActive();
          var animations = _activeAnimations();
          if ((animations && animations.length) || _positionMonitorActive) {
            _scheduleAnimationProbe();
          }
        }, 250);
      };
	      if (typeof document.getAnimations === 'function') _scheduleAnimationProbe();
	    }

	    window.addEventListener('message', function(event) {
	      if (event.source !== window.parent) return;
	      var msg = event.data;
	      if (!msg || msg.type !== 'agent-native-theme-update') return;
	      var root = document.documentElement;
	      if (msg.isDark !== undefined) {
	        if (msg.isDark) root.classList.add('dark');
	        else root.classList.remove('dark');
	      }
	      var vars = msg.vars || {};
	      for (var key in vars) {
	        if (vars.hasOwnProperty(key)) {
	          root.style.setProperty(key, vars[key]);
	        }
	      }
	    });

	    document.addEventListener('keydown', function(e) {
	      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
	        var key = (e.key || '').toLowerCase();
	        if (key === 'c' || key === 'v' || key === 'x' || key === 'a' || key === 'z' || key === 'y') return;
	        e.preventDefault();
	        e.stopPropagation();
	        window.parent.postMessage({
	          type: 'agent-native-extension-keydown',
	          key: e.key, code: e.code,
	          metaKey: e.metaKey, ctrlKey: e.ctrlKey,
	          shiftKey: e.shiftKey, altKey: e.altKey,
	        }, '*');
	        return;
	      }
	      if (e.key === 'Escape') {
	        window.parent.postMessage({
	          type: 'agent-native-extension-keydown',
	          key: e.key, code: e.code,
	          metaKey: false, ctrlKey: false,
	          shiftKey: false, altKey: false,
	        }, '*');
	      }
	    });

	    document.addEventListener('DOMContentLoaded', function() {
	      _renderErrorToast();
	      var fixBtn = document.getElementById('__extension-error-fix');
	      if (fixBtn) {
	        fixBtn.addEventListener('click', function() {
	          window.parent.postMessage({
	            type: 'agent-native-extension-error-fix',
	            errors: _extensionErrors,
	            errorDetails: _extensionErrorDetails,
	            consoleLogs: _consoleLogs.slice(-30),
	            networkLogs: _networkLogs.slice(-15)
	          }, '*');
	          document.getElementById('__extension-error-toast').style.display = 'none';
	        });
	      }
	      var dismissBtn = document.getElementById('__extension-error-dismiss');
	      if (dismissBtn) {
	        dismissBtn.addEventListener('click', function() {
	          document.getElementById('__extension-error-toast').style.display = 'none';
	        });
	      }
	    });
	  </script>
	${buildSessionReplayIframeBootstrap()}
	</head>
	<body${extensionId ? ` data-extension-id="${extensionIdAttr}" data-tool-id="${extensionIdAttr}"` : ""} class="text-foreground">
	${content}
	<div id="__extension-error-toast">
	  <div style="display:flex;align-items:flex-start;gap:8px;">
	    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
	    <span id="__extension-error-msg" style="flex:1;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;"></span>
	    <button id="__extension-error-fix" style="cursor:pointer;border:none;background:rgba(255,255,255,.9);color:hsl(0 84.2% 40%);font-size:12px;font-weight:500;padding:4px 12px;border-radius:4px;flex-shrink:0;">Fix</button>
	    <button id="__extension-error-dismiss" style="cursor:pointer;border:none;background:transparent;color:inherit;font-size:16px;padding:2px 6px;opacity:0.7;flex-shrink:0;">&#215;</button>
	  </div>
	</div>
	</body>
	</html>`;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
