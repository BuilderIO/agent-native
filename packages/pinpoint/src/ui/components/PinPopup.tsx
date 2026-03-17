// @agent-native/pinpoint — Pin creation/edit popup
// MIT License

import { createSignal, Show, onMount, onCleanup, type Component } from "solid-js";
import type { ElementContext } from "../../types/index.js";
import { icons } from "../icons/index.js";

interface PinPopupProps {
  context: ElementContext;
  /** Pre-filled comment for editing an existing pin */
  initialComment?: string;
  /** Whether this is editing an existing pin */
  isEditing?: boolean;
  /** Compact mode — hide technical details behind chevron toggle */
  compactPopup?: boolean;
  onAdd: (comment: string) => void;
  onCancel: () => void;
}

export const PinPopup: Component<PinPopupProps> = (props) => {
  const [comment, setComment] = createSignal(props.initialComment || "");
  const [showDetails, setShowDetails] = createSignal(false);
  let textareaRef: HTMLTextAreaElement | undefined;

  const compact = () => props.compactPopup ?? true;

  // Friendly display name: component name or HTML tag
  const displayName = () => {
    if (props.context.framework?.componentPath) {
      return props.context.framework.componentPath;
    }
    return `<${props.context.element.tagName.toLowerCase()}>`;
  };

  // Reactive popup positioning — recalculates when details expand
  const popupPosition = () => {
    const rect = props.context.element.boundingRect;
    const estimatedHeight = (compact() && showDetails()) ? 220 : 180;
    const popupX = Math.min(rect.x, window.innerWidth - 380);
    const popupY = rect.y + rect.height + 8;
    const adjustedY = popupY + estimatedHeight > window.innerHeight
      ? rect.y - estimatedHeight - 8
      : popupY;
    return { x: Math.max(8, popupX), y: Math.max(8, adjustedY) };
  };

  async function openFileHandler() {
    try {
      const file = props.context.framework?.sourceFile;
      if (!file) return;
      const { openFile } = await import("../../utils/open-file.js");
      openFile(file);
    } catch {
      // Can't open file
    }
  }

  onMount(() => {
    textareaRef?.focus();
    if (props.initialComment && textareaRef) {
      textareaRef.selectionStart = textareaRef.value.length;
    }

    // Global Escape listener (works even when textarea isn't focused)
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        props.onCancel();
      }
    };
    document.addEventListener("keydown", onEsc, true);
    onCleanup(() => document.removeEventListener("keydown", onEsc, true));
  });

  function handleSubmit() {
    const text = comment().trim();
    if (!text) return;
    props.onAdd(text);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      props.onCancel();
    }
  }

  function handleAutoGrow(e: Event) {
    const el = e.currentTarget as HTMLTextAreaElement;
    setComment(el.value);
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }

  return (
    <div
      class="pp-popup"
      style={{
        left: `${popupPosition().x}px`,
        top: `${popupPosition().y}px`,
      }}
    >
      {compact() ? (
        /* Compact mode — friendly name + collapsible details */
        <>
          {/* Header with chevron toggle */}
          <div class="pp-popup__header" on:click={() => setShowDetails(!showDetails())}>
            <span class="pp-popup__name">{displayName()}</span>
            <span
              class={`pp-popup__chevron ${showDetails() ? "pp-popup__chevron--open" : ""}`}
              innerHTML={icons.chevronDown}
              aria-expanded={showDetails()}
            />
          </div>

          {/* Collapsible technical details — CSS animated, always in DOM */}
          <div class={`pp-popup__details ${showDetails() ? "pp-popup__details--open" : ""}`}>
            <div class="pp-popup__details-inner">
              <div class="pp-popup__element-info">{props.context.cssSelector}</div>
              <Show when={props.context.framework?.sourceFile}>
                {(file) => (
                  <div
                    class="pp-popup__source"
                    on:click={openFileHandler}
                    title={file()}
                  >
                    <span innerHTML={icons.fileCode} style={{ display: "inline-flex", "vertical-align": "middle" }} />{" "}
                    {file().split("/").pop()}
                  </div>
                )}
              </Show>
            </div>
          </div>
        </>
      ) : (
        /* Condensed mode — all info visible, reordered */
        <>
          {/* Friendly name — primary identifier */}
          <div class="pp-popup__component">{displayName()}</div>

          {/* CSS selector — secondary */}
          <div class="pp-popup__element-info">{props.context.cssSelector}</div>

          {/* Source file — truncated to filename:line */}
          <Show when={props.context.framework?.sourceFile}>
            {(file) => (
              <div
                class="pp-popup__source"
                on:click={openFileHandler}
                title={file()}
              >
                <span innerHTML={icons.fileCode} style={{ display: "inline-flex", "vertical-align": "middle" }} />{" "}
                {file().split("/").pop()}
              </div>
            )}
          </Show>
        </>
      )}

      {/* Comment textarea — auto-grows up to 120px */}
      <textarea
        ref={textareaRef}
        class="pp-popup__textarea"
        placeholder="Add your feedback..."
        value={comment()}
        on:input={handleAutoGrow}
        on:keydown={handleKeyDown}
      />

      {/* Actions */}
      <div class="pp-popup__actions">
        <button class="pp-btn" on:click={() => props.onCancel()}>
          Cancel
        </button>
        <button
          class="pp-btn pp-btn--primary"
          on:click={() => handleSubmit()}
          disabled={!comment().trim()}
        >
          {props.isEditing ? "Save" : "Add Pin"}
        </button>
      </div>
    </div>
  );
};
