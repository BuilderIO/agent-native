// @agent-native/pinpoint — Text range selection
// MIT License
//
// Listens for selectionchange, captures Selection.getRangeAt(0),
// extracts container element and surrounding context.

export interface TextSelection {
  text: string;
  container: Element;
  startOffset: number;
  endOffset: number;
  context: string;
  rect: DOMRect;
}

export interface TextSelectOptions {
  onSelect?: (selection: TextSelection | null) => void;
  minLength?: number;
}

export class TextSelect {
  private active = false;
  private options: TextSelectOptions;
  private handleSelectionChange: () => void;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: TextSelectOptions = {}) {
    this.options = { minLength: 3, ...options };

    this.handleSelectionChange = () => {
      if (!this.active) return;

      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        const selection = this.getTextSelection();
        this.options.onSelect?.(selection);
      }, 150);
    };
  }

  private getTextSelection(): TextSelection | null {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return null;
    }

    const text = selection.toString().trim();
    if (text.length < (this.options.minLength ?? 3)) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const container =
      range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? (range.commonAncestorContainer as Element)
        : range.commonAncestorContainer.parentElement;

    if (!container) return null;

    const fullText = container.textContent || "";
    const startOffset = range.startOffset;
    const endOffset = range.endOffset;
    const contextBefore = fullText.slice(
      Math.max(0, startOffset - 50),
      startOffset,
    );
    const contextAfter = fullText.slice(endOffset, endOffset + 50);
    const context = `...${contextBefore}[${text}]${contextAfter}...`;

    const rect = range.getBoundingClientRect();

    return {
      text,
      container,
      startOffset,
      endOffset,
      context,
      rect,
    };
  }

  activate(): void {
    if (this.active) return;
    this.active = true;
    document.addEventListener("selectionchange", this.handleSelectionChange);
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    document.removeEventListener("selectionchange", this.handleSelectionChange);
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  getCurrentSelection(): TextSelection | null {
    return this.getTextSelection();
  }

  dispose(): void {
    this.deactivate();
  }
}
