const OPEN_FILL_OPACITY_MARKER = "data-an-open-fill-opacity";
const HIDDEN_FILL_OPACITY = "0";
const HIDDEN_FILL_OPACITY_PRIORITY = "important";

type OpenFillOpacitySnapshot = {
  version: 2;
  attributeValue: string | null;
  restoreAttribute: boolean;
  styleValue: string | null;
  stylePriority: string;
};

function readOpenFillOpacitySnapshot(
  value: string,
): OpenFillOpacitySnapshot | "invalid" {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      parsed.version === 2 &&
      "attributeValue" in parsed &&
      (parsed.attributeValue === null ||
        typeof parsed.attributeValue === "string") &&
      "restoreAttribute" in parsed &&
      typeof parsed.restoreAttribute === "boolean" &&
      "styleValue" in parsed &&
      (parsed.styleValue === null || typeof parsed.styleValue === "string") &&
      "stylePriority" in parsed &&
      typeof parsed.stylePriority === "string"
    ) {
      return parsed as OpenFillOpacitySnapshot;
    }
  } catch {
    return "invalid";
  }
  return "invalid";
}

function writeOpenFillOpacitySnapshot(
  path: SVGPathElement,
  snapshot: OpenFillOpacitySnapshot,
) {
  path.setAttribute(OPEN_FILL_OPACITY_MARKER, JSON.stringify(snapshot));
}

function readInlineFillOpacity(path: SVGPathElement) {
  return {
    styleValue: path.style.getPropertyValue("fill-opacity") || null,
    stylePriority: path.style.getPropertyPriority("fill-opacity"),
  };
}

function hasTemporaryFillOpacity(path: SVGPathElement): boolean {
  return (
    path.style.getPropertyValue("fill-opacity") === HIDDEN_FILL_OPACITY &&
    path.style.getPropertyPriority("fill-opacity") ===
      HIDDEN_FILL_OPACITY_PRIORITY
  );
}

export function hidePenPathFill(path: SVGPathElement): void {
  const marker = path.getAttribute(OPEN_FILL_OPACITY_MARKER);
  const snapshot =
    marker === null ? "invalid" : readOpenFillOpacitySnapshot(marker);
  if (marker === "absent" || marker?.startsWith("value:")) {
    writeOpenFillOpacitySnapshot(path, {
      version: 2,
      attributeValue:
        marker === "absent" ? null : marker.slice("value:".length),
      restoreAttribute: true,
      ...readInlineFillOpacity(path),
    });
  } else if (snapshot === "invalid" || !hasTemporaryFillOpacity(path)) {
    writeOpenFillOpacitySnapshot(path, {
      version: 2,
      attributeValue: path.getAttribute("fill-opacity"),
      restoreAttribute: false,
      ...readInlineFillOpacity(path),
    });
  }
  path.style.setProperty(
    "fill-opacity",
    HIDDEN_FILL_OPACITY,
    HIDDEN_FILL_OPACITY_PRIORITY,
  );
}

export function restoreClosedPenPathFill(path: SVGPathElement): void {
  const marker = path.getAttribute(OPEN_FILL_OPACITY_MARKER);
  if (marker === null) return;

  const snapshot = readOpenFillOpacitySnapshot(marker);
  if (snapshot === "invalid") {
    if (marker === "absent") {
      path.removeAttribute("fill-opacity");
    } else if (marker.startsWith("value:")) {
      path.setAttribute("fill-opacity", marker.slice("value:".length));
    } else if (hasTemporaryFillOpacity(path)) {
      path.style.removeProperty("fill-opacity");
      path.removeAttribute(OPEN_FILL_OPACITY_MARKER);
    }
    if (path.hasAttribute(OPEN_FILL_OPACITY_MARKER)) {
      path.removeAttribute(OPEN_FILL_OPACITY_MARKER);
    }
    return;
  }

  if (
    snapshot.restoreAttribute &&
    path.getAttribute("fill-opacity") === HIDDEN_FILL_OPACITY
  ) {
    if (snapshot.attributeValue === null) {
      path.removeAttribute("fill-opacity");
    } else {
      path.setAttribute("fill-opacity", snapshot.attributeValue);
    }
  }
  if (hasTemporaryFillOpacity(path)) {
    if (snapshot.styleValue === null) {
      path.style.removeProperty("fill-opacity");
    } else {
      path.style.setProperty(
        "fill-opacity",
        snapshot.styleValue,
        snapshot.stylePriority,
      );
    }
  }

  path.removeAttribute(OPEN_FILL_OPACITY_MARKER);
}
