// @agent-native/pinpoint — Settings panel
// MIT License

import { type Component } from "solid-js";
import type { OutputFormat } from "../../types/index.js";
import { icons } from "../icons/index.js";

interface SettingsPanelProps {
  outputFormat: OutputFormat;
  clearOnSend: boolean;
  blockInteractions: boolean;
  autoSubmit: boolean;
  markerColor?: string;
  webhookUrl?: string;
  onOutputFormatChange: (format: OutputFormat) => void;
  onClearOnSendChange: (value: boolean) => void;
  onBlockInteractionsChange: (value: boolean) => void;
  onAutoSubmitChange: (value: boolean) => void;
  onClose: () => void;
}

export const SettingsPanel: Component<SettingsPanelProps> = (props) => {
  return (
    <div class="pp-settings">
      <div
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          "padding-bottom": "4px",
        }}
      >
        <span
          style={{
            "font-size": "12px",
            "font-weight": "600",
            color: "var(--pp-text)",
          }}
        >
          Settings
        </span>
        <button
          class="pp-btn--icon"
          onClick={props.onClose}
          innerHTML={icons.x}
        />
      </div>

      {/* Output format */}
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
            props.onOutputFormatChange(e.currentTarget.value as OutputFormat)
          }
        >
          <option value="compact">Compact</option>
          <option value="standard">Standard</option>
          <option value="detailed">Detailed</option>
        </select>
      </div>

      {/* Auto-submit */}
      <div class="pp-settings__row">
        <span class="pp-settings__label">Auto-submit</span>
        <div
          class={`pp-toggle ${props.autoSubmit ? "pp-toggle--active" : ""}`}
          onClick={() => props.onAutoSubmitChange(!props.autoSubmit)}
        >
          <div class="pp-toggle__thumb" />
        </div>
      </div>

      {/* Clear on send */}
      <div class="pp-settings__row">
        <span class="pp-settings__label">Clear on send</span>
        <div
          class={`pp-toggle ${props.clearOnSend ? "pp-toggle--active" : ""}`}
          onClick={() => props.onClearOnSendChange(!props.clearOnSend)}
        >
          <div class="pp-toggle__thumb" />
        </div>
      </div>

      {/* Block interactions */}
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

      {/* Webhook URL (read-only display if configured) */}
      {props.webhookUrl && (
        <div class="pp-settings__row">
          <span class="pp-settings__label">Webhook</span>
          <span class="pp-settings__value" title={props.webhookUrl}>
            {props.webhookUrl.length > 30
              ? props.webhookUrl.slice(0, 30) + "..."
              : props.webhookUrl}
          </span>
        </div>
      )}
    </div>
  );
};
