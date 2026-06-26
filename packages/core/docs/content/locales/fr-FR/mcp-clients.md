---
title: "Clients MCP"
description: "Connectez votre application native d'agent aux serveurs MCP locaux (claude-in-chrome, système de fichiers, dramaturge, etc.) afin que l'agent dispose de ses outils."
---

# Clients MCP

**Cette page : donnez plus d'outils à votre agent.** Pointez une application native d'agent vers les serveurs MCP (locaux ou distants) afin que leurs outils s'affichent dans le chat de l'agent. Il s'agit de la direction _client_, l'image miroir de [MCP Protocol](/docs/mcp-protocol) (qui fait de votre application un _serveur_ MCP).

| Si vous voulez…                                                                               | Lire                                     |
| --------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Connectez un agent/hôte externe à votre application                                           | [External Agents](/docs/external-agents) |
| Donnez plus d'outils à votre agent (consommez d'autres serveurs MCP)                          | **Cette page** — Clients MCP             |
| Créez des UI en ligne qui s'affichent dans Claude/ChatGPT                                     | [MCP Apps](/docs/mcp-apps)               |
| Référence du serveur MCP de niveau inférieur (authentification, outils, montage personnalisé) | [MCP Protocol](/docs/mcp-protocol)       |

Avec un seul fichier de configuration, chaque application native d'agent de votre espace de travail a accès aux outils fournis par les serveurs MCP sur votre machine : `claude-in-chrome` pour l'automatisation du navigateur, `@modelcontextprotocol/server-filesystem` pour la lecture de fichiers, `@playwright/mcp` pour les tests du navigateur et tout ce qui parle de MCP.

Vous pouvez également utiliser [connect remote (HTTP) MCP servers at runtime](#remote-via-ui) (utilisateurs individuels ou organisations entières) sans modifier de fichier de configuration.

Chaque source se résout en un seul **gestionnaire MCP** d'exécution, et chaque outil qu'il apprend atterrit dans le registre d'outils de l'agent sous un préfixe `mcp__<server-id>__<tool>` anti-collision — consultable intentionnellement via `tool-search`.

```an-diagram title="Orientation client : plusieurs sources, un seul registre d'outils" summary="Les fichiers de configuration, l'environnement et l'interface utilisateur d'exécution sont tous fusionnés dans le gestionnaire MCP ; ses outils apparaissent préfixés et peuvent être recherchés à côté des actions de votre application. C'est le miroir de la direction serveur."
{
  "html": "<div class=\"mcp-merge\"><div class=\"diagram-col sources\"><div class=\"diagram-box\" data-rough>Workspace <code>mcp.config.json</code><br><small class=\"diagram-muted\">partagé entre apps</small></div><div class=\"diagram-box\" data-rough>Racine app <code>mcp.config.json</code><br><small class=\"diagram-muted\">remplacement par app</small></div><div class=\"diagram-box\" data-rough><code>MCP_SERVERS</code> env<br><small class=\"diagram-muted\">CI / environnement de production</small></div><div class=\"diagram-box\" data-rough>Distant via l’UI des paramètres<br><small class=\"diagram-muted\">personal &amp; org scope</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">Gestionnaire MCP</span><small class=\"diagram-muted\">merge &middot; hot-reload</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col out\"><div class=\"diagram-node\">Outil agent registry<br><small class=\"diagram-muted\"><code>mcp__&lt;server-id&gt;__&lt;tool&gt;</code></small></div><div class=\"diagram-node\"><code>tool-search</code><br><small class=\"diagram-muted\">découvrir par intention</small></div></div></div>",
  "css": ".mcp-merge{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.mcp-merge .diagram-col{display:flex;flex-direction:column;gap:8px}.mcp-merge .center{display:flex;flex-direction:column;align-items:center;gap:4px}.mcp-merge .diagram-arrow{font-size:22px;line-height:1}.mcp-merge code{font-size:.85em}"
}
```

> La direction opposée : faire de _votre_ application un serveur MCP que d'autres hôtes consomment - se trouve dans [MCP Protocol](/docs/mcp-protocol) et [External Agents](/docs/external-agents).

## Navigateur intégré et fonctionnalités d'utilisation de l'ordinateur {#built-in-capabilities}

L'agent natif inclut des options de développement local pour les serveurs standard MCP courants.
Ils sont désactivés par défaut et peuvent être activés par utilisateur ou par organisation uniquement
lorsque l'application s'exécute localement. Ignorer les environnements d'exécution sans serveur de production et hébergés
ces éléments intégrés même si d'anciennes lignes de paramètres existent, ainsi que les ressources de l'espace de travail
l'arborescence ne les affiche pas comme ressources `mcp-servers/*.json` par défaut.

| Capacité                       | ID du serveur     | Commande                                                                |
| ------------------------------ | ----------------- | ----------------------------------------------------------------------- |
| Outils de développement Chrome | `chrome-devtools` | `npx -y chrome-devtools-mcp@latest --autoConnect --no-usage-statistics` |
| Navigateur de dramaturge       | `playwright`      | `npx -y @playwright/mcp@latest`                                         |
| Utilisation de l'ordinateur    | `computer-use`    | `npx -y computer-use-mcp@latest`                                        |

Une seule fonctionnalité de navigateur peut être activée dans une étendue à la fois. L'activation de Chrome DevTools désactive Playwright pour ce même utilisateur ou cette même organisation, et l'activation de Playwright désactive Chrome DevTools.

L'utilisation de l'ordinateur est réservée à macOS uniquement. Sur d'autres plates-formes, il est répertorié comme indisponible et est ignoré même si une ancienne ligne de paramètres le contient.

Chrome DevTools utilise `--autoConnect` par défaut. Cela s'attache à une instance Chrome en cours d'exécution éligible ; il ne crée pas de profil de navigateur isolé et ne se connecte pas au profil habituel de l'utilisateur pour vous. Il nécessite Chrome 144+ avec le débogage à distance activé. Une configuration manuelle `browser-url` peut être ajoutée ultérieurement lorsqu'un déploiement nécessite un point de terminaison de débogage spécifique.

Les éléments intégrés sont conservés dans la table `settings` du framework sous `u:<email>:mcp-builtin-capabilities` pour les bascules personnelles et `o:<orgId>:mcp-builtin-capabilities` pour les bascules d'équipe. Lorsqu'ils sont activés, ils fusionnent dans le gestionnaire d'exécution MCP avec le même format de visibilité étendue que les serveurs distants, par exemple `mcp__user_<emailhash>_playwright__*` ou `mcp__org_<orgId>_chrome-devtools__*`.

### Notes de configuration destinées aux utilisateurs

Utilisez une copie de configuration concise et explicite pour les éléments intégrés sensibles :

- **Chrome DevTools** s'attache à une cible de débogage Chrome en cours d'exécution. Informez les utilisateurs
  il est destiné aux tests du navigateur et à la vérification de la connexion, et il
  peut nécessiter l'activation du débogage à distance de Chrome avant que les outils n'apparaissent.
- **Playwright** lance un navigateur isolé. Recommandez-le pour les déterministes
  Contrôle qualité lorsque le profil Chrome actif de l'utilisateur n'est pas requis.
- **Utilisation de l'ordinateur** peut faire fonctionner des applications locales. Gardez-le désactivé par défaut, expliquez le
  Invites d'enregistrement d'écran et d'accessibilité macOS, et demande avant de prendre
  actions sensibles, tels que les achats, les modifications financières ou les modifications de compte.

### Points de terminaison intégrés

| Méthode | Itinéraire                   | Objectif                                                                                                       |
| ------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| GET     | `/_agent-native/mcp/builtin` | Répertoriez les fonctionnalités intégrées, les étendues activées, les identifiants fusionnés et l'état actuel. |
| POST    | `/_agent-native/mcp/builtin` | Mettre à jour une étendue. Corps : `{ scope, enabledIds }` ou `{ scope, id, enabled }`.                        |

## Ajout d'un serveur MCP local {#adding-a-server}

Créez `mcp.config.json` à la racine de votre espace de travail (ou à la racine d'une application individuelle : la racine de l'espace de travail l'emporte lorsque les deux existent) :

```jsonc
{
  "$schema": "https://agent-native.com/schema/mcp.config.json",
  "servers": {
    "claude-in-chrome": {
      "command": "claude-in-chrome-mcp",
      "args": [],
      "env": { "LOG_LEVEL": "info" },
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"],
    },
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem@latest",
        "/Users/me/projects",
      ],
    },
  },
}
```

La forme est petite : une carte `servers` saisie par identifiant de serveur, où chaque entrée est soit un lanceur stdio (`command` + `args` + `env` en option), soit une entrée `{ "type": "http", "url", "headers" }` distante.

```an-annotated-code title="mcp.config.json, annoté"
{
  "filename": "mcp.config.json",
  "language": "jsonc",
  "code": "{\n  \"$schema\": \"https://agent-native.com/schema/mcp.config.json\",\n  \"servers\": {\n    \"claude-in-chrome\": {\n      \"command\": \"claude-in-chrome-mcp\",\n      \"args\": [],\n      \"env\": { \"LOG_LEVEL\": \"info\" }\n    },\n    \"filesystem\": {\n      \"command\": \"npx\",\n      \"args\": [\"-y\", \"@modelcontextprotocol/server-filesystem@latest\", \"/Users/me/projects\"]\n    }\n  }\n}",
  "annotations": [
    { "lines": "3", "label": "Identifiant du serveur", "note": "La clé devient le préfixe de l'outil : les outils de ce serveur apparaissent sous la forme `mcp__claude-in-chrome__*` dans le registre de l'agent, ils ne peuvent donc pas entrer en collision avec les actions de votre modèle." },
    { "lines": "4-6", "label": "stdio launcher", "note": "`command` + `args` génèrent un binaire local. Les serveurs Stdio sont destinés au **développement local** : ils ne sont pas opérationnels dans les environnements d'exécution Edge." },
    { "lines": "6", "label": "Environnement du processus", "note": "Optional `env` is passed to the spawned process. Keep secrets out of committed config; prefer `MCP_SERVERS` or the settings UI for tokens." }
  ]
}
```

Au prochain démarrage de l'application, vous verrez :

```
[mcp-client] loaded config from /path/to/mcp.config.json (3 server(s))
[mcp-client] connected to claude-in-chrome: 12 tools
[mcp-client] connected to playwright: 9 tools
[mcp-client] connected to filesystem: 4 tools
```

Les outils sont enregistrés dans le registre d'outils de l'agent avec le préfixe `mcp__<server-id>__<tool-name>` afin qu'ils ne puissent pas entrer en collision avec le actions de votre modèle. Ils sont également inclus dans `tool-search`, afin que les agents puissent découvrir intentionnellement les fonctionnalités MCP nouvellement connectées au lieu d'avoir besoin du préfixe exact du nom au départ.

## Priorité de configuration {#precedence}

La configuration MCP est résolue dans cet ordre, le premier match gagne :

1. **Racine de l'espace de travail `mcp.config.json`** — détectée via `agent-native.workspaceCore` dans `package.json`. Partagé dans toutes les applications de l'espace de travail.
2. **Racine app `mcp.config.json`** — remplacement par application si vous ne souhaitez pas qu'un serveur MCP soit disponible dans chaque application.
3. **`MCP_SERVERS` env var** — Chaîne JSON avec la même forme, pour CI/production où un fichier n'a pas de sens.

## Déploiements en production : `MCP_SERVERS` {#mcp-servers-env}

Pour les déploiements en production, préférez les serveurs distants HTTP MCP et définissez la configuration complète
forme (ou la carte du serveur interne) en tant que variable d'environnement :

```bash
MCP_SERVERS='{"servers":{"zapier":{"type":"http","url":"https://mcp.example.com/mcp","headers":{"Authorization":"Bearer paste-token-value-here"}}}}'
```

`MCP_SERVERS` est analysé comme JSON, donc les espaces réservés `${...}` ne sont pas développés
à l'intérieur de la chaîne. Si vous stockez le jeton dans un autre secret, développez-le avant
écrire la valeur finale JSON.

Les serveurs Stdio MCP génèrent des binaires locaux et sont destinés au développement local.
Les outils MCP s'activent uniquement dans les environnements d'exécution Node – Cloudflare Workers et autres périphériques
les cibles ignorent silencieusement MCP et continuent de fonctionner avec le reste de l'application
normalement.

## Détection automatique : `claude-in-chrome` {#autodetect}

Si vous n'avez **pas** de `mcp.config.json` et que le binaire `claude-in-chrome-mcp` se trouve sur `PATH` (ou dans l'emplacement d'installation bien connu `~/.claude-in-chrome/bin/claude-in-chrome-mcp`), l'agent natif l'enregistre automatiquement en tant que serveur MCP par défaut. Configurez `AGENT_NATIVE_DISABLE_MCP_AUTODETECT=1` pour vous désinscrire.

Cela signifie que les utilisateurs qui ont installé l'extension claude-in-chrome obtiennent le contrôle du navigateur sur chaque application native d'agent qu'ils ouvrent sans aucune modification de configuration.

## Serveurs MCP distants via les paramètres UI {#remote-via-ui}

Les serveurs MCP (Model Context Protocol) offrent à votre agent de nouvelles capacités, comme la connexion à Zapier, Cloudflare, Composio ou aux outils internes de votre entreprise. Une fois connecté, l'agent peut utiliser ces outils tout comme ses outils intégrés.

### Comment connecter un serveur MCP distant

1. **Nom du serveur** — une courte étiquette pour votre propre référence (par exemple "zapier", "slack-tools").
2. **URL** : le point de terminaison HTTPS que le fournisseur de serveur MCP vous a fourni (par exemple, `https://mcp.zapier.com/s/abc123/mcp`). Cela se trouve généralement dans le tableau de bord du fournisseur ou dans les documents d'intégration.
3. **Description** (facultatif) : une note sur ce que fait ce serveur.
4. **En-têtes** : informations d'authentification requises par le serveur, une par ligne. La plupart des serveurs ont besoin d'un en-tête `Authorization`. Exemple : `Authorization: Bearer sk-your-key-here`. Les documents du fournisseur vous indiqueront quoi mettre ici.

Cliquez sur **Test** pour vérifier la connexion avant d'enregistrer. Si cela réussit, vous verrez le nombre d’outils disponibles. Cliquez sur **Connecter** pour l'ajouter.

### Portée personnelle ou organisationnelle

Deux étendues sont prises en charge :

- **Personnel** : seul l'utilisateur connecté obtient les outils. Stocké en tant que paramètre de portée utilisateur.
- **Équipe** : tous les membres de l'organisation active disposent des outils nécessaires. Les propriétaires et les administrateurs peuvent ajouter : les membres voient la liste en lecture seule. Stocké en tant que paramètre de portée de l'organisation.

Ajoute et supprime le rechargement à chaud dans le gestionnaire MCP en cours d'exécution – pas de redémarrage du processus ni de redémarrage du serveur. Les nouveaux outils `mcp__<scope>-<name>__*` apparaissent à l'agent lors du message suivant et peuvent être recherchés via `tool-search`.

Les HTTPS URL sont acceptés partout ; Le `http://` simple n'est autorisé que pour le `localhost` pendant le développement. L'authentification facultative est introduite sous la forme d'un jeton Bearer envoyé via `Authorization: Bearer …` à chaque demande.

Sous le capot, ces serveurs sont conservés dans la table `settings` du framework sous la clé `u:<email>:mcp-servers-remote` (Personnel) ou `o:<orgId>:mcp-servers-remote` (Équipe) et fusionnés avec `mcp.config.json` au démarrage.

### Points de terminaison HTTP

| Méthode | Itinéraire                                            | Objectif                                                                                              |
| ------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| GET     | `/_agent-native/mcp/servers`                          | Répertoriez les serveurs personnels et d'organisation de l'utilisateur actuel avec leur statut actif. |
| POST    | `/_agent-native/mcp/servers`                          | Ajouter un serveur. Corps : `{ scope, name, url, headers?, description? }`.                           |
| DELETE  | `/_agent-native/mcp/servers/:id?scope=user\|org`      | Supprimez un serveur et reconfigurez le gestionnaire.                                                 |
| POST    | `/_agent-native/mcp/servers/:id/test?scope=user\|org` | Exécutez à sec les outils de connexion et de liste du serveur existant.                               |
| POST    | `/_agent-native/mcp/servers/test`                     | Exécutez à sec un URL arbitraire avant de persister. Corps : `{ url, headers? }`.                     |

Les serveurs Stdio ne fonctionnent toujours pas en dehors des environnements d'exécution Node, mais les serveurs distants HTTP MCP fonctionnent dans n'importe quel environnement avec `fetch`, y compris les versions de production de bureau.

## Serveurs MCP partagés via un hub {#hub}

Si votre espace de travail exécute plusieurs applications natives d'agent (par exemple, dispatch + mail + clips), vous pouvez configurer **une** application comme hub et demander aux autres d'extraire automatiquement ses serveurs MCP de portée organisationnelle. Pas de copier-coller par application des URL et des jetons au porteur. Voir [Multi-App Workspace](/docs/multi-app-workspace) pour l'approche canonique utilisant les ressources MCP de l'espace de travail Dispatch.

Dispatch est le hub conventionnel : il assure déjà la coordination entre les applications.

```an-diagram title="Modèle Hub : une application dessert les serveurs MCP de portée organisationnelle" summary="Dispatch contient les serveurs MCP de portée organisationnelle ; les applications grand public les extraient et les fusionnent sous le nom mcp__hub_<orgId>_<name>__*. Seules les lignes de portée de l'organisation sont partagées : les informations d'identification personnelles restent en place."
{
  "html": "<div class=\"mcp-hub\"><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">Dispatch hub</span><small class=\"diagram-muted\">serveurs MCP au périmètre organisation</small><small class=\"diagram-muted\"><code>GET /mcp/hub/servers</code></small></div><div class=\"diagram-col arrows\"><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div></div><div class=\"diagram-col consumers\"><div class=\"diagram-box\" data-rough>Mail<br><small class=\"diagram-muted\"><code>mcp__hub_&lt;orgId&gt;_&lt;name&gt;__*</code></small></div><div class=\"diagram-box\" data-rough>Clips<br><small class=\"diagram-muted\">pull + merge toutes les ~60 s</small></div></div></div><p class=\"diagram-muted note\">Bearer-gated by <code>AGENT_NATIVE_MCP_HUB_TOKEN</code>. Personal (user-scope) servers are never re-exposed.</p>",
  "css": ".mcp-hub{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.mcp-hub .center{display:flex;flex-direction:column;align-items:center;gap:4px}.mcp-hub .diagram-col{display:flex;flex-direction:column;gap:10px}.mcp-hub .arrows .diagram-arrow{font-size:22px;line-height:1}.mcp-hub .note{margin:8px 0 0;font-size:.85em}.mcp-hub code{font-size:.85em}"
}
```

Pour les nouvelles configurations d'espace de travail, préférez **Répartir les ressources MCP de l'espace de travail** lorsque vous
vous souhaitez le même modèle d'attribution pour toutes les applications et celles sélectionnées que celui utilisé par l'espace de travail skills,
instructions et ressources de référence. Ajoutez une ressource d'espace de travail avec :

```json
{
  "type": "http",
  "url": "https://example.com/mcp",
  "headers": {
    "Authorization": "Bearer ${keys.MCP_SERVER_TOKEN}"
  },
  "description": "Shared Outil MCPs for workspace apps"
}
```

Enregistrez-le sous `mcp-servers/<name>.json` avec le type `mcp-server`. Toutes les applications
les ressources sont chargées par chaque application d'espace de travail ; les ressources sélectionnées se chargent uniquement dans
applications avec une subvention Dispatch active. Les espaces réservés secrets sont résolus depuis l'application
magasin secret, alors placez les jetons de porteur bruts dans Dispatch Vault et référencez-les
avec `${keys.NAME}` au lieu de les stocker dans le corps de la ressource.

Les applications actualisent leur configuration MCP fusionnée environ une fois par minute, donc une ressource centrale
les modifications, les modifications d'autorisation et les suppressions prennent effet sans déploiement. Définir
`AGENT_NATIVE_MCP_CONFIG_REFRESH_MS=0` pour désactiver cette actualisation en arrière-plan, ou
définissez-le sur une valeur d'au moins `5000` millisecondes pour régler l'intervalle.

L'ancien mode hub ci-dessous reste utile pour le « partage grossier de chaque MCP de portée organisationnelle
serveur de Dispatch" et pour les déploiements qui utilisent déjà le MCP
paramètres UI comme source de vérité.

### 1. Activer Hub-Serve sur l'application Hub (répartition)

Définissez une variable d'environnement dans le déploiement de dispatch :

```bash
AGENT_NATIVE_MCP_HUB_TOKEN=<a-long-random-secret>
```

Dispatch monte désormais `GET /_agent-native/mcp/hub/servers` qui renvoie chaque serveur MCP de portée organisationnelle stocké dans sa table `settings`, avec les en-têtes URL + complets, authentifiés par le jeton.

### 2. Applications consommatrices de points au niveau du hub

Défini sur chaque consommateur (mail, clips, peu importe) :

```bash
AGENT_NATIVE_MCP_HUB_URL=https://dispatch.acme.com
AGENT_NATIVE_MCP_HUB_TOKEN=<the-same-secret>
```

Au démarrage, chaque consommateur extrait la liste des serveurs du hub et la fusionne dans son propre gestionnaire MCP. Les outils apparaissent à l'agent sous la forme `mcp__hub_<orgId>_<name>__*`, distincts du propre `mcp__org_…` local du consommateur, il n'y a donc pas de collision.

### 3. Ce qui est partagé

Seuls les serveurs **org-scope** sont partagés. Les serveurs au niveau utilisateur (personnels) restent la propriété de l'utilisateur qui les a ajoutés : le hub ne réexpose jamais les informations d'identification personnelles dans les applications.

Les réponses du Hub incluent les en-têtes d'authentification complets (jetons du porteur, etc.). Le transport est HTTPS, le point de terminaison nécessite le secret partagé et il ne renvoie que les lignes de portée de l'organisation – traitez le hub URL + le jeton comme un identifiant de base de données.

### 4. Rechargement à chaud ou redémarrage

Le local UI ajoute un rechargement à chaud dans chaque application via `McpClientManager.reconfigure()` — pas de redémarrage. Les serveurs provenant du hub sont récupérés par la même actualisation périodique en arrière-plan (environ 60 s, réglable ou désactivable via `AGENT_NATIVE_MCP_CONFIG_REFRESH_MS`) que celle utilisée par le chemin des ressources de l'espace de travail, de sorte que les modifications apportées dans Dispatch se propagent à toutes les applications grand public en une minute environ sans redémarrage. De plus, toute mutation locale dans une application grand public déclenche immédiatement une reconfiguration de cette application.

### Résumé des points de terminaison

| Méthode | Itinéraire                       | Objectif                                                                                                                                                         |
| ------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET     | `/_agent-native/mcp/hub/servers` | Servez tous les serveurs de l'organisation avec des crédits complets (dépendants du porteur, montés uniquement lorsque `AGENT_NATIVE_MCP_HUB_TOKEN` est défini). |
| GET     | `/_agent-native/mcp/hub/status`  | Renvoie `{ serving, consuming, hubUrl }` pour les paramètres de la carte UI.                                                                                     |

## Statut de l'itinéraire {#status-route}

Chaque application expose `GET /_agent-native/mcp/status` pour les outils et l'intégration :

```an-api
{
  "method": "GET",
  "path": "/_agent-native/mcp/status",
  "summary": "Statut du client MCP pour les outils et l'intégration",
  "description": "Reports which configured servers connected, the total live tool count, the merged prefixed tool list, and any per-server connection errors. Use it to build \"detected — your agent can now drive X\" hints or to debug connection problems.",
  "responses": [
    {
      "status": "200",
      "description": "Configured vs connected servers, tool inventory, and per-server errors.",
      "example": "{\n  \"configuredServers\": [\"claude-in-chrome\", \"playwright\"],\n  \"connectedServers\": [\"claude-in-chrome\", \"playwright\"],\n  \"totalTools\": 21,\n  \"tools\": [\n    {\n      \"source\": \"claude-in-chrome\",\n      \"name\": \"mcp__claude-in-chrome__navigate\",\n      \"description\": \"Navigate the browser to a URL\"\n    }\n  ],\n  \"errors\": {}\n}"
    }
  ]
}
```

```json
{
  "configuredServers": ["claude-in-chrome", "playwright"],
  "connectedServers": ["claude-in-chrome", "playwright"],
  "totalTools": 21,
  "tools": [
    {
      "source": "claude-in-chrome",
      "name": "mcp__claude-in-chrome__navigate",
      "description": "Navigate the browser to a URL"
    }
  ],
  "errors": {}
}
```

Utilisez ceci pour créer des conseils d'intégration « Claude-in-Chrome détecté – votre agent peut désormais piloter Chrome » ou pour déboguer les problèmes de connexion MCP.

## Modes de défaillance {#failures}

Les pannes individuelles du serveur MCP ne mettent jamais l'agent hors service :

- Un `command` mal configuré → le serveur est ignoré, son erreur apparaît dans `/mcp/status` sous `errors.<server-id>` et tous les autres serveurs continuent de fonctionner.
- Le MCP SDK est absent du `node_modules` → toutes les fonctionnalités du MCP sont ignorées avec un avertissement ; Le chat d'agent continue de fonctionner sans aucun outil MCP.
- S'exécuter dans un environnement d'exécution Edge → Le client MCP ne fonctionne pas.

L'agent natif démarrera toujours ; une configuration MCP cassée signifie simplement moins d'outils.

## Sécurité {#security}

Les outils MCP s'exécutent sur votre ordinateur avec les autorisations dont dispose le processus généré. Traitez `mcp.config.json` comme n'importe quelle autre liste d'exécutables que vous êtes prêt à laisser conduire l'agent. Les outils des serveurs MCP apparaissent dans la boucle d'utilisation des outils de l'agent, tout comme le actions de votre modèle, alors assurez-vous de faire confiance à chaque serveur que vous configurez.
