---
title: "Conscience du contexte"
description: "Comment l'agent sait ce que l'utilisateur regarde : état de navigation, contexte de sélection, écran d'affichage, transferts sendToAgentChat, commandes de navigation et prévention de l'instabilité."
---

# Conscience du contexte

> **Page développeur.** Cette page est destinée aux développeurs câblant la couche contextuelle de l'application. Pour l'expérience de l'utilisateur final (comment l'agent utilise ce contexte dans une conversation), voir [Using Your Agent](/docs/using-your-agent).

Comment l'agent sait ce que l'utilisateur regarde – et comment l'agent peut contrôler ce que l'utilisateur voit.

## Vue d'ensemble {#overview}

Sans connaissance du contexte, l'agent est aveugle. Il demande « quel email ? » lorsque l'utilisateur en regarde un. Il ne peut pas agir sur la sélection actuelle, ne peut pas fournir de suggestions pertinentes et ne peut pas modifier ce que voit l'utilisateur. Grâce à la connaissance du contexte, l'utilisateur peut cliquer sur une ligne, mettre en surbrillance un paragraphe, sélectionner un élément de diapositive ou appuyer sur Cmd+I, puis dire « résumer ceci » et l'agent sait déjà ce que « ceci » signifie.

Pour comprendre quoi mettre sur quelle surface (AGENTS.md contre skills contre application_state), voir [Writing Agent Instructions — The four surfaces the agent sees](/docs/writing-agent-instructions#four-surfaces).

Six modèles résolvent ce problème :

1. **État de navigation** - le UI écrit une clé `navigation` dans l'état de l'application à chaque changement d'itinéraire
2. **URL actuel** - le framework écrit `__url__` afin que les paramètres de requête soient visibles et modifiables par l'agent
3. **État de sélection** - le UI écrit une clé `selection` lorsque l'utilisateur se concentre, sélectionne ou sélectionne plusieurs fois quelque chose de significatif
4. **`view-screen`** - une action qui lit l'état de l'application, récupère les données contextuelles et renvoie un instantané de ce que voit l'utilisateur
5. **Transfert rapide** : les contrôles UI appellent `sendToAgentChat()` lorsqu'un clic doit devenir le tour de l'agent
6. **`navigate`** -- une commande unique de l'agent qui indique au UI où aller

```an-diagram title="Comment l'agent voit ce que vous voyez" summary="L'interface utilisateur écrit des clés d'état légères ; l'écran de visualisation les hydrate en enregistrements réels ; l'agent peut écrire, revenir en arrière pour déplacer l'interface utilisateur."
{
  "html": "<div class=\"diagram-ctx\"><div class=\"diagram-card col\"><span class=\"diagram-pill\">L’UI écrit</span><div class=\"diagram-node\">navigation<br><small class=\"diagram-muted\">vue, IDs ouverts</small></div><div class=\"diagram-node\">__url__<br><small class=\"diagram-muted\">shareable filters</small></div><div class=\"diagram-node\">selection<br><small class=\"diagram-muted\">lignes, blocs, formes</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">view-screen</span><small class=\"diagram-muted\">reads state &middot; fetches records</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">L’agent agit<br><small class=\"diagram-muted\">on the real object</small></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-box diagram-accent\">navigate<br><small class=\"diagram-muted\">l’agent déplace l’UI</small></div></div>",
  "css": ".diagram-ctx{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-ctx .col{display:flex;flex-direction:column;gap:8px;padding:14px}.diagram-ctx .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px}.diagram-ctx .diagram-arrow{font-size:22px;line-height:1}"
}
```

## Couches de contexte {#context-layers}

Utilisez différents canaux contextuels pour différentes tâches :

| Couche                                                  | Propriétaire      | Utilisez-le pour                                                                                           |
| ------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| Clé d'état de l'application `navigation`                | UI                | État de la route sémantique : vue actuelle, enregistrement ouvert, onglet actif, identifiants stables      |
| Clé d'état de l'application `__url__`                   | Cadre UI          | Chemin d'accès actuel, chaîne de recherche, hachage et paramètres de requête URL analysés                  |
| Clé d'état de l'application `__set_url__`               | Agent/framework   | Modifications ponctuelles de URL à partir de `set-search-params` et `set-url-path`                         |
| Clé d'état de l'application `selection`                 | UI                | Sélection sémantique durable : lignes, blocs, formes, ressources, messages                                 |
| Clé d'état de l'application `pending-selection-context` | UI / `AgentPanel` | Texte sélectionné en une seule fois attaché au prochain tour de discussion, généralement à partir de Cmd+I |
| Action `view-screen`                                    | Agent             | Hydratation des clés d'état de l'application dans des enregistrements réels et des résumés d'écran         |
| `sendToAgentChat()`                                     | UI                | Transformer un clic, une commande, une épingle de commentaire ou un élément sélectionné en invite de chat  |
| Clé d'état de l'application `navigate`                  | Agent             | Demander au UI de se déplacer vers un autre itinéraire ou de focaliser un autre objet                      |

La version courte : les paramètres de requête URL sont la source de vérité pour les filtres partageables, `navigation` stocke les identifiants sémantiques et les noms de vue, `view-screen` transforme ces couches d'état en données utiles et `sendToAgentChat()` transforme l'intention UI en message de discussion lorsque l'utilisateur clique sur une commande.

## État de navigation {#navigation-state}

Le UI écrit une clé `navigation` dans l'état de l'application à chaque changement d'itinéraire. Cela indique à l'agent sur quelle vue se trouve l'utilisateur, quel élément est ouvert et quel état sémantique UI est important.

```json
{
  "view": "inbox",
  "threadId": "thread-123",
  "focusedEmailId": "msg-456",
  "label": "important"
}
```

Ce qu'il faut inclure dans l'état de navigation :

- `view` – la page/section actuelle, telle que "boîte de réception", "générateur de formulaires" ou "tableau de bord"
- ID d'élément : l'élément sélectionné/ouvert, tel que `threadId` ou `formId`
- Alias sémantiques : onglet actif, nom d'étiquette ou autres concepts d'application stables qui aident l'agent à raisonner
- État de mise au point claire – ligne ciblée, onglet actif, panneau actuel

Gardez `navigation` petit et sémantique. Il doit identifier l'écran actuel, et non dupliquer des enregistrements entiers ou refléter chaque paramètre de requête. Récupérez les enregistrements dans `view-screen` afin que l'agent reçoive toujours des données récentes.

L'agent lit ceci avant d'agir :

```ts
import { readAppState } from "@agent-native/core/application-state";

const navigation = await readAppState("navigation");
// { view: "inbox", threadId: "thread-123", label: "important" }
```

## URL et filtres actuels {#current-url}

`AgentPanel` synchronise automatiquement le routeur React actuel URL avec la clé d'état de l'application `__url__`. L'agent intégré l'inclut à chaque tour sous forme de bloc `<current-url>` :

```text
<current-url>
pathname: /adhoc/revenue
search: ?f_region=west&q=renewal
searchParams:
  f_region: west
  q: renewal
</current-url>
```

Il s'agit de la couche canonique pour l'état du filtre partageable. Si l'utilisateur peut copier un URL et revenir à la même liste filtrée, le filtre appartient à la chaîne de requête. L'agent peut modifier ces filtres avec l'outil `set-search-params` intégré :

```text
set-search-params({ "params": { "f_region": "east", "q": null } })
```

Utilisez `navigation` uniquement pour les alias sémantiques qui aident `view-screen` à récupérer ou à résumer les bonnes données. Un tableau de bord peut conserver `navigation.dashboardId` tandis que `__url__.searchParams` possède `f_region`, `f_dateStart` et `q`.

Lorsque `view-screen` renvoie un instantané plus riche, il peut copier les filtres URL importants dans un objet `activeFilters` convivial :

```ts
const url = (await readAppState("__url__")) as {
  searchParams?: Record<string, string>;
} | null;

if (url?.searchParams) {
  screen.activeFilters = Object.fromEntries(
    Object.entries(url.searchParams).filter(
      ([key, value]) => key.startsWith("f_") && value,
    ),
  );
}
```

## État de sélection {#selection-state}

La sélection est l'état sémantique UI. C'est ainsi que « le graphique sur lequel j'ai cliqué », « ces trois lignes », « le titre de cette diapositive » ou « la plage actuelle du brouillon de l'e-mail » deviennent un contexte visible par le modèle.

Utilisez la clé d'état de l'application `selection` pour une sélection durable qui devrait survivre à un moment de navigation, à des suggestions de discussion vide ou à un appel `view-screen` ultérieur :

```json
{
  "kind": "slide.elements",
  "deckId": "deck-123",
  "slideId": "slide-4",
  "items": [
    {
      "id": "hero-title",
      "selector": "[data-block-id='hero-title']",
      "label": "Hero title",
      "text": "Lancement T3 plan"
    }
  ],
  "capturedAt": 1780332977027
}
```

Écrivez-le à partir du UI lorsque l'utilisateur sélectionne, concentre ou sélectionne plusieurs objets significatifs :

```tsx
import { setClientAppState } from "@agent-native/core/client";

async function syncSelection(selection: unknown | null) {
  await setClientAppState("selection", selection, { keepalive: true });
}
```

L'état de bonne sélection inclut :

- ID stables que l'agent peut utiliser dans actions, tels que `threadId`, `slideId` ou `assetId`
- Une courte étiquette humaine pour que les invites et les suggestions soient lisibles
- Assez de texte ou de métadonnées pour lever l'ambiguïté de l'objet
- Localisateurs UI facultatifs tels que des sélecteurs ou des coordonnées lorsque l'agent doit se référer à un élément visuel
- `capturedAt` lorsqu'une sélection obsolète serait nuisible

Évitez de stocker des secrets, des documents complets, des charges utiles binaires volumineuses ou des réponses API entières dans `selection`. Stockez les identifiants ainsi que de courts extraits, puis laissez `view-screen` récupérer la source de vérité actuelle.

### Texte sélectionné en une seule fois {#pending-selection-context}

`AgentPanel` gère déjà le flux commun de sélection de texte. Lorsque l'utilisateur appuie sur Cmd+I (ou Ctrl+I) avec le texte sélectionné sur la page, il :

1. Lit `window.getSelection()`
2. Écrit `{ text, capturedAt }` dans `pending-selection-context`
3. Cible le chat de l'agent

L'agent de production injecte cette clé dans le tour suivant comme contexte de sélection immédiate et l'ignore une fois qu'elle est périmée. C'est le chemin qui permet de "sélectionner le texte, appuyer sur Cmd+I, demander 'rendre cela plus percutant'" sans que l'utilisateur copie la sélection dans l'invite.

Les éditeurs personnalisés peuvent écrire la même clé lorsque leur sélection n'est pas représentée par la sélection native du navigateur :

```tsx
import { setClientAppState } from "@agent-native/core/client";

await setClientAppState(
  "pending-selection-context",
  {
    text: selectedMarkdown,
    capturedAt: Date.now(),
  },
  { keepalive: true },
);
```

Utilisez `pending-selection-context` pour des flux ponctuels « agir sur ce texte exact en surbrillance ». Utilisez `selection` pour une sélection d'objets durables que `view-screen` et les suggestions dynamiques devraient continuer à voir.

## L'action d'affichage sur l'écran {#view-screen-action}

Chaque modèle doit avoir une action `view-screen`. Il lit l'état de navigation et de sélection, récupère les données pertinentes et renvoie un instantané de ce que voit l'utilisateur. Ce sont les yeux de l'agent.

```an-annotated-code title="écran de visualisation : les yeux de l'agent"
{
  "filename": "actions/view-screen.ts",
  "language": "ts",
  "code": "import { defineAction } from \"@agent-native/core/action\";\nimport { readAppState } from \"@agent-native/core/application-state\";\nimport { eq, inArray } from \"drizzle-orm\";\nimport { z } from \"zod\";\nimport { getDb, schema } from \"../server/db/index.js\";\n\nexport default defineAction({\n  description:\n    \"See what the user is currently looking at on screen.\",\n  schema: z.object({}),\n  http: false,\n  run: async () => {\n    const navigation = (await readAppState(\"navigation\")) as any;\n    const selection = (await readAppState(\"selection\")) as any;\n    const screen: Record<string, unknown> = {};\n    if (navigation) screen.navigation = navigation;\n    if (selection) screen.selection = selection;\n\n    const db = getDb();\n\n    // Fetch data based on what the user is viewing\n    if (navigation?.view === \"inbox\") {\n      screen.emailList = await db\n        .select()\n        .from(schema.emails)\n        .where(eq(schema.emails.label, navigation.label));\n    }\n    if (navigation?.threadId) {\n      screen.thread = await db\n        .select()\n        .from(schema.threads)\n        .where(eq(schema.threads.id, navigation.threadId));\n    }\n    if (selection?.kind === \"email.messages\") {\n      screen.selectedMessages = await db\n        .select()\n        .from(schema.emails)\n        .where(inArray(schema.emails.id, selection.messageIds));\n    }\n\n    if (Object.keys(screen).length === 0) {\n      return \"No application state found. Is the app running?\";\n    }\n    return screen;\n  },\n});",
  "annotations": [
    { "lines": "10-11", "label": "Surface de l'outil", "note": "L'agent lit cette description pour savoir qu'il peut appeler `view-screen` pour voir l'interface utilisateur actuelle." },
    { "lines": "13", "label": "http: false", "note": "Action interne – non exposée sur HTTP. L'agent et `pnpm action` l'appellent, pas le navigateur." },
    { "lines": "15-16", "label": "Lire l'état", "note": "Extrait les touches légères `navigation` et `selection` écrites par l'interface utilisateur." },
    { "lines": "23-37", "label": "Hydratation", "note": "Transforme ces IDs en enregistrements **frais** directement à partir de `application_state`, afin que l'agent vérifie l'objet actif avant d'agir." }
  ]
}
```

L'agent doit appeler `pnpm action view-screen` avant d'agir sur le UI actuel. Il s’agit d’une convention stricte dans tous les modèles. Lors de l'ajout de nouvelles fonctionnalités, mettez à jour `view-screen` pour renvoyer les données de la nouvelle vue et de toute nouvelle forme de sélection.

```an-callout
{
  "tone": "info",
  "body": "**Gardez `navigation` et `selection` petits.** Stockez IDs ainsi que des étiquettes courtes, pas des disques entiers. `view-screen` récupère la source de vérité à la demande, de sorte qu'un état obsolète ou volumineux n'atteigne jamais l'agent."
}
```

## Transfert rapide avec `sendToAgentChat()` {#send-to-agent-chat}

Parfois, le contexte ne doit pas simplement rester dans l'état de l'application. Un utilisateur clique sur un bouton, dépose une épingle de commentaire, sélectionne un élément et choisit « Demander à l'agent » ou appuie sur une commande AI dans une barre d'outils. Ce clic est une instruction. Dans le navigateur UI, remettez-le à l'agent avec `sendToAgentChat()`.

```tsx
import { sendToAgentChat } from "@agent-native/core/client";

function askAgentAboutSelection(selection: {
  documentId: string;
  blockId: string;
  label: string;
  text: string;
}) {
  sendToAgentChat({
    message: `Improve the selected block: ${selection.label}`,
    context: [
      `Document id: ${selection.documentId}`,
      `Block id: ${selection.blockId}`,
      "Current selected text:",
      selection.text,
    ].join("\n"),
    submit: false,
    openSidebar: true,
  });
}
```

Utilisez les champs délibérément :

| Champ               | Signification                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `message`           | Texte d'invite visible affiché dans le chat                                                                           |
| `context`           | Contexte masqué visible par le modèle, non affiché sous forme de texte de discussion destiné à l'utilisateur          |
| `submit: true`      | Envoyer immédiatement ; bon pour les boutons de commande explicites tels que "Corriger la mise en page"               |
| `submit: false`     | Préremplir pour examen par l'utilisateur ; idéal pour "Demander à l'agent à ce sujet" ou pour les sélections ambiguës |
| `openSidebar: true` | Rendre la réponse de l'agent visible même si le panneau a été réduit                                                  |
| `newTab: true`      | Démarrez un fil de discussion distinct pour une tâche de création plus importante                                     |
| `type: "code"`      | Itinéraire vers le cadre d'édition de code lorsque la requête concerne la modification de la source de l'application  |

`sendToAgentChat()` est le wrapper de navigateur pris en charge pour le chemin de discussion soumis, parfois vu en interne sous le nom de `agentNative.submitChat`. L'application UI doit appeler le wrapper au lieu de publier directement `agentNative.submitChat`, car le wrapper gère les barres latérales locales, le routage Builder/Frame, le routage de l'hôte de l'application MCP, les ID d'onglet et le routage des demandes de code.

Utilisez `agentChat.submit()` ou `agentChat.prefill()` pour les contextes de nœud/script où il n'y a pas de barre latérale de navigateur. Le serveur actions ne doit généralement pas appeler `sendToAgentChat()` uniquement par navigateur ; si une action nécessite que le UI ouvert demande quelque chose à l'agent, écrivez une petite requête dans `application_state` et laissez un pont UI l'envoyer depuis le navigateur.

### Éléments cliqués dans l'invite {#clicked-items-in-prompt}

Pour l'expérience « Cliquez sur les éléments dans le UI et ils deviennent partie intégrante de l'invite », combinez l'état de sélection avec le transfert de l'invite :

1. En cliquant ou en sélectionnant plusieurs fois, écrivez l'état sémantique `selection` afin que `view-screen`, les suggestions dynamiques et les tours futurs puissent le voir.
2. Si le clic est également une commande, appelez `sendToAgentChat()` avec un `message` visible concis et un `context` caché plus riche.
3. Dans `view-screen`, hydratez les ID sélectionnés dans les enregistrements actuels afin que l'agent puisse vérifier l'objet avant de le muter.
4. Effacer `selection` lorsque l'objet n'est plus sélectionné, supprimé ou n'est plus pertinent.

Cela donne à l'utilisateur le comportement magique « c'est ce que je voulais dire » sans remplir chaque invite avec un contexte visible volumineux.

## L'action de navigation {#navigate-action}

`navigate` est l’image miroir de `navigation`. Où `navigation` est le UI indiquant à l'agent où se trouve l'utilisateur, `navigate` est l'agent indiquant au UI où aller. L'agent écrit une commande `navigate` unique dans l'état de l'application ; le UI le lit, effectue la navigation, puis supprime l'entrée.

```ts
// Agent side -- write a navigate command
import { writeAppState } from "@agent-native/core/application-state";

await writeAppState("navigate", { view: "inbox", threadId: "thread-123" });
```

Du côté du UI, vous n'interrogez ou ne supprimez jamais cette clé à la main. Les deux directions -- écrire `navigation` à chaque changement d'itinéraire et consommer la commande `navigate` de l'agent -- sont gérées par un seul hook, [`useNavigationState`](#use-navigation-state), abordé dans la section suivante.

La clé `navigation` appartient au UI ; l'agent ne doit jamais lui écrire directement. L'agent écrit `navigate`, le UI effectue le déplacement, et ce déplacement met à jour `navigation`.

Lorsque la destination a un vrai URL, incluez un `path` de même origine sur le
Commandez `navigate` et demandez au UI de préférer ce chemin avant de revenir à
champs sémantiques. Gardez la navigation dans les applications sur un seul canal : n'écrivez pas les deux
`navigate` et `__set_url__` pour le même coup. `__set_url__` est pour le
outils framework URL (`set-url-path`, `set-search-params`) et filtre URL uniquement
changements. Pour les commandes qui peuvent arriver pendant la diffusion du chat, validez la route
avec `navigate(path, { replace: true, flushSync: true })` au lieu de l'envelopper
dans une transition de vue afin que la barre d'adresse et la page visible restent ensemble.

## Le hook useNavigationState {#use-navigation-state}

`useNavigationState` est **le crochet de votre application, pas une importation de framework.** Chaque modèle en est livré un sur `app/hooks/use-navigation-state.ts` et l'appelle une fois depuis le shell de l'application (`root.tsx`). C'est le lieu unique qui relie la navigation dans les deux sens :

- **Sortant (UI → agent) :** écrit la clé `navigation` chaque fois que l'itinéraire change, afin que l'agent connaisse toujours la vue actuelle.
- **Entrant (agent → UI) :** interroge la commande `navigate`, exécute la navigation et supprime la commande.

Il reste court car il s'agit d'une fine enveloppe autour de la véritable primitive de framework, `useAgentRouteState` (exportée depuis `@agent-native/core/client`). Vous fournissez deux fonctions spécifiques à l'application et le framework fait le reste :

```tsx
// app/hooks/use-navigation-state.ts -- this file lives in YOUR app
import { useAgentRouteState } from "@agent-native/core/client";
import { TAB_ID } from "@/lib/tab-id";

interface NavigationState {
  view: "inbox" | "thread";
  threadId?: string;
  path?: string;
}

export function useNavigationState() {
  useAgentRouteState<NavigationState>({
    browserTabId: TAB_ID,
    requestSource: TAB_ID,

    // UI → agent: derive semantic state from the current URL.
    getNavigationState: ({ pathname }) => {
      const match = pathname.match(/^\/thread\/([^/]+)/);
      return match ? { view: "thread", threadId: match[1] } : { view: "inbox" };
    },

    // agent → UI: turn a `navigate` command into a route to push.
    getCommandPath: (command) =>
      command.path ??
      (command.view === "thread" && command.threadId
        ? `/thread/${command.threadId}`
        : "/"),
    navigateOptions: { replace: true, flushSync: true },
  });
}
```

| Vous écrivez                                                      | Le framework gère                                                                                                                      |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `getNavigationState` — mappe le URL à l'état sémantique           | `navigation` écrit, au niveau des tabulations plus une clé de secours globale                                                          |
| `getCommandPath` — mapper une commande `navigate` à un itinéraire | interrogation des commandes, suppression après lecture, protection contre les commandes en double, marquage de la source de la requête |

`useAgentRouteState` suppose le routeur React. Lorsque la navigation ne réside pas dans le URL -- une étape de l'assistant, une sélection de canevas, un shell non-routeur -- descendez plutôt vers le niveau inférieur `useSemanticNavigationState` : vous lui donnez une valeur `state` prête à l'emploi plus `navigationKeys`/`commandKeys` et un rappel `onCommand`, et il reste complètement agnostique à propos du routeur React.

## Prévention de la gigue {#jitter-prevention}

Lorsque l'agent écrit dans l'état de l'application, le système de synchronisation peut amener le UI à récupérer les données qu'il vient d'écrire. Cela crée de la gigue. La solution est le balisage source :

Utilisez `setClientAppState`, `writeClientAppState`, `readClientAppState` et `deleteClientAppState` à partir de `@agent-native/core/client` pour l'accès à l'état de l'application côté navigateur. Passez `{ requestSource: TAB_ID }` sur les écritures UI lors de l'appairage avec `useDbSync({ ignoreSource: TAB_ID })` ; transmettez `{ keepalive: true }` pour les écritures de courte durée telles que le nettoyage de la sélection pendant le déchargement.

```ts
// app/root.tsx
import { TAB_ID } from "@/lib/tab-id";

useDbSync({
  queryClient,
  ignoreSource: TAB_ID, // ignore events from this tab's own writes
});
```

Comment ça marche :

- Les écritures de l'agent sont étiquetées avec `requestSource: "agent"` (les assistants d'action le font automatiquement)
- Les écritures UI incluent l'ID unique de l'onglet via l'en-tête `X-Request-Source`
- Le serveur stocke la source sur chaque événement
- Lors du traitement des événements de synchronisation, le UI filtre les événements correspondant à sa propre valeur `ignoreSource` ; il ne récupère donc pas les données qu'il vient d'écrire
- Les événements des agents, des autres onglets et de actions arrivent toujours normalement

```an-diagram title="Le marquage de la source arrête la gigue de la récupération automatique" summary="Un onglet ignore les événements de synchronisation marqués de son propre TAB_ID, mais réagit toujours aux écritures de l'agent et des autres onglets."
{
  "html": "<div class=\"diagram-jitter\"><div class=\"diagram-node\">Cet onglet écrit<br><small class=\"diagram-muted\">X-Request-Source: TAB_ID</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Le serveur stocke la source<br>on the event</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card col\"><div class=\"diagram-pill warn\">source == TAB_ID &rarr; ignored</div><small class=\"diagram-muted\">pas de refetch, pas de scintillement</small><div class=\"diagram-pill ok\">agent / other tab &rarr; applied</div><small class=\"diagram-muted\">L’UI se met à jour en direct</small></div></div>",
  "css": ".diagram-jitter{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-jitter .col{display:flex;flex-direction:column;gap:6px;padding:14px}.diagram-jitter .diagram-arrow{font-size:22px;line-height:1}"
}
```
