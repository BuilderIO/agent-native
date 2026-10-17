// Dashboard ids: letters, digits, dot, dash, underscore. An id also names a
// seed file and keys the shipped-seed map, so a path separator, "..", or an
// Object.prototype member such as __proto__ or constructor must never reach
// those lookups.
const SAFE_DASHBOARD_ID = /^[A-Za-z0-9._-]+$/;

export function isSafeDashboardId(id: string): boolean {
  return (
    SAFE_DASHBOARD_ID.test(id) &&
    !id.includes("..") &&
    !(id in Object.prototype)
  );
}
