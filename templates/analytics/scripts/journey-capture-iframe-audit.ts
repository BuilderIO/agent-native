interface ReplayIframeAuditInput {
  dimensions: { width: number; height: number };
  recordedIframeParentIds: number[];
}

export interface ReplayIframeAudit {
  visibleIframeCount: number;
  unavailableIframeCount: number;
}

/** Serialized into Playwright's page; tsx-rewritten nested functions cannot run there. */
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

  const containingBlockProperties = [
    "transform",
    "perspective",
    "filter",
    "backdrop-filter",
    "translate",
    "rotate",
    "scale",
  ];

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
      if (element.localName === "slot") {
        const assigned = (element as HTMLSlotElement).assignedNodes();
        const children = assigned.length > 0 ? assigned : element.childNodes;
        for (const child of Array.from(children)) {
          if (child.nodeType === 1) nodes.push(child);
        }
        continue;
      }
      const source = element.shadowRoot ?? node;
      for (const child of Array.from(source.childNodes)) {
        if (child.nodeType === 1) nodes.push(child);
      }
    }

    for (const frame of frames) {
      const frameStyle = view.getComputedStyle(frame);
      const visibility = frameStyle.visibility;
      if (visibility === "hidden" || visibility === "collapse") continue;
      const position = frameStyle.position;
      const positioned = position === "absolute" || position === "fixed";
      let containingBlock: Element | null = null;
      if (positioned) {
        for (
          let current: Element | null =
            frame.assignedSlot ?? frame.parentElement;
          current;
        ) {
          const styles = view.getComputedStyle(current);
          let establishesContainingBlock = false;
          if (styles.display !== "none" && styles.display !== "contents") {
            const containment = styles.contain.split(/\s+/);
            const hasContainingBlockProperty = containingBlockProperties.some(
              (property) => {
                const value = styles.getPropertyValue(property);
                return value !== "" && value !== "none";
              },
            );
            const willChange = styles.willChange.split(/\s*,\s*/);
            establishesContainingBlock =
              (position === "absolute" &&
                styles.position !== "" &&
                styles.position !== "static") ||
              containment.some((value) =>
                ["layout", "paint", "strict", "content"].includes(value),
              ) ||
              styles.contentVisibility === "auto" ||
              hasContainingBlockProperty ||
              (position === "absolute" && willChange.includes("position")) ||
              willChange.some((property) =>
                [
                  ...containingBlockProperties,
                  "contain",
                  "content-visibility",
                ].includes(property),
              );
          }
          if (establishesContainingBlock) {
            containingBlock = current;
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
      }
      let reachedContainingBlock = !positioned;
      const rootElement = owner.documentElement;
      const rootStyle = view.getComputedStyle(rootElement);
      const bodyStyle = owner.body ? view.getComputedStyle(owner.body) : null;
      const rootOverflowX = rootStyle.overflowX || rootStyle.overflow;
      const rootOverflowY = rootStyle.overflowY || rootStyle.overflow;
      const bodyOverflowPropagatesToViewport =
        bodyStyle !== null &&
        rootOverflowX === "visible" &&
        rootOverflowY === "visible" &&
        rootStyle.contain === "none" &&
        rootStyle.contentVisibility !== "auto" &&
        bodyStyle.display !== "none" &&
        bodyStyle.contain === "none" &&
        bodyStyle.contentVisibility !== "auto";

      let rendered = true;
      const bounds = frame.getBoundingClientRect();
      const frameScaleX =
        frame.offsetWidth > 0
          ? (bounds.right - bounds.left) / frame.offsetWidth
          : 1;
      const frameScaleY =
        frame.offsetHeight > 0
          ? (bounds.bottom - bounds.top) / frame.offsetHeight
          : 1;
      const contentLeft = bounds.left + frame.clientLeft * frameScaleX;
      const contentTop = bounds.top + frame.clientTop * frameScaleY;
      const contentRight = contentLeft + frame.clientWidth * frameScaleX;
      const contentBottom = contentTop + frame.clientHeight * frameScaleY;
      let visibleLeft = Math.max(contentLeft, clip.left);
      let visibleTop = Math.max(contentTop, clip.top);
      let visibleRight = Math.min(contentRight, clip.right);
      let visibleBottom = Math.min(contentBottom, clip.bottom);

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
        if (
          current !== frame &&
          (!positioned || reachedContainingBlock || current === containingBlock)
        ) {
          const ancestor = current as HTMLElement;
          const ancestorBounds = ancestor.getBoundingClientRect();
          const scaleX =
            ancestor.offsetWidth > 0
              ? ancestorBounds.width / ancestor.offsetWidth
              : 1;
          const scaleY =
            ancestor.offsetHeight > 0
              ? ancestorBounds.height / ancestor.offsetHeight
              : 1;
          const overflowX = styles.overflowX || styles.overflow;
          const overflowY = styles.overflowY || styles.overflow;
          const overflowAppliesToViewport =
            current === rootElement ||
            (current === owner.body && bodyOverflowPropagatesToViewport);
          const containment = styles.contain.split(/\s+/);
          let paintContainment = styles.contentVisibility === "auto";
          for (const value of containment) {
            if (
              value === "paint" ||
              value === "strict" ||
              value === "content"
            ) {
              paintContainment = true;
            }
          }
          const hasBox =
            styles.display !== "contents" && styles.display !== "inline";
          if (
            hasBox &&
            (paintContainment ||
              (!overflowAppliesToViewport &&
                ["auto", "clip", "hidden", "overlay", "scroll"].includes(
                  overflowX,
                )))
          ) {
            const left = ancestorBounds.left + ancestor.clientLeft * scaleX;
            visibleLeft = Math.max(visibleLeft, left);
            visibleRight = Math.min(
              visibleRight,
              left + ancestor.clientWidth * scaleX,
            );
          }
          if (
            hasBox &&
            (paintContainment ||
              (!overflowAppliesToViewport &&
                ["auto", "clip", "hidden", "overlay", "scroll"].includes(
                  overflowY,
                )))
          ) {
            const top = ancestorBounds.top + ancestor.clientTop * scaleY;
            visibleTop = Math.max(visibleTop, top);
            visibleBottom = Math.min(
              visibleBottom,
              top + ancestor.clientHeight * scaleY,
            );
          }
        }
        if (positioned && current === containingBlock) {
          reachedContainingBlock = true;
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

      if (
        !rendered ||
        visibleRight <= visibleLeft ||
        visibleBottom <= visibleTop ||
        view.innerWidth <= 0 ||
        view.innerHeight <= 0
      ) {
        continue;
      }

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
