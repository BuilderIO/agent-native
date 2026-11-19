import { saveRevisionOf } from "../save-conflict/index.js";

/** A resource save checks its content, the part the editor and agents change. */
export const RESOURCE_CONTENT_RECORD = "resource_content";

/**
 * What a reader sends back as `expectedRevision`, so its save can't write over
 * content someone else saved after the read. A browser gets the same token from
 * `saveRevisionOf({ content })`.
 */
export function resourceContentRevision(resource: { content: string }): string {
  return saveRevisionOf({ content: resource.content });
}
