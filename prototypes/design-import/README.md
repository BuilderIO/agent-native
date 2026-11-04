# Design import

Importing a website or a project from another builder into Design, on the shipped dashboard.

Artifact: https://claude.ai/artifact/VsZSNrkQEQrBbHUk31cA32

- The dashboard opens with an announcement: a dark hero where the sources orbit the Design mark (pausable, still under reduced motion), three points, then Learn more and Import now. The review strip's Announcement button brings it back.
- Import now, or the dashboard's own Import button, opens the picker. App builders: Lovable (sync with GitHub), v0, Bolt, Replit and Base44 (export as ZIP) and Manus (export with a prompt). Everything else: Website, Upload code, Figma (.fig, up to 2 GB like the shipped Import), GitHub, and Other platforms (Wix, Squarespace, Webflow, Framer).
- Each builder gets its steps with an Open link to its site. ZIP sources continue to the upload screen, which takes a drop or Choose file and checks the type and size. URL sources validate as you type and submit on Enter.
- Every path runs a simulated import with a progress bar and phases, then a ready state with Open design. Import fails in the review strip stops imports on the second phase to show the error.

The dashboard is the real `/home` page, not a redraw: `capture-dashboard.ts` saves its DOM, CSS, Inter faces and template previews from a running Design dev server into `dashboard.json`, and the prototype shows it in an iframe. Recapture after the dashboard changes:

```bash
node prototypes/design-import/capture-dashboard.ts http://localhost:3101
```

`logos.json` holds the sources' marks: Simple Icons for v0, Replit, Figma, GitHub, Wix, Squarespace, Webflow and Framer, and each brand's own site icon for Lovable, Bolt, Base44 and Manus, drawn in one color.

```bash
node prototypes/kit/build.ts design-import
```
