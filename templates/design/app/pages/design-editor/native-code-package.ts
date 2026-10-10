import { parseEffectsFromHtml } from "../../../shared/native-effects";
import { validateEncodedPngViewport } from "./native-raster-encoding";

const MAX_HTML_BYTES = 5_000_000;
const MAX_POSTER_BYTES = 32_000_000;
const MAX_PACKAGE_BYTES = 40_000_000;

function posterDimensions(
  viewport: { width: number; height: number },
  pixelRatio: number,
): { width: number; height: number } {
  const width = Math.ceil(viewport.width * pixelRatio);
  const height = Math.ceil(viewport.height * pixelRatio);
  if (
    !Number.isInteger(viewport.width) ||
    !Number.isInteger(viewport.height) ||
    viewport.width < 1 ||
    viewport.height < 1 ||
    !Number.isFinite(pixelRatio) ||
    pixelRatio <= 0 ||
    pixelRatio > 4 ||
    width > 4096 ||
    height > 4096 ||
    width * height > 8_300_000
  )
    throw new NativeCodePackageError(
      "source-unreadable",
      "The native scene preview has invalid dimensions.",
    );
  return { width, height };
}

export class NativeCodePackageError extends Error {
  constructor(
    readonly code:
      | "source-unreadable"
      | "poster-unreadable"
      | "package-too-large",
    message: string,
  ) {
    super(message);
    this.name = "NativeCodePackageError";
  }
}

function reactSource(args: {
  viewport: { width: number; height: number };
  targets: Array<{ instanceId: string; nodeId: string }>;
  title: string;
}): string {
  const targets = JSON.stringify(args.targets);
  const title = JSON.stringify(args.title);
  return `import { useEffect, useRef, useState } from "react";
import designHtml from "./design.html?raw";
import posterUrl from "./design-preview.png";

const targets: Array<{ instanceId: string; nodeId: string }> = ${targets};
const sceneTitle = ${title};

export default function NativeDesignScene() {
  const frame = useRef<HTMLIFrameElement>(null);
  const onFrameLoad = useRef<() => void>(() => {});
  const [mode, setMode] = useState<"poster" | "loading" | "live">("poster");

  useEffect(() => {
    if (!window.isSecureContext || !("gpu" in navigator)) return;
    setMode("loading");
    const ready = new Set<string>();
    let failed = false;
    let runtimeEpoch: string | undefined;
    let loadGeneration = 0;
    let requestPrefix = "";
    let timeout = window.setTimeout(() => {
      failed = true;
      setMode("poster");
    }, 15000);
    const onStatus = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== "native-shader-status" || data.schemaVersion !== 1) return;
      const targetIndex = targets.findIndex((item) => item.instanceId === data.instanceId && item.nodeId === data.nodeId);
      const target = targets[targetIndex];
      if (!target) return;
      if (typeof data.runtimeEpoch !== "string" || !data.runtimeEpoch) return;
      if (!runtimeEpoch) {
        if (data.requestId !== requestPrefix + "-" + targetIndex) return;
        runtimeEpoch = data.runtimeEpoch;
      }
      if (data.runtimeEpoch !== runtimeEpoch) return;
      if (data.status === "ready" && data.backend === "webgpu" && !failed) {
        ready.add(target.instanceId);
        if (ready.size === targets.length) {
          window.clearTimeout(timeout);
          setMode("live");
        }
      } else if (data.status === "error" || data.status === "unavailable" || data.status === "last-good") {
        failed = true;
        window.clearTimeout(timeout);
        setMode("poster");
      }
    };
    onFrameLoad.current = () => {
      const targetWindow = frame.current?.contentWindow;
      if (!targetWindow) return;
      loadGeneration += 1;
      requestPrefix = "native-scene-" + loadGeneration;
      runtimeEpoch = undefined;
      ready.clear();
      failed = false;
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => {
        failed = true;
        setMode("poster");
      }, 15000);
      setMode("loading");
      targets.forEach((item, index) =>
        targetWindow.postMessage({ type: "native-shader-status-request", requestId: requestPrefix + "-" + index, instanceId: item.instanceId, nodeId: item.nodeId }, window.location.origin)
      );
    };
    window.addEventListener("message", onStatus);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onStatus);
      onFrameLoad.current = () => {};
    };
  }, []);

  return (
    <div style={{ position: "relative", width: ${args.viewport.width}, height: ${args.viewport.height} }}>
      {mode !== "poster" && (
        <iframe
          ref={frame}
          title={sceneTitle}
          sandbox="allow-same-origin allow-scripts"
          srcDoc={designHtml}
          onLoad={() => onFrameLoad.current()}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
        />
      )}
      {mode !== "live" && <img src={posterUrl} alt={sceneTitle} width={${args.viewport.width}} height={${args.viewport.height}} style={{ position: "absolute", inset: 0, display: "block", width: "100%", height: "100%" }} />}
    </div>
  );
}
`;
}

function withCapturedFallback(args: {
  html: string;
  posterBytes: Uint8Array;
  targets: Array<{ instanceId: string; nodeId: string }>;
  title: string;
  viewport: { width: number; height: number };
}): string {
  const runtimeTag = [...args.html.matchAll(/<script\b[^>]*>/gi)]
    .map((match) => match[0])
    .find((tag) => tag.includes("data-agent-native-native-shader-runtime"));
  const nonce = runtimeTag?.match(/\bnonce="([A-Za-z0-9+/=]+)"/)?.[1];
  if (!nonce || !/<\/body\s*>/i.test(args.html))
    throw new NativeCodePackageError(
      "source-unreadable",
      "The standalone scene has no trusted runtime nonce or body.",
    );
  const escapeHtml = (value: string) =>
    value.replace(
      /[&"<>]/g,
      (character) =>
        ({
          "&": "&amp;",
          '"': "&quot;",
          "<": "&lt;",
          ">": "&gt;",
        })[character]!,
    );
  const targets = JSON.stringify(args.targets).replace(/</g, "\\u003c");
  let poster = "";
  for (let offset = 0; offset < args.posterBytes.length; offset += 12_000)
    poster += btoa(
      String.fromCharCode(
        ...args.posterBytes.subarray(offset, offset + 12_000),
      ),
    );
  const bootstrap = `(()=>{
    const targets=${targets};
    const poster=document.querySelector('[data-agent-native-static-fallback]');
    if(!poster)return;
    document.documentElement.append(poster);
    const statuses=new Map();
    let epoch;
    const uniqueNodes=new Set(targets.map(item=>item.nodeId)).size===targets.length;
    const update=()=>{
      const eventReady=targets.every(item=>statuses.get(item.instanceId)==='ready');
      const domReady=statuses.size===0&&uniqueNodes&&targets.every(({instanceId,nodeId})=>{
        const node=[...document.querySelectorAll('[data-agent-native-node-id]')].find(item=>item.getAttribute('data-agent-native-node-id')===nodeId);
        const canvas=[...document.querySelectorAll('[data-an-native-canvas]')].find(item=>item.getAttribute('data-an-native-canvas')===instanceId);
        return !!canvas?.isConnected&&node?.getAttribute('data-an-native-status')==='ready'&&node?.getAttribute('data-an-native-backend')==='webgpu';
      });
      poster.hidden=eventReady||domReady;
    };
    window.addEventListener('native-shader-status',event=>{
      const detail=event.detail;
      if(!detail||detail.type!=='native-shader-status'||detail.schemaVersion!==1||typeof detail.runtimeEpoch!=='string')return;
      if(!targets.some(item=>item.instanceId===detail.instanceId&&item.nodeId===detail.nodeId))return;
      if(epoch!==detail.runtimeEpoch){epoch=detail.runtimeEpoch;statuses.clear();}
      statuses.set(detail.instanceId,detail.status==='ready'&&detail.backend==='webgpu'?'ready':'unavailable');
      update();
    });
    const requestSnapshot=()=>window.__anNativeShaders?.requestStatusSnapshot?.();
    requestSnapshot();
    window.addEventListener('DOMContentLoaded',requestSnapshot,{once:true});
    new MutationObserver(update).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['data-an-native-status','data-an-native-backend','data-an-native-canvas']});
    update();
  })();`;
  const fallback = `<img data-agent-native-static-fallback src="data:image/png;base64,${poster}" alt="${escapeHtml(args.title)}" style="position:fixed;inset:0;width:${args.viewport.width}px;height:${args.viewport.height}px;object-fit:fill;z-index:2147483647;pointer-events:none"><script nonce="${nonce}">${bootstrap}</script>`;
  const closingBody = [...args.html.matchAll(/<\/body\s*>/gi)].pop();
  if (closingBody?.index === undefined)
    throw new NativeCodePackageError(
      "source-unreadable",
      "The standalone scene has no closing body.",
    );
  return (
    args.html.slice(0, closingBody.index) +
    fallback +
    args.html.slice(closingBody.index)
  );
}

export async function buildNativeStandaloneHtml(args: {
  html: string;
  poster: Blob;
  viewport: { width: number; height: number };
  pixelRatio: number;
  signal?: AbortSignal;
}): Promise<Blob> {
  if (args.signal?.aborted) throw args.signal.reason;
  if (
    !args.html ||
    new TextEncoder().encode(args.html).byteLength > MAX_HTML_BYTES
  )
    throw new NativeCodePackageError(
      "source-unreadable",
      "The canonical native scene is missing or exceeds the HTML source limit.",
    );
  const expectedPoster = posterDimensions(args.viewport, args.pixelRatio);
  if (args.poster.size > MAX_POSTER_BYTES)
    throw new NativeCodePackageError(
      "poster-unreadable",
      "The native static preview exceeds the standalone HTML limit.",
    );
  await validateEncodedPngViewport(args.poster, expectedPoster);
  const manifest = parseEffectsFromHtml(args.html);
  const doc = new DOMParser().parseFromString(args.html, "text/html");
  if (
    manifest.errors.length ||
    !manifest.document?.instances.some((instance) => instance.enabled) ||
    doc.querySelectorAll("script[data-agent-native-native-shader-runtime]")
      .length !== 1
  )
    throw new NativeCodePackageError(
      "source-unreadable",
      "The canonical native model or runtime is missing from standalone HTML.",
    );
  const targets = manifest.document.instances
    .filter((instance) => instance.enabled)
    .map((instance) => ({ instanceId: instance.id, nodeId: instance.nodeId }));
  const posterBytes = new Uint8Array(await args.poster.arrayBuffer());
  if (args.signal?.aborted) throw args.signal.reason;
  const html = withCapturedFallback({
    html: args.html,
    posterBytes,
    targets,
    title: doc.title.trim() || targets[0]!.nodeId,
    viewport: args.viewport,
  });
  if (new TextEncoder().encode(html).byteLength > MAX_PACKAGE_BYTES)
    throw new NativeCodePackageError(
      "package-too-large",
      "The standalone HTML with captured fallback exceeds its local export limit.",
    );
  return new Blob([html], { type: "text/html" });
}

export async function buildNativeCodePackage(args: {
  html: string;
  poster: Blob;
  viewport: { width: number; height: number };
  pixelRatio: number;
  signal?: AbortSignal;
}): Promise<Blob> {
  if (args.signal?.aborted) throw args.signal.reason;
  const htmlBytes = new TextEncoder().encode(args.html).byteLength;
  if (!htmlBytes || htmlBytes > MAX_HTML_BYTES)
    throw new NativeCodePackageError(
      "source-unreadable",
      "The canonical native scene is missing or exceeds the code package limit.",
    );
  const expectedPoster = posterDimensions(args.viewport, args.pixelRatio);
  if (args.poster.size > MAX_POSTER_BYTES)
    throw new NativeCodePackageError(
      "poster-unreadable",
      "The native static preview exceeds the code package limit.",
    );
  await validateEncodedPngViewport(args.poster, expectedPoster);
  const doc = new DOMParser().parseFromString(args.html, "text/html");
  const manifest = parseEffectsFromHtml(args.html);
  if (
    manifest.errors.length ||
    !manifest.document?.instances.some((instance) => instance.enabled) ||
    doc.querySelectorAll("script[data-agent-native-native-shader-runtime]")
      .length !== 1
  )
    throw new NativeCodePackageError(
      "source-unreadable",
      "The canonical native model or runtime is missing from the code package.",
    );
  const targets = manifest.document.instances
    .filter((instance) => instance.enabled)
    .map((instance) => ({ instanceId: instance.id, nodeId: instance.nodeId }));
  const styles = [...doc.querySelectorAll("style")];
  const authoredCss = styles
    .filter(
      (style) =>
        !style.hasAttribute("data-agent-native-export-tailwind-static"),
    )
    .map((style) => style.textContent ?? "")
    .filter(Boolean)
    .join("\n\n");
  const tailwindCss = styles
    .filter((style) =>
      style.hasAttribute("data-agent-native-export-tailwind-static"),
    )
    .map((style) => style.textContent ?? "")
    .filter(Boolean)
    .join("\n\n");
  const posterBytes = new Uint8Array(await args.poster.arrayBuffer());
  if (args.signal?.aborted) throw args.signal.reason;
  const JSZip = (await import("jszip")).default;
  const archive = new JSZip();
  const standalone = await buildNativeStandaloneHtml({
    html: args.html,
    poster: args.poster,
    viewport: args.viewport,
    pixelRatio: args.pixelRatio,
    signal: args.signal,
  });
  archive.file("design.html", await standalone.text());
  archive.file(
    "Design.tsx",
    reactSource({
      viewport: args.viewport,
      targets,
      title: doc.title.trim() || targets[0]!.nodeId,
    }),
  );
  archive.file("design.css", authoredCss);
  archive.file("tailwind.css", tailwindCss);
  archive.file("design-preview.png", posterBytes);
  archive.file(
    "README.md",
    [
      "# Native Design code package",
      "",
      "design.html is the canonical editable HTML/CSS/Tailwind source and includes the versioned native effect model and its portable WebGPU runtime.",
      "Design.tsx is a Vite-compatible React wrapper around that exact scene. It shows the GPU scene only after every effect reports ready, and shows the captured PNG poster when WebGPU is unavailable or a renderer fails.",
      "design.css and tailwind.css are extracted editing references; update design.html when changing them so the standalone and React outputs stay in sync.",
      "Live WebGPU requires a secure context (HTTPS or localhost). The poster is a frame captured from the selected Design source at time zero, not a procedural CSS substitute.",
      "The standalone design.html embeds that captured poster and covers the scene whenever its native effects have not all reported ready. The React wrapper uses the same poster while waiting for exact per-instance readiness.",
      "The native scene remains editable HTML inside the React iframe; it is not converted into individual JSX components.",
      "",
    ].join("\n"),
  );
  const bytes = await archive.generateAsync({
    type: "uint8array",
    compression: "STORE",
  });
  if (args.signal?.aborted) throw args.signal.reason;
  if (bytes.byteLength > MAX_PACKAGE_BYTES)
    throw new NativeCodePackageError(
      "package-too-large",
      "The native code package exceeds its local export limit.",
    );
  const zipBytes = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  zipBytes.set(bytes);
  return new Blob([zipBytes], { type: "application/zip" });
}
