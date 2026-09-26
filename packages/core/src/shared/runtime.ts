
export function isNodeRuntime(): boolean {
  return (
    typeof process !== "undefined" &&
    typeof process.versions?.node === "string" &&
    !("__cf_env" in globalThis) &&
    !("__env__" in globalThis) &&
    !("Deno" in globalThis)
  );
}

export function isCloudflareRuntime(): boolean {
  return (
    "__cf_env" in globalThis ||
    "__env__" in globalThis ||
    (typeof navigator !== "undefined" &&
      navigator.userAgent === "Cloudflare-Workers")
  );
}

export function isEdgeRuntime(): boolean {
  return !isNodeRuntime();
}
