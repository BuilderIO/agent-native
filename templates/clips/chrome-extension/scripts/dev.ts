import { spawn } from "node:child_process";
import { watch } from "node:fs";
import http from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(root, "dist");
const PORT = 8123;

const clients = new Set<http.ServerResponse>();

const server = http.createServer((req, res) => {
  if (req.url === "/dev-reload-stream") {
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      Connection: "keep-alive",
    });
    res.write("connected\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  res.writeHead(404);
  res.end();
});

server.on("error", (err) => {
  console.error(`[clips-dev] reload server error:`, err);
});

server.listen(PORT, () => {
  console.log(`[clips-dev] reload server → http://localhost:${PORT}`);
  console.log(
    `[clips-dev] load ${distDir} as an unpacked extension; it auto-reloads on rebuild.`,
  );
});

let debounce: ReturnType<typeof setTimeout> | undefined;
function notifyReload(): void {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    if (clients.size === 0) return;
    for (const res of clients) {
      try {
        res.write("reload\n");
      } catch {
        /* client went away */
      }
    }
    console.log(
      `[clips-dev] rebuild → reload sent to ${clients.size} client(s)`,
    );
  }, 250);
}

const vite = spawn("pnpm", ["exec", "vite", "build", "--watch"], {
  cwd: root,
  stdio: "inherit",
});
vite.on("exit", (code) => {
  console.log(`[clips-dev] vite exited (${code ?? 0})`);
  server.close();
  process.exit(code ?? 0);
});

let watching = false;
function startWatchingDist(): void {
  if (watching) return;
  try {
    watch(distDir, { recursive: true }, () => notifyReload());
    watching = true;
  } catch {
    setTimeout(startWatchingDist, 500);
  }
}
startWatchingDist();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    vite.kill();
    server.close();
    process.exit(0);
  });
}
