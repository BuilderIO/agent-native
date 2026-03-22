import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import http from "http";

// App config: array of { name, appPort, wsPort }
// Set by dev-all.mjs, or defaults to a single app
const apps: Array<{ name: string; appPort: number; wsPort: number }> =
  JSON.parse(
    process.env.VITE_APP_CONFIG ||
      '[{"name":"default","appPort":8081,"wsPort":3341}]',
  );

// Optional docs port for single-port mode (set by dev-all-single-port.mjs)
const docsPort = process.env.VITE_DOCS_PORT
  ? parseInt(process.env.VITE_DOCS_PORT, 10)
  : null;

export default defineConfig({
  plugins: [
    react(),
    // Redirect /app/<name> to /app/<name>/ so Vite proxy matches
    {
      name: "trailing-slash-redirect",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          for (const app of apps) {
            if (req.url === `/app/${app.name}`) {
              _res.writeHead(301, { Location: `/app/${app.name}/` });
              _res.end();
              return;
            }
          }
          next();
        });
      },
    },
    // Set a cookie when an app iframe loads so we know which app is active
    {
      name: "active-app-cookie",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          for (const app of apps) {
            if (req.url?.startsWith(`/app/${app.name}`)) {
              res.setHeader(
                "Set-Cookie",
                `active_app=${app.name}; Path=/; SameSite=Lax`,
              );
              break;
            }
          }
          next();
        });
      },
    },
    // Proxy bare /api/* requests to the correct app based on Referer header.
    // When the iframe loads via /app/<name>/, its fetch("/api/...") calls
    // hit the harness origin. This middleware detects which app made the
    // request and proxies it to the right app server.
    {
      name: "api-proxy-by-referer",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith("/api/")) return next();

          // Skip if this is already a per-app API route like /api/mail/...
          for (const app of apps) {
            if (req.url.startsWith(`/api/${app.name}`)) return next();
          }

          // Determine target app from Referer header or cookie
          const referer = req.headers.referer || "";
          const cookieMatch = (req.headers.cookie || "").match(
            /active_app=(\w+)/,
          );
          let targetApp = apps[0];
          for (const app of apps) {
            if (
              referer.includes(`/app/${app.name}`) ||
              cookieMatch?.[1] === app.name
            ) {
              targetApp = app;
              break;
            }
          }

          const proxyReq = http.request(
            {
              hostname: "localhost",
              port: targetApp.appPort,
              path: req.url,
              method: req.method,
              headers: {
                ...req.headers,
                // Preserve original host so the app sees the harness origin
                "x-forwarded-host": req.headers.host || "",
                host: `localhost:${targetApp.appPort}`,
              },
            },
            (proxyRes) => {
              res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
              proxyRes.pipe(res);
            },
          );

          proxyReq.on("error", (err) => {
            res.writeHead(502, { "Content-Type": "text/plain" });
            res.end("Proxy error: " + err.message);
          });

          req.pipe(proxyReq);
        });
      },
    },
  ],
  define: {
    "import.meta.env.VITE_APP_CONFIG": JSON.stringify(apps),
  },
  server: {
    port: parseInt(process.env.PORT || "3334", 10),
    strictPort: true,
    proxy: Object.fromEntries([
      ...apps.flatMap(({ name, appPort, wsPort }) => [
        // WebSocket for CLI terminal
        [
          `/ws/${name}`,
          {
            target: `ws://localhost:${wsPort}`,
            ws: true,
            rewrite: (p: string) => p.replace(`/ws/${name}`, "/ws"),
          },
        ],
        // App API routes
        [
          `/api/${name}`,
          {
            target: `http://localhost:${appPort}`,
            changeOrigin: true,
            rewrite: (p: string) => p.replace(`/api/${name}`, "/api"),
          },
        ],
        // App itself
        [
          `/app/${name}`,
          {
            target: `http://localhost:${appPort}`,
            changeOrigin: true,
            rewrite: (p: string) => p.replace(`/app/${name}`, ""),
            ws: true,
          },
        ],
      ]),
      // Docs site proxy (single-port mode only)
      ...(docsPort
        ? [
            [
              "/docs",
              {
                target: `http://localhost:${docsPort}`,
                changeOrigin: true,
                ws: true,
              },
            ],
          ]
        : []),
    ]),
  },
  build: {
    outDir: "dist/client",
  },
});
