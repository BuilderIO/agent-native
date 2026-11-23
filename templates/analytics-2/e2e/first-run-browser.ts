import type { BrowserContext, Page } from "@playwright/test";

export const RENDERER_PROBE_MS = 3000;

export class RendererStallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RendererStallError";
  }
}

type SessionContext = Pick<BrowserContext, "addCookies" | "cookies"> & {
  request: {
    storageState(): Promise<{
      cookies: Parameters<BrowserContext["addCookies"]>[0];
    }>;
  };
};

export async function bridgeSessionCookies(
  context: BrowserContext | SessionContext,
  base: string,
) {
  const source = context as SessionContext;
  const sessionCookies = (await source.request.storageState()).cookies;
  await source.addCookies(sessionCookies);
  const pageCookies = await source.cookies(base);
  if (
    sessionCookies.length === 0 ||
    !sessionCookies.every(({ name }) =>
      pageCookies.some((cookie) => cookie.name === name),
    )
  )
    throw new Error("Local QA login did not reach the browser context");
}

export async function probeRenderer(
  page: Pick<Page, "evaluate">,
  timeoutMs = RENDERER_PROBE_MS,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      page.evaluate(() => true).then(
        (value) => value === true,
        () => false,
      ),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function requireResponsiveRenderer(
  page: Pick<Page, "evaluate">,
  timeoutMs = RENDERER_PROBE_MS,
) {
  if (!(await probeRenderer(page, timeoutMs)))
    throw new RendererStallError(
      `Owned browser tab did not answer a trivial evaluate within ${timeoutMs}ms before the app was loaded`,
    );
}

export type RendererVerdict = "responsive" | "page-only" | "browser-wide";

export async function diagnoseRendererStall(
  context: Pick<BrowserContext, "newPage">,
  page: Pick<Page, "evaluate">,
  timeoutMs = RENDERER_PROBE_MS,
): Promise<RendererVerdict> {
  if (await probeRenderer(page, timeoutMs)) return "responsive";
  let blank: Page | undefined;
  try {
    blank = await Promise.race([
      context.newPage(),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Blank tab did not open")),
          timeoutMs,
        );
        timer.unref();
      }),
    ]);
    return (await probeRenderer(blank, timeoutMs))
      ? "page-only"
      : "browser-wide";
  } catch {
    return "browser-wide";
  } finally {
    void blank?.close().catch(() => undefined);
  }
}

export function stallExitCode(error: unknown) {
  return error instanceof RendererStallError ? 2 : undefined;
}
