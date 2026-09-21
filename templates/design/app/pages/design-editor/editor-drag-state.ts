export type EditorDragStateEvent = {
  active: boolean;
  dragId?: string;
  screenId?: string;
  eventAt?: number;
  preview?: { phase?: "preview" | "clear" };
};

export type EditorDragStateOwner = {
  dragId: string | null;
  retiredDragIds: ReadonlySet<string>;
  retiredScreenIds: ReadonlySet<string>;
  latestEventAt?: number;
};

export function shouldAcceptEditorDragStateEvent(
  state: EditorDragStateEvent,
  owner: EditorDragStateOwner,
): boolean {
  if (state.dragId && owner.retiredDragIds.has(state.dragId)) return false;
  if (
    state.dragId &&
    typeof state.eventAt === "number" &&
    typeof owner.latestEventAt === "number" &&
    state.eventAt < owner.latestEventAt
  ) {
    return false;
  }
  // eventAt is a shared epoch clock, not an ordering token. Same-iframe
  // postMessage delivery is FIFO; equal-time cross-iframe events are rejected
  // by the retired screen/drag ownership checks above.
  if (
    !state.active &&
    state.dragId &&
    owner.dragId &&
    state.dragId !== owner.dragId
  ) {
    return false;
  }
  if (
    state.active &&
    state.dragId === owner.dragId &&
    state.screenId &&
    owner.retiredScreenIds.has(state.screenId) &&
    state.preview?.phase !== "clear"
  ) {
    return false;
  }
  return true;
}
