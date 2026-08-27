# Clips Search Debounce Design

## Goal

Prevent the Clips library search action from running on every keystroke while preserving immediate input feedback and the existing interface.

## Approach

Keep `query` as the controlled input value. Add a component-local `debouncedQuery` state initialized to an empty string and a trailing `useEffect` timer that copies `query` after 200ms. Clear the timer whenever `query` changes or the component unmounts, then pass `debouncedQuery` to `useRecordingSearch`.

The popover visibility, highlighting, empty-state text, keyboard behavior, markup, classes, and responsive styles continue to use the immediate `query`. This keeps typing responsive and preserves all current visuals while delaying only the database-backed action.

## Alternatives Considered

- Shared debounce hook: rejected because no shared utility exists and this change has one caller.
- Hook-level debounce in `useRecordingSearch`: rejected because it would silently change every caller's timing contract.

## Verification

Add a fake-timer component test proving that rapid input changes do not reach `useRecordingSearch` before 200ms and that only the latest query is used after the delay. Run oxfmt on both modified source files, the targeted component test, and the Clips typecheck.
