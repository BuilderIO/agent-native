---
title: "Cadres"
description: "Le cadre de développement local, le panneau d'agent intégré et le cadre cloud : la manière dont un agent IA s'exécute aux côtés de votre application."
---

# Cadres

Chaque application native d'agent s'exécute avec un agent IA à côté de l'application UI. Un **cadre** est
le wrapper qui héberge les deux : il affiche votre application et donne à l'agent un emplacement pour
discutez, exécutez et (en développement) modifiez le code. Il existe trois frames partageant un même environnement d'exécution :

- **Panneau d'agent intégré** : livré dans chaque application de `@agent-native/core`.
  Il s'agit de la barre latérale que votre application affiche elle-même, en développement et en production.
- **Cadre de développement local** : un wrapper léger qui charge votre application en cours d'exécution dans une iframe
  et ajoute le même panneau d'agent plus un terminal CLI intégré à côté. Utilisé
  pour le développement local de modèles dans ce dépôt.
- **Cadre cloud Builder.io** : un cadre géré et hébergé avec collaboration,
  édition visuelle et exécutions d'agents parallèles.

Le code de votre application est identique quel que soit le cadre qui l'héberge. L'agent parle
à votre application via le même actions et le même état d'application dans tous les cas.

```an-diagram title="Trois frames, un runtime" summary="Votre application et le panneau d'agent sont les mêmes dans chaque cadre ; seul l'emballage qui les entoure change."
{
  "html": "<div class=\"diagram-frames\"><div class=\"diagram-card\" data-rough><span class=\"diagram-pill accent\">Panneau intégré</span><small class=\"diagram-muted\">fourni dans chaque app · dev + prod</small></div><div class=\"diagram-card\" data-rough><span class=\"diagram-pill\">Frame de dev local</span><small class=\"diagram-muted\">app dans une iframe + panneau + terminal CLI</small></div><div class=\"diagram-card\" data-rough><span class=\"diagram-pill\">Frame cloud Builder.io</span><small class=\"diagram-muted\">hébergé : collaboration · édition visuelle · exécutions parallèles</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>Même runtime<br><small class=\"diagram-muted\">votre app · actions · état applicatif</small></div></div>",
  "css": ".diagram-frames{display:flex;flex-direction:column;gap:10px;align-items:stretch}.diagram-frames .diagram-card{display:flex;flex-direction:column;gap:4px;padding:12px 16px}.diagram-frames .diagram-arrow{font-size:22px;line-height:1;align-self:center}"
}
```

## Panneau d'agent intégré {#embedded-agent}

Le panneau intégré est la barre latérale de l'agent affichée par votre application. Il est livré avec
`@agent-native/core` — il n'y a pas de package distinct à installer — et c'est le même
composant en développement et en production.

- Exporté en tant que `AgentPanel` depuis `@agent-native/core/client`, avec un
  variante de production uniquement `ProductionAgentPanel`.
- Fournit la surface Chat / CLI / Workspace complète, de sorte que l'entrée de l'agent reste activée
  la pile de composition partagée utilisée partout ailleurs dans le framework.
- Lit `application_state.navigation` à chaque tour, donc il sait déjà lequel
  vue dans laquelle vous vous trouvez et ce qui est sélectionné – vous n'avez pas besoin de réexpliquer "ceci".

### Modes des outils Application et Code {#tool-modes}

Le panneau s'exécute dans l'un des deux modes d'outil :

- **Mode application** — l'agent ne dispose que des outils propres à votre application : le actions vous
  défini avec `defineAction`, plus navigation et contexte. Pas de système de fichiers ou
  accès au shell. C'est ce qu'obtiennent les utilisateurs finaux.
- **Mode Code** : ajoute les outils de codage partagés (`bash`, `read`, `edit`, `write`)
  et accès à la base de données en plus des outils de l'application, afin que l'agent puisse modifier l'application
  propre source. Les demandes de code sont fermées : lorsqu'un message nécessite du code
  (`type: "code"`) et aucun cadre compatible avec le code n'est connecté, le panneau affiche un
  boîte de dialogue expliquant que les modifications de code nécessitent Agent Native Desktop ou Builder ;
  Lorsqu'une trame est connectée, la requête est acheminée vers elle et un agent de code
  l'indicateur s'affiche pendant qu'il fonctionne (`useSendToAgentChat`). Pour le canonique
  liste des outils de codage et contrats UI partagés, voir
  [Agent-Native Code UI](/docs/code-agents-ui).

```an-diagram title="Contrôle de demande de code" summary="Un message codé nécessite une trame compatible avec le code. Avec un connecté, la requête y est acheminée ; sans cela, le panneau explique que les modifications de code nécessitent Desktop ou Builder."
{
  "html": "<div class=\"diagram-gate\"><div class=\"diagram-node\" data-rough>message<br><small class=\"diagram-muted\">type: \\\"code\\\"</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough>code-capable frame connected?</div><div class=\"diagram-col\"><div class=\"diagram-pill ok\">yes &rarr; route to frame, show code-agent indicator</div><div class=\"diagram-pill warn\">no &rarr; dialog: needs Desktop or Builder</div></div></div>",
  "css": ".diagram-gate{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-gate .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-gate .diagram-arrow{font-size:22px;line-height:1}.diagram-gate .center{text-align:center}"
}
```

Le « mode Code » est la bascule de capacité de l'agent, distincte du mode développement de l'environnement
(`NODE_ENV` / Vite). Le hook client est `useCodeMode()`. (Voir
[Compatibility notes](#compatibility) pour les alias de rétrocompatibilité.)

Dans le cadre de développement local, le rouage des paramètres bascule entre ces modes. Commutation
Le mode Code désactivé masque la propre barre latérale du cadre et affiche l'agent intégré à l'application
barre latérale à l'intérieur de l'iframe, afin que vous puissiez prévisualiser exactement ce que voient les utilisateurs finaux.

## Terminal intégré et commutation CLI {#cli-terminal}

En développement, le panneau comprend un terminal intégré (`AgentTerminal`, également
de `@agent-native/core/client`) soutenu par un serveur PTY. Vous pouvez exécuter un vrai
codage CLI juste à côté de l'application et basculez entre eux ; le terminal redémarre
avec le CLI sélectionné.

Les CLI pris en charge proviennent du registre principal CLI
(`packages/core/src/terminal/cli-registry.ts`). Seules ces commandes sont autorisées
pour apparaître — le serveur PTY valide la commande demandée par rapport au registre
liste blanche pour empêcher l'injection :

| CLI         | Commande   | Installer le package        |
| ----------- | ---------- | --------------------------- |
| Code Claude | `claude`   | `@anthropic-ai/claude-code` |
| Builder.io  | `builder`  | (intégré)                   |
| Codex       | `codex`    | `@openai/codex`             |
| Gémeaux CLI | `gemini`   | `@google/gemini-cli`        |
| OpenCode    | `opencode` | `opencode-ai`               |

Si le CLI sélectionné n'est pas trouvé sur `PATH`, le terminal recommence à l'exécuter
via `npx --yes <install-package>@latest` (là où un package d’installation existe). Le
la commande par défaut est `claude`. Basculez les CLI à partir des paramètres du panneau d'agent à tout moment
heure.

## Cadre nuage Builder.io {#cloud-frame}

[Builder.io](https://www.builder.io) fournit un cadre géré qui héberge le
même application et même panneau d'agent, dans le cloud :

- Collaboration en temps réel : plusieurs utilisateurs peuvent regarder et interagir en même temps.
- Édition visuelle, rôles et autorisations.
- Exécution d'agent en parallèle pour une itération plus rapide.
- Idéal pour une utilisation en équipe, où tout le monde partage un environnement hébergé.

Demandes de code depuis l'itinéraire du panneau intégré vers le cadre Builder de la même manière
ils sont acheminés vers le cadre de développement local, donc le comportement dev-vs-prod ci-dessus est
cohérent dans les deux cas.

## Exécution API {#runtime-apis}

Ceux-ci sont livrés avec `@agent-native/core` et sont ce que votre application utilise pour communiquer avec le
agent, quel que soit le frame qui l'héberge :

1. **Envoyer un message** : `sendToAgentChat()` envoie un message à l'agent. Le
   Le crochet `useSendToAgentChat()` l'enveloppe avec le déclenchement de demande de code décrit
   ci-dessus et renvoie un élément `codeRequiredDialog` à restituer. Voir
   [Drop-in Agent](/docs/drop-in-agent) pour une utilisation complète et des options.
2. **État de génération** — `useAgentChatGenerating()` suit le moment où l'agent est
   en cours d'exécution, afin que le UI puisse afficher la progression sans interroger directement l'agent.
3. **Synchronisation d'interrogation** : la synchronisation basée sur la base de données maintient les caches UI à jour lorsque l'agent
   modifie les données ou l'état de l'application.
4. **Système d'action** – `pnpm action <name>` est envoyé au même appelable
   actions que l'agent appelle comme outils, donc tout ce que l'agent peut faire, vous pouvez le faire
   script.

## L'exécuter {#running}

Le panneau d'agent intégré fait partie de chaque application : créez un modèle et c'est
déjà là :

```bash
npx @agent-native/core@latest create my-app --template mail --standalone
cd my-app
pnpm dev
```

Le cadre de développement local (le package privé `@agent-native/frame` dans le dépôt du framework) est un package d'outils internes qui n'est pas publié sur npm. Il charge le serveur de développement de l'application active dans une iframe et monte le panneau intégré à côté, en sélectionnant l'application via le paramètre de requête `app`. Le terminal CLI intégré nécessite Agent Native Desktop, qui fournit le code local et l'accès PTY aux besoins du terminal ; sans cela, le panneau affiche la surface de discussion et vous invite à ouvrir le bureau pour utiliser le CLI.

## Remarques de compatibilité {#compatibility}

Le concept de "mode Code" était auparavant nommé "mode dev", donc quelques rétro-compatibilités
les noms persistent. Vous pouvez les ignorer, sauf si vous conservez une intégration plus ancienne
code :

- La variable d'environnement `AGENT_MODE` sous-jacente, la `/_agent-native/agent-chat/mode`
  point de terminaison (dont la clé de charge utile est toujours `devMode`) et `agent-chat.mode`
  la clé des paramètres est inchangée.
- `useDevMode()` reste un alias obsolète pour `useCodeMode()`.
