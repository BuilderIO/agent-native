---
"@agent-native/core": patch
---

Application-state writes no longer send a request per call. Writes made in the same tick go out together on the next one, keepalive writes included: a single write uses its key's route as before, and writes to several keys go as one `POST /_agent-native/application-state` with a `writes` list, which the server applies key by key and answers per key. Each entry sets a value or carries `delete: true`, never both. While a write to a key is in flight, later writes to that key replace each other, so a burst sends the write in flight and the latest value, and every caller gets the latest's result. A write identical to the one in flight, with nothing queued behind it, joins it, unless it needs keepalive and the one in flight went without. Writes with an abort signal and compare-and-set calls keep their own requests and their order. Reads still wait for the latest write, including reads through a tab's explicit key (`navigation:<tab>`) after a write through `navigation`.

Keepalive requests are packed by encoded bytes to fit the browser's 64 KiB keepalive budget, counting the ones still in flight; a write that can't fit goes without keepalive instead of failing. Once the page starts hiding, waiting writes go at once and later writes are sent immediately with keepalive; on `pagehide`, a keepalive write still queued behind an earlier write to its key goes too.

When the batch route didn't run (no route marker, and a 404, 405 or non-JSON answer), the client sends those writes one key at a time and stops batching until the page reloads. Any other unreadable or malformed answer rejects every write in that batch rather than sending them again.
