# Clips design direction

| Decision             | Direction                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product mode         | Operate and read                                                                                                                                  |
| Audience and cadence | People recording, reviewing, and sharing work throughout the day                                                                                  |
| Visual world         | Quiet screening room — the recording is primary, collaboration is close at hand, and chrome recedes                                               |
| Palette family       | Ink and graphite neutrals with the existing cyan highlight reserved for focus and playback state                                                  |
| Type treatment       | Sans-first, compact, and highly legible with tabular time values                                                                                  |
| Composition          | Focused workbench with a dominant player and a bounded contextual rail                                                                            |
| Shape language       | Quiet corners, crisp dividers, restrained elevation                                                                                               |
| Anti-references      | Edge-to-edge white slabs, pill-heavy tab bars, generic dashboard cards, decorative AI gradients, and toolbars where every action has equal weight |

## Control density

- 28px for inline icon and reaction affordances.
- 32px for toolbar actions, form controls, and contextual buttons.
- 40px for tab rails and other persistent navigation.
- Media transport may reach 44px; the central play control tops out at 64px.
- Compact visual controls keep a larger invisible hit area when needed.

## Navigation tabs

- Route-, page-, and panel-level navigation uses the installed shadcn `Tabs`
  with `TabsList variant="line"`.
- Hover changes the label color; selection adds the standard underline. Do not
  introduce a filled button background on hover for navigation tabs.
- Reserve the default segmented variant for compact input-mode selectors where
  the options behave like a mutually exclusive control rather than navigation.

## Typeset

Inter is the interface face. Viewer chrome uses 12px medium labels, fields and
content use 14px regular text, recording titles use 14px semibold, and time
values use the existing tabular monospace treatment. Uppercase is reserved for
settings group labels; sentences and actions remain sentence case.

The viewer should feel closer to a professional review room than a settings
dashboard. Video, title, playback, and the current collaboration task stay in
the first visual hierarchy. Agent work is contextual to the open recording,
focused panel, and current playback position; it does not become a separate AI
product inside Clips.

The public link is a watching room, not a reduced owner dashboard. Playback and
the comment conversation are the page; transcript is an optional companion
panel. Owner-only agent, insight, sharing, and editing controls belong in the
authenticated viewer and appear only when the current job needs them.

Reactions are lightweight playback gestures. Comments live beneath the
recording in the primary reading flow, where author identity, timestamp,
replies, and the composer form one conversation surface instead of competing
with reaction controls. The right rail is reserved for contextual inspection:
transcript, agent, insights, and settings.

## Progressive disclosure

The viewer presents jobs, not inventories. Sharing starts with one header-level
copy-link action, invitations, and current access. Social destinations and
embed publishing replace the body as focused secondary views; embed
configuration and agent context links stay collapsed until requested. The
overflow leads with recording cleanup actions, while maintenance and
document-generation commands live in named submenus. A generic AI-tools
launcher does not compete with Share. The editor opens in transcript mode and
reveals the precision timeline as a peer mode instead of stacking both
workspaces under the player.

Share is the viewer toolbar's sole labeled primary action and the product-led
growth entry point. Copy link is the first action inside Share, never a competing
toolbar button. Edit, download, and overflow use equal compact icon controls
with accessible names and tooltips; their visual weight must not rival Share.

Viewer identity uses one avatar grammar everywhere. People use profile images or
initials; agents use the same circular avatar shape with the assistant mark.
Terminal glyphs are reserved for developer tooling and never represent an agent
view. Human and agent totals remain visually distinct and are never summed. The
views popover is an identity roster only; completion, conversion, and drop-off
belong exclusively to the dedicated Insights panel.

## Studio boundary

Studio is the deliberate editing context, not another menu on the public
viewer. Existing transcript cuts, timeline trimming, split, thumbnail,
chapters, stitching, and export remain honest first-class tools. Future visual
operations should enter Studio as complete non-destructive edit capabilities:
guided zooms, cursor treatment, recording backgrounds, aspect-ratio canvases,
and motion treatment. Do not expose placeholder controls before the edit model,
preview, export, actions, and agent context can all represent the operation.
