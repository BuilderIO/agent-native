/**
 * The lowest configuration layer: what this app's own package.json says it is.
 *
 * Before this existed, `server/app-name.ts` resolved the same three values with
 * its own env read and its own package.json parse, so the display name had two
 * resolvers that disagreed — `getAppConfig().app.name` was undefined for every
 * first-party template while `getAppName()` returned "Mail". Reading
 * package.json is configuration resolution, so it is a layer here rather than a
 * helper beside the consumers.
 *
 * Only `name`, `slug`, and `description` are emitted. `packageName` and
 * `template` are deliberately left to the env layer: both are read as app-id
 * fallbacks in credential-grant lookups (`onboarding/default-steps.ts` matches
 * a stored workspace connection grant by them), and filling them where they are
 * currently undefined would repoint those lookups.
 */

import fs from "node:fs";
import path from "node:path";

import { TEMPLATES } from "../cli/templates-meta.js";
import type { AppConfigInput } from "./schema.js";

/**
 * No package.json and an unparseable one are different answers.
 *
 * The helper this replaces caught both and returned null, so a malformed
 * package.json branded the app "Agent Native" and sent its transactional email
 * from the generic mailbox with nothing in the log. Absent is normal — core
 * runs outside a package all the time. Present-but-unreadable is a
 * misconfiguration, and it names the file it could not parse.
 */
function readPkg(): { name?: string; displayName?: string } | null {
  const pkgPath = path.join(process.cwd(), "package.json");
  let raw: string;
  try {
    raw = fs.readFileSync(pkgPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw new Error(
      `[agent-native] Could not read ${pkgPath} while resolving app configuration: ${
        (err as Error)?.message ?? err
      }`,
    );
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `[agent-native] ${pkgPath} is not valid JSON, so this app's name and ` +
        `transactional email sender cannot be resolved: ${(err as Error)?.message ?? err}`,
    );
  }
}

function titlecase(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

let cached: AppConfigInput | undefined;

/**
 * A template match is required for `slug` and `description`, and for a name
 * derived from `pkg.name`. On serverless runtimes `process.cwd()` can point at
 * a bundler-generated package.json with a bogus name, so an unrecognized name
 * yields nothing rather than a guess.
 */
export function readPackageConfigLayer(): AppConfigInput {
  if (cached) return cached;
  const pkg = readPkg();
  const template = pkg?.name
    ? TEMPLATES.find((t) => t.name === pkg.name)
    : undefined;
  const name =
    pkg?.displayName ??
    (template ? template.label || titlecase(template.name) : undefined);

  const app: Record<string, string> = {};
  if (name) app.name = name;
  if (template) {
    app.slug = template.name;
    if (template.hint) app.description = template.hint;
  }
  return (cached = Object.keys(app).length ? { app } : {});
}

/** Drops the memoized package.json read. Tests only. */
export function resetPackageConfigLayerForTests(): void {
  cached = undefined;
}
