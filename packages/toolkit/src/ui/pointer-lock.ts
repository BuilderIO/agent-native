// Radix's DismissableLayer (used by Dialog, Sheet, AlertDialog, Select, ...)
// tracks every mounted layer that disables outside pointer events in one
// shared, module-level registry: the first layer to mount saves
// `document.body.style.pointerEvents` and sets it to "none", and the last
// layer to unregister restores it. When a nested layer (e.g. a Select inside
// a Sheet) is still unwinding its own close animation at the moment an outer
// layer closes, the registry can end up with nothing left to trigger that
// restore, and `pointerEvents` sticks at "none" — freezing the whole page
// until reload. Defer any state change that opens a follow-up layer (another
// dialog) or runs a mutation gated on the previous layer being fully closed
// until pointer events are confirmed unlocked.
export function afterBodyPointerUnlock(callback: () => void) {
  const run = () => {
    if (document.body.style.pointerEvents === "none") {
      window.requestAnimationFrame(run);
      return;
    }
    callback();
  };
  window.requestAnimationFrame(run);
}
