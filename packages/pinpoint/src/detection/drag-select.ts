// @agent-native/pinpoint — Click-and-drag multi-element selection
// MIT License
//
// Inspired by react-grab pattern: 75% coverage threshold.
// Collect elements within selection rectangle via bounding rect comparison.

export interface DragSelectOptions {
  /** Minimum coverage threshold (0-1) for an element to be considered selected */
  coverageThreshold?: number;
  /** Called when drag starts */
  onDragStart?: (rect: DOMRect) => void;
  /** Called during drag with the current selection rectangle */
  onDragMove?: (rect: DOMRect) => void;
  /** Called when drag ends with selected elements */
  onDragEnd?: (elements: Element[]) => void;
  /** Elements to ignore */
  ignoreSelector?: string;
}

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class DragSelect {
  private active = false;
  private dragging = false;
  private startX = 0;
  private startY = 0;
  private options: DragSelectOptions;

  private handleMouseDown: (e: MouseEvent) => void;
  private handleMouseMove: (e: MouseEvent) => void;
  private handleMouseUp: (e: MouseEvent) => void;

  constructor(options: DragSelectOptions = {}) {
    this.options = { coverageThreshold: 0.75, ...options };

    this.handleMouseDown = (e: MouseEvent) => {
      if (!this.active || e.button !== 0) return;
      // Only start drag if holding Shift (to distinguish from single click)
      if (!e.shiftKey) return;

      e.preventDefault();
      this.dragging = true;
      this.startX = e.clientX;
      this.startY = e.clientY;

      const rect = this.buildRect(e.clientX, e.clientY);
      this.options.onDragStart?.(
        new DOMRect(rect.x, rect.y, rect.width, rect.height),
      );
    };

    this.handleMouseMove = (e: MouseEvent) => {
      if (!this.dragging) return;
      e.preventDefault();
      const rect = this.buildRect(e.clientX, e.clientY);
      this.options.onDragMove?.(
        new DOMRect(rect.x, rect.y, rect.width, rect.height),
      );
    };

    this.handleMouseUp = (e: MouseEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      const selectionRect = this.buildRect(e.clientX, e.clientY);

      // Skip tiny drags (accidental)
      if (selectionRect.width < 5 && selectionRect.height < 5) return;

      const selected = this.getElementsInRect(selectionRect);
      this.options.onDragEnd?.(selected);
    };
  }

  private buildRect(currentX: number, currentY: number): SelectionRect {
    return {
      x: Math.min(this.startX, currentX),
      y: Math.min(this.startY, currentY),
      width: Math.abs(currentX - this.startX),
      height: Math.abs(currentY - this.startY),
    };
  }

  private getElementsInRect(selectionRect: SelectionRect): Element[] {
    const threshold = this.options.coverageThreshold!;
    const elements: Element[] = [];

    // Walk all visible elements
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => {
          const el = node as Element;
          if (
            this.options.ignoreSelector &&
            el.matches(this.options.ignoreSelector)
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );

    let node: Node | null;
    while ((node = walker.nextNode())) {
      const el = node as Element;
      const rect = el.getBoundingClientRect();

      // Skip invisible elements
      if (rect.width === 0 || rect.height === 0) continue;

      // Calculate overlap
      const overlapX = Math.max(
        0,
        Math.min(rect.right, selectionRect.x + selectionRect.width) -
          Math.max(rect.left, selectionRect.x),
      );
      const overlapY = Math.max(
        0,
        Math.min(rect.bottom, selectionRect.y + selectionRect.height) -
          Math.max(rect.top, selectionRect.y),
      );
      const overlapArea = overlapX * overlapY;
      const elementArea = rect.width * rect.height;
      const coverage = overlapArea / elementArea;

      if (coverage >= threshold) {
        // Only add leaf-ish elements (avoid selecting huge containers)
        if (el.children.length === 0 || rect.width < 400) {
          elements.push(el);
        }
      }
    }

    return elements;
  }

  activate(): void {
    if (this.active) return;
    this.active = true;
    document.addEventListener("mousedown", this.handleMouseDown, true);
    document.addEventListener("mousemove", this.handleMouseMove, true);
    document.addEventListener("mouseup", this.handleMouseUp, true);
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.dragging = false;
    document.removeEventListener("mousedown", this.handleMouseDown, true);
    document.removeEventListener("mousemove", this.handleMouseMove, true);
    document.removeEventListener("mouseup", this.handleMouseUp, true);
  }

  isDragging(): boolean {
    return this.dragging;
  }

  dispose(): void {
    this.deactivate();
  }
}
