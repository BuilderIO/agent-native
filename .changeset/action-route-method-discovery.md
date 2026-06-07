---
"@agent-native/core": patch
---

Fix deploy-time action route discovery so worker/edge builds mount actions with their declared HTTP method and `http.path`.

The deploy scan previously detected only `method: "GET"` via a plain source-text `includes`, so actions declaring `PUT`/`PATCH`/`DELETE`/`OPTIONS` were silently registered as `POST` (`app.on("POST", …)`) in deployed builds — a method mismatch against the client's actual request that 404s on edge/worker hosts (affected `calendar`'s `update-external-calendars`/`update-overlay-people` PUTs and `brain`'s `delete-source` DELETE). The same naive scan could also be tripped by an unrelated `method: "GET"` elsewhere in the file (e.g. a `fetch(…, { method: "GET" })` in the action body), and it dropped `http.path` entirely.

Discovery now parses the `http` config block specifically (all verbs, `http.path`, whitespace-tolerant `http: false`), and the generated worker mounts each action at `${prefix}/${http.path ?? name}` — matching the runtime mount in `action-routes.ts`.
