// GitHub Clips link previews. This is a narrow declarative content script for
// github.com only; the recording overlay remains activeTab-injected.
(function clipsGithubPreviewContent() {
  const ROOT_CLASS = "clips-github-preview";
  const PROCESSED_ATTR = "data-clips-github-preview";
  const SOURCE_ATTR = "data-clips-source-url";
  const EXTENSION_ORIGIN = chrome.runtime.getURL("").replace(/\/$/, "");
  const CLIPS_HOSTS = new Set(["clips.agent-native.com"]);
  const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
  const ROUTE_SEGMENTS = new Set(["r", "share", "embed"]);
  const MIN_HEIGHT = 120;
  const MAX_HEIGHT = 720;

  type ClipsLink = {
    sourceUrl: string;
    embedUrl: string;
    metadataUrl: string;
    clipId: string;
    host: string;
  };

  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  let frameCounter = 0;

  function isAllowedHost(url: URL): boolean {
    if (CLIPS_HOSTS.has(url.hostname)) return true;
    if (LOCAL_HOSTS.has(url.hostname)) return true;
    return false;
  }

  function safeTimeParam(value: string | null): string | null {
    const trimmed = value?.trim();
    if (!trimmed || trimmed.length > 32) return null;
    if (/^\d{1,6}(\.\d{1,3})?$/.test(trimmed)) return trimmed;
    if (/^\d{1,2}:\d{1,2}(:\d{1,2})?$/.test(trimmed)) return trimmed;
    if (/^(?:\d{1,4}h)?(?:\d{1,4}m)?(?:\d{1,4}s)?$/i.test(trimmed)) {
      return /\d/.test(trimmed) ? trimmed : null;
    }
    return null;
  }

  function parseClipsLink(raw: string): ClipsLink | null {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return null;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    if (!isAllowedHost(parsed)) return null;

    const segments = parsed.pathname.split("/").filter(Boolean);
    const routeIndex = segments.findIndex((segment) =>
      ROUTE_SEGMENTS.has(segment),
    );
    if (routeIndex === -1) return null;

    const route = segments[routeIndex];
    const clipId = segments[routeIndex + 1];
    if (!clipId || clipId === "meeting" || clipId.length > 240) return null;
    if (route === "share" && clipId === "meeting") return null;

    let decodedClipId = clipId;
    try {
      decodedClipId = decodeURIComponent(clipId);
    } catch {
      // Keep the raw segment; malformed escaping should not break the scanner.
    }

    const baseSegments = segments.slice(0, routeIndex);
    const sourceUrl = new URL(parsed.pathname, parsed.origin);
    const embedPath = [
      "",
      ...baseSegments,
      "embed",
      encodeURIComponent(decodedClipId),
    ].join("/");
    const embedUrl = new URL(embedPath, parsed.origin);
    const metadataUrl = new URL(
      ["", ...baseSegments, "api", "public-recording"].join("/"),
      parsed.origin,
    );
    metadataUrl.searchParams.set("id", decodedClipId);

    const time = safeTimeParam(parsed.searchParams.get("t"));
    if (time) {
      sourceUrl.searchParams.set("t", time);
      embedUrl.searchParams.set("t", time);
    }

    return {
      sourceUrl: sourceUrl.toString(),
      embedUrl: embedUrl.toString(),
      metadataUrl: metadataUrl.toString(),
      clipId,
      host: parsed.host,
    };
  }

  function isGitHubMarkdownAnchor(anchor: HTMLAnchorElement): boolean {
    if (anchor.closest(`.${ROOT_CLASS}`)) return false;
    return Boolean(
      anchor.closest(
        [
          ".markdown-body",
          ".comment-body",
          ".js-comment-body",
          ".timeline-comment",
          ".js-issue-body",
          ".js-pull-request-body",
        ].join(","),
      ),
    );
  }

  function previewInsertionTarget(anchor: HTMLAnchorElement): HTMLElement {
    const block = anchor.closest(
      [
        "p",
        "li",
        "td",
        "blockquote",
        "pre",
        ".markdown-body > div",
        ".comment-body",
      ].join(","),
    );
    return block instanceof HTMLElement ? block : anchor;
  }

  function existingPreview(sourceUrl: string): HTMLElement | null {
    for (const element of document.querySelectorAll<HTMLElement>(
      `.${ROOT_CLASS}`,
    )) {
      if (element.getAttribute(SOURCE_ATTR) === sourceUrl) return element;
    }
    return null;
  }

  function mountPreview(anchor: HTMLAnchorElement, link: ClipsLink): void {
    if (existingPreview(link.sourceUrl)) {
      anchor.setAttribute(PROCESSED_ATTR, "mounted");
      return;
    }

    const frameId = `clips-github-preview-${++frameCounter}`;
    const wrapper = document.createElement("div");
    wrapper.className = ROOT_CLASS;
    wrapper.id = `${frameId}-wrapper`;
    wrapper.setAttribute(SOURCE_ATTR, link.sourceUrl);
    Object.assign(wrapper.style, {
      display: "block",
      width: "min(720px, 100%)",
      maxWidth: "100%",
      margin: "8px 0 16px",
      clear: "both",
    });

    const frame = document.createElement("iframe");
    frame.id = frameId;
    frame.title = "Clips preview";
    frame.allow = "autoplay; fullscreen; picture-in-picture";
    frame.setAttribute("allowfullscreen", "true");
    frame.setAttribute("scrolling", "no");
    frame.referrerPolicy = "no-referrer";
    Object.assign(frame.style, {
      display: "block",
      width: "100%",
      height: "430px",
      border: "0",
      borderRadius: "8px",
      background: "transparent",
      overflow: "hidden",
    });

    const previewUrl = new URL(
      chrome.runtime.getURL("src/github-preview.html"),
    );
    previewUrl.searchParams.set("frameId", frameId);
    previewUrl.searchParams.set("embedUrl", link.embedUrl);
    previewUrl.searchParams.set("metadataUrl", link.metadataUrl);
    previewUrl.searchParams.set("sourceUrl", link.sourceUrl);
    previewUrl.searchParams.set("clipId", link.clipId);
    previewUrl.searchParams.set("host", link.host);
    frame.src = previewUrl.toString();

    wrapper.appendChild(frame);
    previewInsertionTarget(anchor).after(wrapper);
    anchor.setAttribute(PROCESSED_ATTR, "mounted");
  }

  function scan(): void {
    for (const anchor of document.querySelectorAll<HTMLAnchorElement>(
      `a[href]:not([${PROCESSED_ATTR}])`,
    )) {
      if (!isGitHubMarkdownAnchor(anchor)) continue;
      const link = parseClipsLink(anchor.href);
      if (!link) continue;
      mountPreview(anchor, link);
    }
  }

  function scheduleScan(): void {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 120);
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== EXTENSION_ORIGIN) return;
    const data = event.data as
      | { source?: string; frameId?: string; height?: number }
      | undefined;
    if (data?.source !== "clips-github-preview") return;
    if (!data.frameId || typeof data.height !== "number") return;
    const frame = document.getElementById(data.frameId);
    if (!(frame instanceof HTMLIFrameElement)) return;
    const height = Math.max(
      MIN_HEIGHT,
      Math.min(MAX_HEIGHT, Math.ceil(data.height)),
    );
    frame.style.height = `${height}px`;
  });

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  scan();
})();
