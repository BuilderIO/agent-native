# Design editor tests and blast radius

Canvas changes can affect selection, layer ordering, drag insertion, undo, and
persisted geometry. Start with the focused interaction spec, then run nearby
specs that share the edited state or input handler.

The interaction suite is organized by behavior, including selection,
reparenting, layer ordering, resizing, duplication, undo and redo, and editor
walkthroughs. Select cases by their test titles rather than relying on file
line numbers.

Changes to shared canvas math, input handling, editor state, or the Design app
configuration require the bounded Design interaction lane. For an app-only
copy or export change, run the corresponding action and server tests as well.
