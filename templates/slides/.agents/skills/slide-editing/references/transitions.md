# Slide transitions

A slide's transition plays across the boundary before that slide, in Present
and Presenter view, forward or backward. The later slide of the pair supplies the
type and speed, and that later slide is always the one the transition leads into.
So going backward across a boundary plays the transition of the slide you are
leaving, not the transition of the slide you land on.

Set it with `patch-deck` `patch-slide`, or on creation with a `patch-deck`
`add-slide` op. `update-slide` does not take transition fields.

- `transition`: one of `none`, `dissolve`, `fade`, `slide-from-right`,
  `slide-from-left`, `flip`, `cube`, `gallery`. These match the Google Slides
  Transitions panel. Legacy `instant`, `slide` and `zoom` are accepted and stored
  as `none`, `slide-from-right` and `dissolve`. `null` resets it to `none`. On
  `patch-slide`, omitting it keeps the current type; on `add-slide`, omitting it
  means `none`.
- `transitionSpeed`: integer 0..49, default 45. Duration is `(5.0 - 0.1 * v)`
  seconds, so 45 is 0.5 s, 0 is 5.0 s and 49 is 0.1 s. `null` resets it to the
  default. On `patch-slide`, omitting it keeps the current speed; on `add-slide`,
  omitting it means 45.

To set a transition on every slide, patch each slide. The editor's Transition
popover also has Apply to all slides, which writes one batch.

PDF export keeps the transition metadata. PPTX and HTML export do not carry
transitions.
