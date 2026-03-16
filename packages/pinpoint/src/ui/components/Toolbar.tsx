// @agent-native/pinpoint — Pill-style floating toolbar
// MIT License
//
// Collapsed: small pill with pin count. Expanded: annotation controls.

import { createSignal, For, type Component } from "solid-js";
import type { Pin } from "../../types/index.js";
import { icons } from "../icons/index.js";

interface ToolbarProps {
  expanded: boolean;
  active: boolean;
  pins: Pin[];
  position?: { x: number; y: number };
  author?: string;
  onToggleExpand: () => void;
  onToggleActive: () => void;
  onSend: () => void;
  onCopy: () => void;
  onClear: () => void;
  onRemovePin: (id: string) => void;
  onShowSettings: () => void;
}

export const Toolbar: Component<ToolbarProps> = (props) => {
  const [pos, setPos] = createSignal(
    props.position || { x: window.innerWidth - 80, y: window.innerHeight - 60 },
  );
  const [dragging, setDragging] = createSignal(false);
  const [dragOffset, setDragOffset] = createSignal({ x: 0, y: 0 });

  // Drag to reposition toolbar
  function handleMouseDown(e: MouseEvent) {
    if (props.expanded) return; // Only drag when collapsed
    setDragging(true);
    setDragOffset({ x: e.clientX - pos().x, y: e.clientY - pos().y });

    const handleMove = (e: MouseEvent) => {
      setPos({
        x: Math.max(
          0,
          Math.min(window.innerWidth - 80, e.clientX - dragOffset().x),
        ),
        y: Math.max(
          0,
          Math.min(window.innerHeight - 40, e.clientY - dragOffset().y),
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

  return (
    <div
      class={`pp-toolbar ${props.expanded ? "pp-toolbar--expanded" : "pp-toolbar--collapsed"}`}
      style={{
        ...(props.expanded
          ? { bottom: "16px", right: "16px" }
          : { left: `${pos().x}px`, top: `${pos().y}px` }),
      }}
      onMouseDown={props.expanded ? undefined : handleMouseDown}
    >
      {!props.expanded ? (
        /* Collapsed pill */
        <div
          style={{ display: "flex", "align-items": "center", gap: "6px" }}
          onClick={() => props.onToggleExpand()}
        >
          <span innerHTML={icons.pin} />
          {props.pins.length > 0 && (
            <span class="pp-toolbar__badge">{props.pins.length}</span>
          )}
        </div>
      ) : (
        /* Expanded toolbar */
        <>
          {/* Header */}
          <div
            style={{
              display: "flex",
              "align-items": "center",
              "justify-content": "space-between",
            }}
          >
            <div
              style={{ display: "flex", "align-items": "center", gap: "8px" }}
            >
              <span class="pp-toolbar__title">Pinpoint</span>
              {props.author && (
                <span
                  style={{ "font-size": "11px", color: "var(--pp-text-muted)" }}
                >
                  {props.author}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: "2px" }}>
              <button
                class="pp-btn--icon"
                onClick={props.onShowSettings}
                title="Settings"
                innerHTML={icons.settings}
              />
              <button
                class="pp-btn--icon"
                onClick={props.onToggleExpand}
                title="Collapse"
                innerHTML={icons.x}
              />
            </div>
          </div>

          {/* Select mode toggle */}
          <button
            class={`pp-btn ${props.active ? "pp-btn--primary" : ""}`}
            onClick={props.onToggleActive}
          >
            <span innerHTML={icons.crosshair} />
            {props.active ? "Selecting..." : "Select Element"}
            <span class="pp-kbd">
              {navigator.platform.includes("Mac") ? "\u2318" : "Ctrl"}+\u21E7+.
            </span>
          </button>

          {/* Pin list */}
          {props.pins.length > 0 && (
            <div class="pp-pin-list">
              <For each={props.pins}>
                {(pin, index) => (
                  <div class="pp-pin-item">
                    <span class="pp-pin-item__number">{index() + 1}</span>
                    <div class="pp-pin-item__content">
                      <div class="pp-pin-item__element">
                        {pin.element.selector}
                      </div>
                      <div class="pp-pin-item__comment">{pin.comment}</div>
                    </div>
                    <span
                      class={`pp-pin-item__status pp-pin-item__status--${pin.status.state}`}
                    />
                    <button
                      class="pp-btn--icon"
                      onClick={() => props.onRemovePin(pin.id)}
                      title="Remove"
                      innerHTML={icons.x}
                      style={{ "font-size": "10px" }}
                    />
                  </div>
                )}
              </For>
            </div>
          )}

          {/* Actions */}
          <div class="pp-actions">
            <button class="pp-btn pp-btn--primary" onClick={props.onSend}>
              <span innerHTML={icons.send} />
              Send
              <span class="pp-kbd">
                {navigator.platform.includes("Mac") ? "\u2318" : "Ctrl"}
                +\u21E7+\u23CE
              </span>
            </button>
            <button class="pp-btn" onClick={props.onCopy}>
              <span innerHTML={icons.copy} />
              Copy
            </button>
            {props.pins.length > 0 && (
              <button class="pp-btn" onClick={props.onClear}>
                <span innerHTML={icons.trash} />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};
