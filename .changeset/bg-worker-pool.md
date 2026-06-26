---
"@agent-native/core": patch
---

Fix durable background-agent workers freezing during pre-send setup on apps with
large action surfaces (e.g. analytics). The background-function Neon pool was
capped at 2 connections (same as the foreground serverless), but the agent's
pre-send setup fires ~6 concurrent DB reads — that burst exhausted the 2-slot
pool and a stalled connection froze the worker right after `model_done`, so it
never claimed and the foreground fell back to inline (~17s) every turn. The bg
worker is a single process per run, so it now uses a larger pool (8); the
many-instance foreground serverless pool stays at 2 to avoid Neon's connection
cap.
