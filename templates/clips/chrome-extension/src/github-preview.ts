import { captureExtensionError, initExtensionSentry } from "./sentry";

initExtensionSentry("github-preview");

const DEFAULT_HOST = "clips.agent-native.com";
const CLIPS_HOSTS = new Set(["clips.agent-native.com"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

type PreviewParams = {
  frameId: string;
  embedUrl: URL;
  metadataUrl: URL;
  sourceUrl: URL;
  clipId: string;
  host: string;
};

type PublicRecordingResponse = {
  recording?: {
    title?: string | null;
    status?: string | null;
    videoUrl?: string | null;
    visibility?: string | null;
    hasPassword?: boolean | null;
  } | null;
  error?: string;
  passwordRequired?: boolean;
  expired?: boolean;
};

type PreviewState =
  | { kind: "checking" }
  | { kind: "playable"; title: string }
  | { kind: "unavailable"; title: string; detail: string };

function parseUrl(value: string | null): URL | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isAllowedPreviewOrigin(url: URL): boolean {
  if (CLIPS_HOSTS.has(url.hostname)) return true;
  if (LOCAL_HOSTS.has(url.hostname)) return true;
  return false;
}

function validPreviewParams(params: PreviewParams): boolean {
  if (!isAllowedPreviewOrigin(params.embedUrl)) return false;
  if (!isAllowedPreviewOrigin(params.metadataUrl)) return false;
  if (!isAllowedPreviewOrigin(params.sourceUrl)) return false;
  if (params.embedUrl.origin !== params.metadataUrl.origin) return false;
  if (params.sourceUrl.origin !== params.metadataUrl.origin) return false;
  return /(?:^|\/)api\/public-recording$/.test(params.metadataUrl.pathname);
}

function readParams(): PreviewParams | null {
  const params = new URLSearchParams(location.search);
  const frameId = params.get("frameId")?.trim();
  const embedUrl = parseUrl(params.get("embedUrl"));
  const metadataUrl = parseUrl(params.get("metadataUrl"));
  const sourceUrl = parseUrl(params.get("sourceUrl"));
  const clipId = params.get("clipId")?.trim() ?? "";
  const host = params.get("host")?.trim() || DEFAULT_HOST;
  if (!frameId || !embedUrl || !metadataUrl || !sourceUrl || !clipId) {
    return null;
  }
  const preview = { frameId, embedUrl, metadataUrl, sourceUrl, clipId, host };
  return validPreviewParams(preview) ? preview : null;
}

function postHeight(frameId: string): void {
  const height = document.documentElement.scrollHeight;
  window.parent.postMessage(
    {
      source: "clips-github-preview",
      frameId,
      height,
    },
    "*",
  );
}

function installAutoResize(frameId: string): void {
  const emit = () => postHeight(frameId);
  try {
    const observer = new ResizeObserver(emit);
    observer.observe(document.documentElement);
    observer.observe(document.body);
  } catch {
    window.addEventListener("resize", emit);
  }
  requestAnimationFrame(emit);
  setTimeout(emit, 250);
}

function renderInvalid(root: HTMLElement): void {
  root.textContent = "";
  const card = document.createElement("section");
  card.className = "clips-preview-card clips-preview-error";
  const title = document.createElement("strong");
  title.textContent = "Clip preview unavailable";
  const body = document.createElement("p");
  body.textContent = "This Clips link could not be parsed by the extension.";
  card.append(title, body);
  root.append(card);
}

function renderPreview(
  root: HTMLElement,
  preview: PreviewParams,
  state: PreviewState,
): void {
  root.textContent = "";

  const card = document.createElement("section");
  card.className =
    state.kind === "playable"
      ? "clips-preview-card clips-preview-card--player"
      : "clips-preview-card";

  if (state.kind !== "playable") {
    const header = document.createElement("header");
    header.className = "clips-preview-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "clips-preview-title-wrap";

    const title = document.createElement("div");
    title.className = "clips-preview-title";
    title.textContent =
      state.kind === "unavailable" ? state.title : "Clips preview";

    const subtitle = document.createElement("div");
    subtitle.className = "clips-preview-subtitle";
    subtitle.textContent = preview.host;

    titleWrap.append(title, subtitle);

    const open = document.createElement("a");
    open.className = "clips-preview-open";
    open.href = preview.sourceUrl.toString();
    open.target = "_blank";
    open.rel = "noreferrer noopener";
    open.textContent = "Open clip";

    header.append(titleWrap, open);
    card.append(header);
  }

  if (state.kind === "playable") {
    const player = document.createElement("div");
    player.className = "clips-preview-player";

    const frame = document.createElement("iframe");
    frame.title = "Playable Clips embed";
    frame.src = preview.embedUrl.toString();
    frame.allow = "autoplay; fullscreen; picture-in-picture";
    frame.allowFullscreen = true;
    frame.scrolling = "no";
    frame.referrerPolicy = "no-referrer";

    player.append(frame);
    card.append(player);
  } else {
    const body = document.createElement("div");
    body.className = "clips-preview-message";
    body.textContent =
      state.kind === "checking"
        ? "Checking whether this clip can play inline..."
        : state.detail;
    card.append(body);
  }

  root.append(card);
}

async function checkPublicPlayable(
  preview: PreviewParams,
): Promise<PreviewState> {
  try {
    const response = await fetch(preview.metadataUrl.toString(), {
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    const data = (await response
      .json()
      .catch(() => ({}))) as PublicRecordingResponse;

    if (!response.ok) {
      if (response.status === 401 || data.passwordRequired) {
        return {
          kind: "unavailable",
          title: "Protected Clips link",
          detail: "Open this clip in Clips to enter the password.",
        };
      }
      if (response.status === 410 || data.expired) {
        return {
          kind: "unavailable",
          title: "Expired Clips link",
          detail: "This clip has expired. Open it in Clips for details.",
        };
      }
      return {
        kind: "unavailable",
        title: "Clips link",
        detail: "Open this clip in Clips to view it.",
      };
    }

    const recording = data.recording;
    const title = recording?.title?.trim() || "Clips preview";
    if (
      recording?.visibility !== "public" ||
      recording.hasPassword ||
      recording.status !== "ready" ||
      !recording.videoUrl
    ) {
      return {
        kind: "unavailable",
        title,
        detail: "Open this clip in Clips to view it.",
      };
    }

    return { kind: "playable", title };
  } catch {
    return {
      kind: "unavailable",
      title: "Clips link",
      detail: "Open this clip in Clips to view it.",
    };
  }
}

function installStyles(): void {
  const style = document.createElement("style");
  style.textContent = `
    :root {
      color-scheme: light dark;
      --clips-bg: #ffffff;
      --clips-fg: #24292f;
      --clips-muted: #57606a;
      --clips-border: #d0d7de;
      --clips-button-bg: #f6f8fa;
      --clips-button-hover: #eef1f4;
      --clips-shadow: 0 8px 24px rgba(140, 149, 159, 0.2);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: transparent;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --clips-bg: #0d1117;
        --clips-fg: #f0f6fc;
        --clips-muted: #8b949e;
        --clips-border: #30363d;
        --clips-button-bg: #21262d;
        --clips-button-hover: #30363d;
        --clips-shadow: 0 8px 24px rgba(1, 4, 9, 0.38);
      }
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      margin: 0;
      min-width: 0;
      width: 100%;
      background: transparent;
    }

    body {
      padding: 0;
      overflow: hidden;
      color: var(--clips-fg);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    .clips-preview-card {
      overflow: hidden;
      border: 1px solid var(--clips-border);
      border-radius: 8px;
      background: var(--clips-bg);
      box-shadow: var(--clips-shadow);
    }

    .clips-preview-card--player {
      border: 0;
      background: #000000;
      box-shadow: none;
    }

    .clips-preview-header {
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 44px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--clips-border);
    }

    .clips-preview-title-wrap {
      min-width: 0;
      flex: 1;
    }

    .clips-preview-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      font-weight: 600;
      line-height: 18px;
    }

    .clips-preview-subtitle {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--clips-muted);
      font-size: 12px;
      line-height: 16px;
    }

    .clips-preview-open {
      flex: 0 0 auto;
      border: 1px solid var(--clips-border);
      border-radius: 6px;
      background: var(--clips-button-bg);
      color: var(--clips-fg);
      padding: 5px 9px;
      font-size: 12px;
      font-weight: 600;
      line-height: 18px;
      text-decoration: none;
    }

    .clips-preview-open:hover,
    .clips-preview-open:focus-visible {
      background: var(--clips-button-hover);
      text-decoration: none;
      outline: none;
    }

    .clips-preview-player {
      position: relative;
      width: 100%;
      aspect-ratio: 16 / 9;
      background: #000000;
    }

    .clips-preview-player iframe {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      border: 0;
      background: #000000;
    }

    .clips-preview-message {
      padding: 12px;
      color: var(--clips-muted);
      font-size: 12px;
      line-height: 18px;
    }

    .clips-preview-error {
      padding: 12px;
    }

    .clips-preview-error strong {
      display: block;
      font-size: 13px;
      line-height: 18px;
    }

    .clips-preview-error p {
      margin: 4px 0 0;
      color: var(--clips-muted);
      font-size: 12px;
      line-height: 18px;
    }
  `;
  document.head.append(style);
}

async function main(): Promise<void> {
  try {
    installStyles();
    const root = document.getElementById("root");
    if (!root) throw new Error("Missing preview root");

    const preview = readParams();
    if (!preview) {
      renderInvalid(root);
      return;
    }

    renderPreview(root, preview, { kind: "checking" });
    installAutoResize(preview.frameId);
    renderPreview(root, preview, await checkPublicPlayable(preview));
  } catch (error) {
    captureExtensionError(error, {
      tags: { surface: "github-preview" },
      extra: { pageUrl: location.href },
    });
  }
}

main();
