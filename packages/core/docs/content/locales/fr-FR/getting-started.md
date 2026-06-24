---
title: "Démarrage"
description: "Créez une application d'agent, comprenez les instructions, skills et actions, puis regardez l'agent appeler sa première action."
---

# Démarrage

Les applications Agent-Native donnent à un agent IA et à votre UI les mêmes actions, données et
état. Un agent de base est constitué d'instructions qui le guident, de skills qui lui enseignent
comportement reproductible et actions qui lui permettent de faire un vrai travail.

**Vous voulez commencer par une application complète ?** Clonez l'un de nos modèles riches –
[Chat](/docs/template-chat), [Mail](/docs/template-mail),
[Calendar](/docs/template-calendar), [Content](/docs/template-content),
[Analytics](/docs/template-analytics) et [many more](/docs/cloneable-saas) —
chacune une application complète que vous personnalisez.

Construire à partir de zéro ? Le seul choix dès le départ est de savoir si vous voulez un UI —
tout après (écrire les instructions, ajouter skills, définir actions, exécuter
l'agent) est le même dans les deux cas.

```an-file-tree title="A basic Agent-Native agent"
{
  "entries": [
    { "path": "AGENTS.md", "note": "always-on instructions: purpose, rules, tone, and the map of what the agent can do" },
    { "path": ".agents/skills/customer-research/SKILL.md", "note": "a reusable playbook the agent loads when the task matches" },
    { "path": "actions/summarize-week.ts", "note": "typed code the agent, UI, CLI, HTTP, MCP, A2A, jobs, and webhooks can run" }
  ]
}
```

Cela est vrai que vous commenciez avec un chat UI, un agent sans tête ou une application complète.
Le UI change la surface ; instructions, skills et actions donnent à l'agent son
conseils et comportement.

## 1. Créez votre application

Vous aurez besoin de [Node.js 22+](https://nodejs.org) et [pnpm](https://pnpm.io).

Exécutez `create` sans indicateur et il vous demande comment vous souhaitez démarrer (un modèle complet,
Chat ou Headless) avant toute chose :

```bash
npx @agent-native/core@latest create my-app
```

Ou transmettez un indicateur pour ignorer l'invite :

**Vous voulez un UI ?** Commencez à partir du modèle de chat. Vous obtenez un agent actif plus un
chat personnalisable UI, et chaque action que vous ajoutez y apparaît automatiquement :

```bash
npx @agent-native/core@latest create my-app --template chat
```

**Juste la primitive sans tête ?** Démarrer sans tête – les mêmes actions et le même agent
boucle, pas de shell UI :

```bash
npx @agent-native/core@latest create my-agent --headless
```

Installez ensuite à partir du dossier que vous avez créé :

```bash
cd my-agent # or my-app if you chose the Chat template
pnpm install
```

À partir de maintenant, les deux sont identiques.

## 2. Ajouter une action

Une action est une opération que votre agent (et votre UI) peut appeler. Les deux échafaudages
livré avec cet exemple :

```an-annotated-code title="Your first action"
{
  "filename": "actions/hello.ts",
  "language": "ts",
  "code": "import { defineAction } from \"@agent-native/core/action\";\nimport { z } from \"zod\";\n\nexport default defineAction({\n  description: \"Say hello from the local agent.\",\n  schema: z.object({\n    name: z.string().default(\"world\"),\n  }),\n  http: { method: \"GET\" },\n  readOnly: true,\n  run: async ({ name }) => {\n    return { message: `Hello, ${name}!` };\n  },\n});",
  "annotations": [
    { "lines": "5", "label": "Tool description", "note": "The agent reads `description` to decide when to call this as a tool." },
    { "lines": "6-8", "label": "Typed contract", "note": "One zod `schema` validates input from every surface — agent, UI, HTTP, MCP, and A2A." },
    { "lines": "9", "label": "HTTP verb", "note": "Opt this action into an auto-mounted HTTP endpoint." },
    { "lines": "10", "label": "Read-only", "note": "`readOnly` marks the action as safe to call without approval and cacheable for queries." },
    { "lines": "11-13", "label": "One implementation", "note": "The `run` body is the single source of truth that every surface executes." }
  ]
}
```

Remplacez `hello` par la première opération réelle dans votre domaine. Vous le définissez une fois ;
chaque surface le capte.

Utilisez `AGENTS.md` pour obtenir des conseils qui doivent s'appliquer à chaque virage. Utilisez une compétence lorsque le
l'agent a besoin d'un workflow ou d'une procédure de domaine réutilisable. Utilisez une action lorsque
l'agent a besoin d'un moyen typé et testable pour lire des données, écrire des données, appeler un API ou
effectuer une approbation.

## 3. Exécutez-le

Appelez l'action directement :

```bash
pnpm action hello --name Steve
```

Ou demandez à l'agent de l'appeler pour vous :

```bash
pnpm agent "Call the hello action for Steve and explain what happened."
```

Si vous avez démarré à partir du modèle Chat, exécutez l'application et utilisez le même agent dans le
navigateur : il peut déjà appeler toutes les actions que vous définissez :

```bash
pnpm dev
```

Cette action est désormais accessible depuis le chat UI, les CLI, HTTP, MCP, A2A,
tâches planifiées et webhooks. Définissez une fois, appelez de n'importe où.

```an-diagram title="One action, every surface" summary="A single defineAction file fans out to every consumer with no extra wiring."
{
  "html": "<div class=\"diagram-fan\"><div class=\"diagram-box\" data-rough>defineAction</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-surfaces\"><span class=\"diagram-pill\">Chat UI</span><span class=\"diagram-pill\">CLI</span><span class=\"diagram-pill\">HTTP</span><span class=\"diagram-pill\">MCP</span><span class=\"diagram-pill\">A2A</span><span class=\"diagram-pill\">Scheduled jobs</span><span class=\"diagram-pill\">Webhooks</span></div></div>",
  "css": ".diagram-fan{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-fan .diagram-surfaces{display:flex;flex-wrap:wrap;gap:8px;max-width:420px}.diagram-fan .diagram-arrow{font-size:22px;line-height:1}"
}
```

## L'État est intégré

Sans tête ne signifie pas apatride. Actions, sessions, état de l'application, threads,
l'historique d'exécution et les informations d'identification se trouvent tous dans SQL. Localement, c'est SQLite à
`data/app.db` ; en production, vous définissez `DATABASE_URL`. Voir
[Deployment](/docs/deployment).

```an-callout
{
  "tone": "info",
  "body": "**Headless is still a real app.** The app-agent loop persists sessions, threads, runs, settings, and credentials in SQL — it is not a stateless prompt. You can add a UI later without touching your actions or state."
}
```

## Personnalisez le UI

Si vous avez démarré à partir du modèle Chat, vous pouvez modifier le UI. Le chat lui-même
est un petit itinéraire construit sur le composant `<AgentChatSurface>` :

```tsx
// app/routes/_index.tsx
import { AgentChatSurface } from "@agent-native/core/client";

export default function ChatRoute() {
  return <AgentChatSurface mode="page" className="h-full" />;
}
```

- **`app/routes/_index.tsx`** — la page de discussion. Modifier les suggestions, vide
  état et disposition.
- **`app/root.tsx`** — le shell de l'application. Ajoutez vos propres itinéraires et écrans autour du
  agent.
- Déposez l'agent sur n'importe quel écran avec `<AgentSidebar>`, travaillez-y manuellement à partir d'un
  bouton avec `sendToAgentChat()`, ou exécuter une action directement avec
  `useActionMutation()`.

Voir [Drop-in Agent](/docs/drop-in-agent) pour l'ensemble complet des composants, et
[Native Chat UI](/docs/native-chat-ui) pour afficher les résultats des actions sous forme de tableaux,
des graphiques et des cartes dactylographiées au lieu de texte brut.

**Vous avez commencé sans tête et vous voulez un UI plus tard ?** Le modèle Chat _est_ la rampe d'accès au UI —
sa couche `app/` (routeur React + Vite) correspond exactement à l'échafaudage sans tête
laisse de côté. Le geste le plus simple consiste à démarrer (ou à ré-échafauder) à partir du chat
modèle ; vos états `actions/`, agent et SQL restent inchangés. Voir
[Agent Surfaces](/docs/agent-surfaces) pour chaque surface intermédiaire.

## Structure du projet

```text
my-app/
  actions/         # Agent-callable actions
  app/             # React frontend (UI templates only; omitted when headless)
  server/          # Nitro API server (routes, plugins)
  AGENTS.md        # Always-on agent instructions
  .agents/         # Skills the agent can pull in when relevant
  data/app.db      # Local SQLite state when DATABASE_URL is unset
```

## Où aller ensuite

- **[Key Concepts](/docs/key-concepts)** — l'architecture de base : SQL, actions,
  synchronisation et prise en compte du contexte.
- **[Actions](/docs/actions)** — l'action complète API : schémas, HTTP, authentification et
  approbation.
- **[Agent Surfaces](/docs/agent-surfaces)** – sans tête, chat, side-car intégré,
  et application complète.
- **[Drop-in Agent](/docs/drop-in-agent)** — ajoutez le chat d'agent à n'importe quelle application React.
- **[Deployment](/docs/deployment)** : placez votre application sur votre propre domaine.
- **[FAQ](/docs/faq)** — questions sur la configuration et le produit.
