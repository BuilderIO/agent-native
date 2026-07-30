/**
 * Renders one screen in real Chromium and reports whether it came up clean.
 * The completeness backstop behind `html-integrity`'s syntax checks: a typo'd
 * scope object parses fine and only a browser notices the binding never ran.
 */

import { createHash } from "node:crypto";

import type {
  RenderFinding,
  RenderVerificationStatus,
} from "../../shared/render-verification.js";
import {
  importPlaywright,
  isMissingBrowserError,
  launchChromium,
} from "./playwright-runtime.js";

export interface RenderVerificationRun {
  status: RenderVerificationStatus;
  findings: RenderFinding[];
  /** Present only when `status` is `unavailable`. */
  reason?: string;
  /** Findings dropped by the caps below, so a short list is never read as complete. */
  droppedFindings?: number;
}

/**
 * A page can emit unique errors in a loop for the whole settle window, and the
 * result is persisted. Cap both the count and the serialized size, and say so
 * rather than silently returning a partial list.
 */
const MAX_FINDINGS = 25;
const MAX_FINDINGS_BYTES = 16_000;

/** Keyed on content, so an edit invalidates the stamp without anyone clearing it. */
export function renderVerificationHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

const DEFAULT_VIEWPORTS = [
  { label: "390", width: 390, height: 844 },
  { label: "1440", width: 1440, height: 900 },
];

/** Enough for the Tailwind browser build to fetch, compile, and paint. */
const SETTLE_MS = 4000;

/**
 * The renderer executes author-controlled HTML, so anything it requests is an
 * outbound request the server makes on the author's behalf. Loopback, RFC1918
 * and the cloud metadata endpoint are never legitimate for a design preview.
 */
const PRIVATE_HOST =
  /^(?:localhost|127(?:\.\d+){3}|0\.0\.0\.0|\[?::1\]?|10(?:\.\d+){3}|192\.168(?:\.\d+){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d+){2}|169\.254(?:\.\d+){2}|.*\.internal|.*\.local)$/i;

export function isPrivateNetworkUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:" || parsed.protocol === "blob:") return true;
    return PRIVATE_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * The utility class names the document actually uses. Sampling a fixed selector
 * list instead reports a correctly styled `w-full` screen as inert, and passes
 * an unstyled `p-8` screen because some unrelated `.flex` rule happened to exist.
 */
const UTILITY_CANDIDATE =
  /^(?:flex|grid|hidden|block|inline|absolute|relative|sticky|fixed|container)$|^(?:p|m|px|py|mx|my|pt|pb|pl|pr|mt|mb|ml|mr|gap|w|h|text|bg|border|rounded|shadow|items|justify|font|leading|tracking|space|min|max|opacity|ring|z|grid|col|row|order|inset|top|left|right|bottom|overflow|cursor|transition|duration|scale|translate)-/;

export function tailwindUtilitiesUsed(html: string): string[] {
  const names = new Set<string>();
  for (const match of html.matchAll(/\bclass\s*=\s*"([^"]*)"/gi)) {
    for (const token of (match[1] ?? "").split(/\s+/)) {
      // Variants compile to the same base rule, and an arbitrary value carries
      // characters CSS escapes, so neither survives a name comparison.
      if (!token || token.includes(":") || token.includes("[")) continue;
      if (UTILITY_CANDIDATE.test(token)) names.add(token);
    }
  }
  return [...names].slice(0, 40);
}

function truncate(value: string): string {
  return value.length > 300 ? `${value.slice(0, 300)}…` : value;
}

export async function verifyDesignRender(args: {
  html: string;
  viewports?: Array<{ label: string; width: number; height: number }>;
}): Promise<RenderVerificationRun> {
  if (!args.html.trim()) {
    return {
      status: "fail",
      findings: [{ kind: "page-error", message: "the screen has no content" }],
    };
  }

  let browser: Awaited<ReturnType<typeof launchChromium>> | null = null;
  try {
    const { chromium } = await importPlaywright();
    browser = await launchChromium(chromium);
  } catch (error) {
    // A host with no Chromium cannot verify anything. Saying so is the point:
    // collapsing this into a pass is how an unverified screen ships as ready.
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "unavailable",
      findings: [{ kind: "page-error", message: truncate(message) }],
      reason: isMissingBrowserError(error)
        ? "no Chromium binary is available on this host"
        : truncate(message),
    };
  }

  const findings: RenderFinding[] = [];
  const seen = new Set<string>();
  let findingBytes = 0;
  let dropped = 0;
  const utilities = tailwindUtilitiesUsed(args.html);

  try {
    for (const viewport of args.viewports ?? DEFAULT_VIEWPORTS) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
      });
      const record = (kind: RenderFinding["kind"], message: string) => {
        const key = `${kind}:${message}`;
        if (seen.has(key)) return;
        seen.add(key);
        if (
          findings.length >= MAX_FINDINGS ||
          findingBytes >= MAX_FINDINGS_BYTES
        ) {
          dropped += 1;
          return;
        }
        const entry = {
          kind,
          message: truncate(message),
          viewport: viewport.label,
        };
        findingBytes += entry.message.length;
        findings.push(entry);
      };

      page.on("pageerror", (error) => record("page-error", String(error)));
      page.on("console", (message) => {
        const text = message.text();
        if (message.type() === "error") record("console-error", text);
        // Alpine reports every failed expression at warn level, and only that
        // message carries the expression and element.
        else if (message.type() === "warning" && /Alpine/.test(text)) {
          record("alpine-expression", text);
        }
      });

      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (isPrivateNetworkUrl(url)) {
          record(
            "blocked-request",
            `refused a private-network request to ${url}`,
          );
          return route.abort("blockedbyclient");
        }
        return route.continue();
      });

      await page.setContent(args.html, { waitUntil: "load" });
      await page.waitForTimeout(SETTLE_MS);

      if (utilities.length > 0) {
        const missing = await page.evaluate((candidates: string[]) => {
          const emitted = new Set<string>();
          for (const sheet of Array.from(document.styleSheets)) {
            try {
              for (const rule of Array.from(sheet.cssRules)) {
                const match = /\.((?:[\\][^\s]|[\w-])+)/g;
                let found = match.exec(rule.cssText);
                while (found) {
                  emitted.add(found[1]!.replace(/\\/g, ""));
                  found = match.exec(rule.cssText);
                }
              }
            } catch {
              // A cross-origin sheet cannot be read; treat it as contributing nothing.
            }
          }
          return candidates.filter((name) => !emitted.has(name));
        }, utilities);
        // A screen can legitimately carry a class Tailwind does not generate, so
        // only a wholesale miss means the runtime never produced CSS.
        if (missing.length === utilities.length) {
          record(
            "runtime-inert",
            `none of the ${utilities.length} Tailwind utilities this screen uses ` +
              `(${utilities.slice(0, 5).join(", ")}) produced any CSS, so it renders unstyled`,
          );
        }
      }

      await page.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "unavailable",
      findings: [{ kind: "page-error", message: truncate(message) }],
      reason: truncate(message),
    };
  } finally {
    await browser.close().catch(() => {});
  }

  if (findings.length > 0) {
    return dropped > 0
      ? { status: "fail", findings, droppedFindings: dropped }
      : { status: "fail", findings };
  }
  return { status: "pass", findings: [] };
}
