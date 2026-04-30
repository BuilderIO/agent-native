export const TOOL_IFRAME_CSP =
  "default-src 'none'; script-src 'self' https://cdn.jsdelivr.net 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self';";

export const TOOL_IFRAME_META_CSP = TOOL_IFRAME_CSP.replace(
  /\s*frame-ancestors 'self';?$/,
  "",
);

/**
 * SECURITY — TOOL CONTENT IS UNTRUSTED.
 *
 * `${content}` (line ~Body) interpolates raw HTML/JS authored by a user. This
 * file is the boundary between framework-controlled HTML and user-controlled
 * HTML. Two non-negotiable invariants for every change here:
 *
 *   1. The iframe MUST be rendered with a `sandbox` attribute that does NOT
 *      include `allow-same-origin`. The viewer (`ToolViewer.tsx`,
 *      `EmbeddedTool.tsx`) sets `sandbox="allow-scripts allow-forms"` — and
 *      that is the only acceptable shape. Adding `allow-same-origin` would
 *      give the tool full DOM access to the parent window via cross-frame
 *      script.
 *
 *   2. Every reachable parent action must treat the postMessage payload as
 *      hostile. The bridge in `iframe-bridge.ts` enforces a path allowlist,
 *      header sanitization, and method allowlist; do not relax those gates
 *      for "convenience" in this file or any caller.
 *
 * For the trust model rationale, see audit 05-tools-sandbox.md (C1) and the
 * `tools` skill. When in doubt, fail closed.
 */

export interface ToolRenderBinding {
  /** Email of the user who authored / owns the tool. */
  authorEmail: string;
  /** Email of the user currently viewing/running the tool. */
  viewerEmail: string;
  /** True when viewer === author. */
  isAuthor: boolean;
  /**
   * Resolved role for the viewer ("owner" | "admin" | "editor" | "viewer").
   *
   * TODO(security, audit H4): the host-side bridge does not yet gate any
   * helper based on this value — every viewer gets the same powers as the
   * author. The role is plumbed through so a follow-up PR can constrain
   * `appAction` / `dbExec` / `toolFetch` for non-author viewers (and
   * eventually require an explicit consent step before running a shared
   * tool, audit C1). For now this is metadata only.
   */
  role: "owner" | "admin" | "editor" | "viewer";
}

export function buildToolHtml(
  content: string,
  themeVars: string,
  isDark: boolean,
  toolId?: string,
  binding?: ToolRenderBinding,
): string {
  const toolIdJson = JSON.stringify(toolId ?? "");
  const toolIdAttr = escapeHtmlAttribute(toolId ?? "");
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
  <meta http-equiv="Content-Security-Policy" content="${TOOL_IFRAME_META_CSP}" />
  ${binding && !binding.isAuthor ? `<meta name="agent-native-tool-author" content="${escapeHtmlAttribute(binding.authorEmail)}" />` : ""}
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300..700&display=swap" rel="stylesheet" />
  <script>
    var _toolErrors = [];
    var _toolErrorDetails = [];
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
      if (_toolErrors.indexOf(message) !== -1) return;
      _toolErrors.push(message);
      _toolErrorDetails.push({ message: message, stack: stack || '' });
      var toast = document.getElementById('__tool-error-toast');
      if (!toast) return;
      var msg = document.getElementById('__tool-error-msg');
      if (_toolErrors.length === 1) {
        msg.textContent = _toolErrors[0];
      } else {
        msg.textContent = _toolErrors.length + ' errors — ' + _toolErrors[_toolErrors.length - 1];
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
    otherwise inject code into every tool. To bump these versions:
      1. npm view @tailwindcss/browser version  (or alpinejs)
      2. curl -sL https://cdn.jsdelivr.net/npm/@tailwindcss/browser@<v> \
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
	    body { font-family: 'Inter', sans-serif; margin: 0; padding: 0; min-height: 100vh; }
	  </style>
	  <script>
	    var _toolRequestSeq = 0;
	    var _toolPendingRequests = {};

	    window.addEventListener('message', function(event) {
	      if (event.source !== window.parent) return;
	      var message = event.data || {};
	      if (message.type !== 'agent-native-tool-response') return;
	      var pending = _toolPendingRequests[message.requestId];
	      if (!pending) return;
	      delete _toolPendingRequests[message.requestId];
	      if (message.error) {
	        pending.reject(new Error(message.error));
	      } else {
	        pending.resolve(message.response);
	      }
	    });

	    function hostRequest(path, options) {
	      options = options || {};
	      return new Promise(function(resolve, reject) {
	        var requestId = 'tool-req-' + (++_toolRequestSeq);
	        _toolPendingRequests[requestId] = { resolve: resolve, reject: reject };
	        window.parent.postMessage({
	          type: 'agent-native-tool-request',
	          requestId: requestId,
	          path: path,
	          options: {
	            method: options.method || 'GET',
	            headers: options.headers || {},
	            body: options.body,
	          },
	        }, '*');
	        setTimeout(function() {
	          var pending = _toolPendingRequests[requestId];
	          if (!pending) return;
	          delete _toolPendingRequests[requestId];
	          pending.reject(new Error('Tool host request timed out'));
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

	    function toolFetch(url, options) {
	      var opts = options || {};
	      return hostRequest('/_agent-native/tools/proxy', {
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
      return appFetch('/_agent-native/tools/sql/query', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    }

    async function dbExec(sql, args) {
      var body = { sql: sql };
      if (args) body.args = args;
      return appFetch('/_agent-native/tools/sql/exec', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    }

    var _toolId = ${toolIdJson};
    var _toolBinding = ${bindingJson};
    window.toolBinding = _toolBinding;
    // SECURITY: when the viewer is not the author of this tool, emit a clear
    // console warning. The bridge currently runs every helper with the
    // viewer's session — a malicious shared tool can call any action, read
    // any owned table row in scope, and resolve any user-scope secret. A
    // full consent step is tracked as TODO C1 in audit 05-tools-sandbox.md.
    if (_toolBinding && !_toolBinding.isAuthor) {
      try {
        console.warn(
          '[agent-native] Shared tool — running with viewer\\'s session. ' +
            'Author: ' + (_toolBinding.authorEmail || '<unknown>') + '. ' +
            'Bridge calls (appAction, dbExec, toolFetch) execute under ' +
            'your account; they are gated by your permissions, not the ' +
            'author\\'s. Do not run untrusted shared tools.',
        );
      } catch (_) {}
    }

    var toolData = {
	      async list(collection, opts) {
	        var limit = (opts && opts.limit) || 100;
	        var scope = (opts && opts.scope) || 'user';
	        var res = await hostRequest('/_agent-native/tools/data/' + _toolId + '/' + encodeURIComponent(collection) + '?limit=' + limit + '&scope=' + scope);
	        if (!res.ok) throw new Error('Failed to list tool data');
	        return res.body;
	      },
      async get(collection, id, opts) {
        var scope = (opts && opts.scope) || 'user';
        var items = await this.list(collection, { scope: scope });
        return (items || []).find(function(item) { return item.id === id; }) || null;
      },
      async set(collection, id, data, opts) {
	        var scope = (opts && opts.scope) || 'user';
	        var res = await hostRequest('/_agent-native/tools/data/' + _toolId + '/' + encodeURIComponent(collection), {
	          method: 'POST',
	          headers: { 'Content-Type': 'application/json' },
	          body: JSON.stringify({ id: id, data: data, scope: scope }),
	        });
	        if (!res.ok) throw new Error('Failed to save tool data');
	        return res.body;
	      },
	      async remove(collection, id, opts) {
	        var scope = (opts && opts.scope) || 'user';
	        var res = await hostRequest('/_agent-native/tools/data/' + _toolId + '/' + encodeURIComponent(collection) + '/' + encodeURIComponent(id) + '?scope=' + scope, {
	          method: 'DELETE',
	        });
	        if (!res.ok) throw new Error('Failed to delete tool data');
	        return res.body;
	      },
	    };
	  </script>
	  <style>
	    #__tool-error-toast {
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
	    // Extension-point slot context: when a tool is rendered embedded inside an
	    // ExtensionSlot, the host pushes a context object via postMessage. Tools
	    // read it synchronously via window.slotContext or subscribe to changes
	    // via window.onSlotContext(fn). When rendered full-page (no ?slot= param),
	    // slotContext stays null and tools branch on that.
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
	    // host listens for agent-native-tool-resize and adjusts the iframe height.
	    if (new URLSearchParams(location.search).get('slot')) {
	      var _lastH = 0;
	      var _reportHeight = function() {
	        var h = Math.max(
	          document.documentElement.scrollHeight,
	          document.body ? document.body.scrollHeight : 0,
	        );
	        if (h !== _lastH) {
	          _lastH = h;
	          window.parent.postMessage({ type: 'agent-native-tool-resize', height: h }, '*');
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
	          type: 'agent-native-tool-keydown',
	          key: e.key, code: e.code,
	          metaKey: e.metaKey, ctrlKey: e.ctrlKey,
	          shiftKey: e.shiftKey, altKey: e.altKey,
	        }, '*');
	        return;
	      }
	      if (e.key === 'Escape') {
	        window.parent.postMessage({
	          type: 'agent-native-tool-keydown',
	          key: e.key, code: e.code,
	          metaKey: false, ctrlKey: false,
	          shiftKey: false, altKey: false,
	        }, '*');
	      }
	    });

	    document.addEventListener('DOMContentLoaded', function() {
	      var fixBtn = document.getElementById('__tool-error-fix');
	      if (fixBtn) {
	        fixBtn.addEventListener('click', function() {
	          window.parent.postMessage({
	            type: 'agent-native-tool-error-fix',
	            errors: _toolErrors,
	            errorDetails: _toolErrorDetails,
	            consoleLogs: _consoleLogs.slice(-30),
	            networkLogs: _networkLogs.slice(-15)
	          }, '*');
	          document.getElementById('__tool-error-toast').style.display = 'none';
	        });
	      }
	      var dismissBtn = document.getElementById('__tool-error-dismiss');
	      if (dismissBtn) {
	        dismissBtn.addEventListener('click', function() {
	          document.getElementById('__tool-error-toast').style.display = 'none';
	        });
	      }
	    });
	  </script>
	</head>
	<body${toolId ? ` data-tool-id="${toolIdAttr}"` : ""} class="bg-background text-foreground">
	${content}
	<div id="__tool-error-toast">
	  <div style="display:flex;align-items:flex-start;gap:8px;">
	    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
	    <span id="__tool-error-msg" style="flex:1;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;"></span>
	    <button id="__tool-error-fix" style="cursor:pointer;border:none;background:rgba(255,255,255,.9);color:hsl(0 84.2% 40%);font-size:12px;font-weight:500;padding:4px 12px;border-radius:4px;flex-shrink:0;">Fix</button>
	    <button id="__tool-error-dismiss" style="cursor:pointer;border:none;background:transparent;color:inherit;font-size:16px;padding:2px 6px;opacity:0.7;flex-shrink:0;">&#215;</button>
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

/**
 * Static catalog of bridge helpers that a tool can call when rendered. Used by
 * the consent stub to tell viewers WHAT they're trusting before they hit
 * "Run anyway". Any new bridge helper added to `html-shell.ts` MUST also
 * appear here, ordered most-dangerous-first (so the riskiest items render at
 * the top of the consent card).
 *
 * Keep this list in sync with `html-shell.ts` (search for `function appAction`
 * and friends) and with the role-gating switch in `iframe-bridge.ts`.
 */
export const TOOL_BRIDGE_HELPER_CATALOG: ReadonlyArray<{
  name: string;
  summary: string;
}> = [
  {
    name: "appAction",
    summary: "Call any app action under your account.",
  },
  {
    name: "dbExec",
    summary: "Run write SQL (INSERT/UPDATE) under your ownership.",
  },
  {
    name: "dbQuery",
    summary: "Run read SQL against tables your account can see.",
  },
  {
    name: "appFetch",
    summary: "Call same-origin framework endpoints with your session.",
  },
  {
    name: "toolFetch",
    summary:
      "Call external HTTPS endpoints with your secrets injected (URL allowlisted per key).",
  },
  {
    name: "toolData",
    summary: "Read/write the per-tool key-value store under your identity.",
  },
];

export interface ConsentStubOptions {
  toolId: string;
  toolName: string;
  authorEmail: string;
  contentHash: string;
  viewerEmail: string;
  isDark: boolean;
  themeVars: string;
  /**
   * Server-relative path to POST consent grants to. The stub posts here on
   * "Run anyway"; the route should write the consent row and respond 200,
   * then this stub triggers a parent reload so the next render returns the
   * tool body.
   */
  grantPath: string;
}

/**
 * Build the consent-required HTML stub. Rendered in place of the tool body
 * when the viewer is NOT the author and has not previously consented to
 * THIS exact content_hash. The stub itself never loads CDN scripts and
 * never calls the postMessage bridge — its only outbound network call is
 * the same-origin grant POST below, sent via the parent iframe host (which
 * already authenticates via session cookie).
 *
 * Two important security choices:
 *
 * 1. The grant POST is sent through `window.parent.postMessage` exactly
 *    like a real bridge call, NOT via `fetch` from the iframe. The iframe
 *    sandbox blocks same-origin DOM access and would block direct fetch
 *    from a sandboxed null origin in some browsers; routing through the
 *    parent guarantees the request carries the viewer's cookies.
 * 2. The stub renders zero author-controlled content beyond the
 *    `authorEmail` + `toolName` fields, both of which are HTML-escaped
 *    here. The author cannot inject script into the consent UI because
 *    the tool body never reaches the response when this stub renders.
 */
export function buildConsentStubHtml(opts: ConsentStubOptions): string {
  const helpersHtml = TOOL_BRIDGE_HELPER_CATALOG.map(
    (h) =>
      `      <li><code>${escapeHtmlAttribute(h.name)}</code> — ${escapeHtmlAttribute(h.summary)}</li>`,
  ).join("\n");
  return `<!DOCTYPE html>
<html lang="en"${opts.isDark ? ' class="dark"' : ""}>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="${TOOL_IFRAME_META_CSP}" />
  <meta name="agent-native-tool-author" content="${escapeHtmlAttribute(opts.authorEmail)}" />
  <meta name="agent-native-tool-consent-required" content="1" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400..700&display=swap" rel="stylesheet" />
  <style>${opts.themeVars}</style>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: hsl(var(--background));
      color: hsl(var(--foreground));
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      font-size: 14px;
      line-height: 1.5;
    }
    .card {
      max-width: 520px;
      width: 100%;
      background: hsl(var(--card));
      color: hsl(var(--card-foreground));
      border: 1px solid hsl(var(--border));
      border-radius: calc(var(--radius, 0.5rem) + 4px);
      padding: 28px 24px;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.06);
    }
    h1 {
      font-size: 17px;
      font-weight: 600;
      margin: 0 0 6px 0;
    }
    h2 {
      font-size: 13px;
      font-weight: 600;
      margin: 18px 0 6px 0;
    }
    .author {
      color: hsl(var(--muted-foreground));
      font-size: 13px;
      margin-bottom: 16px;
    }
    .author code {
      background: hsl(var(--muted));
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 12px;
    }
    .body p {
      margin: 0 0 12px 0;
      color: hsl(var(--muted-foreground));
    }
    ul.helpers {
      margin: 0;
      padding: 0 0 0 18px;
      color: hsl(var(--muted-foreground));
      font-size: 12.5px;
    }
    ul.helpers li {
      margin: 4px 0;
    }
    ul.helpers code {
      background: hsl(var(--muted));
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 11.5px;
      color: hsl(var(--foreground));
    }
    .actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 22px;
    }
    button {
      cursor: pointer;
      font: inherit;
      padding: 8px 14px;
      border-radius: calc(var(--radius, 0.5rem));
      border: 1px solid hsl(var(--border));
      background: transparent;
      color: hsl(var(--foreground));
      font-weight: 500;
      font-size: 13px;
    }
    button.primary {
      background: hsl(var(--destructive));
      color: hsl(var(--destructive-foreground));
      border-color: hsl(var(--destructive));
    }
    button:disabled {
      opacity: 0.6;
      cursor: progress;
    }
    .error {
      margin-top: 10px;
      color: hsl(var(--destructive));
      font-size: 12.5px;
      display: none;
    }
  </style>
</head>
<body>
  <div class="card" role="alertdialog" aria-labelledby="consent-title">
    <h1 id="consent-title">Run shared tool: ${escapeHtmlAttribute(opts.toolName)}?</h1>
    <p class="author">Authored by <code>${escapeHtmlAttribute(opts.authorEmail)}</code></p>
    <div class="body">
      <p>
        This tool runs under <strong>your</strong> account. The author's HTML/JS will
        execute with your session — it can call any of the helpers below using
        your permissions, your secrets, and your data scope.
      </p>
      <h2>Helpers this tool can use</h2>
      <ul class="helpers">
${helpersHtml}
      </ul>
      <p style="margin-top:14px;">Only run this tool if you trust the author to act under your account.</p>
    </div>
    <div class="error" id="consent-error"></div>
    <div class="actions">
      <button type="button" id="consent-cancel">Cancel</button>
      <button type="button" id="consent-grant" class="primary">Run anyway</button>
    </div>
  </div>
  <script>
    var TOOL_ID = ${JSON.stringify(opts.toolId)};
    var GRANT_PATH = ${JSON.stringify(opts.grantPath)};

    var grantBtn = document.getElementById('consent-grant');
    var cancelBtn = document.getElementById('consent-cancel');
    var errorEl = document.getElementById('consent-error');

    function postRequest(path, body, callback) {
      var requestId = 'consent-' + Math.random().toString(36).slice(2, 10);
      function onMessage(event) {
        if (event.source !== window.parent) return;
        var msg = event.data || {};
        if (msg.type !== 'agent-native-tool-response') return;
        if (msg.requestId !== requestId) return;
        window.removeEventListener('message', onMessage);
        callback(msg);
      }
      window.addEventListener('message', onMessage);
      window.parent.postMessage({
        type: 'agent-native-tool-request',
        requestId: requestId,
        path: path,
        options: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body || {}),
        },
      }, '*');
      // Safety timeout: if the parent never answers, surface the failure.
      setTimeout(function() {
        window.removeEventListener('message', onMessage);
        callback({ error: 'Consent grant timed out — try again.' });
      }, 15000);
    }

    grantBtn.addEventListener('click', function() {
      grantBtn.disabled = true;
      cancelBtn.disabled = true;
      errorEl.style.display = 'none';
      postRequest(GRANT_PATH, {}, function(result) {
        if (result.error) {
          grantBtn.disabled = false;
          cancelBtn.disabled = false;
          errorEl.textContent = String(result.error);
          errorEl.style.display = 'block';
          return;
        }
        var resp = result.response || {};
        if (!resp.ok) {
          grantBtn.disabled = false;
          cancelBtn.disabled = false;
          var msg = (resp.body && resp.body.error) || ('Failed: ' + resp.status);
          errorEl.textContent = String(msg);
          errorEl.style.display = 'block';
          return;
        }
        // Tell the parent to reload the iframe; the next render returns the
        // tool body because hasConsent() is now true.
        window.parent.postMessage({
          type: 'agent-native-tool-consent-granted',
          toolId: TOOL_ID,
        }, '*');
      });
    });

    cancelBtn.addEventListener('click', function() {
      window.parent.postMessage({
        type: 'agent-native-tool-consent-cancelled',
        toolId: TOOL_ID,
      }, '*');
    });
  </script>
</body>
</html>`;
}
