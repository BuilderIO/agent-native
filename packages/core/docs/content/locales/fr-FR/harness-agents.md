---
title: "Exploiter les agents"
description: "Exécutez Claude Code, Codex, Pi et d'autres harnais de codage complets en tant qu'agents intégrés dans Agent-Native, avec leur propre boucle, sandbox, outils natifs et sessions avec reprise basées sur SQL."
search: "exploiter les agents AgentHarness ai-sdk HarnessAgent Claude Code Codex Pi Cursor Mastra agent de codage intégré solveAgentHarness startAgentHarnessRun outils hôte sandbox de session avec reprise"
---

# Exploiter les agents

> **À qui s'adresse-t-il :** les auteurs d'hôtes câblant un environnement d'exécution de codage complet (code Claude,
> Codex, Pi) dans Agent-Native en tant qu'agent. Créer une application ? Commencez par
> [Creating Templates](/docs/creating-templates).

Un agent de harnais est un environnement d'exécution d'agent complet – Code Claude, Codex, Pi et similaire –
qui possède sa propre boucle, son espace de travail, ses outils de fichiers natifs, son état de session, son compactage,
modèle d'approbation et comportement du bac à sable. Agent-Native les exécute via le
**substrat `AgentHarness`** dans `@agent-native/core/agent/harness`, diffuse leur
événements dans la transcription normale et conserve leur session native donc un fil de discussion
peut mettre en pause et reprendre.

Ceci est différent de l'agent de chat intégré et de l'apport de votre propre chat
exécution. L'agent intégré et `AgentEngine` sont destinés à un modèle aller-retour
sous `runAgentLoop`. Un harnais n'est pas un fournisseur `AgentEngine` : il exécute son
propre boucle de bout en bout, donc Agent-Native la pilote comme une session, pas comme une seule
appel de modèle.

```an-diagram title="Un harnais possède sa boucle ; Agent-Native pilote la session" summary="L'AgentHarness substrat creates/resumes la session native, diffuse ses événements dans la transcription normale et conserve l'état de reprise dans SQL entre les tours."
{
  "html": "<div class=\"diagram-harness\"><div class=\"diagram-box\" data-rough><strong>AgentHarness substrate</strong><small class=\"diagram-muted\">@agent-native/core/agent/harness</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><strong>Native harness loop</strong><small class=\"diagram-muted\">Claude Code · Codex · Pi — own tools, sandbox, compaction</small></div><div class=\"diagram-col\"><div class=\"diagram-pill accent\">events &rarr; transcript</div><div class=\"diagram-pill ok\">resumeState &rarr; SQL session</div></div></div>",
  "css": ".diagram-harness{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-harness .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-harness .diagram-arrow{font-size:22px;line-height:1}.diagram-harness .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## Quel document de codage dois-je souhaiter ? {#which-doc}

| Vous voulez…                                                                             | Utiliser                                     |
| ---------------------------------------------------------------------------------------- | -------------------------------------------- |
| Exécutez Claude Code / Codex / Pi **en tant qu'agent**, avec leur propre boucle + outils | **Exploiter les agents** (cette page)        |
| Afficher un **espace de travail de codage de style Claude-Code/Codex**                   | [Agent-Native Code UI](/docs/code-agents-ui) |
| Échangez le backend qui exécute l'**outil `run-code`** de l'agent                        | [Adapters](/docs/sandbox-adapters)           |
| Encapsuler un outil CLI (`gh`, `ffmpeg`) pour que l'agent appelle                        | [Adapters](/docs/sandbox-adapters)           |

Surfaces adjacentes : placez un agent que vous avez construit ailleurs derrière le chat de Agent-Native
UI avec [`AgentChatRuntime`](/docs/native-chat-ui#byo-agent-runtimes) ; laissez un
Appel hôte externe MCP dans votre application via [External Agents](/docs/external-agents) ;
apparaître en arrière-plan/sous-agent avec [Custom Agents & Teams](/docs/agent-teams).

## Harnais intégrés {#built-in}

`registerBuiltinAgentHarnesses()` enregistre trois adaptateurs soutenus par l'IA SDK
`HarnessAgent`:

| Nom                          | Exécution   | Bac à sable | Approbations |
| ---------------------------- | ----------- | ----------- | ------------ |
| `ai-sdk-harness:claude-code` | Code Claude | oui         | oui          |
| `ai-sdk-harness:codex`       | Codex       | oui         | non          |
| `ai-sdk-harness:pi`          | Pi          | non         | oui          |

Leurs packages d'exécution sont des **dépendances homologues facultatives** et se chargent paresseusement, donc
une application qui n'utilise jamais de harnais ne paie pas pour cela. Chaque adaptateur porte un
Indice `installPackage` (par exemple `@ai-sdk/harness@canary
@ai-sdk/harness-codex@canary`); `resolveAgentHarness` lance une installation claire
erreur si les packages sont manquants, et `isAgentHarnessPackageInstalled(entry)`
vous permet de vérifier en premier.

`registerBuiltinAgentHarnesses()` enregistre également les harnais [ACP](#acp)
(`acp`, `acp:gemini`, `acp:claude-code`).

## Agents ACP {#acp}

Agent-Native peut agir comme un [ACP](https://agentclientprotocol.com) (Agent Client
Protocole) **client** et piloter un agent de codage local – Gemini CLI, Claude Code,
ou tout agent conforme à la norme ACP — via ce même substrat. L'agent s'exécute en tant que
sous-processus local qui parle JSON-RPC délimité par des nouvelles lignes sur stdio ; Éditeur de ACP
↔ le modèle d'agent a exactement cette forme.

Cet adaptateur est limité au **codage local**. Le processus enfant hérite du
environnement parent, de sorte que l'agent réutilise la connexion locale CLI dont il dispose déjà
(par exemple, authentification `gemini` ou `claude` dans le répertoire personnel de l'utilisateur). Ce n'est pas un
transport hébergé ou en bac à sable, et ce n'est pas un transport chat/A2A — pour ceux-là,
voir [Agent Surfaces](/docs/agent-surfaces).

| Nom               | Commande par défaut                               | Reprise\* |
| ----------------- | ------------------------------------------------- | --------- |
| `acp`             | _(fournir `command`/`args` via la configuration)_ | oui       |
| `acp:gemini`      | `npx -y @google/gemini-cli --experimental-acp`    | oui       |
| `acp:claude-code` | `npx -y @zed-industries/claude-code-acp`          | oui       |

\*La reprise fonctionne lorsque l'agent annonce la fonctionnalité `loadSession` et
se dégrade en une nouvelle session sinon.

```ts
import {
  registerBuiltinAgentHarnesses,
  resolveAgentHarness,
} from "@agent-native/core/agent/harness";

registerBuiltinAgentHarnesses();

// A built-in preset (command/args are overridable through the resolve config):
const adapter = resolveAgentHarness("acp:gemini");

// Or any ACP agent by command:
const custom = resolveAgentHarness("acp", {
  command: "gemini",
  args: ["--experimental-acp"],
});
```

Le transport de protocole (`@zed-industries/agent-client-protocol`) est facultatif
dépendance chargée paresseusement via l'indice `installPackage`, tout comme l'IA SDK
harnais. Le binaire de l'agent lui-même (`@google/gemini-cli`,
`@zed-industries/claude-code-acp`, …) est un CLI externe distinct ; les préréglages
lancez-le via `npx` et la commande/les arguments restent modifiables car l'agent ACP
les drapeaux d'entrée évoluent encore.

`permissionMode` mappe sur ACP `session/request_permission` à l'aide de l'appel d'outil
type de rapport de l'agent : les lectures sont toujours exécutées, les modifications sont exécutées sous `allow-edits` et
tout est risqué sauf si `allow-all`. Les approbations semblent normales
Événements `approval-request`. L'adaptateur sert `fs/read_text_file` et
`fs/write_text_file` contre l'espace de travail de session (refusant les chemins qui s'échappent
it) et écrit des événements `file-change` ; les méthodes de terminal ne sont pas annoncées,
l'agent utilise donc son propre shell.

## Authentification Codex : code UI par rapport aux bacs à sable de harnais {#codex-auth}

Il existe deux surfaces Codex, et elles s'authentifient différemment :

- **Agent-Native Code / Desktop** exécute `codex exec` sur la machine de l'utilisateur. Si
  l'utilisateur a exécuté `codex login`, cette exécution locale réutilise tout ChatGPT
  l'abonnement ou la clé API authentifie les rapports Codex CLI installés via
  `codex login status`.
- **`ai-sdk-harness:codex`** charge `@ai-sdk/harness-codex`, qui pilote Codex
  à l'intérieur du bac à sable du harnais via `@openai/codex-sdk`. Cela ne se fait pas en silence
  hériter de la connexion Desktop `~/.codex` de l'utilisateur, car le bac à sable peut être distant
  ou isolé. Pour les bacs à sable fiables/privés, inscrivez-vous avec `codexCliAuth: true` ;
  Agent-Native copie le fichier d'authentification local Codex CLI dans le bac à sable avant le
  le harnais démarre. Pour les sandbox hébergés ou partagés, configurez la clé/passerelle API
  auth à la place.

Donc, si quelqu'un demande quel paquet contient le chemin Codex OAuth : pour le codage local
sessions, utilisez `@agent-native/core` / Desktop plus celui installé
`@openai/codex` CLI et `codex login`. Pour le `ai-sdk-harness:codex` en bac à sable,
utilisez l'opt-in explicite `codexCliAuth` lors de la copie de cette connexion dans le bac à sable
est acceptable.

```ts
const adapter = resolveAgentHarness("ai-sdk-harness:codex", {
  codexCliAuth: true,
});
```

`codexCliAuth: true` lit `CODEX_HOME/auth.json` ou `~/.codex/auth.json`. À
pointez sur une autre connexion locale, passez
`{ codexCliAuth: { codexHome: "/path/to/.codex" } }` ou
`{ codexCliAuth: { authJsonPath: "/path/to/auth.json" } }`.

## Enregistrer et résoudre {#register-resolve}

```ts
import {
  registerBuiltinAgentHarnesses,
  resolveAgentHarness,
} from "@agent-native/core/agent/harness";

registerBuiltinAgentHarnesses();
const adapter = resolveAgentHarness("ai-sdk-harness:codex");
```

`resolveAgentHarness(name, config?)` renvoie un `AgentHarnessAdapter`. Le
Le `config` facultatif est transmis à l'usine d'adaptateurs – pour les adaptateurs AI SDK
qui correspond à `AiSdkHarnessAdapterOptions` (`label`, `description`,
`permissionMode`, `harnessOptions`, `agentOptions` et Codex uniquement
`codexCliAuth`). Utilisez `listAgentHarnesses()` pour énumérer ce pour quoi vous êtes enregistré
un sélecteur.

## Faire un tour {#run-a-turn}

`startAgentHarnessRun` relie une session de harnais au gestionnaire d'exécution partagé
cycle de vie. Il crée (ou réutilise) la session native, la conserve, diffuse le
tourne, traduit chaque événement de harnais en événements de transcription et détache le
état pouvant être repris une fois le tour terminé.

```ts
import { startAgentHarnessRun } from "@agent-native/core/agent/harness";

const run = startAgentHarnessRun({
  runId,
  threadId,
  adapter,
  input: { prompt },
  createSession: {
    sessionId,
    resumeState, // opaque value from a previous turn, if resuming
    instructions,
    sandbox, // required for sandboxed harnesses — see Sandbox Adapters
    permissionMode: "allow-reads",
    tools, // a narrow, intentional set of host tools (see below)
  },
  ownerEmail,
  orgId,
});
```

`startAgentHarnessRun` renvoie le `ActiveRun` du gestionnaire d'exécution, donc le tour
apparaît dans les itinéraires de course existants, la transcription et l'annulation, tout comme
tout autre agent exécuté. Passer un `session` déjà créé au lieu de `createSession`
pour continuer une session que vous gardez en mémoire.

## Séances et CV {#sessions}

Un harnais possède un état de session natif de longue durée. Agent-Native le conserve dans SQL
afin qu'un thread puisse survivre à travers les tours, les processus et les déploiements. Le `resumeState`
est **opaque** — Agent-Native le stocke et le rend, mais ne l'inspecte jamais ou
l'interprète.

```an-diagram title="Reprendre à travers les tours, les processus et les déploiements" summary="Chaque tour détache un curriculum vitae opaque dans SQL ; le tour suivant le réinjecte dans createSession au lieu de rejouer l'historique des discussions."
{
  "html": "<div class=\"diagram-resume\"><div class=\"diagram-node\" data-rough>Tour N<br><small class=\"diagram-muted\">streamTurn</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>detach &rarr; resumeState<br><small class=\"diagram-muted\">opaque · session de harnais SQL</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\" data-rough>Tour N+1<br><small class=\"diagram-muted\">createSession.resumeState</small></div></div>",
  "css": ".diagram-resume{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-resume .diagram-arrow{font-size:22px;line-height:1}"
}
```

```ts
import {
  getLatestAgentHarnessSessionForThread,
  listAgentHarnessSessions,
} from "@agent-native/core/agent/harness";

const last = await getLatestAgentHarnessSessionForThread(threadId);
// Feed last?.resumeState into createSession.resumeState on the next turn.
```

Le magasin expose également `saveAgentHarnessSession`, `updateAgentHarnessSession`,
`getAgentHarnessSession`, `getAgentHarnessSessionByRunId`,
`markAgentHarnessSessionStopped` et `ensureAgentHarnessSessionTables`.
`startAgentHarnessRun` appelle les chemins de sauvegarde/mise à jour/arrêt pour vous ; atteignez-les
directement uniquement dans un hôte personnalisé.

## Outils d'hébergement et autorisations {#host-tools}

Un harnais apporte ses propres outils natifs (lecture, modification, écriture, shell, etc.), donc
vous ne **pas** réexposer l'édition de fichiers en tant qu'outils hôtes. Passez seulement un **étroit,
ensemble intentionnel** de Agent-Native actions à `createSession.tools` lorsque vous
vous souhaitez que le harnais atteigne des opérations d'application spécifiques et conservez `defineAction`
authentification, contexte de requête, délais d'attente, troncature et métadonnées en lecture seule intacts lorsque
vous le faites.

`permissionMode` contrôle ce que le harnais peut faire sans approbation :

| Mode          | Signification                                                                     |
| ------------- | --------------------------------------------------------------------------------- |
| `allow-reads` | Par défaut. Les lectures sont exécutées ; modifications et invite actions risquée |
| `allow-edits` | Les lectures et les modifications sont exécutées ; autre invite actions risquée   |
| `allow-all`   | Pas de contrôle d'approbation                                                     |

Lorsqu'un harnais s'arrête pour approbation, il émet un événement `approval-request` et le
la session est marquée `idle` avec l'approbation en attente enregistrée, afin que le UI puisse
faites-le surface et reprenez la décision de l'utilisateur. Voir
[Human Approval](/docs/human-approval) pour la surface d'approbation.

## Événements {#events}

Une session de harnais diffuse les valeurs `AgentHarnessEvent`, lesquelles Agent-Native
se traduit en flux `AgentChatEvent` standard avec
`agentHarnessEventToAgentChatEvents`. Le syndicat événementiel couvre `text-delta`,
`thinking-delta`, `activity`, `tool-start`, `tool-done` (pouvant transporter un
Charge utile `mcpApp` pour les widgets natifs), `approval-request`, `file-change`,
`compaction`, `usage`, `error` et `done`. Parce que les résultats des outils transitent par le
même traduction, les widgets natifs déclarés par action sont toujours rendus – voir
[Native Interface de chat](/docs/native-chat-ui).

## Exécutions en arrière-plan et UI {#background-runs}

Harness exécute le projet dans la forme `BackgroundAgentRun` partagée avec
`createAgentHarnessBackgroundAgentController()` et sont disponibles via le
itinéraires d'exécution existants sous le nom `goalId=agent-harness`. Cela signifie un Claude de longue durée
La session Code ou Codex apparaît dans les mêmes surfaces d'exécution en arrière-plan et de transcription
en tant qu'équipes d'agents et autres adaptateurs, avec `listAgentHarnessBackgroundRuns`,
`listAgentHarnessBackgroundTranscriptEvents`, `getAgentHarnessBackgroundRun` et
`stopAgentHarnessBackgroundRun` disponible pour les hôtes personnalisés.

## Adaptateurs personnalisés {#custom-adapters}

Pour encapsuler un runtime qui ne fait pas partie des éléments intégrés, implémentez
`AgentHarnessAdapter` et enregistrez-le. L'adaptateur déclare ses capacités et
crée des sessions ; une session expose `streamTurn` et `continueTurn` en option,
`approve`, `detach`, `stop` et `destroy`.

```ts
import {
  registerAgentHarness,
  type AgentHarnessAdapter,
} from "@agent-native/core/agent/harness";

const myHarness: AgentHarnessAdapter = {
  name: "acme:my-coder",
  label: "Acme Coder",
  description: "Runs the Acme coding agent.",
  installPackage: "@acme/coder",
  capabilities: {
    sandbox: true,
    resumable: true,
    approvals: true,
    hostTools: true,
    fileEvents: true,
  },
  async createSession(opts) {
    // Build your native session and adapt it to AgentHarnessSession.
    return createAcmeSession(opts);
  },
};

registerAgentHarness({
  name: myHarness.name,
  label: myHarness.label,
  description: myHarness.description,
  installPackage: myHarness.installPackage,
  capabilities: myHarness.capabilities,
  create: () => myHarness,
});
```

Gardez le package d'exécution en option avec une importation dynamique dans `createSession` et un
Indice `installPackage`. Pour les faisceaux de codage à pont, nécessitez un véritable
fournisseur sandbox/espace de travail plutôt que d'exécuter un agent de codage arbitraire dans
processus hôte — voir [Sandbox Adapters](/docs/sandbox-adapters). L'adaptateur AI SDK
(`createAiSdkHarnessAdapter`, soutenu par `HarnessAgent` de `@ai-sdk/harness`) est
une seule mise en œuvre de ce contrat, pas l'abstraction publique.

## Ne pas faire {#donts}

- N'ajoutez pas de code Claude, Codex, Cursor, Mastra ou Pi en tant que `AgentEngine`. Ils
  posséder leur boucle ; en exécuter un sous `AgentEngine.stream()` double la boucle
  et perd la sémantique du cycle de vie de la session.
- Ne rejouez pas l'historique complet des discussions de Agent-Native dans un harnais à chaque tour. Reprendre
  la séance harnais avec son `resumeState` à la place.
- Ne stockez pas `resumeState` dans `application_state`. Sa place est dans le harnais
  tableau de session SQL.
- N'exposez pas chaque action de l'application à chaque session d'exploitation par défaut. Donnez-lui un
  petit ensemble d'outils intentionnel.

## Documents associés {#related-docs}

- [Native Interface de chat](/docs/native-chat-ui) : mettez votre propre agent derrière le chat UI avec `AgentChatRuntime`.
- [Agent Surfaces](/docs/agent-surfaces) : choisissez sans tête, chat, side-car ou application complète.
- [Agent-Native Code UI](/docs/code-agents-ui) : la surface de l'espace de travail de codage réutilisable.
- [Custom Agents & Teams](/docs/agent-teams) — exécutions en arrière-plan et délégation de sous-agents.
- [Sandbox Adapters](/docs/sandbox-adapters) – backends d'exécution enfichables pour les faisceaux de codage.
- [Human Approval](/docs/human-approval) : le faisceau de surface d'approbation est utilisé.
