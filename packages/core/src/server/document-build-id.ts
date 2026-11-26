import { getAppConfig } from "../app-config/index.js";

declare const __AGENT_NATIVE_BUILD_ID__: string | undefined;
declare const __AGENT_NATIVE_COMMIT_SHA__: string | undefined;

/**
 * The build id this server was built with. The bundler define is the normal
 * source; the app config covers an unbundled server, where the define is absent.
 */
export function documentBuildId(): string {
  const raw =
    typeof __AGENT_NATIVE_BUILD_ID__ === "string"
      ? __AGENT_NATIVE_BUILD_ID__
      : getAppConfig().observability.buildId;
  return (raw ?? "").trim();
}

/**
 * The release a served document names. Under the per-app deploy cache the build
 * id is a `content-<hash>` artifact id that no reader can tie to a commit, so
 * the baked workspace commit wins and the build id is only the fallback.
 */
export function documentReleaseId(): string {
  const baked =
    typeof __AGENT_NATIVE_COMMIT_SHA__ === "string"
      ? __AGENT_NATIVE_COMMIT_SHA__.trim()
      : "";
  return (
    baked ||
    (getAppConfig().observability.buildSha ?? "").trim() ||
    documentBuildId()
  );
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * `<meta name="agent-native-build-sha">` for every document the framework
 * serves, both the React Router documents and the hand-built auth pages, so a
 * capture of any of them can be attributed to a release. Empty when the release
 * is unknown: the marker is never written as an empty or "undefined" value.
 */
export function documentBuildIdMetaTag(): string {
  const value = documentReleaseId();
  if (!value) return "";
  return `<meta name="agent-native-build-sha" content="${escapeAttribute(value)}"/>`;
}
