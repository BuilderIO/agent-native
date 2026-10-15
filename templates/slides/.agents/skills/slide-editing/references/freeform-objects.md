# Freeform Canvas Objects

Manual text boxes and other freeform canvas objects are absolutely positioned
children of `.fmd-slide`. Give each one a stable `data-slide-object-id`:

```html
<div
  class="fmd-text-box"
  data-slide-object-id="slide-object-unique-id"
  style="position: absolute; left: 160px; top: 120px; width: 420px;"
>
  Editable text
</div>
```

- Preserve `data-slide-object-id` and the `left`/`top`/`width` of hand-placed
  objects when updating, moving, resizing, or styling them.
- Mint a new unique object ID when duplicating an object.
- Do not use runtime-only `data-builder-id` values in saved slide HTML.
- A text box (`.fmd-text-box`) with no inline `height` auto-grows with its text
  from the top edge.
- Build editable shapes with styled HTML elements such as `div`.
