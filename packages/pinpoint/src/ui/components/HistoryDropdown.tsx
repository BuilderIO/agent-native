// @agent-native/pinpoint — History dropdown for past annotations
// MIT License

import { For, type Component } from "solid-js";
import type { Pin } from "../../types/index.js";
import { icons } from "../icons/index.js";

interface HistoryDropdownProps {
  pins: Pin[];
  onSelect: (pin: Pin) => void;
  onClear: () => void;
}

export const HistoryDropdown: Component<HistoryDropdownProps> = (props) => {
  const resolvedPins = () =>
    props.pins.filter(
      (p) => p.status.state === "resolved" || p.status.state === "dismissed",
    );

  if (resolvedPins().length === 0) return null;

  return (
    <div style={{ "padding-top": "4px" }}>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          "margin-bottom": "4px",
        }}
      >
        <span
          style={{
            "font-size": "11px",
            color: "var(--pp-text-muted)",
            display: "flex",
            "align-items": "center",
            gap: "4px",
          }}
        >
          <span innerHTML={icons.history} />
          History ({resolvedPins().length})
        </span>
        <button
          class="pp-btn--icon"
          onClick={props.onClear}
          title="Clear history"
          innerHTML={icons.trash}
          style={{ "font-size": "10px" }}
        />
      </div>
      <div class="pp-pin-list" style={{ "max-height": "120px" }}>
        <For each={resolvedPins()}>
          {(pin) => (
            <div
              class="pp-pin-item"
              onClick={() => props.onSelect(pin)}
              style={{ opacity: "0.6" }}
            >
              <div class="pp-pin-item__content">
                <div class="pp-pin-item__element">{pin.element.selector}</div>
                <div class="pp-pin-item__comment">{pin.comment}</div>
              </div>
              <span
                class={`pp-pin-item__status pp-pin-item__status--${pin.status.state}`}
              />
            </div>
          )}
        </For>
      </div>
    </div>
  );
};
