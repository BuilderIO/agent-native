---
title: "Agent sans rendez-vous"
description: "Montez le chat de l'agent + l'espace de travail dans n'importe quelle application React avec <AgentPanel>, <AgentSidebar> et sendToAgentChat()."
---

# Agent sans rendez-vous

> **Page développeur.** Cette page est destinée aux développeurs qui intègrent l'agent dans une application React. Pour connaître l'expérience de l'utilisateur final en matière d'utilisation de l'agent, voir [Using Your Agent](/docs/using-your-agent).

Vous n'avez pas besoin de créer un agent natif à partir de zéro. Le chat de l'agent, l'onglet de l'espace de travail, le terminal CLI, la saisie vocale et toute l'infrastructure associée sont livrés sous la forme d'une poignée de composants React que vous déposez dans n'importe quelle application.

> **Prérequis :** le serveur doit exécuter `agent-chat-plugin` (il se monte automatiquement dans chaque modèle). Si vous partez de zéro, voir [Server](/docs/server).
>
> Besoin de la carte publique API au lieu d'un didacticiel ? Voir [Component API](/docs/components).

## Les composants en un coup d'œil {#components}

| Composant             | Qu'est-ce que c'est                                                                                                     | Utilisez-le quand                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `<AgentSidebar>`      | Enveloppe la présentation de votre application racine et ajoute un panneau latéral basculable contenant l'agent complet | Vous souhaitez que l'agent soit disponible à côté de votre application sur chaque écran |
| `<AgentToggleButton>` | Ouvre/ferme `<AgentSidebar>` (mettez-le dans votre en-tête)                                                             | Paire avec `<AgentSidebar>`                                                             |
| `<AgentPanel>`        | Le panneau brut lui-même – chat + CLI + onglets de l'espace de travail                                                  | Vous souhaitez un contrôle total sur la mise en page ou une page d'agent dédiée         |
| `<AgentChatSurface>`  | Une surface de discussion panneau/page pré-câblée                                                                       | Vous souhaitez discuter sans le wrapper de la barre latérale                            |
| `<AssistantChat>`     | Rendu de chat de niveau inférieur avec crochets de composition/historique                                               | Vous avez besoin d'un chrome personnalisé autour de la conversation standard UI         |
| `sendToAgentChat()`   | Envoyer un message au chat par programmation                                                                            | Un bouton qui confie le travail à l'agent au lieu de l'exécuter en ligne                |
| `useActionMutation()` | Emballage frontal Typesafe autour d'une action                                                                          | Le UI doit exécuter la même opération qu'un outil d'agent exécuterait                   |

Tous ces éléments sont exportés depuis `@agent-native/core/client`.

```an-diagram title="Le modèle de monture" summary="<AgentSidebar> enveloppe votre mise en page existante. Vos itinéraires s'affichent dans la zone principale ; le panneau d'agent se monte à côté d'eux. <AgentPanel> est le même panneau sans le wrapper."
{
  "html": "<div class=\"diagram-mount\"><div class=\"diagram-box sidebar\" data-rough><span class=\"diagram-pill accent\">&lt;AgentSidebar&gt;</span><div class=\"inner\"><div class=\"diagram-node main\">Votre application<br><small class=\"diagram-muted\">children: header + &lt;Outlet/&gt;</small></div><div class=\"diagram-node panel\">Panneau de l’agent<br><small class=\"diagram-muted\">chat &middot; CLI &middot; workspace</small></div></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&harr;</div><div class=\"diagram-card alt\"><span class=\"diagram-pill\">&lt;AgentPanel&gt;</span><small class=\"diagram-muted\">same panel, no wrapper &mdash; you own the layout</small></div></div>",
  "css": ".diagram-mount{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-mount .sidebar{display:flex;flex-direction:column;gap:8px;padding:14px}.diagram-mount .inner{display:flex;gap:10px}.diagram-mount .main{flex:2}.diagram-mount .panel{flex:1}.diagram-mount .alt{display:flex;flex-direction:column;gap:6px;padding:14px}.diagram-mount .diagram-arrow{font-size:22px;line-height:1}"
}
```

## Le cas 80 % : `<AgentSidebar>` {#sidebar}

La configuration la plus courante est une barre latérale qui s'ouvre depuis la droite sur n'importe quel écran.
Enveloppez votre disposition racine existante avec `<AgentSidebar>` ; peu importe ce que vous faites passer
les enfants restent dans la zone principale de l'application. Le chat de l'agent est le panneau latéral.

```an-annotated-code title="Encapsuler la disposition racine avec <AgentSidebar>"
{
  "filename": "app/root.tsx",
  "language": "tsx",
  "code": "import { Outlet } from \"react-router\";\nimport { AgentSidebar, AgentToggleButton } from \"@agent-native/core/client\";\n\nexport default function Root() {\n  return (\n    <AgentSidebar\n      emptyStateText=\"Comment puis-je aider ?\"\n      suggestions={[\n        \"Summarize my inbox\",\n        \"Draft a reply to the latest email\",\n        \"Show me yesterday's signup numbers\",\n      ]}\n      dynamicSuggestions\n      defaultSidebarWidth={420}\n      position=\"right\"\n    >\n      <header>\n        <AgentToggleButton />\n      </header>\n\n      <main>\n        <Outlet />\n      </main>\n    </AgentSidebar>\n  );\n}",
  "annotations": [
    { "lines": "6", "label": "Emballage", "note": "`<AgentSidebar>` wraps your whole layout. It adds the toggleable side panel; everything you pass as children stays in the main app area." },
    { "lines": "8-12", "label": "Invites de démarrage", "note": "`suggestions` s’affiche sous forme de puces cliquables sur le chat vide." },
    { "lines": "13", "label": "Puces contextuelles", "note": "`dynamicSuggestions` merges screen-aware prompts (e.g. \"Summarize this selection\") with your static ones. On by default." },
    { "lines": "18-20", "label": "Bouton bascule", "note": "Put `<AgentToggleButton />` anywhere in your header to open and close the panel." },
    { "lines": "22-24", "label": "Votre application", "note": "`<Outlet/>` (your routes) renders in the main area, untouched." }
  ]
}
```

C'est tout. L'utilisateur dispose désormais d'un agent commutable sur chaque page – avec historique des discussions, onglet espace de travail, terminal CLI, saisie vocale et mode plein écran. L'état persiste lors des rechargements via `localStorage`.

### Accessoires

- **`children`** : présentation et itinéraires normaux de votre application. Rendu dans la zone principale ; le panneau d'agent se monte à côté sur le bureau et par-dessus sur mobile/plein écran.
- **`emptyStateText`** — message d'accueil affiché lorsque le chat n'a aucun message. Par défaut : `"How can I help you?"`.
- **`suggestions`** — invites de démarrage affichées sous forme de puces cliquables lorsqu'elles sont vides.
- **`dynamicSuggestions`** — puces d'invite contextuelles fusionnées avec `suggestions`. Activé par défaut ; transmettez `false` pour afficher uniquement les suggestions statiques, ou `{ max, includeStatic, getSuggestions }` pour personnaliser.
- **`defaultSidebarWidth`** — largeur de pixel initiale (montage uniquement ; redimensionnement par l'utilisateur et remplacement de la valeur enregistrée). Par défaut : `380`.
- **`position`** — `"left"` ou `"right"`. Par défaut : `"right"`.
- **`defaultOpen`** — indique si la barre latérale démarre ouverte (bureau uniquement). Par défaut : `false`.

## Les 20 % restants : `<AgentPanel>` {#panel}

Lorsque vous avez besoin d'un contrôle total sur la mise en page (un itinéraire `/chat` dédié, un panneau intégré dans une colonne latérale que vous gérez ou une fenêtre contextuelle), effectuez le rendu direct de `<AgentPanel>` :

```tsx
// app/routes/agent.tsx
import { AgentPanel } from "@agent-native/core/client";

export default function AgentRoute() {
  return (
    <div className="h-screen">
      <AgentPanel defaultMode="chat" className="h-full" />
    </div>
  );
}
```

`<AgentPanel>` vous donne les onglets bruts (Chat / CLI / Espace de travail) sans le wrapper de la barre latérale, le bouton de réduction ou toute persistance d'état. Placez-le où vous voulez ; vous gérez la mise en page.

### Accessoires sélectionnés

- **`defaultMode`** — `"chat"` ou `"cli"`. Par défaut : `"chat"`.
- **`className`** — Classe CSS pour le conteneur externe.
- **`onCollapse`** — s'il est fourni, un bouton de réduction apparaît dans l'en-tête.
- **`isFullscreen`** / **`onToggleFullscreen`** – connectez l'état plein écran externe si vous souhaitez une colonne centrée de style Claude.
- **`storageKey`** — espace de noms pour les clés `localStorage`. Utile lorsque vous affichez plusieurs panneaux (différentes instances d'application ou espaces de travail) sur la même page.

Accessoires complets : `AgentPanelProps` dans `@agent-native/core/client`.

## Messages programmatiques : `sendToAgentChat()` {#send}

Un bouton qui confie le travail à l'agent (au lieu d'exécuter un appel `llm()` en ligne — l'anti-modèle du [ladder](/docs/what-is-agent-native#the-ladder)) :

```tsx
import { sendToAgentChat } from "@agent-native/core/client";

<Button
  onClick={() =>
    sendToAgentChat({
      message: "Generate a chart showing signups by source",
      context: `Dashboard ID: ${dashboardId}, date range: last 30 days`,
      submit: true,
    })
  }
>
  Generate chart
</Button>;
```

### Options

- **`message`** — l'invite visible affichée dans le chat.
- **`context`** — contexte masqué ajouté à l'invite (texte sélectionné, position du curseur, identifiant d'entité actuel — tout ce que l'agent doit savoir mais que l'utilisateur ne doit pas voir deux fois).
- **`submit`** — `true` à exécuter automatiquement, `false` à pré-remplir mais attendre. Omettre d'utiliser la valeur par défaut du projet.
- **`newTab`** : créez un fil de discussion distinct pour cette invite.
- **`background`** — avec `newTab`, exécutez sans focaliser le nouveau thread. La course cachée est suivie dans `RunsTray`.
- **`openSidebar`** — défini sur `false` pour les envois en arrière-plan/silencieux. La valeur par défaut ouvre la barre latérale pour que l'utilisateur voie la réponse.
- **`type`** — `"content"` (par défaut) conserve le travail dans l'agent d'application intégré. `"code"` achemine vers le cadre d'édition de code (pour les modifications de code écrites par l'agent, voir [Frames](/docs/frames)).

`sendToAgentChat` renvoie un `tabId` stable que vous pouvez utiliser pour suivre l'exécution du chat.

Pour un travail silencieux, associez `newTab`, `background` et `openSidebar: false` :

```ts
sendToAgentChat({
  message: "Summarize the selected thread and save the summary",
  context: `Thread id: ${threadId}`,
  submit: true,
  newTab: true,
  background: true,
  openSidebar: false,
});
```

Il s'agit toujours d'un agent complet exécuté avec des outils, actions, l'état du thread et une exécution
suivi. Cela ne détourne tout simplement pas le focus de l'état actuel de la barre latérale de l'utilisateur.

Lorsque le même itinéraire est intégré en tant qu'application MCP, soumis
Les appels `sendToAgentChat()` sont transférés vers le chat hôte lorsque cela est pris en charge ; voir
[Client](/docs/client#sendtoagentchat) pour le comportement du pont de l'application MCP.

Si vous souhaitez un état de chargement, utilisez le hook `useSendToAgentChat()` : il renvoie à la fois `send` et `isGenerating` :

```ts
import { useSendToAgentChat } from "@agent-native/core/client";

const { send, isGenerating } = useSendToAgentChat();
```

## Lorsque la barre latérale d'origine ne convient pas {#custom-chat-ui}

`<AgentSidebar>` et `<AgentPanel>` couvrent la plupart des applications. Quand vous devez posséder le
disposition autour de l'agent, ou vous souhaitez alimenter la conversation avec un agent
vous avez construit ailleurs, déposez une couche — mais continuez à laisser le framework s'approprier
État d'exécution, actions et SQL :

- **Possédez Chrome autour du runtime standard.** Utilisez `<AgentChatSurface>` pour
  une route de chat dédiée, ou `<AssistantChat>` lorsque vous souhaitez des en-têtes personnalisés,
  onglets et états vides autour de la conversation standard. La carte en couches complète —
  chaque composant, hook, compositeur et adaptateur, avec les chemins d'importation, réside dans
  [Component API](/docs/components#agent-chat-ui).
- **Apportez votre propre environnement d'exécution d'agent.** Si un agent que vous avez créé ailleurs le devrait
  alimentez la conversation pendant que Agent-Native conserve le compositeur, la transcription et l'outil
  cartes, approbations et widgets natifs, transmettez un `AgentChatRuntime` à
  `<AssistantChat runtime={...} />`. Les connecteurs
  (`createHttpAgentChatRuntime()` et le OpenAI / Claude / Vercel AI / AG-UI
  aides) et le contrat d'événement sont documentés dans
  [Native Interface de chat — BYO agent runtimes](/docs/native-chat-ui#byo-agent-runtimes).

Quelle que soit la couche que vous choisissez, conservez l'état des applications soutenues par actions et SQL comme contrat,
et évitez de publier directement sur `/_agent-native/agent-chat` à partir du produit UI. Si un
l'assistant nommé manque pour une véritable surface personnalisée, ajoutez d'abord cet assistant donc
le code client n'apprend pas un deuxième transport ad hoc.

## Typesafe actions du UI : `useActionMutation()` {#use-action-mutation}

Lorsque le UI doit exécuter la même opération qu'un outil d'agent exécuterait (échelon 3 du [ladder](/docs/what-is-agent-native#rung-three)), utilisez `useActionMutation` :

```tsx
import { useActionMutation } from "@agent-native/core/client";

const { mutate, isPending } = useActionMutation("reply-to-email");

<Button onClick={() => mutate({ emailId, body: "Thanks!" })}>
  Send Reply
</Button>;
```

Les arguments de type sécurisé proviennent du schéma zod de votre `defineAction()`. Voir [Actions](/docs/actions) pour le système d'action complet.

```an-callout
{
  "tone": "decision",
  "body": "**`useActionMutation` vs `sendToAgentChat`.** Run the operation directly with `useActionMutation` when the user clicked a deterministic button (\"Send reply\"). Hand it to `sendToAgentChat` when the work needs the agent's reasoning, tools, or multi-step planning. Never call an inline `llm()` from UI — that is rung 1 of the [ladder](/docs/what-is-agent-native#the-ladder)."
}
```

## Sélection + connaissance du curseur {#selection}

L'agent peut voir ce que l'utilisateur a sélectionné (texte, cellules, diapositives, contacts) via les touches `navigation` et `selection` dans l'état d'application. Le chat vide utilise également ces touches pour proposer des suggestions dynamiques telles que « Résumer cette sélection » ou « Améliorer cette diapositive » lorsque l'écran actuel les rend pertinentes. Si vous souhaitez que Cmd-I (ou similaire) envoie une plage sélectionnée dans le chat en tant que contexte, voir [Context Awareness](/docs/context-awareness).

## Rassembler tout cela {#putting-it-together}

Une configuration sans rendez-vous typique :

```tsx
// app/root.tsx
import {
  AgentSidebar,
  AgentToggleButton,
  sendToAgentChat,
} from "@agent-native/core/client";

export default function Root() {
  return (
    <AgentSidebar suggestions={["Draft a reply", "Summarize selection"]}>
      <Header>
        <AgentToggleButton />
      </Header>

      <Main>
        <YourRoutes />
      </Main>
    </AgentSidebar>
  );
}
```

```tsx
// Anywhere else in the app
<Button
  onClick={() =>
    sendToAgentChat({
      message: "Summarize this thread",
      context: `Thread id: ${threadId}`,
      submit: true,
    })
  }
>
  Summarize
</Button>
```

L'utilisateur voit un bouton de discussion dans l'en-tête, peut l'ouvrir et parler à l'agent. Vos boutons fonctionnent manuellement avec ce même agent au lieu d'exécuter des appels LLM ponctuels.

## Quelle est la prochaine étape

- [**Actions**](/docs/actions) — `defineAction()` et `useActionMutation()`
- [**Context Awareness**](/docs/context-awareness) — sélection, navigation, écran d'affichage
- [**Workspace**](/docs/workspace) : ce que contient l'onglet Espace de travail (skills, mémoire, serveurs MCP, tâches planifiées)
- [**Voice Input**](/docs/voice-input) — le microphone dans l'éditeur de chat
