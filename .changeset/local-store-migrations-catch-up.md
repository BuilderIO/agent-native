---
"@agent-native/core": patch
---

Local and self-hosted databases now get the agent-run and chat-thread migrations added after the store registry landed (durable execution leases, the submission inbox, the thread projection retry column). Those entries sat in release-only lists that only the release step runs, so a database created earlier failed at runtime with a missing column or table. They are now ordinary store migrations, and the store migrations lock rejects new entries on a release-only list.
