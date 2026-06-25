---
title: "Espaces de travail multi-applications"
description: "Hébergez de nombreuses applications natives d'agent dans un seul monorepo avec authentification partagée, RBAC, instructions, skills, composants et informations d'identification."
---

# Espaces de travail multi-applications

> **Quel document sur l'espace de travail ?** Cette page couvre la **forme de déploiement** : un monorepo, de nombreuses applications, une authentification partagée et un déploiement unifié. Pour savoir ce qu'est un espace de travail (la couche de personnalisation : `AGENTS.md`, `LEARNINGS.md`, mémoire personnelle, skills, agents personnalisés), voir [Workspace](/docs/workspace) ; pour la gouvernance (qui examine, approuve et possède quoi), voir [Workspace Governance](/docs/workspace-management).

Lorsque le vibe-coding d'un outil interne prend un après-midi, vous ne vous arrêtez pas à un seul. Une équipe se retrouve avec un CRM, une boîte de réception d'assistance, un tableau de bord, une console d'opérations – dix petites applications, chacune échafaudée indépendamment. C'est génial jusqu'à ce que vous deviez changer quelque chose dans chacun d'eux.

À ce stade, chaque application possède son propre `AGENTS.md`, son propre plugin d'authentification, son propre composant de mise en page copié-collé, son propre jeton Slack codé en dur, sa propre idée de ce qu'est une « organisation ». Un changement de règle de conformité signifie dix PR. La rotation d’une clé API signifie dix redéploiements. Une actualisation de la marque signifie que dix en-têtes différents ne sont pas synchronisés. Ce qui a facilité leur construction rend désormais leur gestion difficile.

Le modèle **espace de travail multi-applications** est la façon dont l'agent natif résout ce problème. Vous hébergez toutes vos applications dans un seul monorepo aux côtés d'un package `packages/shared` privé. Le framework possède les valeurs par défaut communes ; `packages/shared` concerne uniquement le code, les instructions, le skills, les composants ou les remplacements de plugins véritablement personnalisés pour votre espace de travail. Chaque application se réduit à une poignée d'écrans et de actions qui la rendent unique.

## Ce qui est partagé {#what-gets-shared}

Tout ce sur quoi toutes les applications de votre organisation devraient s'entendre peut être intégré dans `packages/shared` :

| Objet partagé                             | Où il habite                                                                                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Remplacement d'authentification / SSO     | Exporter `authPlugin` depuis `src/server/index.ts`                                                                                              |
| Règles d'organisation/RBAC                | Meilleures organisations d'authentification, éventuellement encapsulées par ce `authPlugin`                                                     |
| Remplacement du chat de l'agent           | Exporter `agentChatPlugin` depuis `src/server/index.ts`                                                                                         |
| Instructions pour les agents d'entreprise | `AGENTS.md`                                                                                                                                     |
| Agent skills                              | `.agents/skills/<skill-name>/SKILL.md`                                                                                                          |
| Agent partagé actions                     | `actions/*.ts`                                                                                                                                  |
| Composants React partagés                 | Exporter depuis `src/client/index.ts`                                                                                                           |
| Jetons de conception / marque             | Ajoutez un fichier CSS partagé et importez-le depuis chaque application                                                                         |
| Identifiants API partagés                 | Préférer les informations d'identification à l'échelle du framework ; ajoutez des assistants uniquement si vous avez besoin d'un espace de noms |

Chaque application individuelle devient *juste un ensemble d'écrans* : itinéraires, tableaux de bord, vues, actions spécifiques au domaine. Les valeurs par défaut du framework couvrent le reste jusqu'à ce que vous ajoutiez une véritable personnalisation de l'espace de travail.

Cette même limite s'applique lorsque votre application souhaite utiliser une autre application propriétaire. Un nouveau tableau de bord d'espace de travail nécessitant un contexte de messagerie, de calendrier, d'analyse et de mémoire d'entreprise doit utiliser les applications Mail, Calendrier, Analytics et Brain existantes comme voisins connectés via des liens ou A2A. Il ne doit pas cloner ces modèles, créer une application wrapper qui les imbrique ou échafauder des applications enfants en lui-même simplement pour accéder à leurs données ou à leurs agents. Créez ou créez une copie uniquement lorsque vous souhaitez explicitement personnaliser cette application.

## Démarrer {#getting-started}

L'espace de travail est la forme par défaut d'un projet natif d'agent. Échafaudez-en un avec :

```bash
npx @agent-native/core@latest create my-company-platform
```

Le CLI affiche un sélecteur à sélection multiple de chaque modèle propriétaire. Choisissez-en autant que vous le souhaitez (Mail + Calendrier + Formulaires, par exemple) et ils seront tous intégrés dans le même espace de travail partageant les paramètres d'authentification et de base de données par défaut.

Vous obtenez un monorepo pnpm avec le package partagé privé, un `package.json` racine qui connecte la découverte de l'espace de travail, un `.env` partagé et un sous-répertoire par application que vous avez choisie :

```an-file-tree title="Un workspace généré"
{
  "entries": [
    { "path": "package.json", "note": "Déclare agent-native.workspaceCore" },
    { "path": "pnpm-workspace.yaml", "note": "packages: [\"packages/*\", \"apps/*\"]" },
    { "path": ".env.example", "note": "ANTHROPIC_API_KEY, A2A_SECRET, DATABASE_URL, ... partagés" },
    { "path": "packages/shared/", "note": "@my-company-platform/shared" },
    { "path": "packages/shared/src/server/", "note": "Overrides de plugins seulement si nécessaire" },
    { "path": "packages/shared/src/client/", "note": "Code React partagé seulement si nécessaire" },
    { "path": "packages/shared/AGENTS.md", "note": "Instructions à l'échelle du workspace" },
    { "path": "apps/mail/" },
    { "path": "apps/calendar/" },
    { "path": "apps/forms/" }
  ]
}
```

Puis démarrez-le :

```bash
cd my-company-platform
cp .env.example .env             # renseignez ANTHROPIC_API_KEY, BETTER_AUTH_SECRET, ...
pnpm install
pnpm dev                         # opens Dispatch; other apps start on first visit
```

Chaque application sait déjà comment se connecter, partager la même base de données et charger l'espace de travail `AGENTS.md`. Vous n'avez rien connecté de tout cela : le framework a découvert automatiquement le package partagé via le champ `agent-native.workspaceCore` à la racine `package.json` :

```json
{
  "name": "my-company-platform",
  "agent-native": {
    "workspaceCore": "@my-company-platform/shared"
  }
}
```

## Ajout d'une autre application {#adding-a-new-app}

Depuis n'importe où dans l'espace de travail :

```bash
npx @agent-native/core@latest add-app
```

Le CLI affiche à nouveau le sélecteur de modèles avec les applications que vous avez déjà installées filtrées. Choisissez-en un ou plusieurs et ils seront échafaudés sous `apps/`. Variante non interactive :

```bash
npx @agent-native/core@latest add-app crm --template content
```

Tout modèle propriétaire fonctionne comme une application d'espace de travail : le CLI exécute une petite transformation **workspacify** sur le modèle qui ajoute le package partagé en tant que dépôt et résout les références `workspace:*`. Aucun échafaudage « espace de travail-application » parallèle à maintenir.

```bash
pnpm install                     # at the workspace root
pnpm dev
```

C'est tout. La nouvelle application contient les mêmes instructions de connexion et d'espace de travail que toutes les autres applications. Ajoutez une marque partagée, actions ou des informations d'identification uniquement lorsque l'espace de travail en a réellement besoin.

## Ce que vous remplacez où {#layering}

Les applications natives d'agent au sein d'un espace de travail résolvent les comportements transversaux à trois endroits, dans cet ordre :

1. **Application locale** — fichiers dans `apps/<name>/` (priorité la plus élevée)
2. **Espace de travail partagé** : fichiers dans `packages/shared/` (la couche intermédiaire partagée)
3. **Framework par défaut** — `@agent-native/core` (le plus bas)

La fusion s'effectue par nom de fichier. Si une application fournit un fichier local qui existe également en amont, le fichier local l'emporte. Si ce n’est pas le cas, la version partagée de l’espace de travail s’applique. Si shared n'en fournit pas non plus, la valeur par défaut du framework entre en jeu. Cela s'applique aux plugins skills, actions et `AGENTS.md`.

```an-diagram title="Trois calques, fusionnés par nom de fichier" summary="Chaque application résout d'abord les plugins, les compétences, les actions et AGENTS.md à partir de l'application locale, puis du package partagé, puis de la valeur par défaut du framework."
{
  "html": "<div class=\"layer\"><div class=\"diagram-card accent\"><span class=\"diagram-pill accent\">1 &middot; App local</span><small class=\"diagram-muted\"><code>apps/&lt;name&gt;/</code> &mdash; highest priority</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">2 &middot; Workspace shared</span><small class=\"diagram-muted\"><code>packages/shared/</code> &mdash; the mid-layer</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">3 &middot; Framework default</span><small class=\"diagram-muted\"><code>@agent-native/core</code> &mdash; lowest</small></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box ok\">first match wins</div></div>",
  "css": ".layer{display:flex;flex-direction:column;align-items:center;gap:6px}.layer .diagram-card{display:flex;flex-direction:column;gap:3px;padding:12px 16px;width:320px}.layer .diagram-arrow{font-size:18px;line-height:1}.layer .diagram-box{margin-top:2px}"
}
```

Lorsqu'une application a besoin de quelque chose de différent, déposez un fichier local :

| Élément à remplacer                          | Fichier à créer dans l'application                            |
| -------------------------------------------- | ------------------------------------------------------------- |
| Plugin d'authentification                    | `apps/<name>/server/plugins/auth.ts`                          |
| Plugin de chat d'agent                       | `apps/<name>/server/plugins/agent-chat.ts`                    |
| Une compétence spécifique                    | `apps/<name>/.agents/skills/<skill-name>/SKILL.md`            |
| Une action spécifique                        | `apps/<name>/actions/<action-name>.ts`                        |
| Instructions supplémentaires pour les agents | `apps/<name>/AGENTS.md` (fusionne avec l'espace de travail 1) |

Pas de câblage, pas de configuration. Créez le fichier et il prend le relais.

## Modification du comportement partagé {#editing-shared-behavior}

Tout ce que vous personnalisez de manière transversale se trouve dans `packages/shared/`. Exportez un `authPlugin` depuis `src/server/index.ts` et chaque application le récupère lors du prochain rechargement du développement. Ajoutez une compétence sous `.agents/skills/` et chaque agent de l'application la verra. Ajoutez une action à `actions/` et chaque agent de l'application peut l'appeler.

Étant donné que le package partagé est une dépendance `workspace:*`, pnpm le lie symboliquement au `node_modules/` de chaque application. Vous ne le créez ni ne le publiez jamais : les applications regroupent tout ce dont elles ont besoin au moment de la construction.

## Ressources globales d'exécution {#runtime-global-resources}

Utilisez `packages/shared` pour les valeurs par défaut au niveau du code qui doivent être fournies avec le dépôt : plugins, actions partagé, code React partagé, système de fichiers `AGENTS.md` et système de fichiers skills. Utilisez les ressources de l'espace de travail Dispatch pour le contexte global modifiable au moment de l'exécution que les administrateurs souhaitent gérer sans modification du code.

Les ressources de répartition sont limitées à **Toutes les applications** (chaque application en hérite au moment de l'exécution, sans étape de copie ou de synchronisation) ou **Applications sélectionnées** (accordées par application pour le contexte spécifique à l'application). Voir [Workspace](/docs/workspace#global-resources) pour le tableau complet du modèle de ressource, les conventions de chemin et le pack de démarrage recommandé.

## Authentification et RBAC {#auth-and-rbac}

Chaque application native d'agent est déjà livrée avec [Better Auth](/docs/authentication) ainsi que le système d'organisation intégré au framework. Dans un espace de travail, vous obtenez cela gratuitement dans chaque application, soutenue par la même base de données. Pour le modèle multi-tenant complet (organisations, rôles, isolation des données), voir [Multi-Tenancy](/docs/multi-tenancy).

Pour les règles spécifiques à l'entreprise (domaines de liste verte, application de SSO, vérifications de rôles supplémentaires), exportez un `authPlugin` à partir de `packages/shared/src/server/index.ts`. Chaque application de l'espace de travail applique désormais ces règles.

L'organisation active circule automatiquement : `session.orgId` → `AGENT_ORG_ID` → Portée des lignes SQL, de sorte que les données marquées avec `org_id` sont invisibles pour les autres organisations, même pour l'agent. Voir [Security & Data Scoping](/docs/security) pour le modèle complet.

## Serveurs MCP partagés {#shared-mcp}

Les options recommandées pour partager les serveurs MCP entre les applications d'espace de travail, par ordre de préférence :

1. **Ressources MCP de l'espace de travail Dispatch** : ajoutez des ressources `mcp-servers/<name>.json` dans Dispatch dans la portée **Toutes les applications**. Chaque application de l'espace de travail hérite du serveur MCP au moment de l'exécution sans modification ni redéploiement de fichiers. Accordez aux applications sélectionnées uniquement lorsque le serveur est spécifique à une application. Les jetons vivent dans le coffre-fort Dispatch ; référencez-les à partir de la ressource JSON avec `${keys.NAME}`.

2. **Root `mcp.config.json`** : déposez un fichier à la racine de l'espace de travail et chaque application de l'espace de travail se connecte aux mêmes serveurs MCP. Les applications individuelles peuvent remplacer leur propre `mcp.config.json` (app-root wins). Utilisez-le pour les serveurs MCP locaux/système de fichiers (`@modelcontextprotocol/server-filesystem`, `claude-in-chrome`, Playwright) qui n'ont pas besoin d'informations d'identification de coffre-fort par utilisateur.

3. **Paramètres UI (portée personnelle/organisation)** — pour les serveurs HTTP MCP distants, les utilisateurs peuvent les ajouter à partir des paramètres UI au niveau personnel ou équipe (organisation) — aucune modification de fichier, rechargé à chaud dans l'agent en cours d'exécution.

Voir [MCP Clients](/docs/mcp-clients) pour le schéma de configuration, les règles de priorité et la configuration du hub.

## Variables d'environnement partagées {#shared-env}

La racine de l'espace de travail `.env` est chargée automatiquement dans chaque application. Placez les clés partagées une fois à la racine – `ANTHROPIC_API_KEY`, `A2A_SECRET`, `BETTER_AUTH_SECRET`, `DATABASE_URL`, `BUILDER_PRIVATE_KEY`, etc. – et chaque application les récupère. Les remplacements par application vont dans `apps/<name>/.env` et gagnent en cas de conflit.

Pour les informations d'identification de l'application d'exécution, préférez le coffre-fort Dispatch à la modification manuelle des fichiers `.env`. Le coffre-fort est par défaut un accès à toutes les applications, de sorte que chaque clé du coffre-fort enregistrée est disponible pour chaque application de l'espace de travail et peut être poussée avec `sync-vault-to-app`. Basculez le coffre-fort en mode manuel uniquement lorsque les applications ont besoin d'autorisations explicites par clé.

```text
my-company-platform/
├── .env                           # shared: ANTHROPIC_API_KEY=... , A2A_SECRET=... , ...
└── apps/
    └── mail/
        └── .env                   # optional overrides just for mail
```

Quelques flux d'intégration sont prêts à l'emploi et adaptés à l'espace de travail :

- **Builder `/cli-auth`** : en cliquant sur "Connecter Builder" depuis n'importe quelle application, `BUILDER_PRIVATE_KEY` et ses amis sont écrits dans la **racine de l'espace de travail** `.env`, afin que chaque application puisse accéder au navigateur en même temps.
- **Route des paramètres Env-vars** (`POST /_agent-native/env-vars`) : à l'intérieur d'un espace de travail, la racine de l'espace de travail est écrite par défaut `.env`. Transmettez `scope: "app"` dans le corps pour remplacer une application.

## Identifiants partagés {#shared-credentials}

Les applications du même espace de travail pointent par défaut vers le même `DATABASE_URL`, de sorte que le stockage des informations d'identification du framework peut rendre les informations d'identification disponibles pour chaque application sans configuration par application. Utilisez `@agent-native/core/credentials` directement ou ajoutez un assistant léger dans `packages/shared` si votre espace de travail souhaite une convention de dénomination plus stricte.

## Jetons de conception partagés {#design-tokens}

Le framework est sur Tailwind v4. Ajoutez un fichier CSS partagé à `packages/shared` uniquement lorsque l'espace de travail a de vrais jetons de marque à partager, puis importez-le depuis le `app/global.css` de chaque application :

```css
@import "tailwindcss";
@import "@my-company-platform/shared/styles/tokens.css";
@source "./**/*.{ts,tsx}";

:root {
  --background: 0 0% 100%; /* ...brand tokens... */
}
.dark {
  --background: 220 6% 6%; /* ... */
}
```

Les couleurs de la marque, la typographie, les échelles d'espacement et toutes les classes de composants partagés peuvent résider dans ce fichier CSS. Mettez-le à jour dans `packages/shared` et chaque application change de nom lors de la prochaine version.

## Déploiement {#deployment}

Vous disposez de deux options : **déploiement unifié** (valeur par défaut pour les espaces de travail) ou déploiement indépendant par application.

### Déploiement unifié (recommandé)

Une seule commande crée chaque application dans l'espace de travail et les envoie derrière une seule origine, un chemin par application :

```bash
npx @agent-native/core@latest deploy
# https://your-agents.com/mail/*       → apps/mail
# https://your-agents.com/calendar/*   → apps/calendar
# https://your-agents.com/forms/*      → apps/forms
```

Chaque application est construite avec `APP_BASE_PATH=/<name>` et `VITE_APP_BASE_PATH=/<name>` et émise via le préréglage Nitro sélectionné. Cloudflare Pages est le préréglage par défaut et utilise un répartiteur chez `dist/_worker.js` plus `_routes.json`. Netlify est pris en charge avec `npx @agent-native/core@latest deploy --preset netlify` ; il émet des fonctions d'application sous `.netlify/functions-internal/<app>-server` et génère des redirections qui laissent les actifs statiques non forcés afin que le CDN serve les fichiers en premier. Vercel est pris en charge avec `npx @agent-native/core@latest deploy --preset vercel` ; il écrit un bundle `.vercel/output` racine à l'aide du Build Output API de Vercel.

```an-diagram title="Déploiement unifié : une origine, un chemin par application" summary="Chaque application est livrée derrière une seule origine, donc les sessions de connexion et les A2A inter-applications sont gratuites."
{
  "html": "<div class=\"deploy\"><div class=\"diagram-box accent\">your-agents.com<br><small class=\"diagram-muted\">one DNS record &middot; one cert &middot; one CDN</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"deploy-apps\"><div class=\"diagram-box\">/mail/*</div><div class=\"diagram-box\">/calendar/*</div><div class=\"diagram-box\">/forms/*</div></div><div class=\"diagram-pill ok\">shared login cookie on the apex &bull; same-origin A2A, no CORS</div></div>",
  "css": ".deploy{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.deploy .deploy-apps{display:flex;flex-direction:column;gap:8px}.deploy .diagram-arrow{font-size:24px}.deploy .diagram-pill{flex-basis:100%}"
}
```

C'est en étant sur la **même origine** que se trouve le véritable gain :

- **Session de connexion partagée.** Better Auth définit son cookie sur le domaine apex, donc la connexion à n'importe quelle application vous connecte à chaque application. Pas de danse SSO inter-domaines.
- **Zero-config cross-app A2A.** Le balisage `@mail` de `@calendar` devient une récupération de même origine — pas de CORS, pas de signature JWT entre frères et sœurs. Le A2A externe utilise toujours le JWT comme aujourd'hui.
- **Un enregistrement DNS, un certificat, un cache CDN.**

Publiez la sortie `dist/` :

```bash
wrangler pages deploy dist
```

Pour Netlify :

```bash
npx @agent-native/core@latest deploy --preset netlify --build-only
```

Pour les déploiements Vercel Git, définissez la commande build sur :

```bash
npx @agent-native/core@latest deploy --preset vercel --build-only
```

### Itinéraires d'applications publiques

Les applications Workspace sont internes par défaut. Pour un site public avec des pages d'administration réservées à la connexion uniquement, définissez une audience publique et protégez le préfixe d'administrateur dans le `package.json` de cette application :

```json
{
  "agent-native": {
    "workspaceApp": {
      "audience": "public",
      "protectedPaths": ["/admin"]
    }
  }
}
```

Pour les applications principalement internes comportant quelques pages publiques, laissez les préfixes d'audience interne et de page de liste :

```json
{
  "agent-native": {
    "workspaceApp": {
      "publicPaths": ["/", "/share"]
    }
  }
}
```

Ces paramètres affectent uniquement la navigation dans les pages en lecture seule. Les outils Framework, le chat d'agent, A2A, l'accès au coffre-fort et les API arbitraires restent authentifiés à moins que l'application ne déclare explicitement les préfixes publics avec `createAuthPlugin({ publicPaths: [...] })`.

### Déploiement indépendant par application

Vous préférez chaque application sur son propre domaine (`mail.company.com`, `calendar.company.com`) ? Chaque application de l'espace de travail est toujours un déployable indépendant : `cd apps/mail && npx @agent-native/core@latest build` se comporte exactement comme un échafaudage autonome. Le A2A inter-applications passe ensuite par le chemin signé JWT standard avec un `A2A_SECRET` partagé. Le SSO inter-domaines entre des applications déployées séparément est géré par la fédération d'identité avec Dispatch comme hub — voir [Cross-App SSO](/docs/cross-app-sso) ; le déploiement unifié à origine unique évite d'en avoir besoin.

### Base de données partagée, identifiants partagés

Quel que soit votre choix, pointez chaque application vers le même `DATABASE_URL` pour obtenir un état inter-applications prêt à l'emploi : un ensemble de comptes utilisateur, un ensemble d'organisations, un ensemble de paramètres partagés. Si chaque application possède sa propre base de données, le modèle d'espace de travail fonctionne toujours : vous perdez simplement cette histoire à état partagé.

Le package partagé lui-même n’est jamais déployé de manière autonome. Il s'agit d'un dépôt `workspace:*` que pnpm relie symboliquement au `node_modules/` de chaque application, de sorte que chaque application regroupe de manière transparente tout ce dont elle a besoin au moment de la construction.

## Hors de portée (pour l'instant) {#out-of-scope}

Le modèle de l'espace de travail est intentionnellement étroit. Quelques éléments qu'il ne gère pas encore délibérément :

- **Coffre-fort d'informations d'identification chiffré.** Préférez le coffre-fort Dispatch pour les informations d'identification de l'application d'exécution (voir [Shared environment variables](#shared-env)). Le chemin de secours hors coffre-fort (les informations d'identification partagées écrites directement dans la table `settings` du framework) les stocke aujourd'hui sous forme de texte brut, alors effectuez une rotation responsable lorsque vous vous en servez.
- **Publication du code partagé sur npm privé.** Le package partagé concerne uniquement `workspace:*` ; Le partage multi-repo via un registre privé est faisable mais pas échafaudé.
- **Bibliothèque de composants avisés.** `packages/shared` est l'endroit où _vous_ placez les composants partagés. Le framework ne force pas shadcn/ui ou tout autre système à accéder à cet emplacement.

## Voir aussi {#see-also}

- [Workspace](/docs/workspace) : la couche de personnalisation (`AGENTS.md`, `LEARNINGS.md`, mémoire personnelle, skills, agents personnalisés) que chaque application de l'espace de travail partage.
- [Workspace Governance](/docs/workspace-management) – branchement, CODEOWNERS, examen des relations publiques sur de nombreuses applications dans un seul dépôt.
- [Multi-Tenancy](/docs/multi-tenancy) – organisations, rôles et isolation des données par organisation.
- [Cross-App SSO](/docs/cross-app-sso) : fédération d'identités pour les déploiements de domaines distincts.
- [Dispatch](/docs/dispatch) : le plan de contrôle d'exécution qui se trouve généralement dans un espace de travail multi-applications en tant que coffre-fort de secrets, catalogue d'intégration et hub d'approbations.
