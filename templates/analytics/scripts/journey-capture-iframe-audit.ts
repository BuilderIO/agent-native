interface ReplayIframeAuditInput {
  dimensions: { width: number; height: number };
  recordedIframeParentIds: number[];
}

export interface ReplayIframeAudit {
  visibleIframeCount: number;
  unavailableIframeCount: number;
}

/** This function is serialized into the local Playwright page by page.evaluate. */
export function auditReplayIframeContent({
  dimensions,
  recordedIframeParentIds,
}: ReplayIframeAuditInput): ReplayIframeAudit {
  const MAX_REPLAY_IFRAME_DEPTH = 8;
  const state = (window as typeof window & { __anJourneyCapture?: any })
    .__anJourneyCapture;
  const replayFrame = state?.replayer?.iframe as HTMLIFrameElement | undefined;
  const replayDocument = replayFrame?.contentDocument;
  if (!replayDocument) throw new Error("replay_frame_missing");

  const recordedParents = new Set(recordedIframeParentIds);
  const mirror = state.replayer.getMirror?.();
  const documents = [
    {
      owner: replayDocument,
      clip: {
        left: 0,
        top: 0,
        right: dimensions.width,
        bottom: dimensions.height,
      },
      depth: 0,
    },
  ];
  let visibleIframeCount = 0;
  let unavailableIframeCount = 0;

  while (documents.length > 0) {
    const { owner, clip, depth } = documents.pop()!;
    const view = owner.defaultView;
    if (!view || !owner.documentElement) continue;

    const frames: HTMLIFrameElement[] = [];
    const nodes: Node[] = [owner.documentElement];
    while (nodes.length > 0) {
      const node = nodes.pop()!;
      if (node.nodeType !== 1) continue;
      const element = node as Element;
      if (element.tagName === "IFRAME") {
        frames.push(element as HTMLIFrameElement);
        continue;
      }
      const source = element.shadowRoot ?? node;
      for (const child of Array.from(source.childNodes)) {
        if (child.nodeType === 1 && (child as Element).localName === "slot") {
          const assigned = (child as HTMLSlotElement).assignedNodes();
          if (assigned.length > 0) {
            nodes.push(...assigned);
            continue;
          }
        }
        if (child.nodeType === 1) nodes.push(child);
      }
    }

    for (const frame of frames) {
      const visibility = view.getComputedStyle(frame).visibility;
      if (visibility === "hidden" || visibility === "collapse") continue;

      let rendered = true;
      for (let current: Element | null = frame; current; ) {
        const styles = view.getComputedStyle(current);
        if (
          styles.display === "none" ||
          styles.contentVisibility === "hidden" ||
          (styles.opacity !== "" && Number(styles.opacity) === 0)
        ) {
          rendered = false;
          break;
        }
        if (current.assignedSlot) {
          current = current.assignedSlot;
        } else if (current.parentElement) {
          current = current.parentElement;
        } else {
          const root = current.getRootNode();
          current =
            root.nodeType === 11 && "host" in root
              ? (root as ShadowRoot).host
              : null;
        }
      }

      const bounds = frame.getBoundingClientRect();
      if (
        !rendered ||
        bounds.width <= 0 ||
        bounds.height <= 0 ||
        view.innerWidth <= 0 ||
        view.innerHeight <= 0
      ) {
        continue;
      }
      const visibleLeft = Math.max(bounds.left, clip.left);
      const visibleTop = Math.max(bounds.top, clip.top);
      const visibleRight = Math.min(bounds.right, clip.right);
      const visibleBottom = Math.min(bounds.bottom, clip.bottom);
      if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) continue;

      visibleIframeCount += 1;
      if (depth >= MAX_REPLAY_IFRAME_DEPTH) {
        unavailableIframeCount += 1;
        continue;
      }

      const id = mirror?.getId?.(frame);
      let unavailable = !Number.isSafeInteger(id) || !recordedParents.has(id);
      let child: Document | null = null;
      try {
        child = frame.contentDocument;
      } catch {
        child = null;
      }
      if (!child?.documentElement) {
        unavailable = true;
      } else {
        const childView = child.defaultView;
        const width =
          childView?.innerWidth || child.documentElement.clientWidth;
        const height =
          childView?.innerHeight || child.documentElement.clientHeight;
        const frameScaleX =
          frame.offsetWidth > 0
            ? (bounds.right - bounds.left) / frame.offsetWidth
            : 1;
        const frameScaleY =
          frame.offsetHeight > 0
            ? (bounds.bottom - bounds.top) / frame.offsetHeight
            : 1;
        const contentScaleX = (frame.clientWidth * frameScaleX) / width;
        const contentScaleY = (frame.clientHeight * frameScaleY) / height;
        if (
          !childView ||
          width <= 0 ||
          height <= 0 ||
          contentScaleX <= 0 ||
          contentScaleY <= 0
        ) {
          unavailable = true;
        } else {
          const contentLeft = bounds.left + frame.clientLeft * frameScaleX;
          const contentTop = bounds.top + frame.clientTop * frameScaleY;
          const childClip = {
            left: Math.max(
              0,
              Math.min(width, (visibleLeft - contentLeft) / contentScaleX),
            ),
            top: Math.max(
              0,
              Math.min(height, (visibleTop - contentTop) / contentScaleY),
            ),
            right: Math.max(
              0,
              Math.min(width, (visibleRight - contentLeft) / contentScaleX),
            ),
            bottom: Math.max(
              0,
              Math.min(height, (visibleBottom - contentTop) / contentScaleY),
            ),
          };
          if (
            childClip.right <= childClip.left ||
            childClip.bottom <= childClip.top
          ) {
            unavailable = true;
          } else {
            documents.push({ owner: child, clip: childClip, depth: depth + 1 });
          }
        }
      }
      if (unavailable) unavailableIframeCount += 1;
    }
  }

  return { visibleIframeCount, unavailableIframeCount };
}
