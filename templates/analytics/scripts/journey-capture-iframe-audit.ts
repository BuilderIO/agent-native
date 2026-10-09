interface ReplayIframeAuditInput {
  dimensions: { width: number; height: number };
  recordedIframeParentIds: number[];
}

export interface ReplayIframeAudit {
  visibleIframeCount: number;
  unavailableIframeCount: number;
  unverifiableIframeCount?: number;
}

/**
 * Playwright serializes this without tsx's module helper. Keep nested callbacks
 * anonymous to avoid unresolved `__name` references.
 */
export function auditReplayIframeContent({
  dimensions,
  recordedIframeParentIds,
}: ReplayIframeAuditInput): ReplayIframeAudit {
  type Point = { x: number; y: number };
  type LinearTransform = { a: number; b: number; c: number; d: number };
  type BoxGeometry = {
    bounds: DOMRect;
    height: number;
    transform: LinearTransform | null;
    uncertain: boolean;
    width: number;
  };

  const MAX_REPLAY_IFRAME_DEPTH = 8;
  const state = (window as typeof window & { __anJourneyCapture?: any })
    .__anJourneyCapture;
  const replayFrame = state?.replayer?.iframe as HTMLIFrameElement | undefined;
  const replayDocument = replayFrame?.contentDocument;
  if (!replayDocument) throw new Error("replay_frame_missing");

  const recordedParents = new Set(recordedIframeParentIds);
  const mirror = state.replayer.getMirror?.();
  const boxGeometries = new WeakMap<Element, BoxGeometry>();

  const [multiply]: [
    (left: LinearTransform, right: LinearTransform) => LinearTransform,
  ] = [
    (left, right) => ({
      a: left.a * right.a + left.c * right.b,
      b: left.b * right.a + left.d * right.b,
      c: left.a * right.c + left.c * right.d,
      d: left.b * right.c + left.d * right.d,
    }),
  ];

  const [parentElement]: [(element: Element) => Element | null] = [
    (element) => {
      if (element.assignedSlot) return element.assignedSlot;
      if (element.parentElement) return element.parentElement;
      const root = element.getRootNode();
      return root.nodeType === 11 && "host" in root
        ? (root as ShadowRoot).host
        : null;
    },
  ];

  const [rotation]: [(value: string) => LinearTransform | null] = [
    (value) => {
      if (!value || value === "none") return { a: 1, b: 0, c: 0, d: 1 };
      const parts = value.trim().split(/\s+/);
      const match = parts[parts.length - 1]!.match(
        /^(-?(?:\d+(?:\.\d*)?|\.\d+))(deg|rad|grad|turn)$/i,
      );
      if (!match) return null;

      let degrees = Number(match[1]);
      switch (match[2]!.toLowerCase()) {
        case "rad":
          degrees = (degrees * 180) / Math.PI;
          break;
        case "grad":
          degrees *= 0.9;
          break;
        case "turn":
          degrees *= 360;
          break;
      }

      if (parts.length === 4) {
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        const z = Number(parts[2]);
        if (Math.abs(x) > 1e-8 || Math.abs(y) > 1e-8) return null;
        if (Math.abs(z) <= 1e-8) return { a: 1, b: 0, c: 0, d: 1 };
        degrees *= Math.sign(z);
      } else if (
        parts.length !== 1 &&
        !(parts.length === 2 && parts[0] === "z")
      ) {
        return null;
      }

      const radians = (degrees * Math.PI) / 180;
      const cosine = Math.cos(radians);
      const sine = Math.sin(radians);
      return { a: cosine, b: sine, c: -sine, d: cosine };
    },
  ];

  const [transformFor]: [
    (element: Element, view: Window) => LinearTransform | null,
  ] = [
    (element, view) => {
      let combined: LinearTransform = { a: 1, b: 0, c: 0, d: 1 };
      for (
        let current: Element | null = element;
        current;
        current = parentElement(current)
      ) {
        const styles = view.getComputedStyle(current);
        if (
          (styles.perspective && styles.perspective !== "none") ||
          (styles.getPropertyValue("offset-path") &&
            styles.getPropertyValue("offset-path") !== "none")
        ) {
          return null;
        }
        if (styles.display === "contents") continue;

        let local: LinearTransform = { a: 1, b: 0, c: 0, d: 1 };
        const transformValue = styles.transform;
        if (transformValue && transformValue !== "none") {
          const Matrix = (view as any).DOMMatrix;
          if (!Matrix) return null;
          const matrix = new Matrix(transformValue);
          if (!matrix.is2D) return null;
          local = {
            a: matrix.a,
            b: matrix.b,
            c: matrix.c,
            d: matrix.d,
          };
        }

        const scaleValue = styles.getPropertyValue("scale");
        if (scaleValue && scaleValue !== "none") {
          const values = scaleValue.split(/\s+/).map(Number);
          if (
            values.length > 3 ||
            values.some((value) => !Number.isFinite(value)) ||
            (values.length === 3 && Math.abs(values[2]! - 1) > 1e-8)
          ) {
            return null;
          }
          local = multiply(
            {
              a: values[0]!,
              b: 0,
              c: 0,
              d: values[1] ?? values[0]!,
            },
            local,
          );
        }

        const rotationValue = styles.getPropertyValue("rotate");
        const rotate = rotation(rotationValue);
        if (!rotate) return null;
        local = multiply(rotate, local);
        combined = multiply(local, combined);
      }
      return combined;
    },
  ];

  const [geometryFor]: [(element: Element, view: Window) => BoxGeometry] = [
    (element, view) => {
      const cached = boxGeometries.get(element);
      if (cached) return cached;

      const htmlElement = element as HTMLElement;
      const bounds = element.getBoundingClientRect();
      const width = htmlElement.offsetWidth || bounds.width;
      const height = htmlElement.offsetHeight || bounds.height;
      const unscaled = transformFor(element, view);
      let transform: LinearTransform | null = null;
      let uncertain = unscaled === null;
      if (unscaled && width > 0 && height > 0) {
        const expectedWidth =
          Math.abs(unscaled.a) * width + Math.abs(unscaled.c) * height;
        const expectedHeight =
          Math.abs(unscaled.b) * width + Math.abs(unscaled.d) * height;
        if (expectedWidth > 0 && expectedHeight > 0) {
          const scaleX = bounds.width / expectedWidth;
          const scaleY = bounds.height / expectedHeight;
          const tolerance = Math.max(scaleX, scaleY) * 0.05;
          if (
            scaleX > 0 &&
            scaleY > 0 &&
            Math.abs(scaleX - scaleY) <= tolerance
          ) {
            const scale = (scaleX + scaleY) / 2;
            transform = {
              a: unscaled.a * scale,
              b: unscaled.b * scale,
              c: unscaled.c * scale,
              d: unscaled.d * scale,
            };
          } else {
            uncertain = true;
          }
        } else {
          uncertain = true;
        }
      }

      const result = { bounds, height, transform, uncertain, width };
      boxGeometries.set(element, result);
      return result;
    },
  ];

  const [pointToScreen]: [(geometry: BoxGeometry, point: Point) => Point] = [
    (geometry, point) => {
      const { bounds, height, transform, width } = geometry;
      if (!transform) {
        return {
          x: bounds.left + (point.x / width) * bounds.width,
          y: bounds.top + (point.y / height) * bounds.height,
        };
      }
      const x = point.x - width / 2;
      const y = point.y - height / 2;
      return {
        x: (bounds.left + bounds.right) / 2 + transform.a * x + transform.c * y,
        y: (bounds.top + bounds.bottom) / 2 + transform.b * x + transform.d * y,
      };
    },
  ];

  const [pointToLocal]: [(geometry: BoxGeometry, point: Point) => Point] = [
    (geometry, point) => {
      const { bounds, height, transform, width } = geometry;
      if (!transform) {
        return {
          x: ((point.x - bounds.left) / bounds.width) * width,
          y: ((point.y - bounds.top) / bounds.height) * height,
        };
      }
      const determinant = transform.a * transform.d - transform.b * transform.c;
      if (Math.abs(determinant) <= 1e-12) return { x: NaN, y: NaN };
      const x = point.x - (bounds.left + bounds.right) / 2;
      const y = point.y - (bounds.top + bounds.bottom) / 2;
      return {
        x: width / 2 + (transform.d * x - transform.c * y) / determinant,
        y: height / 2 + (-transform.b * x + transform.a * y) / determinant,
      };
    },
  ];

  const [polygonArea]: [(polygon: Point[]) => number] = [
    (polygon) => {
      let area = 0;
      for (let index = 0; index < polygon.length; index += 1) {
        const current = polygon[index]!;
        const next = polygon[(index + 1) % polygon.length]!;
        area += current.x * next.y - next.x * current.y;
      }
      return area / 2;
    },
  ];

  const [intersectPolygons]: [(subject: Point[], clip: Point[]) => Point[]] = [
    (subject, clip) => {
      if (subject.length < 3 || clip.length < 3) return [];
      const orientation = polygonArea(clip) >= 0 ? 1 : -1;
      let output = subject;
      for (let index = 0; index < clip.length; index += 1) {
        const start = clip[index]!;
        const end = clip[(index + 1) % clip.length]!;
        const edgeX = end.x - start.x;
        const edgeY = end.y - start.y;
        const input = output;
        output = [];
        if (input.length === 0) break;

        let previous = input[input.length - 1]!;
        let previousDistance =
          orientation *
          (edgeX * (previous.y - start.y) - edgeY * (previous.x - start.x));
        for (const current of input) {
          const currentDistance =
            orientation *
            (edgeX * (current.y - start.y) - edgeY * (current.x - start.x));
          const previousInside = previousDistance >= -1e-7;
          const currentInside = currentDistance >= -1e-7;
          if (previousInside !== currentInside) {
            const ratio =
              previousDistance / (previousDistance - currentDistance);
            output.push({
              x: previous.x + (current.x - previous.x) * ratio,
              y: previous.y + (current.y - previous.y) * ratio,
            });
          }
          if (currentInside) output.push(current);
          previous = current;
          previousDistance = currentDistance;
        }
      }
      return output;
    },
  ];

  const [
    clipLocalBound,
    clipLocalAxis,
    hasVisibleArea,
    hasRoundedCornerOverlap,
  ]: [
    (
      points: Point[],
      geometry: BoxGeometry,
      axis: "x" | "y",
      boundary: number,
      isMinimum: boolean,
    ) => Point[],
    (
      polygon: Point[],
      geometry: BoxGeometry,
      axis: "x" | "y",
      minimum: number,
      maximum: number,
    ) => Point[],
    (polygon: Point[]) => boolean,
    (
      polygon: Point[],
      geometry: BoxGeometry,
      ancestor: HTMLElement,
      styles: CSSStyleDeclaration,
    ) => boolean,
  ] = [
    (points, geometry, axis, boundary, isMinimum) => {
      if (points.length === 0) return [];
      const clipped: Point[] = [];
      let previous = points[points.length - 1]!;
      const previousLocal = pointToLocal(geometry, previous);
      const previousValue = axis === "x" ? previousLocal.x : previousLocal.y;
      let previousDistance = isMinimum
        ? previousValue - boundary
        : boundary - previousValue;
      for (const current of points) {
        const currentLocal = pointToLocal(geometry, current);
        const currentValue = axis === "x" ? currentLocal.x : currentLocal.y;
        const currentDistance = isMinimum
          ? currentValue - boundary
          : boundary - currentValue;
        const previousInside = previousDistance >= -1e-7;
        const currentInside = currentDistance >= -1e-7;
        if (previousInside !== currentInside) {
          const ratio = previousDistance / (previousDistance - currentDistance);
          clipped.push({
            x: previous.x + (current.x - previous.x) * ratio,
            y: previous.y + (current.y - previous.y) * ratio,
          });
        }
        if (currentInside) clipped.push(current);
        previous = current;
        previousDistance = currentDistance;
      }
      return clipped;
    },
    (polygon, geometry, axis, minimum, maximum) =>
      clipLocalBound(
        clipLocalBound(polygon, geometry, axis, minimum, true),
        geometry,
        axis,
        maximum,
        false,
      ),
    (polygon) => polygon.length >= 3 && Math.abs(polygonArea(polygon)) > 1e-4,
    (polygon, geometry, ancestor, styles) => {
      if (polygon.length < 3) return false;
      const local = polygon.map((point) => pointToLocal(geometry, point));
      const minX = Math.min(...local.map((point) => point.x));
      const maxX = Math.max(...local.map((point) => point.x));
      const minY = Math.min(...local.map((point) => point.y));
      const maxY = Math.max(...local.map((point) => point.y));
      const cornerValues = [
        [styles.borderTopLeftRadius, ancestor.clientLeft, ancestor.clientTop],
        [
          styles.borderTopRightRadius,
          ancestor.clientLeft + ancestor.clientWidth,
          ancestor.clientTop,
        ],
        [
          styles.borderBottomRightRadius,
          ancestor.clientLeft + ancestor.clientWidth,
          ancestor.clientTop + ancestor.clientHeight,
        ],
        [
          styles.borderBottomLeftRadius,
          ancestor.clientLeft,
          ancestor.clientTop + ancestor.clientHeight,
        ],
      ] as const;
      for (let index = 0; index < cornerValues.length; index += 1) {
        const [value, edgeX, edgeY] = cornerValues[index]!;
        const radii = value
          .split(/[ /]+/)
          .filter(Boolean)
          .map((part, radiusIndex) => {
            const extent = radiusIndex === 0 ? geometry.width : geometry.height;
            const amount = Number.parseFloat(part);
            return part.endsWith("%") ? (amount / 100) * extent : amount;
          });
        const radiusX = radii[0] ?? 0;
        const radiusY = radii[1] ?? radiusX;
        if (radiusX <= 0 || radiusY <= 0) continue;
        const left = index === 0 || index === 3 ? edgeX : edgeX - radiusX;
        const top = index < 2 ? edgeY : edgeY - radiusY;
        if (
          maxX > left &&
          minX < left + radiusX &&
          maxY > top &&
          minY < top + radiusY
        ) {
          return true;
        }
      }
      return false;
    },
  ];

  const documents = [
    {
      owner: replayDocument,
      clip: [
        { x: 0, y: 0 },
        { x: dimensions.width, y: 0 },
        { x: dimensions.width, y: dimensions.height },
        { x: 0, y: dimensions.height },
      ],
      depth: 0,
    },
  ];
  let visibleIframeCount = 0;
  let unavailableIframeCount = 0;
  let unverifiableIframeCount = 0;

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
        for (let current: Element | null = parentElement(frame); current; ) {
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
          current = parentElement(current);
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
      const frameGeometry = geometryFor(frame, view);
      let visibilityUncertain = frameGeometry.uncertain;
      let visiblePolygon = frameGeometry.uncertain
        ? intersectPolygons(
            [
              { x: frameGeometry.bounds.left, y: frameGeometry.bounds.top },
              { x: frameGeometry.bounds.right, y: frameGeometry.bounds.top },
              {
                x: frameGeometry.bounds.right,
                y: frameGeometry.bounds.bottom,
              },
              { x: frameGeometry.bounds.left, y: frameGeometry.bounds.bottom },
            ],
            clip,
          )
        : intersectPolygons(
            [
              pointToScreen(frameGeometry, {
                x: frame.clientLeft,
                y: frame.clientTop,
              }),
              pointToScreen(frameGeometry, {
                x: frame.clientLeft + frame.clientWidth,
                y: frame.clientTop,
              }),
              pointToScreen(frameGeometry, {
                x: frame.clientLeft + frame.clientWidth,
                y: frame.clientTop + frame.clientHeight,
              }),
              pointToScreen(frameGeometry, {
                x: frame.clientLeft,
                y: frame.clientTop + frame.clientHeight,
              }),
            ],
            clip,
          );

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
          !frameGeometry.uncertain &&
          (!positioned || reachedContainingBlock || current === containingBlock)
        ) {
          const ancestor = current as HTMLElement;
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
          const geometry = geometryFor(ancestor, view);
          if (hasBox) {
            const clipsX =
              paintContainment ||
              (!overflowAppliesToViewport &&
                ["auto", "clip", "hidden", "overlay", "scroll"].includes(
                  overflowX,
                ));
            const clipsY =
              paintContainment ||
              (!overflowAppliesToViewport &&
                ["auto", "clip", "hidden", "overlay", "scroll"].includes(
                  overflowY,
                ));
            if (clipsX) {
              visiblePolygon = clipLocalAxis(
                visiblePolygon,
                geometry,
                "x",
                ancestor.clientLeft,
                ancestor.clientLeft + ancestor.clientWidth,
              );
            }
            if (clipsY) {
              visiblePolygon = clipLocalAxis(
                visiblePolygon,
                geometry,
                "y",
                ancestor.clientTop,
                ancestor.clientTop + ancestor.clientHeight,
              );
            }
            if (
              (clipsX || clipsY) &&
              hasRoundedCornerOverlap(
                visiblePolygon,
                geometry,
                ancestor,
                styles,
              )
            ) {
              visibilityUncertain = true;
            }
          }
        }
        if (positioned && current === containingBlock) {
          reachedContainingBlock = true;
        }
        current = parentElement(current);
      }

      if (
        !rendered ||
        !hasVisibleArea(visiblePolygon) ||
        view.innerWidth <= 0 ||
        view.innerHeight <= 0
      ) {
        continue;
      }

      if (frameGeometry.uncertain) {
        unverifiableIframeCount += 1;
        continue;
      }

      if (visibilityUncertain) {
        unverifiableIframeCount += 1;
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
        if (
          !childView ||
          width <= 0 ||
          height <= 0 ||
          frame.clientWidth <= 0 ||
          frame.clientHeight <= 0
        ) {
          unavailable = true;
        } else {
          const childClip = visiblePolygon.map((point) => {
            const local = pointToLocal(frameGeometry, point);
            return {
              x: Math.max(
                0,
                Math.min(
                  width,
                  ((local.x - frame.clientLeft) / frame.clientWidth) * width,
                ),
              ),
              y: Math.max(
                0,
                Math.min(
                  height,
                  ((local.y - frame.clientTop) / frame.clientHeight) * height,
                ),
              ),
            };
          });
          if (!hasVisibleArea(childClip)) {
            unavailable = true;
          } else {
            documents.push({ owner: child, clip: childClip, depth: depth + 1 });
          }
        }
      }
      if (unavailable) unavailableIframeCount += 1;
    }
  }

  return {
    visibleIframeCount,
    unavailableIframeCount,
    ...(unverifiableIframeCount > 0 ? { unverifiableIframeCount } : {}),
  };
}
