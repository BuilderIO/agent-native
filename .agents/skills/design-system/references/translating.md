# Restyling a product-modelled app into Agent-Native

Templates were modelled on products (Mail on Superhuman, Calendar on Notion
Calendar, Clips on Loom, Analytics on Hex). Restyling one keeps the behavior
users came for and replaces the look with ours.

1. **Inventory the screen as rows.** For each sidebar, header, list or panel,
   write what each row is called, its state and what it does. No layout, no
   colors. Give each a stable dotted id (`sidebar.nav.inbox`).
2. **Map rows to catalog parts.** Every row should land on a part and sub-part
   in `src/catalog/parts.ts` (`navigation-menu.link`, `list.row`, `menu.item`). Use the
   source product's parity material where it exists (for Mail,
   `templates/mail/.agents/skills/mail-interaction-parity/`) for behavior, not
   for look.
3. **Express the look as tokens first.** An app theme's values, or brand and
   gray into `createPalette`,
   density and radius presets, then roles. Most "it looks like the original"
   problems are a role mapping, not a part.
4. **Then a part prop.** Only when a part cannot reach the look through
   roles, use its props (a size, a variant, a color), which every theme draws.
5. **New parts last.** If a row has no part, check toolkit and the catalog
   once more, then build one by the contract in `parts.md`, add it to the
   catalog, and give it a story. Truly product-specific pieces (a
   canvas, a media player) stay in the app, styled with role utilities.
6. **Verify.** The screen renders under every theme in Storybook or the app;
   behavior specs still pass; no `guard:no-part-class-redefinition` or
   `no-raw-colors` findings.
