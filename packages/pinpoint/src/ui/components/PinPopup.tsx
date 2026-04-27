// @agent-native/pinpoint — Pin creation/edit popup with voice + queue
// MIT License

import {
  createSignal,
  Show,
  onMount,
  onCleanup,
  type Component,
} from "solid-js";
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
  /** Whether queue mode is enabled */
  queueMode?: boolean;
  onAdd: (comment: string) => void;
  onQueue?: (comment: string) => void;
  onFixThis?: (comment: string) => void;
  onCancel: () => void;
}

// Check Speech API availability
function getSpeechRecognition(): (new () => any) | null {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export const PinPopup: Component<PinPopupProps> = (props) => {
  const [comment, setComment] = createSignal(props.initialComment || "");
  const [showDetails, setShowDetails] = createSignal(false);
  const [isRecording, setIsRecording] = createSignal(false);
  let textareaRef: HTMLTextAreaElement | undefined;
  let recognitionRef: any = null;

  const compact = () => props.compactPopup ?? true;
  const hasSpeechAPI = !!getSpeechRecognition();

  // Friendly display name: component name or HTML tag
  const displayName = () => {
    if (props.context.framework?.componentPath) {
      return props.context.framework.componentPath;
    }
    return `<${props.context.element.tagName.toLowerCase()}>`;
  };

  // Reactive popup positioning
  const popupPosition = () => {
    const rect = props.context.element.boundingRect;
    const estimatedHeight = compact() && showDetails() ? 260 : 220;
    const popupX = Math.min(rect.x, window.innerWidth - 380);
    const popupY = rect.y + rect.height + 8;
    const adjustedY =
      popupY + estimatedHeight > window.innerHeight
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

  // Voice recording
  function toggleRecording() {
    if (isRecording()) {
      stopRecording();
    } else {
      startRecording();
    }
  }

  function startRecording() {
    const SpeechRecognitionClass = getSpeechRecognition();
    if (!SpeechRecognitionClass) return;

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let finalTranscript = "";

    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interim = transcript;
        }
      }
      // Append transcribed text to existing comment
      const current = comment();
      const separator = current && !current.endsWith(" ") ? " " : "";
      setComment(current + separator + finalTranscript + interim);
      finalTranscript = "";

      // Update textarea height
      if (textareaRef) {
        textareaRef.style.height = "auto";
        textareaRef.style.height =
          Math.min(textareaRef.scrollHeight, 120) + "px";
      }
    };

    recognition.onerror = () => {
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognition.start();
    recognitionRef = recognition;
    setIsRecording(true);
  }

  function stopRecording() {
    recognitionRef?.stop();
    recognitionRef = null;
    setIsRecording(false);
  }

  onMount(() => {
    textareaRef?.focus();
    if (props.initialComment && textareaRef) {
      textareaRef.selectionStart = textareaRef.value.length;
    }

    // Global Escape listener
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        stopRecording();
        props.onCancel();
      }
    };
    document.addEventListener("keydown", onEsc, true);
    onCleanup(() => {
      document.removeEventListener("keydown", onEsc, true);
      stopRecording();
    });
  });

  function handleSubmit() {
    const text = comment().trim();
    if (!text) return;
    stopRecording();
    props.onAdd(text);
  }

  function handleQueue() {
    const text = comment().trim();
    if (!text) return;
    stopRecording();
    props.onQueue?.(text);
  }

  function handleFixThis() {
    const text = comment().trim() || `Fix this ${displayName()}`;
    stopRecording();
    props.onFixThis?.(text);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      stopRecording();
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
          <div
            class="pp-popup__header"
            on:click={() => setShowDetails(!showDetails())}
          >
            <span class="pp-popup__name">{displayName()}</span>
            <span
              class={`pp-popup__chevron ${showDetails() ? "pp-popup__chevron--open" : ""}`}
              innerHTML={icons.chevronDown}
              aria-expanded={showDetails()}
            />
          </div>

          {/* Collapsible technical details */}
          <div
            class={`pp-popup__details ${showDetails() ? "pp-popup__details--open" : ""}`}
          >
            <div class="pp-popup__details-inner">
              <div class="pp-popup__element-info">
                {props.context.cssSelector}
              </div>
              <Show when={props.context.framework?.sourceFile}>
                {(file) => (
                  <div
                    class="pp-popup__source"
                    on:click={openFileHandler}
                    title={file()}
                  >
                    <span
                      innerHTML={icons.fileCode}
                      style={{
                        display: "inline-flex",
                        "vertical-align": "middle",
                      }}
                    />{" "}
                    {file().split("/").pop()}
                  </div>
                )}
              </Show>
            </div>
          </div>
        </>
      ) : (
        /* Expanded mode — all info visible */
        <>
          <div class="pp-popup__component">{displayName()}</div>
          <div class="pp-popup__element-info">{props.context.cssSelector}</div>
          <Show when={props.context.framework?.sourceFile}>
            {(file) => (
              <div
                class="pp-popup__source"
                on:click={openFileHandler}
                title={file()}
              >
                <span
                  innerHTML={icons.fileCode}
                  style={{ display: "inline-flex", "vertical-align": "middle" }}
                />{" "}
                {file().split("/").pop()}
              </div>
            )}
          </Show>
        </>
      )}

      {/* Comment textarea with voice mic */}
      <div class="pp-popup__input-row">
        <textarea
          ref={textareaRef}
          class="pp-popup__textarea"
          placeholder="Add your feedback..."
          value={comment()}
          on:input={handleAutoGrow}
          on:keydown={handleKeyDown}
        />
        {hasSpeechAPI && (
          <button
            class={`pp-btn--icon pp-popup__mic ${isRecording() ? "pp-popup__mic--recording" : ""}`}
            on:click={toggleRecording}
            title={isRecording() ? "Stop recording" : "Voice input"}
            aria-label={isRecording() ? "Stop recording" : "Voice input"}
            innerHTML={isRecording() ? icons.microphoneOff : icons.microphone}
          />
        )}
      </div>

      {/* Actions */}
      <div class="pp-popup__actions">
        <button
          class="pp-btn pp-btn--ghost"
          on:click={handleFixThis}
          title="Send 'Fix this' to agent"
        >
          <span innerHTML={icons.bolt} style={{ display: "inline-flex" }} />
          Fix
        </button>

        <div style={{ flex: "1" }} />

        <button class="pp-btn" on:click={() => props.onCancel()}>
          Cancel
        </button>

        {props.queueMode && props.onQueue && (
          <button
            class="pp-btn"
            on:click={handleQueue}
            disabled={!comment().trim()}
            title="Add to queue"
          >
            <span innerHTML={icons.plus} style={{ display: "inline-flex" }} />
            Queue
          </button>
        )}

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
