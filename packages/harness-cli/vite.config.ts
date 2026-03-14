import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// App config: array of { name, appPort, wsPort }
// Set by dev-all.mjs, or defaults to a single app
const apps: Array<{ name: string; appPort: number; wsPort: number }> = JSON.parse(
  process.env.VITE_APP_CONFIG || '[{"name":"default","appPort":8081,"wsPort":3341}]'
);

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
  ],
  define: {
    "import.meta.env.VITE_APP_CONFIG": JSON.stringify(apps),
  },
  server: {
    port: parseInt(process.env.PORT || "3334", 10),
    strictPort: true,
    proxy: Object.fromEntries(
      apps.flatMap(({ name, appPort, wsPort }) => [
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
      ])
    ),
  },
  build: {
    outDir: "dist/client",
  },
});
