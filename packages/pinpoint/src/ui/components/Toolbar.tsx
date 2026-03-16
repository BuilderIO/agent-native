// @agent-native/pinpoint — Pill-style floating toolbar
// MIT License
//
// Collapsed: small pill with pin count. Expanded: annotation controls.
// Expanding auto-activates selection mode.

import { createSignal, Show, For, type Component } from "solid-js";
import type { Pin, OutputFormat } from "../../types/index.js";
import { icons } from "../icons/index.js";

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
  webhookUrl?: string;
  onToggleExpand: () => void;
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
}

export const Toolbar: Component<ToolbarProps> = (props) => {
  const [pos, setPos] = createSignal(
    props.position || {
      x: window.innerWidth - 80,
      y: window.innerHeight - 60,
    },
  );
  const [dragging, setDragging] = createSignal(false);
  const [dragOffset, setDragOffset] = createSignal({ x: 0, y: 0 });

  function handleMouseDown(e: MouseEvent) {
    if (props.expanded) return;
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
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            gap: "6px",
          }}
          onClick={() => props.onToggleExpand()}
        >
          <span
            innerHTML={icons.pin}
            style={{ display: "flex", "align-items": "center" }}
          />
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
                  style={{
                    "font-size": "11px",
                    color: "var(--pp-text-muted)",
                  }}
                >
                  {props.author}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: "2px" }}>
              <button
                class="pp-btn--icon"
                onClick={props.onToggleSettings}
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

          {/* Active indicator */}
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

          {/* Pin list */}
          {props.pins.length > 0 && (
            <div class="pp-pin-list">
              <For each={props.pins}>
                {(pin, index) => (
                  <div
                    class="pp-pin-item"
                    onClick={() => props.onEditPin(pin)}
                  >
                    <span class="pp-pin-item__number">{index() + 1}</span>
                    <div class="pp-pin-item__content">
                      <div class="pp-pin-item__element">
                        {pin.element.selector}
                      </div>
                      <div class="pp-pin-item__comment">{pin.comment}</div>
                    </div>
                    <button
                      class="pp-btn--icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onRemovePin(pin.id);
                      }}
                      title="Remove"
                      innerHTML={icons.x}
                      style={{ "font-size": "10px" }}
                    />
                  </div>
                )}
              </For>
            </div>
          )}

          {/* Icon-only action buttons */}
          <div class="pp-actions">
            <button
              class="pp-btn--icon"
              onClick={props.onSend}
              title="Send to agent"
              innerHTML={icons.send}
            />
            <button
              class="pp-btn--icon"
              onClick={props.onCopy}
              title="Copy to clipboard"
              innerHTML={icons.copy}
            />
            {props.pins.length > 0 && (
              <button
                class="pp-btn--icon"
                onClick={props.onClear}
                title="Clear all"
                innerHTML={icons.trash}
              />
            )}
          </div>

          {/* Settings panel (inline, inside the toolbar) */}
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
                  onClick={() => props.onAutoSubmitChange(!props.autoSubmit)}
                >
                  <div class="pp-toggle__thumb" />
                </div>
              </div>
              <div class="pp-settings__row">
                <span class="pp-settings__label">Clear on send</span>
                <div
                  class={`pp-toggle ${props.clearOnSend ? "pp-toggle--active" : ""}`}
                  onClick={() => props.onClearOnSendChange(!props.clearOnSend)}
                >
                  <div class="pp-toggle__thumb" />
                </div>
              </div>
              <div class="pp-settings__row">
                <span class="pp-settings__label">Block page clicks</span>
                <div
                  class={`pp-toggle ${props.blockInteractions ? "pp-toggle--active" : ""}`}
                  onClick={() =>
                    props.onBlockInteractionsChange(!props.blockInteractions)
                  }
                >
                  <div class="pp-toggle__thumb" />
                </div>
              </div>
            </div>
          </Show>
        </>
      )}
    </div>
  );
};
