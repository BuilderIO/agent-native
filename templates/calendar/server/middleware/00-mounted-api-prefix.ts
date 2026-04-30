import { defineEventHandler } from "h3";

function normalizeBasePath(value: string | undefined): string {
  if (!value || value === "/") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function appBasePath(): string {
  return normalizeBasePath(
    process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH,
  );
}

export default defineEventHandler((event) => {
  const basePath = appBasePath();
  if (!basePath) return;

  const pathname = event.url?.pathname ?? "";
  if (!pathname.startsWith(`${basePath}/api/`)) return;

  const strippedPath = pathname.slice(basePath.length) || "/";
  try {
    event.url.pathname = strippedPath;
  } catch {
    // Keep best-effort node request rewriting below.
  }

  const query = event.url?.search ?? "";
  if (event.node?.req) {
    event.node.req.url = `${strippedPath}${query}`;
  }
});
