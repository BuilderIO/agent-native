/** 403/404 on an open deck: the viewer's access was revoked or the deck is gone. */
export function isDeckAccessLostStatus(status: unknown): boolean {
  return status === 403 || status === 404;
}
