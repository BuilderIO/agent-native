# Clips User Avatar Design

## Problem

The Clips viewer popover and share-access list render initials or generic icons even when a user has uploaded an Agent Native profile avatar. Both surfaces receive an email identity but never call the framework avatar lookup or render an image.

## Approved approach

Use the existing cached `useAvatarUrl(email)` client hook in both surfaces. Render the returned URL through the existing shadcn `AvatarImage` primitive and preserve every current size, shape, color, and fallback. Anonymous view records remain generic because they have no email identity, and organization grants retain the group icon.

## Components

- `templates/clips/app/components/sharing/viewed-by-popover.tsx`: extract an email-aware viewer avatar component so hooks are not called inside the view-record loop.
- `templates/clips/app/components/sharing/share-ui.tsx`: update the existing access-list avatar component to resolve profile images for user principals while leaving organization principals unchanged.

## Data flow

Each identified row passes its email to `useAvatarUrl`. The hook reads the framework avatar endpoint and uses its module-level cache to deduplicate repeat lookups. A stored image renders when available; otherwise the current initials/icon fallback renders unchanged.

## Error handling

The existing avatar hook converts unavailable avatar responses into `null`. The UI therefore keeps its current fallback without introducing new loading, error, or empty states.

## Verification

Run oxfmt on both modified files, then run the Clips typecheck and focused test command. Open the Clips UI and verify both the Views popover and Share dialog with users that have and do not have profile avatars.
