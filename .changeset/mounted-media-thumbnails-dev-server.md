---
"@agent-native/core": patch
---

Fix mounted-app API thumbnails/media 404ing in dev when a template is mounted
under a base path (e.g. `/assets`, `/clips`) as part of a unified workspace
deploy. Browsers send `Sec-Fetch-Dest: image/video/audio/track` for
`<img>`/`<video>`/`<audio>` fetches, not `empty`, so the dev-server base-strip
guard only stripped the mount prefix off document/iframe/frame/empty
requests, leaving media API calls with the prefix still attached and the
request fell through to a generic "Cannot GET" 404 instead of reaching the
app's real handler. The guard now strips the mount prefix for image, video,
audio, and track requests too — this only ever affects `/api/**` paths, so
static asset and module requests mounted under the base are unaffected.
