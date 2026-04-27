// @agent-native/pinpoint — Pill-style floating toolbar with mode tabs
// MIT License
//
// Collapsed: small pill with pin count. Expanded: mode-tabbed controls.
// Modes: Select (element picking), Draw (freehand/shapes), Queue (batch send).

import { createSignal, Show, For, type Component } from "solid-js";
import type {
  Pin,
  OutputFormat,
  ToolbarMode,
  DrawToolType,
  QueuedAnnotation,
} from "../../types/index.js";
import { icons } from "../icons/index.js";

const DRAW_COLORS = [
  { color: "#EF4444", name: "Red" },
  { color: "#3B82F6", name: "Blue" },
  { color: "#22C55E", name: "Green" },
  { color: "#EAB308", name: "Yellow" },
];

const LINE_WIDTHS = [
  { width: 2, name: "Thin" },
  { width: 4, name: "Medium" },
  { width: 8, name: "Thick" },
];

interface ToolbarProps {
  expanded: boolean;
  active: boolean;
  pins: Pin[];
  position?: { x: number; y: number };
  author?: string;
  showSettings: boolean;
  outputFormat: OutputFormat;
  clearOnSend: boolean;
  blockInteractions: boolean;
  autoSubmit: boolean;
  compactPopup: boolean;
  webhookUrl?: string;
  // Mode state
  mode: ToolbarMode;
  drawTool: DrawToolType;
  drawColor: string;
  drawLineWidth: number;
  drawStrokeCount: number;
  // Queue state
  queue: QueuedAnnotation[];
  selectedPinIds: Set<string>;
  // Callbacks
  onToggleExpand: () => void;
  onModeChange: (mode: ToolbarMode) => void;
  onSend: () => void;
  onCopy: () => void;
  onClear: () => void;
  onRemovePin: (id: string) => void;
  onEditPin: (pin: Pin) => void;
  onToggleSettings: () => void;
  onOutputFormatChange: (format: OutputFormat) => void;
  onClearOnSendChange: (value: boolean) => void;
  onBlockInteractionsChange: (value: boolean) => void;
  onAutoSubmitChange: (value: boolean) => void;
  onCompactPopupChange: (value: boolean) => void;
  // Draw callbacks
  onDrawToolChange: (tool: DrawToolType) => void;
  onDrawColorChange: (color: string) => void;
  onDrawLineWidthChange: (width: number) => void;
  onDrawUndo: () => void;
  onDrawClear: () => void;
  // Queue callbacks
  onQueueAdd: () => void;
  onQueueSend: () => void;
  onQueueClear: () => void;
  // Select-for-send
  onSendSelected: () => void;
  onTogglePinSelect: (pin: Pin) => void;
}

export const Toolbar: Component<ToolbarProps> = (props) => {
  // Position stored as right/bottom offsets for edge anchoring
  const [pos, setPos] = createSignal<{ right: number; bottom: number }>(
    props.position
      ? {
          right: window.innerWidth - props.position.x,
          bottom: window.innerHeight - props.position.y,
        }
      : { right: 16, bottom: 16 },
  );
  const [dragging, setDragging] = createSignal(false);
  const [dragStart, setDragStart] = createSignal({
    x: 0,
    y: 0,
    right: 0,
    bottom: 0,
  });
  const [didDrag, setDidDrag] = createSignal(false);

  function handleMouseDown(e: MouseEvent) {
    if (props.expanded) return;
    setDragging(true);
    setDidDrag(false);
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      right: pos().right,
      bottom: pos().bottom,
    });

    const handleMove = (e: MouseEvent) => {
      setDidDrag(true);
      const start = dragStart();
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      setPos({
        right: Math.max(0, Math.min(window.innerWidth - 60, start.right - dx)),
        bottom: Math.max(
          0,
          Math.min(window.innerHeight - 60, start.bottom - dy),
        ),
      });
    };

    const handleUp = () => {
      setDragging(false);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }

  function handleClick(e: Event) {
    if (props.expanded) return;
    if (didDrag()) return;
    props.onToggleExpand();
  }

  // Queue summary counts
  const queueSummary = () => {
    const q = props.queue;
    let draws = 0;
    let clicks = 0;
    for (const item of q) {
      if (item.drawings?.length || item.textNotes?.length) draws++;
      if (item.pin) clicks++;
    }
    const parts: string[] = [];
    if (draws > 0) parts.push(`Draw x${draws}`);
    if (clicks > 0) parts.push(`Click x${clicks}`);
    return parts.join(" / ") || "Empty";
  };

  const totalBadgeCount = () =>
    props.pins.length + props.queue.length + props.drawStrokeCount;

  return (
    <div
      class={`pp-toolbar ${props.expanded ? "pp-toolbar--expanded" : "pp-toolbar--collapsed"}`}
      style={{
        ...(props.expanded
          ? { bottom: "16px", right: "16px" }
          : { right: `${pos().right}px`, bottom: `${pos().bottom}px` }),
      }}
      onMouseDown={props.expanded ? undefined : handleMouseDown}
      on:click={handleClick}
    >
      {!props.expanded ? (
        /* Collapsed pill */
        <div
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            gap: "6px",
          }}
        >
          {totalBadgeCount() > 0 && (
            <span class="pp-toolbar__badge">{totalBadgeCount()}</span>
          )}
          <span
            innerHTML={icons.pin}
            style={{ display: "flex", "align-items": "center" }}
          />
        </div>
      ) : (
        /* Expanded toolbar */
        <div
          on:click={(e: Event) => e.stopPropagation()}
          style={{ display: "contents" }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              "align-items": "center",
              "justify-content": "space-between",
              "font-size": "12px",
              "font-weight": "600",
              "letter-spacing": "0.02em",
              color: "var(--pp-text-muted)",
            }}
          >
            <span>{props.author || "Pinpoint"}</span>
            {props.queue.length > 0 && (
              <span class="pp-toolbar__queue-badge">{props.queue.length}</span>
            )}
          </div>

          {/* Mode tabs */}
          <div class="pp-mode-tabs" role="tablist">
            <button
              class={`pp-mode-tab ${props.mode === "select" ? "pp-mode-tab--active" : ""}`}
              on:click={() => props.onModeChange("select")}
              role="tab"
              aria-selected={props.mode === "select"}
            >
              <span innerHTML={icons.crosshair} />
              Select
            </button>
            <button
              class={`pp-mode-tab ${props.mode === "draw" ? "pp-mode-tab--active" : ""}`}
              on:click={() => props.onModeChange("draw")}
              role="tab"
              aria-selected={props.mode === "draw"}
            >
              <span innerHTML={icons.pencil} />
              Draw
            </button>
            <button
              class={`pp-mode-tab ${props.mode === "queue" ? "pp-mode-tab--active" : ""}`}
              on:click={() => props.onModeChange("queue")}
              role="tab"
              aria-selected={props.mode === "queue"}
            >
              <span innerHTML={icons.stack} />
              Queue
              {props.queue.length > 0 && (
                <span class="pp-mode-tab__count">{props.queue.length}</span>
              )}
            </button>
          </div>

          {/* SELECT MODE content */}
          <Show when={props.mode === "select"}>
            {/* Active indicator when no pins */}
            {props.pins.length === 0 && (
              <div
                style={{
                  "font-size": "11px",
                  color: "var(--pp-accent)",
                  display: "flex",
                  "align-items": "center",
                  gap: "4px",
                }}
              >
                <span innerHTML={icons.crosshair} />
                Click any element to annotate
              </div>
            )}

            {/* Pin list */}
            {props.pins.length > 0 && (
              <div class="pp-pin-list">
                <For each={props.pins}>
                  {(pin, index) => (
                    <div
                      class="pp-pin-item"
                      on:click={() => props.onEditPin(pin)}
                    >
                      <div
                        class={`pp-pin-item__status pp-pin-item__status--${pin.status.state}`}
                      />
                      <span class="pp-pin-item__number">{index() + 1}</span>
                      <div class="pp-pin-item__content">
                        <div class="pp-pin-item__comment">
                          {pin.comment || (
                            <span
                              style={{
                                color: "var(--pp-text-muted)",
                                "font-style": "italic",
                              }}
                            >
                              No comment
                            </span>
                          )}
                        </div>
                      </div>
                      {/* Select checkbox */}
                      <button
                        class="pp-btn--icon pp-btn--icon-sm"
                        on:click={(e: Event) => {
                          e.stopPropagation();
                          props.onTogglePinSelect(pin);
                        }}
                        title={
                          props.selectedPinIds.has(pin.id)
                            ? "Deselect"
                            : "Select for send"
                        }
                        aria-label={
                          props.selectedPinIds.has(pin.id)
                            ? "Deselect"
                            : "Select for send"
                        }
                        innerHTML={
                          props.selectedPinIds.has(pin.id)
                            ? icons.checkSquare
                            : icons.squareEmpty
                        }
                        style={{
                          opacity: "1",
                          "pointer-events": "auto",
                          color: props.selectedPinIds.has(pin.id)
                            ? "var(--pp-accent)"
                            : "var(--pp-text-muted)",
                        }}
                      />
                      <button
                        class="pp-btn--icon pp-btn--icon-sm"
                        on:click={(e: Event) => {
                          e.stopPropagation();
                          props.onRemovePin(pin.id);
                        }}
                        title="Remove pin"
                        aria-label="Remove pin"
                        innerHTML={icons.minus}
                      />
                    </div>
                  )}
                </For>
              </div>
            )}

            {/* Send selected button */}
            <Show when={props.selectedPinIds.size > 0}>
              <button
                class="pp-btn pp-btn--primary"
                style={{ width: "100%" }}
                on:click={() => props.onSendSelected()}
              >
                <span
                  innerHTML={icons.send}
                  style={{ display: "inline-flex" }}
                />
                Send {props.selectedPinIds.size} selected to Claude
              </button>
            </Show>
          </Show>

          {/* DRAW MODE content */}
          <Show when={props.mode === "draw"}>
            {/* Draw tool selector */}
            <div class="pp-draw-tools">
              <button
                class={`pp-draw-tool ${props.drawTool === "freehand" ? "pp-draw-tool--active" : ""}`}
                on:click={() => props.onDrawToolChange("freehand")}
                title="Freehand"
                innerHTML={icons.pencil}
              />
              <button
                class={`pp-draw-tool ${props.drawTool === "arrow" ? "pp-draw-tool--active" : ""}`}
                on:click={() => props.onDrawToolChange("arrow")}
                title="Arrow"
                innerHTML={icons.arrowUpRight}
              />
              <button
                class={`pp-draw-tool ${props.drawTool === "circle" ? "pp-draw-tool--active" : ""}`}
                on:click={() => props.onDrawToolChange("circle")}
                title="Circle"
                innerHTML={icons.circle}
              />
              <button
                class={`pp-draw-tool ${props.drawTool === "rect" ? "pp-draw-tool--active" : ""}`}
                on:click={() => props.onDrawToolChange("rect")}
                title="Rectangle"
                innerHTML={icons.square}
              />
              <button
                class={`pp-draw-tool ${props.drawTool === "text" ? "pp-draw-tool--active" : ""}`}
                on:click={() => props.onDrawToolChange("text")}
                title="Text note"
                innerHTML={icons.typography}
              />
              <div style={{ flex: "1" }} />
              <button
                class="pp-draw-tool"
                on:click={() => props.onDrawUndo()}
                title="Undo (remove last stroke)"
                innerHTML={icons.undo}
                disabled={props.drawStrokeCount === 0}
              />
              <button
                class="pp-draw-tool"
                on:click={() => props.onDrawClear()}
                title="Clear drawing"
                innerHTML={icons.trash}
                disabled={props.drawStrokeCount === 0}
              />
            </div>

            {/* Color picker */}
            <div class="pp-draw-options">
              <div class="pp-draw-colors">
                <For each={DRAW_COLORS}>
                  {(c) => (
                    <button
                      class={`pp-color-swatch ${props.drawColor === c.color ? "pp-color-swatch--active" : ""}`}
                      style={{ background: c.color }}
                      on:click={() => props.onDrawColorChange(c.color)}
                      title={c.name}
                    />
                  )}
                </For>
              </div>

              {/* Line width */}
              <div class="pp-draw-widths">
                <For each={LINE_WIDTHS}>
                  {(w) => (
                    <button
                      class={`pp-width-btn ${props.drawLineWidth === w.width ? "pp-width-btn--active" : ""}`}
                      on:click={() => props.onDrawLineWidthChange(w.width)}
                      title={w.name}
                    >
                      <div
                        style={{
                          width: "16px",
                          height: `${w.width}px`,
                          background: props.drawColor,
                          "border-radius": `${w.width / 2}px`,
                        }}
                      />
                    </button>
                  )}
                </For>
              </div>
            </div>

            {/* Draw stroke count */}
            <Show when={props.drawStrokeCount > 0}>
              <div
                style={{
                  "font-size": "11px",
                  color: "var(--pp-text-muted)",
                  "text-align": "center",
                }}
              >
                {props.drawStrokeCount} stroke
                {props.drawStrokeCount !== 1 ? "s" : ""}
              </div>
            </Show>
          </Show>

          {/* QUEUE MODE content */}
          <Show when={props.mode === "queue"}>
            {props.queue.length === 0 ? (
              <div
                style={{
                  "font-size": "11px",
                  color: "var(--pp-text-muted)",
                  "text-align": "center",
                  padding: "8px 0",
                }}
              >
                Queue is empty. Add pins or drawings, then queue them here.
              </div>
            ) : (
              <>
                <div
                  style={{
                    "font-size": "11px",
                    color: "var(--pp-text-muted)",
                    "text-align": "center",
                  }}
                >
                  {queueSummary()}
                </div>

                <div class="pp-pin-list">
                  <For each={props.queue}>
                    {(item, index) => (
                      <div class="pp-pin-item">
                        <span class="pp-pin-item__number">{index() + 1}</span>
                        <div class="pp-pin-item__content">
                          <div class="pp-pin-item__comment">
                            {item.pin
                              ? item.pin.comment || "Pin annotation"
                              : `Drawing (${(item.drawings?.length || 0) + (item.textNotes?.length || 0)} items)`}
                          </div>
                        </div>
                      </div>
                    )}
                  </For>
                </div>

                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    class="pp-btn"
                    style={{ flex: "1" }}
                    on:click={() => props.onQueueClear()}
                  >
                    Clear
                  </button>
                  <button
                    class="pp-btn pp-btn--primary"
                    style={{ flex: "1" }}
                    on:click={() => props.onQueueSend()}
                  >
                    <span
                      innerHTML={icons.send}
                      style={{ display: "inline-flex" }}
                    />
                    Send All
                  </button>
                </div>
              </>
            )}
          </Show>

          {/* Settings panel */}
          <Show when={props.showSettings}>
            <div class="pp-settings">
              <div class="pp-settings__row">
                <span class="pp-settings__label">Output detail</span>
                <select
                  style={{
                    background: "var(--pp-bg-solid)",
                    color: "var(--pp-text)",
                    border: "1px solid var(--pp-border)",
                    "border-radius": "var(--pp-radius-sm)",
                    padding: "2px 6px",
                    "font-size": "11px",
                  }}
                  value={props.outputFormat}
                  onChange={(e) =>
                    props.onOutputFormatChange(
                      e.currentTarget.value as OutputFormat,
                    )
                  }
                >
                  <option value="compact">Compact</option>
                  <option value="standard">Standard</option>
                  <option value="detailed">Detailed</option>
                </select>
              </div>
              <div class="pp-settings__row">
                <span class="pp-settings__label">Auto-submit</span>
                <div
                  class={`pp-toggle ${props.autoSubmit ? "pp-toggle--active" : ""}`}
                  on:click={() => props.onAutoSubmitChange(!props.autoSubmit)}
                >
                  <div class="pp-toggle__thumb" />
                </div>
              </div>
              <div class="pp-settings__row">
                <span class="pp-settings__label">Clear on send</span>
                <div
                  class={`pp-toggle ${props.clearOnSend ? "pp-toggle--active" : ""}`}
                  on:click={() => props.onClearOnSendChange(!props.clearOnSend)}
                >
                  <div class="pp-toggle__thumb" />
                </div>
              </div>
              <div class="pp-settings__row">
                <span class="pp-settings__label">Block page clicks</span>
                <div
                  class={`pp-toggle ${props.blockInteractions ? "pp-toggle--active" : ""}`}
                  on:click={() =>
                    props.onBlockInteractionsChange(!props.blockInteractions)
                  }
                >
                  <div class="pp-toggle__thumb" />
                </div>
              </div>
              <div class="pp-settings__row">
                <span class="pp-settings__label">Compact popup</span>
                <div
                  class={`pp-toggle ${props.compactPopup ? "pp-toggle--active" : ""}`}
                  on:click={() =>
                    props.onCompactPopupChange(!props.compactPopup)
                  }
                >
                  <div class="pp-toggle__thumb" />
                </div>
              </div>
            </div>
          </Show>

          {/* Bottom action bar */}
          <div class="pp-actions" role="toolbar" aria-label="Pinpoint actions">
            <button
              class="pp-btn--icon"
              on:click={() => props.onSend()}
              title="Send to agent"
              aria-label="Send to agent"
              innerHTML={icons.send}
            />
            <button
              class="pp-btn--icon"
              on:click={() => props.onCopy()}
              title="Copy to clipboard"
              aria-label="Copy to clipboard"
              innerHTML={icons.copy}
            />
            {props.pins.length > 0 && (
              <button
                class="pp-btn--icon"
                on:click={() => props.onClear()}
                title="Clear all"
                aria-label="Clear all pins"
                innerHTML={icons.trash}
              />
            )}
            <button
              class="pp-btn--icon"
              on:click={() => props.onToggleSettings()}
              title="Settings"
              aria-label="Toggle settings"
              innerHTML={icons.settings}
            />
            <button
              class="pp-btn--icon"
              on:click={() => props.onToggleExpand()}
              title="Close"
              aria-label="Close toolbar"
              innerHTML={icons.x}
            />
          </div>
        </div>
      )}
    </div>
  );
};
