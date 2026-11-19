import fs from "fs";
import path from "path";

/**
 * What a workspace deploy says it is serving, and how to check a live response
 * against it. Two ids answer two questions: the revision is the workspace
 * commit being deployed, stamped by the deploy itself; the app build id is the
 * id baked into that app's bundles, which a cached app carries unchanged across
 * commits. A response proves its app is current only when both match.
 */

export const SERVED_REVISION_HEADER = "x-agent-native-build-sha";
export const SERVED_APP_BUILD_ID_HEADER = "x-agent-native-app-build-id";

const MANIFEST_PATH = path.join(".netlify", "agent-native-served-builds.json");

export interface ServedBuildManifest {
  /** The workspace commit, or null when the deploy named none. */
  revision: string | null;
  /** Each app's baked build id. */
  apps: Record<string, string>;
}

export function servedBuildManifestPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, MANIFEST_PATH);
}

export function writeServedBuildManifest(
  workspaceRoot: string,
  manifest: ServedBuildManifest,
): void {
  const file = servedBuildManifestPath(workspaceRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Throws when the manifest is missing or malformed: there is nothing to check against. */
export function readServedBuildManifest(
  workspaceRoot: string,
): ServedBuildManifest {
  const file = servedBuildManifestPath(workspaceRoot);
  const raw: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  if (
    !isRecord(raw) ||
    !(raw.revision === null || typeof raw.revision === "string") ||
    !isRecord(raw.apps) ||
    !Object.values(raw.apps).every((id) => typeof id === "string" && id)
  ) {
    throw new Error(`${file} has an unexpected shape`);
  }
  return {
    revision: raw.revision,
    apps: raw.apps as Record<string, string>,
  };
}

const HTML_BUILD_ID =
  /<script data-agent-native-build-id>globalThis\.__AGENT_NATIVE_BUILD_ID__=("(?:[^"\\]|\\.)*");<\/script>/;

/** The build id an SSR page was rendered by, or null when the page has none. */
export function htmlBakedBuildId(html: string): string | null {
  const encoded = HTML_BUILD_ID.exec(html)?.[1];
  if (encoded === undefined) return null;
  const value: unknown = JSON.parse(encoded);
  return typeof value === "string" ? value : null;
}

export type ServedBuildCheck = { ok: true } | { ok: false; problems: string[] };

/**
 * Compare one app's live response with what the deploy built for it. Pass the
 * HTML of an SSR page to also check the id the bundle itself rendered, which
 * catches a deploy that stamped fresh headers around an old bundle.
 */
export function checkServedAppBuild(
  expected: { revision: string | null; appBuildId: string },
  served: { headers: { get(name: string): string | null }; html?: string },
): ServedBuildCheck {
  const problems: string[] = [];
  const compare = (label: string, want: string, got: string | null) => {
    if (got === null) problems.push(`${label} is missing (expected ${want})`);
    else if (got !== want) {
      problems.push(`${label} is ${got} (expected ${want})`);
    }
  };
  if (expected.revision !== null) {
    compare(
      SERVED_REVISION_HEADER,
      expected.revision,
      served.headers.get(SERVED_REVISION_HEADER),
    );
  }
  compare(
    SERVED_APP_BUILD_ID_HEADER,
    expected.appBuildId,
    served.headers.get(SERVED_APP_BUILD_ID_HEADER),
  );
  if (served.html !== undefined) {
    compare(
      "page build id",
      expected.appBuildId,
      htmlBakedBuildId(served.html),
    );
  }
  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}
