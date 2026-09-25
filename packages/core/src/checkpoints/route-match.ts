/**
 * The framework mount shim normally rewrites `event.path` to the mount-relative
 * remainder ("/restore"), but it falls back to the unstripped request path when
 * `event.url` is read-only on the host runtime. Accept both so a restore POST
 * never silently 405s.
 */
export function isCheckpointRestorePath(path: string | undefined): boolean {
  if (!path) return false;
  return (
    /(^|\/)checkpoints\/restore(?:[/?]|$)/.test(path) ||
    /^\/?restore(?:[/?]|$)/.test(path)
  );
}
