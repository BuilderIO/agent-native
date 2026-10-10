type ViewedSourceLease = {
  doc: Document;
  versionHash?: string;
  pending?: { requestId: string; versionHash: string };
};

const leases = new WeakMap<HTMLIFrameElement, ViewedSourceLease>();
const SOURCE_HASH = /^\d+:[0-9a-z]+$/;

export function registerNativeViewedSource(
  iframe: HTMLIFrameElement,
  doc: Document,
  versionHash: string,
): void {
  if (!SOURCE_HASH.test(versionHash))
    throw new TypeError("The source version is invalid.");
  if (leases.get(iframe)?.doc === doc) return;
  leases.set(iframe, { doc, versionHash });
}

export function beginNativeViewedSourceReplacement(
  iframe: HTMLIFrameElement,
  doc: Document,
  versionHash: string,
): string {
  if (!SOURCE_HASH.test(versionHash))
    throw new Error("The replacement source version is invalid.");
  const requestId = crypto.randomUUID();
  leases.set(iframe, {
    doc,
    pending: { requestId, versionHash },
  });
  return requestId;
}

export function acceptNativeViewedSourceReplacement(
  iframe: HTMLIFrameElement,
  doc: Document,
  requestId: string,
): boolean {
  const lease = leases.get(iframe);
  if (lease?.doc !== doc || lease.pending?.requestId !== requestId)
    return false;
  leases.set(iframe, {
    doc,
    versionHash: lease.pending.versionHash,
  });
  return true;
}

export function invalidateNativeViewedSource(
  iframe: HTMLIFrameElement,
  doc?: Document,
): void {
  const lease = leases.get(iframe);
  if (lease && (!doc || lease.doc === doc)) leases.delete(iframe);
}

export function readNativeViewedSourceLease(
  iframe: HTMLIFrameElement,
  doc: Document,
): string | undefined {
  const lease = leases.get(iframe);
  return lease?.doc === doc ? lease.versionHash : undefined;
}
