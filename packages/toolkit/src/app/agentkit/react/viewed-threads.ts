const views = new Map<string, Set<HTMLElement>>();
const listeners = new Set<() => void>();
let observer: IntersectionObserver | null | undefined;

function notify(): void {
  for (const listener of listeners) listener();
}

// A transcript changes on-screen state without remounting: a hidden chat tab
// is `display: none`, and the agent sidebar slides out of view. Watching
// intersection reports those changes instead of each host announcing them.
function intersectionObserver(): IntersectionObserver | null {
  if (observer === undefined) {
    observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(notify);
  }
  return observer;
}

/**
 * Declares that `element` shows `threadId`'s transcript. The thread counts as
 * viewed only while the element is actually on screen in a visible tab.
 */
export function registerChatThreadView(
  threadId: string,
  element: HTMLElement,
): () => void {
  let elements = views.get(threadId);
  if (!elements) {
    elements = new Set();
    views.set(threadId, elements);
  }
  elements.add(element);
  intersectionObserver()?.observe(element);
  notify();
  return () => {
    const current = views.get(threadId);
    if (!current?.delete(element)) return;
    if (current.size === 0) views.delete(threadId);
    intersectionObserver()?.unobserve(element);
    notify();
  };
}

export function subscribeChatThreadViews(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function isOnScreen(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  // A closed agent sidebar stays mounted but inert while it slides away.
  if (element.closest('[inert], [aria-hidden="true"]')) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const view = element.ownerDocument.defaultView;
  if (!view) return true;
  return (
    rect.right > 0 &&
    rect.bottom > 0 &&
    rect.left < view.innerWidth &&
    rect.top < view.innerHeight
  );
}

export function isChatThreadViewed(
  threadId: string,
  doc: Document = document,
): boolean {
  if (doc.visibilityState !== "visible") return false;
  const elements = views.get(threadId);
  if (!elements) return false;
  for (const element of elements) {
    if (isOnScreen(element)) return true;
  }
  return false;
}
