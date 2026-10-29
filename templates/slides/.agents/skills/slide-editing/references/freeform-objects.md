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

## Groups and auto layout

A group is an absolutely positioned
`div.fmd-slide-group[data-slide-group="true"]` with its own
`data-slide-object-id`. Its members are freeform objects placed with
`left`/`top`/`width`/`height` relative to the group's padding box.

An auto layout group lays its members out with flexbox instead. The editor
writes exactly this shape (Shift+A, the toolbar's Auto layout section); write
and edit it the same way:

```html
<div
  class="fmd-slide-group"
  data-slide-group="true"
  data-slide-object-id="group-unique-id"
  style="position: absolute; left: 120px; top: 160px; width: 360px; height: 80px; box-sizing: border-box; display: flex; flex-direction: row; gap: 20px; padding: 20px 10px; align-items: flex-start;"
>
  <div data-slide-object-id="card-a" style="width: 100px; height: 40px;">A</div>
  <div class="fmd-text-box" data-slide-object-id="label-b" style="width: 100px;">B</div>
</div>
```

- Members in flow have no `position`, `left`, `top`, `right`, `bottom`,
  `inset`, or margin. DOM order is flow order: reorder by moving the element.
- Direction is `flex-direction: row | column`. Gap and padding are whole px.
- Alignment along the direction is `justify-content`; across it is
  `align-items`. Use `flex-start`, `center`, or `flex-end`, and always write
  `align-items` so a text box with no height does not stretch.
- Sizing per axis, for a member or the group: Fixed is a px `width`/`height`
  (along the direction also `flex-grow: 0; flex-shrink: 0; flex-basis: auto`).
  Hug is `fit-content`, only for an element whose content is in flow (text, or
  an auto layout group); a group or shape whose children are all absolute
  cannot hug. Fill along the direction is
  `flex-grow: 1; flex-shrink: 0; flex-basis: 0` with `auto` size; across it is
  `align-self: stretch` with `auto` size. Only a member in flow can Fill.
- A member left `position: absolute` inside an auto layout group (a badge or
  overlay) stays out of the flow and keeps its `left`/`top`.
- Geometry lands on whole px: `left`, `top`, `width`, `height`, `gap`, and
  `padding`.
- To turn auto layout off, pin each member at its rendered box with
  `position: absolute; left; top; width; height; box-sizing: border-box;
  margin: 0` (no `height` on a text box that sizes to its text) and set the
  group to `display: block`. A group that hugged gets its rendered px size.

