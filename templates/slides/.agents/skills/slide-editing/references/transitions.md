# Slide transitions

A slide's transition plays when the presentation enters that slide, in Present
and Presenter view, forward or backward. It is set on the entering slide.

Set it with `patch-deck` `patch-slide` (or `update-slide`):

- `transition`: one of `none`, `dissolve`, `fade`, `slide-from-right`,
  `slide-from-left`, `flip`, `cube`, `gallery`. These match the Google Slides
  Transitions panel. Legacy `instant`, `slide` and `zoom` are accepted and stored
  as `none`, `slide-from-right` and `dissolve`.
- `transitionSpeed`: integer 0..49, default 45. Duration is `(5.0 - 0.1 * v)`
  seconds, so 45 is 0.5 s, 0 is 5.0 s and 49 is 0.1 s. `null` clears it back to
  the default.

To set a transition on every slide, patch each slide. The editor's Transition
popover also has Apply to all slides, which writes one batch.

PDF export keeps the transition metadata. PPTX and HTML export do not carry
transitions.
