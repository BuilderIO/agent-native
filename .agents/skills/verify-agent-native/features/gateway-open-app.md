# Open an app through the gateway

The dev-lazy gateway serves every exposed template under
`http://127.0.0.1:8080/<app>`, boots it on first visit, and lands the user on
the app's home route.

## Sub-features

- `lazy-boot` starts a stopped app on first request. A `Dev server is
  restarting…` page shows until it is ready.
- `landing` redirects `/<app>/` to the app's home route (for example
  `/dispatch/overview`).
- `catalog` lists apps, ports, and `running` flags at `/_workspace/apps`.

## How to get to it (user POV)

- Opening `http://127.0.0.1:8080/<app>` directly.
- Opening `http://127.0.0.1:8080/`, which redirects to the default app.
- Using the app switcher in the workspace chrome.

## Driving it with drive.ts

Preconditions:

- The gateway is running. Check with
  `node .agents/skills/verify-agent-native/scripts/doctor.ts --gateway --app <app>`,
  which must show `gateway` ok.

- **Open and land.** Run
  `node .agents/skills/verify-agent-native/scripts/drive.ts --gateway --app dispatch --recipe .agents/skills/verify-agent-native/recipes/gateway-open-app.ts`.
  The recipe waits out lazy boot and asserts a `main` landmark under
  `/dispatch`. The note logs the landing path and title.
- **Proof.** `.tmp/verify/gateway-dispatch-<ts>/evidence/gateway-open-app/01-gateway-app.png`.
  Pass `--run <id>` to choose the directory.

## Gotchas

- This is read-only by contract. Gateway apps may be on a shared remote DB.
- A cold app can take over a minute on first compile. `ctx.open` waits up to
  3 minutes.
- Dispatch logs `400 …/get-builder-credit-status` when Builder isn't
  connected. This is pre-existing.
