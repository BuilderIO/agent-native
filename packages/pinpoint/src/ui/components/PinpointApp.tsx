// @agent-native/pinpoint — Root SolidJS application component
// MIT License

import {
  createSignal,
  createEffect,
  onCleanup,
  type Component,
} from "solid-js";
import type {
  PinpointConfig,
  Pin,
  ElementContext,
  DrawStroke,
  DrawToolType,
  TextNote,
  ToolbarMode,
  QueuedAnnotation,
} from "../../types/index.js";
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
import { TextInputPopup } from "./TextInputPopup.js";
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

  // Mode state
  const [mode, setMode] = createSignal<ToolbarMode>("select");

  // Draw mode state
  const [drawMode, setDrawMode] = createSignal(false);
  const [drawStrokes, setDrawStrokes] = createSignal<DrawStroke[]>([]);
  const [currentStroke, setCurrentStroke] = createSignal<DrawStroke | null>(
    null,
  );
  const [drawColor, setDrawColor] = createSignal("#EF4444");
  const [drawLineWidth, setDrawLineWidth] = createSignal(4);
  const [drawTool, setDrawTool] = createSignal<DrawToolType>("freehand");
  const [textNotes, setTextNotes] = createSignal<TextNote[]>([]);
  const [showTextInput, setShowTextInput] = createSignal(false);
  const [textInputPos, setTextInputPos] = createSignal({ x: 0, y: 0 });
  let isDrawing = false;

  // Queue state
  const [queue, setQueue] = createSignal<QueuedAnnotation[]>([]);

  // Select-for-send state
  const [selectedPinIds, setSelectedPinIds] = createSignal<Set<string>>(
    new Set(),
  );

  // Settings state
  const [outputFormat, setOutputFormat] = createSignal(
    props.config.outputFormat || "detailed",
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
  const [compactPopup, setCompactPopup] = createSignal(
    props.config.compactPopup ?? true,
  );

  // Storage adapter
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
      picker.pause();
    },
  });

  // Drag select
  const dragSelect = new DragSelect({
    ignoreSelector: "#pinpoint-root, [data-pinpoint-marker]",
    onDragStart: (rect) => setDragRect(rect),
    onDragMove: (rect) => setDragRect(rect),
    onDragEnd: (elements) => {
      setDragRect(null);
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

    // Cmd/Ctrl+Shift+. -> Toggle toolbar
    if (mod && e.shiftKey && e.key === ".") {
      e.preventDefault();
      toggleActive();
      return;
    }

    // Cmd/Ctrl+Shift+D -> Toggle draw mode
    if (mod && e.shiftKey && (e.key === "D" || e.key === "d")) {
      e.preventDefault();
      if (active()) {
        if (mode() === "draw") {
          handleModeChange("select");
        } else {
          handleModeChange("draw");
        }
      }
      return;
    }

    if (!active()) return;

    // Cmd/Ctrl+Shift+C -> Copy annotations
    if (mod && e.shiftKey && e.key === "C") {
      e.preventDefault();
      copyPins();
      return;
    }

    // Cmd/Ctrl+Shift+Enter -> Send queue/selected to agent
    if (mod && e.shiftKey && e.key === "Enter") {
      e.preventDefault();
      if (queue().length > 0) {
        sendQueue();
      } else if (selectedPinIds().size > 0) {
        sendSelected();
      } else {
        sendPins();
      }
      return;
    }

    // Cmd/Ctrl+Z -> Undo draw stroke
    if (mod && e.key === "z" && drawMode()) {
      e.preventDefault();
      undoDrawStroke();
      return;
    }

    // Esc -> Close popup/exit draw mode/collapse toolbar
    if (e.key === "Escape") {
      if (showTextInput()) {
        setShowTextInput(false);
      } else if (showPopup()) {
        closePopup();
      } else if (showContextMenu()) {
        setShowContextMenu(false);
      } else if (showPrompt()) {
        setShowPrompt(false);
      } else if (drawMode()) {
        handleModeChange("select");
      } else if (expanded()) {
        setExpanded(false);
      } else {
        deactivateSelection();
      }
    }
  };

  // Right-click context menu
  const handleContextMenu = (e: MouseEvent) => {
    if (!active() || drawMode()) return;
    const element = document.elementFromPoint(e.clientX, e.clientY);
    if (!element || element.closest("#pinpoint-root")) return;

    e.preventDefault();
    setSelectedElement(element);
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  };

  // Propagate blockInteractions setting changes
  createEffect(() => {
    picker.setBlockInteractions(blockInteractions());
  });

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
  markerManager.setOnToggleSelect((pin) => togglePinSelect(pin));

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

  // Sync selected pin IDs to marker manager
  createEffect(() => {
    markerManager.setSelectedPins(selectedPinIds());
  });

  // Mode change handler
  function handleModeChange(newMode: ToolbarMode) {
    setMode(newMode);

    if (newMode === "draw") {
      setDrawMode(true);
      picker.pause();
      dragSelect.deactivate();
      textSelect.deactivate();
      markerManager.setShowCheckboxes(false);
    } else if (newMode === "select") {
      setDrawMode(false);
      picker.resume();
      if (active()) {
        dragSelect.activate();
        textSelect.activate();
      }
      markerManager.setShowCheckboxes(false);
    } else if (newMode === "queue") {
      setDrawMode(false);
      picker.pause();
      markerManager.setShowCheckboxes(true);
    }
  }

  // Draw mode handlers
  function handleDrawStart(x: number, y: number) {
    isDrawing = true;
    const toolType = drawTool();
    if (toolType === "text") return; // Handled separately
    setCurrentStroke({
      points: [{ x, y }],
      color: drawColor(),
      lineWidth: drawLineWidth(),
      type: toolType as DrawStroke["type"],
    });
  }

  function handleDrawMove(x: number, y: number) {
    if (!isDrawing) return;
    const stroke = currentStroke();
    if (!stroke) return;

    if (stroke.type === "freehand") {
      setCurrentStroke({
        ...stroke,
        points: [...stroke.points, { x, y }],
      });
    } else {
      // For shapes, keep start and replace end
      setCurrentStroke({
        ...stroke,
        points: [stroke.points[0], { x, y }],
      });
    }
  }

  function handleDrawEnd() {
    if (!isDrawing) return;
    isDrawing = false;
    const stroke = currentStroke();
    if (stroke && stroke.points.length > 1) {
      setDrawStrokes((prev) => [...prev, stroke]);
    }
    setCurrentStroke(null);
  }

  function handleTextPlace(x: number, y: number) {
    setTextInputPos({ x, y });
    setShowTextInput(true);
  }

  function handleTextSubmit(text: string) {
    setTextNotes((prev) => [
      ...prev,
      { x: textInputPos().x, y: textInputPos().y, text, color: drawColor() },
    ]);
    setShowTextInput(false);
  }

  function undoDrawStroke() {
    if (textNotes().length > 0) {
      setTextNotes((prev) => prev.slice(0, -1));
    } else if (drawStrokes().length > 0) {
      setDrawStrokes((prev) => prev.slice(0, -1));
    }
  }

  function clearDrawing() {
    setDrawStrokes([]);
    setTextNotes([]);
    setCurrentStroke(null);
  }

  // Queue handlers
  function addToQueue(pin?: Pin) {
    const item: QueuedAnnotation = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };

    if (pin) {
      item.pin = pin;
    }

    // Include current drawings if any
    const strokes = drawStrokes();
    const notes = textNotes();
    if (strokes.length > 0 || notes.length > 0) {
      item.drawings = [...strokes];
      item.textNotes = [...notes];
      clearDrawing();
    }

    setQueue((prev) => [...prev, item]);
  }

  async function sendQueue() {
    const items = queue();
    if (items.length === 0) return;

    const { formatQueueForAgent } =
      await import("../../output/agent-context.js");
    const { message, context } = formatQueueForAgent(items, outputFormat());

    try {
      const { sendToAgentChat } = await import("@agent-native/core/client");
      sendToAgentChat({ message, context, submit: autoSubmit() });
    } catch {
      await navigator.clipboard.writeText(`${message}\n\n${context}`);
    }

    setQueue([]);

    if (clearOnSend()) {
      const pageUrl = window.location.pathname;
      await storage.clear(pageUrl);
      setPins([]);
    }
  }

  function clearQueue() {
    setQueue([]);
  }

  // Pin select-for-send
  function togglePinSelect(pin: Pin) {
    setSelectedPinIds((prev) => {
      const next = new Set(prev);
      if (next.has(pin.id)) {
        next.delete(pin.id);
      } else {
        next.add(pin.id);
      }
      return next;
    });
  }

  async function sendSelected() {
    const ids = selectedPinIds();
    if (ids.size === 0) return;

    const selected = pins().filter((p) => ids.has(p.id));
    const { formatPinsForAgent } =
      await import("../../output/agent-context.js");
    const { message, context } = formatPinsForAgent(selected, outputFormat());

    try {
      const { sendToAgentChat } = await import("@agent-native/core/client");
      sendToAgentChat({ message, context, submit: autoSubmit() });
    } catch {
      await navigator.clipboard.writeText(`${message}\n\n${context}`);
    }

    setSelectedPinIds(new Set<string>());
  }

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
    if (mode() !== "draw") {
      picker.activate();
      dragSelect.activate();
      textSelect.activate();
    }
  }

  function deactivateSelection() {
    setActive(false);
    setDrawMode(false);
    setMode("select");
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
    if (mode() !== "draw") {
      picker.resume();
    }
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
    return pin;
  }

  function handleQueueFromPopup(comment: string) {
    const el = selectedElement();
    if (!el) return;
    const pin = addPin(el, comment);
    addToQueue(pin);
  }

  async function handleFixThis(comment: string) {
    const el = selectedElement();
    if (!el) return;
    const pin = addPin(el, comment);

    // Format rich context
    const { formatRichPinContext } =
      await import("../../output/agent-context.js");
    const richMessage = `Please fix: ${formatRichPinContext(pin)}`;

    try {
      const { sendToAgentChat } = await import("@agent-native/core/client");
      sendToAgentChat({
        message: richMessage,
        context: "",
        submit: autoSubmit(),
      });
    } catch {
      await navigator.clipboard.writeText(richMessage);
    }
  }

  function openEditPopup(pin: Pin) {
    setShowPopup(false);

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
    // Also remove from selected
    setSelectedPinIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function clearPins() {
    const pageUrl = window.location.pathname;
    storage.clear(pageUrl);
    setPins([]);
    setSelectedPinIds(new Set<string>());
  }

  return (
    <>
      {/* Canvas overlay for hover/selection/drawing */}
      <OverlayCanvas
        hoveredRect={hoveredRect()}
        dragRect={dragRect()}
        pins={pins()}
        active={active()}
        drawMode={drawMode()}
        drawStrokes={drawStrokes()}
        currentStroke={currentStroke()}
        drawColor={drawColor()}
        drawLineWidth={drawLineWidth()}
        drawTool={drawTool()}
        textNotes={textNotes()}
        onDrawStart={handleDrawStart}
        onDrawMove={handleDrawMove}
        onDrawEnd={handleDrawEnd}
        onTextPlace={handleTextPlace}
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
        compactPopup={compactPopup()}
        mode={mode()}
        drawTool={drawTool()}
        drawColor={drawColor()}
        drawLineWidth={drawLineWidth()}
        drawStrokeCount={drawStrokes().length + textNotes().length}
        queue={queue()}
        selectedPinIds={selectedPinIds()}
        onToggleExpand={() => {
          const willExpand = !expanded();
          setExpanded(willExpand);
          if (willExpand) {
            activateSelection();
          } else {
            deactivateSelection();
            setShowSettings(false);
            if (showPopup()) {
              closePopup();
            }
          }
        }}
        onModeChange={handleModeChange}
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
        onCompactPopupChange={setCompactPopup}
        onDrawToolChange={setDrawTool}
        onDrawColorChange={setDrawColor}
        onDrawLineWidthChange={setDrawLineWidth}
        onDrawUndo={undoDrawStroke}
        onDrawClear={clearDrawing}
        onQueueAdd={() => addToQueue()}
        onQueueSend={sendQueue}
        onQueueClear={clearQueue}
        onSendSelected={sendSelected}
        onTogglePinSelect={togglePinSelect}
      />

      {/* Pin popup for annotation */}
      {showPopup() && selectedContext() && (
        <PinPopup
          context={selectedContext()!}
          initialComment={editingPin()?.comment}
          isEditing={!!editingPin()}
          compactPopup={compactPopup()}
          queueMode={mode() === "queue"}
          onAdd={(comment) => {
            if (editingPin()) {
              updatePin(comment);
            } else {
              addPin(selectedElement()!, comment);
            }
          }}
          onQueue={handleQueueFromPopup}
          onFixThis={handleFixThis}
          onCancel={() => closePopup()}
        />
      )}

      {/* Text input popup for draw-mode text annotations */}
      {showTextInput() && (
        <TextInputPopup
          x={textInputPos().x}
          y={textInputPos().y}
          color={drawColor()}
          onSubmit={handleTextSubmit}
          onCancel={() => setShowTextInput(false)}
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
    </>
  );
};
