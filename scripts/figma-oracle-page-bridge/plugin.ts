type PageIdentity = { id: string; name: string };
type OracleProbeNode = {
  name: string;
  exportAsync(options: {
    format: "PNG";
    constraint: { type: "WIDTH"; value: 1200 };
    contentsOnly: true;
  }): Promise<Uint8Array>;
};
type OraclePage = PageIdentity & { selection: OracleProbeNode[] };
type PageRequest = { type: "get-active-page"; requestId: string };
type SelectedProbeRequest = {
  type: "export-selected-probe";
  requestId: string;
  marker: string;
};

declare const __html__: string;
declare const figma: {
  currentPage: OraclePage;
  showUI(
    html: string,
    options: { width: number; height: number; themeColors: boolean },
  ): void;
  on(type: "currentpagechange", callback: () => void): void;
  ui: {
    onmessage: ((message: unknown) => void) | null;
    postMessage(message: unknown): void;
  };
};

let pageChangeCount = 0;
const MAX_PROBE_PNG_BYTES = 4 * 1024 * 1024;
const ORACLE_PROBE_MARKER =
  /^AN-ORACLE-PROBE:fig\.[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isPageRequest(value: unknown): value is PageRequest {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "get-active-page" &&
    typeof (value as { requestId?: unknown }).requestId === "string"
  );
}

function isSelectedProbeRequest(value: unknown): value is SelectedProbeRequest {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "export-selected-probe" &&
    typeof (value as { requestId?: unknown }).requestId === "string" &&
    typeof (value as { marker?: unknown }).marker === "string"
  );
}

function publishActivePage(requestId: string): void {
  figma.ui.postMessage({
    type: "active-page",
    requestId,
    page: {
      id: figma.currentPage.id,
      name: figma.currentPage.name,
      pageChangeCount,
    },
  });
}

function publishProbeError(request: SelectedProbeRequest, error: string): void {
  figma.ui.postMessage({
    type: "selected-probe",
    requestId: request.requestId,
    marker: request.marker,
    error,
  });
}

async function publishSelectedProbe(
  request: SelectedProbeRequest,
): Promise<void> {
  if (!ORACLE_PROBE_MARKER.test(request.marker)) {
    publishProbeError(request, "invalid oracle probe marker");
    return;
  }
  const page = figma.currentPage;
  const [selected] = page.selection;
  if (
    page.selection.length !== 1 ||
    !selected ||
    selected.name !== request.marker
  ) {
    publishProbeError(
      request,
      "Figma must select exactly the marked oracle probe layer before recording",
    );
    return;
  }
  try {
    const png = await selected.exportAsync({
      format: "PNG",
      constraint: { type: "WIDTH", value: 1200 },
      contentsOnly: true,
    });
    if (
      figma.currentPage !== page ||
      page.selection.length !== 1 ||
      page.selection[0] !== selected
    ) {
      publishProbeError(request, "Figma selection changed during probe export");
      return;
    }
    if (
      !(png instanceof Uint8Array) ||
      png.byteLength === 0 ||
      png.byteLength > MAX_PROBE_PNG_BYTES
    ) {
      publishProbeError(
        request,
        "selected oracle probe export is out of bounds",
      );
      return;
    }
    figma.ui.postMessage({
      type: "selected-probe",
      requestId: request.requestId,
      marker: request.marker,
      png: Array.from(png),
    });
  } catch {
    publishProbeError(request, "could not export the selected oracle probe");
  }
}

figma.ui.onmessage = async (message: unknown) => {
  if (isPageRequest(message)) {
    publishActivePage(message.requestId);
    return;
  }
  if (isSelectedProbeRequest(message)) {
    await publishSelectedProbe(message);
  }
};

figma.on("currentpagechange", () => {
  pageChangeCount += 1;
  publishActivePage("__page-change__");
});
figma.showUI(__html__, { width: 300, height: 64, themeColors: true });
