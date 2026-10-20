# Fixing Design editor issues

Reproduce the reported steps on the current application build before editing.
Record the selected layer, visible controls, persisted file state, and any
console or network errors that explain the result.

Keep the change close to the boundary that owns the behavior. For canvas
interactions, inspect input handling, selection state, layout calculations, and
history persistence together. For import and export behavior, check the action
contract and the file data passed across that boundary.

Add a focused regression test that describes the observable result. Check a
nearby case that could be affected by the same code path, such as a text layer
with a background when changing text styling, or a nested layer when changing
drag insertion.

Do not hide a failure by skipping or weakening its assertion. If a test is
unstable, reproduce the race and fix the synchronization or give it a named,
time-limited owner.
