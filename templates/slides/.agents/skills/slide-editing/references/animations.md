# Click-to-reveal animations

Animations are metadata over the final slide HTML, not alternate slide markup.
Reveal only where the order of ideas carries the argument (a list whose payoff
is the last item, a build to a conclusion, before/after); a title, single
quote, or diagram the audience should take in at a glance is stronger shown
whole. Do not add reveals by default.
Read the full target slide, keep its existing visual structure, and patch the
complete ordered `animations` list with `elementPath` values from that exact
HTML. Elements omitted from the list remain visible immediately, so labels and
headings need no duplicate markup. Do not add hidden duplicates, layout
spacers, absolute-positioned copies, transforms, or placeholder content to
simulate reveals. When content and reveals change together, send both fields in
one `patch-deck` operation. To remove reveals, send `animations: []` with the
existing content and verify the persisted slide afterward.

Array order is reveal order, and each entry needs a non-empty `id`, a 0-based
`elementIndex`, and a `type` of `appear`, `fade`, `slide-up`, or `zoom`; the
schema rejects the operation otherwise. Nothing checks that ids are unique, but
the editor keys its reveal list by id, so a duplicate makes "remove" and
"change type" hit every entry sharing it.

`elementPath` has to come from the exact final HTML because it is positional:
every segment is a child index, so inserting or removing a sibling anywhere
along the path retargets it. The runtime resolves the path first and falls back
to `elementIndex` only when it fails to resolve, which is why a stale path
silently reveals the wrong element instead of erroring. `get-deck` with
`compact=true` reports each step's order, id, target, and type for verification.
