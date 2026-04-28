export function buildToolHtml(
  content: string,
  themeVars: string,
  isDark: boolean,
  toolId?: string,
): string {
  const toolIdJson = JSON.stringify(toolId ?? "");
  const toolIdAttr = escapeHtmlAttribute(toolId ?? "");

  return `<!DOCTYPE html>
<html lang="en"${isDark ? ' class="dark"' : ""}>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data: https:; form-action 'none';" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300..700&display=swap" rel="stylesheet" />
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js"></script>
  <style>${themeVars}</style>
  <style type="text/tailwindcss">
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
	    body { font-family: 'Inter', sans-serif; margin: 0; padding: 1.5rem; }
	  </style>
	  <script>
	    var _toolRequestSeq = 0;
	    var _toolPendingRequests = {};

	    window.addEventListener('message', function(event) {
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

    var toolData = {
	      async list(collection, opts) {
	        var limit = (opts && opts.limit) || 100;
	        var res = await hostRequest('/_agent-native/tools/data/' + _toolId + '/' + encodeURIComponent(collection) + '?limit=' + limit);
	        if (!res.ok) throw new Error('Failed to list tool data');
	        return res.body;
	      },
      async get(collection, id) {
        var items = await this.list(collection);
        return (items || []).find(function(item) { return item.id === id; }) || null;
      },
      async set(collection, id, data) {
	        var res = await hostRequest('/_agent-native/tools/data/' + _toolId + '/' + encodeURIComponent(collection), {
	          method: 'POST',
	          headers: { 'Content-Type': 'application/json' },
	          body: JSON.stringify({ id: id, data: data }),
	        });
	        if (!res.ok) throw new Error('Failed to save tool data');
	        return res.body;
	      },
	      async remove(collection, id) {
	        var res = await hostRequest('/_agent-native/tools/data/' + _toolId + '/' + encodeURIComponent(collection) + '/' + encodeURIComponent(id), {
	          method: 'DELETE',
	        });
	        if (!res.ok) throw new Error('Failed to delete tool data');
	        return res.body;
	      },
	    };
	  </script>
	</head>
	<body${toolId ? ` data-tool-id="${toolIdAttr}"` : ""} class="bg-background text-foreground">
	${content}
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
