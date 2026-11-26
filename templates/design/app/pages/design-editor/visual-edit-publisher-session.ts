/**
 * The identity this tab publishes visual-edit handoffs under. It lives in
 * sessionStorage so a reload keeps it: the server treats a waiting handoff
 * from another publisher as a collaborator's, so a fresh identity after reload
 * would lock the editor out of its own earlier publication. The revision
 * persists with it because the server only accepts newer revisions from the
 * same publisher.
 */
export interface VisualEditPublisherSession {
  publisherId: string;
  revision: number;
}

const storageKey = (designId: string) =>
  `design:visual-edit-publisher:${designId}`;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseSession(raw: string | null): VisualEditPublisherSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<VisualEditPublisherSession>;
    return typeof value.publisherId === "string" &&
      UUID_PATTERN.test(value.publisherId) &&
      typeof value.revision === "number" &&
      Number.isSafeInteger(value.revision) &&
      value.revision >= 0
      ? { publisherId: value.publisherId, revision: value.revision }
      : null;
  } catch (error) {
    console.warn(
      "[design:visual-edit] replacing an unreadable publisher session",
      error,
    );
    return null;
  }
}

// Reading sessionStorage throws when site data is blocked; the caller then
// gets a fresh identity, which only costs reload continuity.
export function readVisualEditPublisherSession(
  designId: string | undefined,
): VisualEditPublisherSession {
  const fresh = { publisherId: crypto.randomUUID(), revision: 0 };
  if (!designId) return fresh;
  try {
    const stored = parseSession(sessionStorage.getItem(storageKey(designId)));
    if (stored) return stored;
    sessionStorage.setItem(storageKey(designId), JSON.stringify(fresh));
  } catch (error) {
    console.warn(
      "[design:visual-edit] publisher session storage unavailable; a reload will publish as a new collaborator",
      error,
    );
  }
  return fresh;
}

export function writeVisualEditPublisherSession(
  designId: string,
  session: VisualEditPublisherSession,
): void {
  try {
    sessionStorage.setItem(storageKey(designId), JSON.stringify(session));
  } catch (error) {
    console.warn(
      "[design:visual-edit] publisher session storage unavailable; a reload will publish as a new collaborator",
      error,
    );
  }
}
