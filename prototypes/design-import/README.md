# Design import

Importing a website or a project from another builder into Design and turning it into an agentic app built with Agent-Native, on the shipped dashboard.

Artifact: https://claude.ai/artifact/VsZSNrkQEQrBbHUk31cA32

- The announcement lives in a card where Getting started sits in the sidebar, with a small version of the galaxy. The card opens the announcement dialog; its Import project button, the dialog's, and the dashboard's own Import button open the picker. The review strip's Announcement button opens the dialog directly.
- The announcement's galaxy sits in a blue, cyan and teal nebula (the website's brand tokens). Both rings turn at one speed, six logos each, so no two logos touch, and every few seconds one falls into the Design mark on a path checked against the others. It pauses, and holds still under reduced motion.
- The picker: App builders (Lovable, v0, Bolt, Replit, Base44, Manus) and Other ways to import (Website, Upload code, Figma, GitHub, Other site builders). Its sources drift into the Design mark in the header; source screens pull specks from the source into the mark.
- Each builder's steps follow its own help docs, with an Open link to its site. Lovable's ZIP needs a paid plan, so it links to a GitHub route for free plans. ZIP and Figma uploads take a drop or Choose file and check the type and size. URL sources validate as you type and submit on Enter.
- Every path runs a simulated import with a progress bar and phases, then a ready state with Open design. Import fails in the review strip stops imports on the second phase to show the error.
- Dialogs use the toolkit Dialog's corners, overlay, motion and close button, and the toolkit Button and Input.

The dashboard is the real `/home` page, not a redraw: `capture-dashboard.ts` saves its DOM, CSS, Inter faces and template previews from a running Design dev server into `dashboard.json`, and the prototype shows it in an iframe. Recapture after the dashboard changes:

```bash
node prototypes/design-import/capture-dashboard.ts http://localhost:3101
```

`logos.json` holds the sources' marks: Simple Icons for v0, Replit, Figma, GitHub, Wix, Squarespace, Webflow and Framer, and each brand's own site icon for Lovable, Bolt, Base44 and Manus, drawn in one color.

```bash
node prototypes/kit/build.ts design-import
```
