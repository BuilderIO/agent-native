export const EXTENSION_IFRAME_CSP =
  "default-src 'none'; script-src 'self' https://cdn.jsdelivr.net 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self';";

export const EXTENSION_IFRAME_META_CSP = EXTENSION_IFRAME_CSP.replace(
  /\s*frame-ancestors 'self';?$/,
  "",
);

/**
 * SECURITY — EXTENSION CONTENT IS UNTRUSTED.
 *
 * `${content}` (line ~Body) interpolates raw HTML/JS authored by a user. This
 * file is the boundary between framework-controlled HTML and user-controlled
 * HTML. Two non-negotiable invariants for every change here:
 *
 *   1. The iframe MUST be rendered with a `sandbox` attribute that does NOT
 *      include `allow-same-origin`. The viewer (`ExtensionViewer.tsx`,
 *      `EmbeddedExtension.tsx`) sets `sandbox="allow-scripts allow-forms"` —
 *      and that is the only acceptable shape. Adding `allow-same-origin`
 *      would give the extension full DOM access to the parent window via
 *      cross-frame script.
 *
 *   2. Every reachable parent action must treat the postMessage payload as
 *      hostile. The bridge in `iframe-bridge.ts` enforces a path allowlist,
 *      header sanitization, and method allowlist; do not relax those gates
 *      for "convenience" in this file or any caller.
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
  /** Email of the user who authored / owns the extension. */
  authorEmail: string;
  /** Email of the user currently viewing/running the extension. */
  viewerEmail: string;
  /** True when viewer === author. */
  isAuthor: boolean;
  /**
   * Resolved role for the viewer ("owner" | "admin" | "editor" | "viewer").
   *
   * TODO(security, audit H4): the host-side bridge does not yet gate any
   * helper based on this value — every viewer gets the same powers as the
   * author. The role is plumbed through so a follow-up PR can constrain
   * `appAction` / `dbExec` / `extensionFetch` for non-author viewers (and
   * eventually require an explicit consent step before running a shared
   * extension, audit C1). For now this is metadata only.
   */
  role: "owner" | "admin" | "editor" | "viewer";
}

export function buildExtensionHtml(
  content: string,
  themeVars: string,
  isDark: boolean,
  extensionId?: string,
  binding?: ExtensionRenderBinding,
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
  <meta http-equiv="Content-Security-Policy" content="${EXTENSION_IFRAME_META_CSP}" />
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
      var toast = document.getElementById('__extension-error-toast');
      if (!toast) return;
      var msg = document.getElementById('__extension-error-msg');
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
	    body {
	      --agent-native-extension-padding: clamp(16px, 2vw, 24px);
	      /* Legacy alias for pre-rename extension content (do not remove). */
	      --agent-native-tool-padding: var(--agent-native-extension-padding);
	      box-sizing: border-box;
	      font-family: 'Inter', sans-serif;
	      margin: 0;
	      min-height: 100vh;
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

	    async function appAction(name, params) {
	      params = params || {};
	      var res = await hostRequest('/_agent-native/actions/' + encodeURIComponent(name), {
	        method: 'POST',
	        headers: { 'Content-Type': 'application/json' },
	        body: JSON.stringify(params),
	      });
	      if (!res.ok) {
	        var err = res.body || { error: res.statusText };
	        throw new Error(err.error || 'Action failed: ' + res.status);
	      }
	      return res.body;
	    }

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
        },
        '*',
      );
    } catch (_) {}
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
	    // `toolFetch`, `toolData`, `toolId`. Keep these working forever.
	    var toolFetch = extensionFetch;
	    var toolData = extensionData;
	    var _toolId = _extensionId;
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

	    // Auto-resize the iframe to its content when running in slot mode. The
	    // host listens for agent-native-extension-resize and adjusts the iframe height.
	    if (new URLSearchParams(location.search).get('slot')) {
	      var _lastH = 0;
	      var _reportHeight = function() {
	        var h = Math.max(
	          document.documentElement.scrollHeight,
	          document.body ? document.body.scrollHeight : 0,
	        );
	        if (h !== _lastH) {
	          _lastH = h;
	          window.parent.postMessage({ type: 'agent-native-extension-resize', height: h }, '*');
	        }
	      };
	      if (typeof ResizeObserver !== 'undefined') {
	        var _ro = new ResizeObserver(_reportHeight);
	        document.addEventListener('DOMContentLoaded', function() {
	          _ro.observe(document.documentElement);
	          if (document.body) _ro.observe(document.body);
	        });
	      }
	      // Initial reports — Alpine takes a tick to render after DOMContentLoaded.
	      setTimeout(_reportHeight, 50);
	      setTimeout(_reportHeight, 250);
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
	        var key = e.key.toLowerCase();
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
	</head>
	<body${extensionId ? ` data-extension-id="${extensionIdAttr}" data-tool-id="${extensionIdAttr}"` : ""} class="bg-background text-foreground">
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
