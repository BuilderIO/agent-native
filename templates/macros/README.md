# Macros

An agent-native, voice-driven calorie and macro tracker — an open-source take on
MyFitnessPal-style logging. Speak or type what you ate and the agent logs the
food, estimates calories and macros, and keeps your daily stats up to date.

> **Internal/experimental template.** Macros is not shown in the public template
> pickers. It exists as a reference app and demo.

**Live app: [macros.agent-native.com](https://macros.agent-native.com)**

## Features

- Log foods and meals by voice or text through the agent.
- Automatic calorie and macro estimation.
- Voice corrections and quick edits.
- Daily and historical stats.

## Develop locally

Scaffold your own copy and run it:

```bash
npx @agent-native/core@latest create my-macros --standalone --template macros
cd my-macros
pnpm install
pnpm dev
```
