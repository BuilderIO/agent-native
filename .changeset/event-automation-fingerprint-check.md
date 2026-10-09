---
"@agent-native/core": patch
---

Event automations created on another server instance now start receiving events within about 5 seconds instead of up to a minute. The trigger dispatcher re-checks its cached list of event automations with a cheap fingerprint read of `jobs/` (a digest of each row's id, owner, path, write time and content hash; content is hashed in the database) at most every 5 seconds, and reads the full list only when the fingerprint changed. `hasEventAutomation` answers "no" from that fingerprint instead of a full read. Adds `resourceFingerprintAllOwners` and `resourceListAllOwnersWithFingerprint` to the resource store; each full read carries the fingerprint of exactly the rows it returned.
