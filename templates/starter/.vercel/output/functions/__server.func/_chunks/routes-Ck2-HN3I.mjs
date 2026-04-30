import{b as e,r as t,s as n,y as r}from"./node-DYtH-KCh.mjs";import{t as i}from"./h3-helpers-biOegcqH.mjs";import{n as a,s as o}from"./request-context-60tSGHqu.mjs";import{i as s,l as c}from"./client-DU--QVjD.mjs";import{l}from"./auth-Dww4On4H.mjs";import{n as u}from"./poll-aO2fdqrq.mjs";import{createTool as d,deleteTool as f,ensureToolsTables as p,getTool as m,listTools as h,updateTool as g,updateToolContent as _}from"./store-CZj8fPFy.mjs";import{r as v}from"./context-BOr0oN9W.mjs";import{a as y,i as b,n as x,o as S,r as C,s as w,t as T}from"./url-safety-DC46OIyr.mjs";import{i as E,n as D,t as O}from"./substitution-Z-wkdNYh.mjs";import{randomUUID as k}from"node:crypto";var A=`default-src 'none'; script-src 'self' https://cdn.jsdelivr.net 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self';`;function j(e,t,n,r){let i=JSON.stringify(r??``),a=M(r??``);return`<!DOCTYPE html>
<html lang="en"${n?` class="dark"`:``}>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="${A}" />
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
  <\/script>
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"><\/script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js"><\/script>
  <style>${t}</style>
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

    var _toolId = ${i};

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
	  <\/script>
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
	  <\/script>
	</head>
	<body${r?` data-tool-id="${a}"`:``} class="bg-background text-foreground">
	${e}
	<div id="__tool-error-toast">
	  <div style="display:flex;align-items:flex-start;gap:8px;">
	    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
	    <span id="__tool-error-msg" style="flex:1;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;"></span>
	    <button id="__tool-error-fix" style="cursor:pointer;border:none;background:rgba(255,255,255,.9);color:hsl(0 84.2% 40%);font-size:12px;font-weight:500;padding:4px 12px;border-radius:4px;flex-shrink:0;">Fix</button>
	    <button id="__tool-error-dismiss" style="cursor:pointer;border:none;background:transparent;color:inherit;font-size:16px;padding:2px 6px;opacity:0.7;flex-shrink:0;">&#215;</button>
	  </div>
	</div>
	</body>
	</html>`}function M(e){return e.replace(/&/g,`&amp;`).replace(/"/g,`&quot;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`)}function N(e){return e?`
:root {
  --background: 240 10% 3.9%;
  --foreground: 0 0% 98%;
  --card: 240 10% 3.9%;
  --card-foreground: 0 0% 98%;
  --popover: 240 10% 3.9%;
  --popover-foreground: 0 0% 98%;
  --primary: 0 0% 98%;
  --primary-foreground: 240 5.9% 10%;
  --secondary: 240 3.7% 15.9%;
  --secondary-foreground: 0 0% 98%;
  --muted: 240 3.7% 15.9%;
  --muted-foreground: 240 5% 64.9%;
  --accent: 240 3.7% 15.9%;
  --accent-foreground: 0 0% 98%;
  --destructive: 0 62.8% 30.6%;
  --destructive-foreground: 0 0% 98%;
  --border: 240 3.7% 15.9%;
  --input: 240 3.7% 15.9%;
  --ring: 240 4.9% 83.9%;
  --radius: 0.5rem;
  --sidebar-background: 240 5.9% 10%;
  --sidebar-foreground: 240 4.8% 95.9%;
  --sidebar-primary: 224.3 76.3% 48%;
  --sidebar-primary-foreground: 0 0% 100%;
  --sidebar-accent: 240 3.7% 15.9%;
  --sidebar-accent-foreground: 240 4.8% 95.9%;
  --sidebar-border: 240 3.7% 15.9%;
  --sidebar-ring: 240 4.9% 83.9%;
}`:`
:root {
  --background: 0 0% 100%;
  --foreground: 240 10% 3.9%;
  --card: 0 0% 100%;
  --card-foreground: 240 10% 3.9%;
  --popover: 0 0% 100%;
  --popover-foreground: 240 10% 3.9%;
  --primary: 240 5.9% 10%;
  --primary-foreground: 0 0% 98%;
  --secondary: 240 4.8% 95.9%;
  --secondary-foreground: 240 5.9% 10%;
  --muted: 240 4.8% 95.9%;
  --muted-foreground: 240 3.8% 46.1%;
  --accent: 240 4.8% 95.9%;
  --accent-foreground: 240 5.9% 10%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 0 0% 98%;
  --border: 240 5.9% 90%;
  --input: 240 5.9% 90%;
  --ring: 240 5.9% 10%;
  --radius: 0.5rem;
  --sidebar-background: 0 0% 98%;
  --sidebar-foreground: 240 5.3% 26.1%;
  --sidebar-primary: 240 5.9% 10%;
  --sidebar-primary-foreground: 0 0% 98%;
  --sidebar-accent: 240 4.8% 95.9%;
  --sidebar-accent-foreground: 240 5.9% 10%;
  --sidebar-border: 220 13% 91%;
  --sidebar-ring: 240 5.9% 10%;
}`}function P(){return t(async t=>{let r=n(t),i=(t.url?.pathname||``).replace(/^\/+/,``).replace(/\/+$/,``),a=i?i.split(`/`):[],s=await l(t).catch(()=>null);if(!s?.email)return e(t,401),{error:`Authentication required`};let c=await v(t).catch(()=>null),u=s.email;return o({userEmail:u,orgId:c?.orgId??void 0},()=>F(t,r,a,u))})}async function F(t,n,a,o){if(n===`POST`&&a.length===2&&a[0]===`sql`&&a[1]===`query`)return H(t);if(n===`POST`&&a.length===2&&a[0]===`sql`&&a[1]===`exec`)return K(t);if(n===`GET`&&a.length===3&&a[0]===`data`)return I(t,a[1],a[2],o);if(n===`POST`&&a.length===3&&a[0]===`data`)return L(t,a[1],a[2],o);if(n===`DELETE`&&a.length===4&&a[0]===`data`)return R(t,a[1],a[2],a[3],o);if(n===`POST`&&a.length===1&&a[0]===`proxy`)return z(t,o);if(n===`GET`&&a.length===0)return h();if(n===`POST`&&a.length===0){let n=await i(t);if(!n.name)return e(t,400),{error:`name is required`};let r=await d(n);return u({source:`action`,type:`change`}),e(t,201),r}if(n===`GET`&&a.length===2&&a[1]===`render`){let n=await m(a[0]);if(!n)return e(t,404),{error:`Tool not found`};let i=t.url?.search||``,o=i.includes(`dark=1`)||i.includes(`dark=true`),s=N(o),c=j(n.content,s,o,a[0]);return r(t,`Content-Type`,`text/html; charset=utf-8`),r(t,`Content-Security-Policy`,A),r(t,`X-Content-Type-Options`,`nosniff`),r(t,`Referrer-Policy`,`no-referrer`),c}if(n===`GET`&&a.length===1)return await m(a[0])||(e(t,404),{error:`Tool not found`});if(n===`PUT`&&a.length===1){let n=await i(t),r=n.content!==void 0||n.patches!==void 0,o=n.name!==void 0||n.description!==void 0||n.icon!==void 0||n.visibility!==void 0,s=null;return r&&(s=await _(a[0],{content:n.content,patches:n.patches})),o&&(s=await g(a[0],n)),!r&&!o&&(s=await m(a[0])),s?(u({source:`action`,type:`change`}),s):(e(t,404),{error:`Tool not found`})}return n===`DELETE`&&a.length===1?await f(a[0])?(u({source:`action`,type:`change`}),{ok:!0}):(e(t,404),{error:`Tool not found`}):(e(t,404),{error:`Not found`})}async function I(t,n,r,i){if(await p(),!await m(n))return e(t,404),{error:`Tool not found`};let o=s(),c=t.url,l=c?.searchParams?.get(`limit`),u=l?Math.min(Math.max(1,Number(l)),1e3):100,d=c?.searchParams?.get(`scope`)||`user`,f=a();return d===`org`?f?(await o.execute({sql:`SELECT COALESCE(item_id, id) AS id, tool_id, collection, data, owner_email, scope, org_id, created_at, updated_at
        FROM tool_data
        WHERE tool_id = ? AND collection = ? AND scope = 'org' AND org_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,args:[n,r,f,u]})).rows??[]:(e(t,400),{error:`Org context required for scope=org`}):d===`all`?(await o.execute({sql:`SELECT COALESCE(item_id, id) AS id, tool_id, collection, data, owner_email, scope, org_id, created_at, updated_at
        FROM tool_data
        WHERE tool_id = ? AND collection = ?
          AND ((scope = 'user' AND owner_email = ?) OR (scope = 'org' AND org_id = ?))
        ORDER BY created_at DESC
        LIMIT ?`,args:[n,r,i,f??``,u]})).rows??[]:(await o.execute({sql:`SELECT COALESCE(item_id, id) AS id, tool_id, collection, data, owner_email, scope, org_id, created_at, updated_at
      FROM tool_data
      WHERE tool_id = ? AND collection = ? AND scope = 'user' AND owner_email = ?
      ORDER BY updated_at DESC
      LIMIT ?`,args:[n,r,i,u]})).rows??[]}async function L(t,n,r,o){if(await p(),!await m(n))return e(t,404),{error:`Tool not found`};let l=await i(t);if(l.data===void 0)return e(t,400),{error:`data is required`};let u=String(l.id||k()),d=typeof l.data==`string`?l.data:JSON.stringify(l.data),f=new Date().toISOString(),h=l.scope===`org`?`org`:`user`,g=a();if(h===`org`&&!g)return e(t,400),{error:`Org context required for scope=org`};let _=h===`org`?`org:${g}`:o,v=s(),y=c()?`ON CONFLICT (tool_id, collection, scope_key, item_id)
       DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`:`ON CONFLICT (tool_id, collection, scope_key, item_id)
       DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`;return await v.execute({sql:`INSERT INTO tool_data (id, tool_id, collection, item_id, data, owner_email, scope, org_id, scope_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ${y}`,args:[k(),n,r,u,d,o,h,h===`org`?g:null,_,f,f]}),{id:u,toolId:n,collection:r,data:d,ownerEmail:o,scope:h,orgId:h===`org`?g:null,createdAt:f,updatedAt:f}}async function R(t,n,r,i,o){if(await p(),!await m(n))return e(t,404),{error:`Tool not found`};let c=t.url?.searchParams?.get(`scope`)||`user`,l=a(),u=s();return c===`org`?l?(await u.execute({sql:`DELETE FROM tool_data WHERE COALESCE(item_id, id) = ? AND tool_id = ? AND collection = ? AND scope = 'org' AND org_id = ?`,args:[i,n,r,l]}),{ok:!0}):(e(t,400),{error:`Org context required for scope=org`}):(await u.execute({sql:`DELETE FROM tool_data WHERE COALESCE(item_id, id) = ? AND tool_id = ? AND collection = ? AND scope = 'user' AND owner_email = ?`,args:[i,n,r,o]}),{ok:!0})}async function z(t,n){let r=await i(t),a=r.url;if(!a||typeof a!=`string`)return e(t,400),{error:`url is required`};let o=C(r.method||`GET`);if(!o)return e(t,405),{error:`Unsupported HTTP method. Allowed methods: GET, POST, PUT, PATCH, DELETE, HEAD.`};let s=r.headers||{},c=r.body,l=a,u=JSON.stringify(s),d=c,f=[],p=[];try{let e=await D(a,`user`,n);l=e.resolved,f.push(...e.usedKeys),p.push(...e.secretValues);let t=await D(u,`user`,n);if(u=t.resolved,f.push(...t.usedKeys),p.push(...t.secretValues),c){let e=await D(typeof c==`string`?c:JSON.stringify(c),`user`,n);d=e.resolved,f.push(...e.usedKeys),p.push(...e.secretValues)}}catch(n){return e(t,400),{error:`Key resolution failed: ${n?.message??n}`}}let m=T(p);if(await x(l))return e(t,403),{error:`Requests to private/internal addresses are not allowed`};for(let r of new Set(f)){let i=await O(r,`user`,n);if(!E(l,i))return e(t,403),{error:`Key "${r}" is not allowed for this URL origin`}}let h;try{h=w(JSON.parse(u))}catch{h=w(s)}let g=new AbortController,_=setTimeout(()=>g.abort(),15e3);try{let r={method:o,headers:h,signal:g.signal,redirect:`manual`};d&&[`POST`,`PUT`,`PATCH`].includes(o)&&(r.body=typeof d==`string`?d:JSON.stringify(d),!h[`content-type`]&&!h[`Content-Type`]&&(h[`Content-Type`]=`application/json`));let i=await fetch(l,r);if(i.status>=300&&i.status<400){let r=i.headers.get(`location`),a=r?new URL(r,l).href:null;if(a&&await x(a))return e(t,403),{error:`Redirect to private/internal address blocked`};if(a){for(let r of new Set(f))if(!E(a,await O(r,`user`,n)))return e(t,403),{error:`Redirect URL is not allowed for key "${r}"`}}return{status:i.status,body:{redirect:a?S(a,m):r}}}let{text:a}=await b(i),s;try{s=JSON.parse(a)}catch{s=a}return{status:i.status,body:y(s,m)}}catch(n){return n?.name===`AbortError`?(e(t,504),{error:`Upstream request timed out`}):(e(t,502),{error:`Proxy request failed: ${y(n?.message??String(n),m)}`})}finally{clearTimeout(_)}}var B=Promise.resolve();async function V(e,t){let n=B,r;B=new Promise(e=>{r=e}),await n;let i=[],a=console.log,o=console.error,s=process.stdout.write;console.log=(...e)=>{i.push(e.map(String).join(` `))},console.error=(...e)=>{i.push(e.map(String).join(` `))},process.stdout.write=(e=>(typeof e==`string`?i.push(e):Buffer.isBuffer(e)&&i.push(e.toString()),!0));try{await e(t)}catch(e){i.push(`Error: ${e?.message??String(e)}`)}finally{console.log=a,console.error=o,process.stdout.write=s,r()}return i.join(`
`)||`(no output)`}async function H(t){let n=await i(t),r=n.sql;if(!r||typeof r!=`string`)return e(t,400),{error:`sql is required`};let a=G(r);if(!/^\s*(SELECT|WITH)\b/i.test(a))return e(t,403),{error:`Only SELECT queries are allowed from tools`};if(W.test(a))return e(t,403),{error:`Sensitive framework tables are not readable from tools`};try{let i=await import(`./query-BD9nBiwV.mjs`),a=[`--sql`,r,`--format`,`json`];if(n.limit&&a.push(`--limit`,String(n.limit)),n.args!==void 0){if(!Array.isArray(n.args))return e(t,400),{error:`args must be an array`};a.push(`--args`,JSON.stringify(n.args))}let o=await V(i.default,a);try{return JSON.parse(o)}catch{return{output:o}}}catch(n){return e(t,500),{error:n?.message??`Query failed`}}}var U=/\b(CREATE\s+(?:(?:LOCAL|GLOBAL)\s+)?(?:TEMPORARY|TEMP)?\s*(TABLE|INDEX|VIEW|SCHEMA|DATABASE|TRIGGER)|DROP\s+(TABLE|INDEX|VIEW|SCHEMA|DATABASE|TRIGGER)|TRUNCATE|DELETE\s+FROM\s+(?!tool_data\b)|ALTER\s+TABLE\s+(?!tool_data\b)|ATTACH|DETACH|VACUUM|REINDEX|PRAGMA)\b/i,W=/\b(app_secrets|user|users|session|sessions|account|accounts|verification|oauth_tokens|tool_shares|tool_slots|tool_slot_installs)\b/i;function G(e){return e.replace(/\/\*[\s\S]*?\*\//g,` `).replace(/--[^\n]*/g,` `)}async function K(t){let n=await i(t),r=n.sql;if(!r||typeof r!=`string`)return e(t,400),{error:`sql is required`};let a=G(r);if(U.test(a))return e(t,403),{error:`Schema changes and destructive SQL are not allowed from tools`};if(W.test(a))return e(t,403),{error:`Sensitive framework tables are not writable from tools`};try{let i=await import(`./exec-T1Ss3kNg.mjs`),a=[`--sql`,r,`--format`,`json`];if(n.args!==void 0){if(!Array.isArray(n.args))return e(t,400),{error:`args must be an array`};a.push(`--args`,JSON.stringify(n.args))}let o=await V(i.default,a);try{return JSON.parse(o)}catch{return{output:o}}}catch(n){return e(t,500),{error:n?.message??`Exec failed`}}}export{P as createToolsHandler};