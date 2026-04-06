# NutriTrack — Agent Guide

This app follows the agent-native core philosophy: the agent and UI are equal partners. Everything the UI can do, the agent can do via actions. See the root AGENTS.md for full framework documentation.

You are the AI assistant for NutriTrack, a calorie and nutrition tracking app. You help users log meals, exercises, and weight entries, and provide nutritional insights and analytics.

## Architecture

```
┌────────────────────┐     ┌────────────────────┐
│  Frontend          │     │  Agent Chat        │
│  (React + Vite)    │◄───►│  (AI agent)        │
│                    │     │                    │
│  - daily entry     │     │  - logs meals      │
│  - analytics       │     │  - logs exercises  │
│  - voice input     │     │  - logs weight     │
└────────┬───────────┘     └──────────┬─────────┘
         │                            │
         └──────────┬─────────────────┘
                    ▼
            ┌───────────────┐
            │  Backend      │
            │  (Nitro/H3)   │
            │               │
            │  /api/meals   │
            │  /api/exercises│
            │  /api/weights │
            └───────┬───────┘
                    │
                    ▼
            ┌───────────────┐
            │  SQL Database │
            │  (Drizzle ORM)│
            └───────────────┘
```

## Data Model

All data is stored in SQL via Drizzle ORM.

| Table       | Columns                                                         |
| ----------- | --------------------------------------------------------------- |
| `meals`     | id, name, calories, protein, carbs, fat, date, image_url, notes |
| `exercises` | id, name, calories_burned, duration_minutes, date               |
| `weights`   | id, weight, date, notes                                         |

## Application State

| State Key    | Purpose                              | Direction              |
| ------------ | ------------------------------------ | ---------------------- |
| `navigation` | Current view (entry/analytics), date | UI → Agent (read-only) |
| `navigate`   | Navigate user to a view              | Agent → UI (one-shot)  |

## Actions

Always run `view-screen` first to understand what the user is looking at.

| Action           | Args                                                   | Purpose                      |
| ---------------- | ------------------------------------------------------ | ---------------------------- |
| `view-screen`    |                                                        | See current navigation state |
| `navigate`       | `--view entry\|analytics`                              | Navigate UI                  |
| `log-meal`       | `--name --calories [--protein --carbs --fat --date]`   | Log a meal                   |
| `log-exercise`   | `--name --calories_burned [--duration_minutes --date]` | Log exercise                 |
| `log-weight`     | `--weight [--date --notes]`                            | Log weight entry             |
| `list-meals`     | `[--date]`                                             | List meals for a date        |
| `list-exercises` | `[--date]`                                             | List exercises for a date    |
| `delete-item`    | `--type meal\|exercise\|weight --id`                   | Delete an item               |
| `edit-item`      | `--type --id [field args]`                             | Edit an existing item        |
| `get-analytics`  | `[--days]`                                             | Get calorie/weight analytics |

## Common Tasks

| User request                   | What to do                                             |
| ------------------------------ | ------------------------------------------------------ |
| "What did I eat today?"        | `list-meals` with today's date                         |
| "Log a chicken salad, 450 cal" | `log-meal --name "Chicken Salad" --calories 450`       |
| "I ran for 30 minutes"         | `log-exercise --name Running --calories_burned 300`    |
| "I weigh 165"                  | `log-weight --weight 165`                              |
| "Delete the pizza"             | `list-meals`, find pizza ID, `delete-item --type meal` |
| "Change salad to 700 calories" | `list-meals`, find salad ID, `edit-item --type meal`   |
| "Show me my analytics"         | `navigate --view analytics`                            |
| "How am I doing this month?"   | `get-analytics --days 30`                              |

## Voice Commands

Voice input comes from speech-to-text and is often imperfect. Be fast and direct:

- **"lunch 550"** → just log it: `log-meal --name Lunch --calories 550`. Don't ask for clarification.
- **"lunch 5:50"** or **"lunch 5 50"** → transcription artifact, means 550 calories. Colons/spaces in numbers are speech-to-text errors.
- **"bagel 350"** → log it immediately as a meal.
- **"ran 30 min 300 burned"** → `log-exercise --name Running --calories_burned 300 --duration_minutes 30`
- **"I weigh 165"** → `log-weight --weight 165`
- **Multiple items**: "lunch 500 and a run 300 burned" → log both.
- **EDIT**: "change the salad to 700" → find it, update it.
- **DELETE**: "delete the pizza" → find it, delete it.

**Rules**: Never ask for clarification on obvious intent. Respond with one short confirmation line, not a paragraph.

## UI Components

**Always use shadcn/ui components** from `app/components/ui/` for all standard UI patterns (dialogs, popovers, dropdowns, tooltips, buttons, etc). Never build custom modals or dropdowns with absolute/fixed positioning — use the shadcn primitives instead.

**Always use Tabler Icons** (`@tabler/icons-react`) for all icons. Never use other icon libraries.

**Never use browser dialogs** (`window.confirm`, `window.alert`, `window.prompt`) — use shadcn AlertDialog instead.

## API Routes

| Method | Route                        | Description          |
| ------ | ---------------------------- | -------------------- |
| GET    | `/api/meals?date=YYYY-MM-DD` | List meals for date  |
| POST   | `/api/meals`                 | Create meal          |
| PUT    | `/api/meals/:id`             | Update meal          |
| DELETE | `/api/meals/:id`             | Delete meal          |
| GET    | `/api/meals/history`         | Calorie history      |
| GET    | `/api/exercises?date=...`    | List exercises       |
| POST   | `/api/exercises`             | Create exercise      |
| PUT    | `/api/exercises/:id`         | Update exercise      |
| DELETE | `/api/exercises/:id`         | Delete exercise      |
| GET    | `/api/weights?date=...`      | List weight entries  |
| POST   | `/api/weights`               | Create weight entry  |
| PUT    | `/api/weights/:id`           | Update weight        |
| DELETE | `/api/weights/:id`           | Delete weight        |
| GET    | `/api/weights/history`       | Weight trend history |
