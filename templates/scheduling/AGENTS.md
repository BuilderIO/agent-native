# Scheduling — Agent Guide

Scheduling is an agent-native booking and availability app with public booking
routes and authenticated management surfaces.

## Core Rules

- Use actions for availability, booking links, bookings, teams/orgs, settings,
  navigation, and sharing. Do not bypass access checks.
- Public booking pages must SSR real content and expose only intentional public
  endpoints.
- Treat time zones and relative dates carefully. Use concrete dates/times in
  replies and clarify assumptions.
- Use `view-screen` when the active booking link, availability window, event, or
  settings panel is unclear.
- Use shared booking-link components and existing framework auth/public-path
  patterns.

## Application State

- `navigation` exposes booking links, availability, bookings, dashboard, and
  settings context.
- `navigate` moves the UI to dashboard, booking links, availability, and public
  preview surfaces.

## Skills

Read `frontend-design` and `shadcn-ui` for UI work. Use root `actions`,
`storing-data`, `security`, `sharing`, `authentication`, and `real-time-sync`
for implementation details.
