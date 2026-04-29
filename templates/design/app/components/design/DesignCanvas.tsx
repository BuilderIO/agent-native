import { useRef, useEffect, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { DeviceFrame } from "./DeviceFrame";
import type { ElementInfo, DeviceFrameType } from "./types";

/**
 * Tweak-bridge script. ALWAYS injected so the parent's postMessage
 * (`tweak-values`) can update CSS custom properties on the iframe's :root
 * regardless of which editor mode is active. Without this the tweak panel
 * silently no-ops in the default Comment mode.
 */
const TWEAK_BRIDGE_SCRIPT = `
<script>
(function() {
  window.addEventListener('message', function(e) {
    if (!e.data || e.data.type !== 'tweak-values') return;
    var root = document.documentElement;
    var vals = e.data.values || {};
    Object.keys(vals).forEach(function(k) {
      root.style.setProperty(k, vals[k]);
    });
  });
})();
</script>
`;

/**
 * Edit-mode bridge: element click/hover overlays + selector-targeted
 * style-change messages. Only injected when the user is in Edit mode.
 */
const EDIT_BRIDGE_SCRIPT = `
<script>
(function() {
  function getElementInfo(el) {
    var cs = window.getComputedStyle(el);
    var rect = el.getBoundingClientRect();
    var parentDisplay = el.parentElement
      ? window.getComputedStyle(el.parentElement).display
      : undefined;
    return {
      tagName: el.tagName.toLowerCase(),
      id: el.id || undefined,
      classes: Array.from(el.classList),
      computedStyles: {
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        fontSize: cs.fontSize,
        fontFamily: cs.fontFamily,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing,
        textAlign: cs.textAlign,
        display: cs.display,
        flexDirection: cs.flexDirection,
        justifyContent: cs.justifyContent,
        alignItems: cs.alignItems,
        gap: cs.gap,
        width: cs.width,
        height: cs.height,
        opacity: cs.opacity,
        paddingTop: cs.paddingTop,
        paddingRight: cs.paddingRight,
        paddingBottom: cs.paddingBottom,
        paddingLeft: cs.paddingLeft,
        marginTop: cs.marginTop,
        marginRight: cs.marginRight,
        marginBottom: cs.marginBottom,
        marginLeft: cs.marginLeft,
        borderWidth: cs.borderWidth,
        borderColor: cs.borderColor,
        borderRadius: cs.borderRadius,
      },
      boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      textContent: el.textContent ? el.textContent.slice(0, 200) : undefined,
      isFlexContainer: cs.display === 'flex' || cs.display === 'inline-flex',
      isFlexChild: parentDisplay === 'flex' || parentDisplay === 'inline-flex',
      parentDisplay: parentDisplay,
    };
  }

  var highlightOverlay = document.createElement('div');
  highlightOverlay.style.cssText = 'position:fixed;pointer-events:none;z-index:99999;border:2px solid #609FF8;background:rgba(96,159,248,0.08);display:none;';
  document.body.appendChild(highlightOverlay);

  var selectionOverlay = document.createElement('div');
  selectionOverlay.style.cssText = 'position:fixed;pointer-events:none;z-index:99998;border:2px solid #609FF8;background:rgba(96,159,248,0.12);display:none;';
  document.body.appendChild(selectionOverlay);

  document.addEventListener('click', function(e) {
    e.preventDefault();
    var info = getElementInfo(e.target);
    var rect = e.target.getBoundingClientRect();
    selectionOverlay.style.display = 'block';
    selectionOverlay.style.top = rect.top + 'px';
    selectionOverlay.style.left = rect.left + 'px';
    selectionOverlay.style.width = rect.width + 'px';
    selectionOverlay.style.height = rect.height + 'px';
    window.parent.postMessage({ type: 'element-select', payload: info }, '*');
  });

  document.addEventListener('mouseover', function(e) {
    var rect = e.target.getBoundingClientRect();
    highlightOverlay.style.display = 'block';
    highlightOverlay.style.top = rect.top + 'px';
    highlightOverlay.style.left = rect.left + 'px';
    highlightOverlay.style.width = rect.width + 'px';
    highlightOverlay.style.height = rect.height + 'px';
    var info = getElementInfo(e.target);
    window.parent.postMessage({ type: 'element-hover', payload: info }, '*');
  });

  document.addEventListener('mouseout', function() {
    highlightOverlay.style.display = 'none';
  });

  window.addEventListener('message', function(e) {
    if (!e.data || e.data.type !== 'style-change') return;
    var sel = e.data.selector;
    var prop = e.data.property;
    var val = e.data.value;
    var el = sel ? document.querySelector(sel) : null;
    if (el) el.style[prop] = val;
  });
})();
</script>
`;

interface DesignCanvasProps {
  content: string;
  zoom: number;
  deviceFrame: DeviceFrameType;
  editMode: boolean;
  onElementSelect: (info: ElementInfo) => void;
  onElementHover: (info: ElementInfo) => void;
  tweakValues: Record<string, string>;
}

export function DesignCanvas({
  content,
  zoom,
  deviceFrame,
  editMode,
  onElementSelect,
  onElementHover,
  tweakValues,
}: DesignCanvasProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Build the srcdoc with bridge script injected before </body>
  const srcdoc = useMemo(() => {
    const bridgeToInject = editMode ? BRIDGE_SCRIPT : "";
    if (content.includes("</body>")) {
      return content.replace("</body>", bridgeToInject + "</body>");
    }
    if (content.includes("</html>")) {
      return content.replace("</html>", bridgeToInject + "</html>");
    }
    // No body/html tags — wrap it
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${content}${bridgeToInject}</body></html>`;
  }, [content, editMode]);

  // Listen for messages from the iframe
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (!e.data || !e.data.type) return;
      if (e.data.type === "element-select") {
        onElementSelect(e.data.payload);
      }
      if (e.data.type === "element-hover") {
        onElementHover(e.data.payload);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onElementSelect, onElementHover]);

  // Send tweak values to the iframe whenever they change
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(
      { type: "tweak-values", values: tweakValues },
      "*",
    );
  }, [tweakValues]);

  const sendStyleChange = useCallback(
    (selector: string, property: string, value: string) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) return;
      iframe.contentWindow.postMessage(
        { type: "style-change", selector, property, value },
        "*",
      );
    },
    [],
  );

  // Expose sendStyleChange for external use
  useEffect(() => {
    (window as any).__designCanvasSendStyle = sendStyleChange;
    return () => {
      delete (window as any).__designCanvasSendStyle;
    };
  }, [sendStyleChange]);

  // Device dimensions match real-world devices. iframes are replaced elements
  // with an intrinsic 300×150 size, so `aspect-ratio` + `height: auto` doesn't
  // reliably compute height from width — explicit pixel heights are required.
  const deviceDimensions: Record<
    DeviceFrameType,
    { width: string; height: string | null }
  > = {
    none: { width: "100%", height: null },
    desktop: { width: "1280px", height: "800px" }, // 16:10
    tablet: { width: "768px", height: "1024px" }, // iPad
    mobile: { width: "390px", height: "844px" }, // iPhone 14
  };

  const { width: iframeWidth, height: iframeHeight } =
    deviceDimensions[deviceFrame];

  const iframeElement = (
    <iframe
      ref={iframeRef}
      srcDoc={srcdoc}
      sandbox="allow-scripts allow-same-origin"
      className="border-0 bg-white"
      style={{
        width: iframeWidth,
        height: deviceFrame === "none" ? "100%" : (iframeHeight ?? undefined),
      }}
      title="Design Preview"
    />
  );

  const wrappedContent =
    deviceFrame === "none" ? (
      iframeElement
    ) : (
      <DeviceFrame type={deviceFrame}>{iframeElement}</DeviceFrame>
    );

  return (
    <div className="relative flex-1 h-full overflow-auto">
      {/* Dot grid background */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      {/* Canvas area. "none" mode fills the canvas (responsive preview);
          framed modes are centered inside the dot-grid with zoom applied. */}
      {deviceFrame === "none" ? (
        <div className="relative h-full w-full p-8">
          <div
            className="h-full w-full"
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: "top left",
            }}
          >
            {wrappedContent}
          </div>
        </div>
      ) : (
        <div className="relative flex items-center justify-center min-h-full p-8">
          <div
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: "center center",
            }}
          >
            {wrappedContent}
          </div>
        </div>
      )}
    </div>
  );
}
