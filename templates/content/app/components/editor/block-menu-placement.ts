export type Box = { top: number; left: number; width: number; height: number };

export type BlockMenuPlacement = {
  side: "left" | "bottom" | "top";
  anchor: Box;
  zone: Box;
};

export const BLOCK_MENU_WIDTH = 240;
export const BLOCK_MENU_GAP = 6;
export const BLOCK_MENU_PADDING = 8;
export const BLOCK_MENU_HEIGHT = 400;
const MIN_MENU_HEIGHT = 240;
const MIN_SCROLLING_MENU_HEIGHT = 120;

export function placeBlockMenu({
  grip: gripRect,
  block: blockRect,
  pageLeft,
  viewport,
  menuHeight = BLOCK_MENU_HEIGHT,
}: {
  grip: Box;
  block: Box;
  pageLeft: number;
  viewport: { width: number; height: number };
  menuHeight?: number;
}): BlockMenuPlacement {
  const grip = boxOf(gripRect);
  const block = boxOf(blockRect);
  const whole = { top: 0, left: 0, ...viewport };
  const besideEnd = grip.left - BLOCK_MENU_GAP;
  const fitsBeside = (start: number) =>
    besideEnd - (start + BLOCK_MENU_PADDING) >= BLOCK_MENU_WIDTH;
  const beside = (): BlockMenuPlacement => ({
    side: "left",
    anchor: { ...grip, top: block.top, height: block.height },
    zone: { ...whole, width: besideEnd + BLOCK_MENU_PADDING },
  });
  if (fitsBeside(Math.max(pageLeft, 0))) return beside();

  const blockBottom = block.top + block.height;
  const roomBelow =
    viewport.height - BLOCK_MENU_PADDING - blockBottom - BLOCK_MENU_GAP;
  const roomAbove = block.top - BLOCK_MENU_GAP - BLOCK_MENU_PADDING;
  const below: BlockMenuPlacement = {
    side: "bottom",
    anchor: block,
    zone: { ...whole, top: blockBottom, height: viewport.height - blockBottom },
  };
  const above: BlockMenuPlacement = {
    side: "top",
    anchor: block,
    zone: { ...whole, height: block.top },
  };
  if (roomBelow >= menuHeight) return below;
  if (roomAbove >= menuHeight) return above;
  if (roomBelow >= MIN_MENU_HEIGHT) return below;
  if (roomAbove >= MIN_MENU_HEIGHT) return above;
  if (fitsBeside(0)) return beside();
  const besideTextEnd = block.left - BLOCK_MENU_GAP;
  if (besideTextEnd - BLOCK_MENU_PADDING >= BLOCK_MENU_WIDTH) {
    return {
      side: "left",
      anchor: { ...block, width: 0 },
      zone: { ...whole, width: besideTextEnd + BLOCK_MENU_PADDING },
    };
  }
  if (Math.max(roomBelow, roomAbove) >= MIN_SCROLLING_MENU_HEIGHT) {
    return roomBelow >= roomAbove ? below : above;
  }
  return { side: "bottom", anchor: grip, zone: whole };
}

function boxOf({ top, left, width, height }: Box): Box {
  return { top, left, width, height };
}

export function pageLeftOf(element: Element) {
  for (
    let parent = element.parentElement;
    parent && parent !== document.body;
    parent = parent.parentElement
  ) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === "auto" || overflowY === "scroll") {
      return parent.getBoundingClientRect().left;
    }
  }
  return 0;
}
