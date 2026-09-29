# Changing tests and blast radius

A convention change will break specs that encoded the old convention. The rule:
**re-express the gesture or the assertion frame; never weaken a result.**

- `parity-layers-panel-autolayout`: three tests dragged item N onto the *leading*
  edge of N+1, which only reorders when the list is inverted. Fixed by swapping
  the drag direction — every expected array untouched.
- `layers-reparent`: flipping the precondition alone would have left the test
  *passing but vacuous*, so the round-trip direction was swapped instead.
- `parity-layers-panel`: `aboutIdx < contactIdx` existed to rule out "landed at
  the very top"; once Shop became the first row that clause contradicted the
  primary assertion. Replaced with `shopIdx < aboutIdx` — equally strict.

Always reproduce the behaviour in the harness first and confirm the app is
right, before touching a spec.

## Blast radius

For a convention change, run **every** spec that touches the area, twice: once
with the change, once at HEAD with the product files *and* your spec edits
stashed. Diff the failure sets.

```
with changes   33 passed   7 failed   8 did not run
at HEAD        34 passed   6 failed   8 did not run
```

Identical except one → exactly one real regression. `describe.serial` files skip
everything behind a failure, so "N passed" is never a clean read on its own.
Run e2e specs on their own port (`E2E_PORT`, default 8180) and free it first:
a hung teardown holds it.
