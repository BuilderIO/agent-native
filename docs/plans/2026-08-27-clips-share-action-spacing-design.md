# Clips Share Action Spacing Design

## Goal

Give the view badge, Share button, and options menu more breathing room in the Clips share-page header without changing their individual appearance or responsive behavior.

## Approach

Change the share-page action cluster from Tailwind `gap-1` (4px) to `gap-2` (8px). This matches the sibling recording-page header and the surrounding share-page header spacing.

No markup, colors, dimensions, radii, typography, button variants, internal badge spacing, breakpoints, wrapping behavior, or media queries change.

## Verification

Format the modified route, run the Clips typecheck, and inspect the share-page header at desktop and narrow widths when an authenticated share page is available.
