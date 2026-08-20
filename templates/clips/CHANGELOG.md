# Changelog

All notable user-facing changes to Clips are documented here. Open it any time
from the command menu (Cmd+K → "What's new") or from Settings.

Older updates live in [the changelog folder](./changelog/) and are included in the in-app "What's new" view.

## 2026-08-20

### Improved

- Recording controls now follow you across browser tabs and page navigations.

### Fixed

- Clips overlays now follow tab switches during the recording countdown and recover cleanly on tabs opened before Clips.
- Clips now opens provider setup instead of retrying a rejected key in a loop.

## 2026-08-19

### Added

- Clips Nightly builds are available for trying the latest updates.

### Fixed

- Shared clips now show a video frame in social previews when no thumbnail is stored.

## 2026-08-18

### Improved

- Meeting notes support rich editing for personal notes, summaries, and action items.
- Meeting notifications no longer show decorative left-side lines.

### Fixed

- Centered the clip play button and corrected the empty comment-panel hint.
- Clips no longer crashes when a camera bubble starts at a tiny size.
- Clips now recovers interrupted uploads and reliably restarts after installing desktop updates.
- Deleting a recording no longer freezes Clips or blocks starting a new recording.
- Pending recording files now use a Clips-prefixed name instead of a feature-ambiguous stem.

### Removed

- Clips no longer opens a welcome window on first launch.

## 2026-08-17

### Fixed

- Shared clips now clearly show sign-in, let signed-in viewers comment, and use neutral messaging for confirmed no-audio transcripts.

## 2026-08-14

### Improved

- Meetings now opens on your history instead of a wall of upcoming cards: past meetings with notes but no linked recording are back in the list, older ones keep loading as you go, and search reaches attendee names and transcript text so you can find a call by what was said in it.

### Fixed

- Long desktop recordings now complete or abort resumable uploads cleanly, preserve local recovery copies, and show the actual upload error when saving fails.
- Clips now uses consistent text-only share controls with compact copy actions and an expandable Share with agents section across recordings and meetings.
