## Preferences

- Prefers agent chat docked on the far right, fully absent when closed, with the toggle as the rightmost button in the app's actual top bar instead of a floating button
- Prefers the agent sidebar header as a single row: mode tabs, chat tabs, and new/clear actions together; keep CLI chooser inside the cog menu instead of inline
- Project-wide domain rule: always use `agent-native.com` for docs/site links; do not use `agent-native.dev`
- When Steve asks to look up production template app data, use the `DATABASE_URL` from that template's `.env` file; those env files intentionally point at the prod DBs.
- For local app QA, test with the built-in browser before calling the work done. If creating test accounts, use emails with `+qa` in the local part.
- Avoid sparkle and wand icons in first-party UI; use message-style icons for chat / agent affordances.
- Top-bar agent toggle buttons should match neighboring toolbar controls: 8x8 muted button, subtle hover, and a normal-sized agent-native mark.
- Fusion Analytics migrations should use scripts only as repeatable manifests/writers; the React-to-Alpine translation itself must be manually reviewed and authored by the agent from the Fusion source UI, never treated as a generic JSON/action wrapper.
