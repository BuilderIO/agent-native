import type { DrawAnnotation } from "@/components/visual-editor/DrawOverlay";

export interface OverviewAnnotationScreen {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverviewAnnotationViewportMap {
  width: number;
  height: number;
  zoom: number;
  screens: OverviewAnnotationScreen[];
  board?: { x: number; y: number; width: number; height: number };
}

function escapeSelector(value: string) {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}

export function collectOverviewAnnotationViewportMap({
  container,
  screens,
  zoom,
}: {
  container: HTMLElement;
  screens: readonly { id: string; name: string }[];
  zoom: number;
}): OverviewAnnotationViewportMap {
  const containerRect = container.getBoundingClientRect();
  const relativeRect = (rect: DOMRect) => ({
    x: rect.left - containerRect.left,
    y: rect.top - containerRect.top,
    width: rect.width,
    height: rect.height,
  });
  const mappedScreens = screens.flatMap((screen) => {
    const shell = container.querySelector<HTMLElement>(
      `[data-frame-id="${escapeSelector(screen.id)}"]`,
    );
    return shell
      ? [
          {
            id: screen.id,
            name: screen.name,
            ...relativeRect(shell.getBoundingClientRect()),
          },
        ]
      : [];
  });
  const boardSurface = container.querySelector<HTMLElement>(
    "[data-board-surface-layer]",
  );
  return {
    width: containerRect.width,
    height: containerRect.height,
    zoom,
    screens: mappedScreens,
    board: boardSurface
      ? relativeRect(boardSurface.getBoundingClientRect())
      : undefined,
  };
}

function annotationBounds(annotation: DrawAnnotation) {
  if (annotation.type === "text") {
    return {
      left: annotation.position.x,
      top: annotation.position.y,
      right: annotation.position.x,
      bottom: annotation.position.y,
    };
  }
  const values = Array.from(
    annotation.pathData?.matchAll(/-?\d+(?:\.\d+)?/g) ?? [],
    (match) => Number(match[0]),
  );
  const xs = values.filter((_, index) => index % 2 === 0);
  const ys = values.filter((_, index) => index % 2 === 1);
  if (!xs.length || !ys.length) return null;
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

function mappedAnnotationRegions(
  annotation: DrawAnnotation,
  viewportMap: OverviewAnnotationViewportMap,
) {
  const bounds = annotationBounds(annotation);
  if (!bounds) return ["board"];
  const screens = viewportMap.screens.filter(
    (screen) =>
      bounds.right >= screen.x &&
      bounds.left <= screen.x + screen.width &&
      bounds.bottom >= screen.y &&
      bounds.top <= screen.y + screen.height,
  );
  return screens.length
    ? screens.map((screen) => `${screen.name} (${screen.id})`)
    : ["board outside screens"];
}

export function formatOverviewAnnotationMessage({
  designId,
  designTitle,
  annotations,
  instruction,
  viewportMap,
}: {
  designId: string;
  designTitle?: string;
  annotations: DrawAnnotation[];
  instruction: string;
  viewportMap: OverviewAnnotationViewportMap;
}) {
  const drawing = annotations
    .map((annotation) => {
      const regions = mappedAnnotationRegions(annotation, viewportMap).join(
        ", ",
      );
      return annotation.type === "path"
        ? `[stroke regions=${regions} color=${annotation.color} w=${annotation.lineWidth}] ${annotation.pathData}`
        : `[label regions=${regions} text="${annotation.text ?? ""}" at ${annotation.position.x.toFixed(0)},${annotation.position.y.toFixed(0)}]`;
    })
    .join("\n");
  const screenMap = viewportMap.screens
    .map(
      (screen) =>
        `- ${screen.name} (${screen.id}): x=${screen.x.toFixed(1)}, y=${screen.y.toFixed(1)}, width=${screen.width.toFixed(1)}, height=${screen.height.toFixed(1)}`,
    )
    .join("\n");
  const boardMap = viewportMap.board
    ? `Board surface: x=${viewportMap.board.x.toFixed(1)}, y=${viewportMap.board.y.toFixed(1)}, width=${viewportMap.board.width.toFixed(1)}, height=${viewportMap.board.height.toFixed(1)}`
    : "Board surface: the viewport outside the mapped screen rectangles";

  return [
    `[Annotations on the all-screens canvas for design ${designId}${designTitle ? ` (${designTitle})` : ""}]`,
    `Overview viewport: ${viewportMap.width.toFixed(0)}x${viewportMap.height.toFixed(0)} at ${viewportMap.zoom.toFixed(1)}% zoom`,
    "Coordinates and screen bounds are viewport-relative at send time; their x/y positions encode the current canvas pan.",
    "",
    "[Screen map]",
    screenMap || "- No screen rectangles were visible",
    boardMap,
    ...(drawing ? ["", "[Drawing]", drawing] : []),
    "",
    instruction || "Apply these annotations to the design.",
  ].join("\n");
}
