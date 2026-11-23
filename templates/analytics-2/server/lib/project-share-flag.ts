/**
 * The roles a project grant may carry, mapped to the framework's share roles.
 * The product's own permission names are the reference's, and are rendered by
 * the Share surface; this map is the storage contract only.
 */
export const PROJECT_SHARE_ROLES = ["viewer", "editor", "admin"] as const;
export type ProjectShareRole = (typeof PROJECT_SHARE_ROLES)[number];

export function isProjectShareRole(value: string): value is ProjectShareRole {
  return (PROJECT_SHARE_ROLES as readonly string[]).includes(value);
}
