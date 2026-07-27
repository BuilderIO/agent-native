---
type: fixed
date: 2026-07-01
---

Session replays now play back in production instead of showing a blank recording, because chunk downloads no longer rely on a manual gzip content-encoding that serverless hosts corrupted.
