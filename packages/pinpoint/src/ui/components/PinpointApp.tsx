// @agent-native/pinpoint — Root SolidJS application component
// MIT License

import {
  createSignal,
  createEffect,
  onCleanup,
  type Component,
} from "solid-js";
import type { PinpointConfig, Pin, ElementContext } from "../../types/index.js";
import { ElementPicker } from "../../detection/element-picker.js";
import { DragSelect } from "../../detection/drag-select.js";
import { TextSelect } from "../../detection/text-select.js";
import {
  buildElementContext,
  extractElementInfo,
} from "../../detection/element-info.js";
import {
  detectFramework,
  getComponentInfo,
  getSourceLocation,
} from "../../frameworks/adapter.js";
import { Toolbar } from "./Toolbar.js";
import { OverlayCanvas } from "./OverlayCanvas.js";
import { PinPopup } from "./PinPopup.js";
import { PinMarkerManager } from "./PinMarker.js";
import { ContextMenu } from "./ContextMenu.js";
import { SelectionLabel } from "./SelectionLabel.js";
import { PromptMode } from "./PromptMode.js";
// SettingsPanel is now inline in Toolbar
import { MemoryStore } from "../../storage/memory-store.js";
import { RestClient } from "../../storage/rest-client.js";
import type { PinStorage } from "../../types/index.js";

export interface PinpointAppProps {
  config: PinpointConfig;
}

export const PinpointApp: Component<PinpointAppProps> = (props) => {
  // Core state
  const [active, setActive] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  const [pins, setPins] = createSignal<Pin[]>([]);
  const [hoveredElement, setHoveredElement] = createSignal<Element | null>(
    null,
  );
  const [hoveredRect, setHoveredRect] = createSignal<DOMRect | null>(null);
  const [selectedElement, setSelectedElement] = createSignal<Element | null>(
    null,
  );
  const [selectedContext, setSelectedContext] =
    createSignal<ElementContext | null>(null);
  const [showPopup, setShowPopup] = createSignal(false);
  const [editingPin, setEditingPin] = createSignal<Pin | null>(null);
  const [showContextMenu, setShowContextMenu] = createSignal(false);
  const [contextMenuPos, setContextMenuPos] = createSignal({ x: 0, y: 0 });
  const [showSettings, setShowSettings] = createSignal(false);
  const [showPrompt, setShowPrompt] = createSignal(false);
  const [selectionLabelInfo, setSelectionLabelInfo] = createSignal<{
    text: string;
    rect: DOMRect;
  } | null>(null);
  const [dragRect, setDragRect] = createSignal<DOMRect | null>(null);

  // Settings state
  const [outputFormat, setOutputFormat] = createSignal(
    props.config.outputFormat || "standard",
  );
  const [clearOnSend, setClearOnSend] = createSignal(
    props.config.clearOnSend ?? false,
  );
  const [blockInteractions, setBlockInteractions] = createSignal(
    props.config.blockInteractions ?? false,
  );
  const [autoSubmit, setAutoSubmit] = createSignal(
    props.config.autoSubmit ?? true,
  );

  // Storage adapter selection
  const storage: PinStorage =
    props.config.storage ||
    (props.config.endpoint
      ? new RestClient(props.config.endpoint)
      : new MemoryStore());

  // Element picker
  const picker = new ElementPicker({
    ignoreSelector: "#pinpoint-root, [data-pinpoint-marker]",
    blockInteractions: blockInteractions(),
    onHover: (element, rect) => {
      setHoveredElement(element);
      setHoveredRect(rect);

      if (element && rect) {
        const framework = detectFramework();
        const componentInfo = framework.getComponentInfo(element);
        const tagName = element.tagName.toLowerCase();
        const componentName = componentInfo?.name;
        const sourceFile = framework.getSourceLocation(element)?.file;

        const parts = [tagName];
        if (componentName) parts.push(componentName);
        if (sourceFile) parts.push(sourceFile);

        setSelectionLabelInfo({ text: parts.join(" · "), rect });
      } else {
        setSelectionLabelInfo(null);
      }
    },
    onStableHover: (_element) => {
      // Could load full component context here
    },
    onSelect: (element) => {
      const framework = detectFramework();
      const frameworkInfo = (() => {
        const info = framework.getComponentInfo(element);
        const source = framework.getSourceLocation(element);
        if (!info && !source) return undefined;
        return {
          framework: framework.name,
          componentPath: info?.name ? `<${info.name}>` : "",
          sourceFile: source
            ? `${source.file}${source.line ? `:${source.line}` : ""}`
            : undefined,
          frameworkVersion: undefined,
        };
      })();

      const context = buildElementContext(element, frameworkInfo);
      setSelectedElement(element);
      setSelectedContext(context);
      setShowPopup(true);
      picker.pause(); // Pause picking while popup is open
    },
  });

  // Drag select
  const dragSelect = new DragSelect({
    ignoreSelector: "#pinpoint-root, [data-pinpoint-marker]",
    onDragStart: (rect) => setDragRect(rect),
    onDragMove: (rect) => setDragRect(rect),
    onDragEnd: (elements) => {
      setDragRect(null);
      // Create pins for all selected elements
      for (const el of elements) {
        addPin(el, "Multi-selected element");
      }
    },
  });

  // Text select
  const textSelect = new TextSelect({
    onSelect: (_selection) => {
      // Text selection handling
    },
  });

  // Keyboard shortcuts
  const handleKeyDown = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;

    // Cmd/Ctrl+Shift+. → Toggle toolbar
    if (mod && e.shiftKey && e.key === ".") {
      e.preventDefault();
      toggleActive();
      return;
    }

    if (!active()) return;

    // Cmd/Ctrl+Shift+C → Copy annotations
    if (mod && e.shiftKey && e.key === "C") {
      e.preventDefault();
      copyPins();
      return;
    }

    // Cmd/Ctrl+Shift+Enter → Send to agent
    if (mod && e.shiftKey && e.key === "Enter") {
      e.preventDefault();
      sendPins();
      return;
    }

    // Esc → Close popup/collapse toolbar
    if (e.key === "Escape") {
      if (showPopup()) {
        closePopup();
      } else if (showContextMenu()) {
        setShowContextMenu(false);
      } else if (showPrompt()) {
        setShowPrompt(false);
      } else if (expanded()) {
        setExpanded(false);
      } else {
        deactivateSelection();
      }
    }
  };

  // Right-click context menu
  const handleContextMenu = (e: MouseEvent) => {
    if (!active()) return;
    const element = document.elementFromPoint(e.clientX, e.clientY);
    if (!element || element.closest("#pinpoint-root")) return;

    e.preventDefault();
    setSelectedElement(element);
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  };

  createEffect(() => {
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("contextmenu", handleContextMenu, true);

    onCleanup(() => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("contextmenu", handleContextMenu, true);
      picker.dispose();
      dragSelect.dispose();
      textSelect.dispose();
      markerManager.dispose();
    });
  });

  // Pin marker manager (DOM badges outside Shadow DOM)
  const markerManager = new PinMarkerManager(props.config.markerColor);
  markerManager.setOnClick((pin) => openEditPopup(pin));

  // Load existing pins
  createEffect(() => {
    const pageUrl = window.location.pathname;
    storage.load(pageUrl).then((loaded) => setPins(loaded));
  });

  // Sync DOM markers whenever pins change
  createEffect(() => {
    const currentPins = pins();
    markerManager.update(currentPins);
  });

  function toggleActive() {
    if (active()) {
      deactivateSelection();
    } else {
      activateSelection();
    }
  }

  function activateSelection() {
    setActive(true);
    setExpanded(true);
    picker.activate();
    dragSelect.activate();
    textSelect.activate();
  }

  function deactivateSelection() {
    setActive(false);
    picker.deactivate();
    dragSelect.deactivate();
    textSelect.deactivate();
    setHoveredElement(null);
    setHoveredRect(null);
    setSelectionLabelInfo(null);
  }

  function closePopup() {
    setShowPopup(false);
    setEditingPin(null);
    picker.resume();
  }

  function addPin(element: Element, comment: string) {
    const framework = detectFramework();
    const frameworkInfo = (() => {
      const info = framework.getComponentInfo(element);
      const source = framework.getSourceLocation(element);
      if (!info && !source) return undefined;
      return {
        framework: framework.name,
        componentPath: info?.name ? `<${info.name}>` : "",
        sourceFile: source
          ? `${source.file}${source.line ? `:${source.line}` : ""}`
          : undefined,
        frameworkVersion: undefined,
      };
    })();

    const elementInfo = extractElementInfo(element);
    const now = new Date().toISOString();
    const pin: Pin = {
      id: crypto.randomUUID(),
      pageUrl: window.location.pathname,
      createdAt: now,
      updatedAt: now,
      author: props.config.author,
      comment,
      element: elementInfo,
      framework: frameworkInfo,
      status: { state: "open", changedAt: now, changedBy: "user" },
    };

    setPins((prev) => [...prev, pin]);
    storage.save(pin);
    closePopup();
  }

  function openEditPopup(pin: Pin) {
    // Close first so SolidJS re-creates the component with fresh props
    setShowPopup(false);

    // Use microtask to ensure the close renders before reopening
    queueMicrotask(() => {
      const el = document.querySelector(pin.element.selector);
      setEditingPin(pin);
      setSelectedContext(
        buildElementContext(el || document.body, pin.framework),
      );
      setShowPopup(true);
      picker.pause();
    });
  }

  function updatePin(comment: string) {
    const pin = editingPin();
    if (!pin) return;
    const now = new Date().toISOString();
    const updated = { ...pin, comment, updatedAt: now };
    setPins((prev) => prev.map((p) => (p.id === pin.id ? updated : p)));
    storage.update(pin.id, { comment, updatedAt: now });
    closePopup();
  }

  async function copyPins() {
    const { formatPins } = await import("../../output/formatter.js");
    const text = formatPins(pins(), outputFormat());
    await navigator.clipboard.writeText(text);
  }

  async function sendPins() {
    const { formatPinsForAgent } =
      await import("../../output/agent-context.js");
    const { message, context } = formatPinsForAgent(pins(), outputFormat());

    try {
      const { sendToAgentChat } = await import("@agent-native/core/client");
      sendToAgentChat({ message, context, submit: autoSubmit() });
    } catch {
      // Fallback to clipboard
      await navigator.clipboard.writeText(`${message}\n\n${context}`);
    }

    if (clearOnSend()) {
      const pageUrl = window.location.pathname;
      await storage.clear(pageUrl);
      setPins([]);
    }
  }

  function removePin(id: string) {
    setPins((prev) => prev.filter((p) => p.id !== id));
    storage.delete(id);
  }

  function clearPins() {
    const pageUrl = window.location.pathname;
    storage.clear(pageUrl);
    setPins([]);
  }

  return (
    <>
      {/* Canvas overlay for hover/selection highlighting */}
      <OverlayCanvas
        hoveredRect={hoveredRect()}
        dragRect={dragRect()}
        pins={pins()}
        active={active()}
      />

      {/* Selection label near hovered element */}
      <SelectionLabel info={selectionLabelInfo()} />

      {/* Toolbar */}
      <Toolbar
        expanded={expanded()}
        active={active()}
        pins={pins()}
        position={props.config.position}
        author={props.config.author}
        showSettings={showSettings()}
        outputFormat={outputFormat()}
        clearOnSend={clearOnSend()}
        blockInteractions={blockInteractions()}
        autoSubmit={autoSubmit()}
        webhookUrl={props.config.webhookUrl}
        onToggleExpand={() => {
          const willExpand = !expanded();
          setExpanded(willExpand);
          if (willExpand) {
            activateSelection();
          } else {
            deactivateSelection();
            setShowSettings(false);
          }
        }}
        onSend={sendPins}
        onCopy={copyPins}
        onClear={clearPins}
        onRemovePin={removePin}
        onEditPin={openEditPopup}
        onToggleSettings={() => setShowSettings(!showSettings())}
        onOutputFormatChange={setOutputFormat}
        onClearOnSendChange={setClearOnSend}
        onBlockInteractionsChange={setBlockInteractions}
        onAutoSubmitChange={setAutoSubmit}
      />

      {/* Pin popup for annotation */}
      {showPopup() && selectedContext() && (
        <PinPopup
          context={selectedContext()!}
          author={props.config.author}
          initialComment={editingPin()?.comment}
          isEditing={!!editingPin()}
          onAdd={(comment) => {
            if (editingPin()) {
              updatePin(comment);
            } else {
              addPin(selectedElement()!, comment);
            }
          }}
          onCancel={() => closePopup()}
        />
      )}

      {/* Context menu */}
      {showContextMenu() && selectedElement() && (
        <ContextMenu
          position={contextMenuPos()}
          element={selectedElement()!}
          onClose={() => setShowContextMenu(false)}
          onAnnotate={() => {
            setShowContextMenu(false);
            const el = selectedElement()!;
            const framework = detectFramework();
            const frameworkInfo = (() => {
              const info = framework.getComponentInfo(el);
              const source = framework.getSourceLocation(el);
              if (!info && !source) return undefined;
              return {
                framework: framework.name,
                componentPath: info?.name ? `<${info.name}>` : "",
                sourceFile: source?.file,
                frameworkVersion: undefined,
              };
            })();
            setSelectedContext(buildElementContext(el, frameworkInfo));
            setShowPopup(true);
            picker.pause();
          }}
          onCopyContext={async () => {
            const el = selectedElement()!;
            const context = buildElementContext(el);
            await navigator.clipboard.writeText(
              JSON.stringify(context, null, 2),
            );
            setShowContextMenu(false);
          }}
          onPrompt={() => {
            setShowContextMenu(false);
            setShowPrompt(true);
          }}
        />
      )}

      {/* Prompt mode */}
      {showPrompt() && selectedElement() && (
        <PromptMode
          element={selectedElement()!}
          onSend={async (instruction) => {
            try {
              const { sendToAgentChat } =
                await import("@agent-native/core/client");
              const context = buildElementContext(selectedElement()!);
              sendToAgentChat({
                message: instruction,
                context: JSON.stringify(context, null, 2),
                submit: autoSubmit(),
              });
            } catch {
              // Fallback
            }
            setShowPrompt(false);
          }}
          onCancel={() => setShowPrompt(false)}
        />
      )}

      {/* Settings panel is now inline in Toolbar */}
    </>
  );
};
