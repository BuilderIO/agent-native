# 007 — Mail: commit swipe-to-archive on velocity, not distance alone

- **Status**: DONE (mechanically verified; feel checks pending)
- **Commit**: f43d34ca24
- **Severity**: MEDIUM
- **Category**: Interruptibility (gesture physics)
- **Estimated scope**: 1 file (`templates/mail/app/components/email/EmailListItem.tsx`), ~15 lines

## Problem

The inbox swipe gesture commits only when the finger travels a fixed 80px, ignoring velocity. A fast, confident flick that covers 60px is dropped; physical gestures should honor momentum (dismiss when `|distance| / elapsedMs > ~0.11 px/ms`, per the motion playbook).

```tsx
// templates/mail/app/components/email/EmailListItem.tsx:80-85
// Minimum horizontal distance before we lock into a swipe gesture.
const SWIPE_SLOP = 10;
// Distance past which a swipe commits the action.
const SWIPE_COMMIT_THRESHOLD = 80;
// Distance past which the action icon "snaps" to filled state.
const SWIPE_ICON_SNAP = 56;

// ~:273 (inside the touch-end handler)
if (dragX <= -SWIPE_COMMIT_THRESHOLD && onSwipeArchive && thread) {
```

The existing good parts must be preserved: the row already disables its transition during drag (`transition: isDragging ? "none" : "transform 180ms ease-out"`) and flies off via `setDragX(-window.innerWidth)`.

## Target

Commit when EITHER the distance threshold is passed OR the release velocity exceeds 0.11 px/ms in the swipe direction (with a minimum travel of `SWIPE_ICON_SNAP` so accidental taps can't trigger):

1. Add a velocity constant next to the others:
   ```tsx
   // Release velocity (px/ms) past which a swipe commits regardless of distance.
   const SWIPE_COMMIT_VELOCITY = 0.11;
   ```
2. Track recent movement in the touch handlers: on each touchmove record `lastX`/`lastT = performance.now()` and the previous sample (`prevX`/`prevT`) in refs (a two-sample window is enough; do not accumulate arrays).
3. In the touch-end handler compute `velocity = (lastX - prevX) / Math.max(1, lastT - prevT)` and replace the commit conditions:
   ```tsx
   const flungLeft = velocity <= -SWIPE_COMMIT_VELOCITY && dragX <= -SWIPE_ICON_SNAP;
   if ((dragX <= -SWIPE_COMMIT_THRESHOLD || flungLeft) && onSwipeArchive && thread) {
   ```
   Mirror the same pattern for the opposite-direction action if the file has one (search for the positive-direction twin of this branch, e.g. snooze on right-swipe, and apply `velocity >= SWIPE_COMMIT_VELOCITY && dragX >= SWIPE_ICON_SNAP`).

## Repo conventions to follow

- Refs for gesture bookkeeping (the file already uses refs for drag state).
- Keep constants top-of-file with the existing comment style.

## Boundaries

- One file only. Do NOT change the animation timings, the fly-off behavior, thresholds' values, or the icon-snap logic.
- Do NOT add dependencies (no motion library).
- If the touch-end structure differs from the excerpt, STOP and report rather than improvising.

## Verification

- **Mechanical**: mail template typecheck passes; `oxfmt` on the file.
- **Feel check** (requires a touch device or DevTools touch emulation): a short fast flick (~60px, quick) archives; a slow 60px drag released does NOT archive (snaps back); a slow 90px drag still archives. Rapidly starting a second swipe mid-snap-back never jumps.
- **Done when**: both commit paths (distance, velocity) work and snap-back behavior is unchanged.
