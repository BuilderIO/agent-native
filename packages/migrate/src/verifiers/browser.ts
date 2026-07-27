import fs from "fs/promises";
import path from "path";

import type { MigrationContext, Verifier, VerifierResult } from "../types.js";

export interface BrowserVerifierOptions {
  id?: string;
  label?: string;
  baseUrl?: string;
  routes?: string[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  loadPlaywright?: () => Promise<PlaywrightLike | null>;
}

interface PlaywrightLike {
  chromium?: {
    launch(options?: Record<string, unknown>): Promise<BrowserLike>;
  };
}

interface BrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

interface PageLike {
  goto(
    url: string,
    options?: { waitUntil?: "load" | "domcontentloaded"; timeout?: number },
  ): Promise<{ status(): number | null } | null>;
  title(): Promise<string>;
}

interface BrowserCheck {
  route: string;
  url?: string;
  ok: boolean;
  status?: number | null;
  title?: string;
  error?: string;
}

export function createBrowserVerifier(
  options: BrowserVerifierOptions = {},
): Verifier {
  const id = options.id ?? "browser-smoke";
  return {
    id,
    label: options.label ?? "Browser smoke verifier",
    async run(context) {
      const routes = routePaths(context, options.routes);
      const artifactPath = path.join(context.artifacts.runDir, `${id}.json`);
      await fs.mkdir(context.artifacts.runDir, { recursive: true });

      if (!options.baseUrl) {
        const payload = {
          mode: "skipped",
          reason: "No baseUrl configured for browser verification.",
          routes,
        };
        await writeArtifact(artifactPath, payload);
        return {
          id,
          ok: true,
          severity: "info",
          summary:
            "Browser verification skipped because no baseUrl was configured.",
          artifactPaths: [artifactPath],
        };
      }

      const loadPlaywright = options.loadPlaywright ?? loadOptionalPlaywright;
      const playwright = await loadPlaywright();
      if (playwright?.chromium) {
        return runWithPlaywright(id, routes, artifactPath, playwright, {
          baseUrl: options.baseUrl,
          timeoutMs: options.timeoutMs,
        });
      }

      return runWithFetchFallback(id, routes, artifactPath, {
        baseUrl: options.baseUrl,
        timeoutMs: options.timeoutMs,
        fetchImpl: options.fetchImpl,
      });
    },
  };
}

async function runWithPlaywright(
  id: string,
  routes: string[],
  artifactPath: string,
  playwright: PlaywrightLike,
  options: { baseUrl: string; timeoutMs?: number },
): Promise<VerifierResult> {
  const checks: BrowserCheck[] = [];
  const browser = await playwright.chromium?.launch({ headless: true });
  if (!browser) {
    return skippedResult(
      id,
      artifactPath,
      routes,
      "Playwright chromium launcher is unavailable.",
    );
  }

  try {
    const page = await browser.newPage();
    for (const route of routes) {
      const url = absoluteUrl(options.baseUrl, route);
      try {
        const response = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: options.timeoutMs ?? 10_000,
        });
        const status = response?.status() ?? null;
        checks.push({
          route,
          url,
          ok: status === null || status < 400,
          status,
          title: await page.title(),
        });
      } catch (error) {
        checks.push({
          route,
          url,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    await browser.close();
  }

  await writeArtifact(artifactPath, { mode: "playwright", checks });
  return checksResult(id, artifactPath, "Playwright", checks);
}

async function runWithFetchFallback(
  id: string,
  routes: string[],
  artifactPath: string,
  options: {
    baseUrl: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  },
): Promise<VerifierResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    return skippedResult(
      id,
      artifactPath,
      routes,
      "Playwright is not available and global fetch is unavailable.",
    );
  }

  const checks: BrowserCheck[] = [];
  for (const route of routes) {
    const url = absoluteUrl(options.baseUrl, route);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 10_000,
    );
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
      });
      checks.push({
        route,
        url,
        ok: response.status < 400,
        status: response.status,
      });
    } catch (error) {
      checks.push({
        route,
        url,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  await writeArtifact(artifactPath, {
    mode: "fetch-fallback",
    reason: "Playwright is not available; used deterministic fetch checks.",
    checks,
  });
  return checksResult(id, artifactPath, "Fetch fallback", checks);
}

async function skippedResult(
  id: string,
  artifactPath: string,
  routes: string[],
  reason: string,
): Promise<VerifierResult> {
  await writeArtifact(artifactPath, {
    mode: "skipped",
    reason,
    routes,
  });
  return {
    id,
    ok: true,
    severity: "warning",
    summary: `${reason} Browser verification was skipped without failing the migration run.`,
    artifactPaths: [artifactPath],
  };
}

function checksResult(
  id: string,
  artifactPath: string,
  mode: string,
  checks: BrowserCheck[],
): VerifierResult {
  const failed = checks.filter((check) => !check.ok);
  return {
    id,
    ok: failed.length === 0,
    severity: failed.length === 0 ? "info" : "warning",
    summary:
      failed.length === 0
        ? `${mode} verified ${checks.length} route(s).`
        : `${mode} found ${failed.length} route(s) needing follow-up.`,
    artifactPaths: [artifactPath],
  };
}

function routePaths(context: MigrationContext, routes?: string[]): string[] {
  const selected =
    routes ??
    context.ir.site.routes
      .filter((route) => route.kind !== "api")
      .map((route) => route.path);
  return selected.length > 0 ? selected : ["/"];
}

function absoluteUrl(baseUrl: string, routePath: string): string {
  return new URL(routePath, baseUrl).toString();
}

async function loadOptionalPlaywright(): Promise<PlaywrightLike | null> {
  try {
    const dynamicImport = new Function(
      "specifier",
      "return import(specifier)",
    ) as (specifier: string) => Promise<unknown>;
    return (await dynamicImport("playwright")) as PlaywrightLike;
  } catch {
    return null;
  }
}

async function writeArtifact(
  artifactPath: string,
  payload: unknown,
): Promise<void> {
  await fs.writeFile(artifactPath, `${JSON.stringify(payload, null, 2)}\n`);
}
