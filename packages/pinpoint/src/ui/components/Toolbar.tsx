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
  compactPopup: boolean;
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
  onCompactPopupChange: (value: boolean) => void;
}

export const Toolbar: Component<ToolbarProps> = (props) => {
  // Position stored as right/bottom offsets for consistent edge anchoring
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

  // Native click handler on the outer div — guards prevent firing in expanded state
  function handleClick(e: Event) {
    if (props.expanded) return;
    if (didDrag()) return;
    props.onToggleExpand();
  }

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
        /* Collapsed pill content */
        <div
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            gap: "6px",
          }}
        >
          {props.pins.length > 0 && (
            <span class="pp-toolbar__badge">{props.pins.length}</span>
          )}
          <span
            innerHTML={icons.pin}
            style={{ display: "flex", "align-items": "center" }}
          />
        </div>
      ) : (
        /* Expanded toolbar — stopPropagation wrapper prevents clicks from reaching outer div */
        <div
          on:click={(e: Event) => e.stopPropagation()}
          style={{ display: "contents" }}
        >
          {/* Header — author name or fallback title */}
          <div
            style={{
              display: "flex",
              "align-items": "center",
              "font-size": "12px",
              "font-weight": "600",
              "letter-spacing": "0.02em",
              color: "var(--pp-text-muted)",
            }}
          >
            {props.author || "Pinpoint"}
          </div>

          {/* Active indicator — only when no pins yet */}
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

          {/* Settings panel (inline, above the icon bar) */}
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

          {/* Unified horizontal icon bar at bottom */}
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
