---
title: "Déploiement"
description: "Déployez des applications natives d'agent sur n'importe quelle plate-forme avec les préréglages Nitro : Node.js, Vercel, Netlify, Cloudflare, AWS, et plus encore."
---

# Déploiement

Les applications natives d'agent utilisent [Nitro](https://nitro.build) sous le capot, ce qui signifie que vous pouvez les déployer sur n'importe quelle plate-forme sans aucune modification de configuration : il vous suffit de définir un préréglage.

## Avant de déployer : choisissez une base de données persistante {#persistent-database}

Chaque application déployée nécessite une base de données SQL persistante. Dans le développement local, l'agent natif s'appuie sur un fichier SQLite dans `data/app.db` ; c'est pratique sur votre machine, mais ce n'est pas durable dans les conteneurs, les aperçus ou les environnements sans serveur où le système de fichiers peut être réinitialisé.

Définissez `DATABASE_URL` dans votre fournisseur de déploiement avant de promouvoir une application en production. Agent-native utilise Drizzle pour le schéma et les requêtes, de sorte que la couche de données est portable sur les backends SQL compatibles Drizzle et que le framework détecte automatiquement le dialecte du URL. Voir [Database](/docs/database#production) pour la liste des adaptateurs et les détails du dialecte.

Utilisez `DATABASE_AUTH_TOKEN` uniquement lorsque votre fournisseur de base de données nécessite un jeton distinct, tel que Turso/libSQL. Pour les espaces de travail, toutes les applications héritent par défaut de la racine `DATABASE_URL` ; définissez `<APP_NAME>_DATABASE_URL` lorsqu'une application doit utiliser une base de données différente.

## Déploiement de Workspace : une origine, de nombreuses applications {#workspace-deploy}

Si votre projet est un [workspace](/docs/multi-app-workspace), vous pouvez envoyer chaque application qu'il contient à une seule origine avec une seule commande :

```bash
npx @agent-native/core@latest deploy
# https://your-agents.com/mail/*       → apps/mail
# https://your-agents.com/calendar/*   → apps/calendar
# https://your-agents.com/forms/*      → apps/forms
```

Chaque application est construite avec `APP_BASE_PATH=/<name>` et `VITE_APP_BASE_PATH=/<name>`, puis packagée pour le préréglage cible Nitro. Cloudflare Pages est le préréglage par défaut et utilise un répartiteur généré sur `dist/_worker.js` ; Netlify utilise une fonction par application dans `.netlify/functions-internal/<app>-server` ainsi que les redirections générées ; Vercel écrit un `.vercel/output` au niveau de l'espace de travail à l'aide de la sortie de construction API.

```an-diagram title="Une origine, de nombreuses applications" summary="Chaque application d'espace de travail est créée avec son propre chemin de base et montée sous un préfixe de chemin sur une seule origine. Ainsi, la connexion et l'application inter-application A2A sont de même origine et gratuites."
{
  "html": "<div class=\"diagram-ws\"><div class=\"diagram-panel\" data-rough><strong>https://your-agents.com</strong><div class=\"diagram-row\"><span class=\"diagram-pill accent\">/mail/*</span><small class=\"diagram-muted\">apps/mail</small></div><div class=\"diagram-row\"><span class=\"diagram-pill accent\">/calendar/*</span><small class=\"diagram-muted\">apps/calendar</small></div><div class=\"diagram-row\"><span class=\"diagram-pill accent\">/forms/*</span><small class=\"diagram-muted\">apps/forms</small></div></div><div class=\"diagram-col wins\"><span class=\"diagram-pill ok\">shared login session</span><span class=\"diagram-pill ok\">A2A inter-apps sans configuration</span></div></div>",
  "css": ".diagram-ws{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.diagram-ws .diagram-panel{display:flex;flex-direction:column;gap:6px;padding:14px 16px}.diagram-ws .diagram-row{display:flex;align-items:center;gap:8px}.diagram-ws .wins{display:flex;flex-direction:column;gap:8px;align-items:flex-start}"
}
```

Le déploiement de même origine vous offre deux gros gains gratuits :

- **Session de connexion partagée** : connectez-vous à n'importe quelle application, chaque application est connectée.
- **A2A inter-applications sans configuration** — le marquage de `@calendar` à partir du courrier est une récupération de même origine ; pas de signature CORS, pas de JWT entre frères et sœurs.

Publiez le résultat avec :

```bash
wrangler pages deploy dist
```

Pour les déploiements unifiés Netlify, utilisez le préréglage Netlify :

```bash
npx @agent-native/core@latest deploy --preset netlify
```

Pour les déploiements unifiés Vercel, utilisez le préréglage Vercel :

```bash
npx @agent-native/core@latest deploy --preset vercel
```

Lors de la configuration d'une commande de build de fournisseur, utilisez la même commande avec `--build-only`. Vercel devrait exécuter `npx @agent-native/core@latest deploy --preset vercel --build-only` ; la commande écrit directement `.vercel/output`, donc aucun `vercel.json` n'est requis pour le routage de l'espace de travail.

Les builds d'espace de travail hébergé nécessitent `A2A_SECRET` dans l'environnement du fournisseur de déploiement.
Cela permet aux Slack, aux webhooks entrants et aux A2A inter-applications de reprendre leur travail via une signature
processeurs d'arrière-plan. Les vérifications locales des artefacts `--build-only` s'exécutent toujours sans celui-ci.

Le déploiement indépendant par application est toujours pris en charge – juste `cd apps/<name> && npx @agent-native/core@latest build` comme un échafaudage autonome.

## Comment ça marche {#how-it-works}

Lorsque vous exécutez `npx @agent-native/core@latest build`, Nitro crée à la fois le client SPA et le serveur API dans `.output/` :

```an-file-tree title="Sortie de build"
{
  "entries": [
    { "path": ".output/", "note": "Autonome : copiez vers n'importe quel environnement et exécutez" },
    { "path": ".output/public/", "note": "SPA buildée (assets statiques)" },
    { "path": ".output/server/index.mjs", "note": "Point d'entrée serveur" },
    { "path": ".output/server/chunks/", "note": "Chunks de code serveur" }
  ]
}
```

La sortie est autonome : copiez `.output/` dans n'importe quel environnement et exécutez-le.

```an-diagram title="Construire pour déployer" summary="Une arborescence source se construit selon un préréglage Nitro ; la même sortie autonome s'exécute sur Node, Vercel, Netlify, Cloudflare, AWS ou Deno. Chaque instance pointe vers le même DATABASE_URL persistant."
{
  "html": "<div class=\"diagram-deploy\"><div class=\"diagram-box\" data-rough>Source de l’app</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">build</span><small class=\"diagram-muted\">Nitro preset</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-grid\"><span class=\"diagram-pill\">Node.js</span><span class=\"diagram-pill\">Vercel</span><span class=\"diagram-pill\">Netlify</span><span class=\"diagram-pill\">Cloudflare</span><span class=\"diagram-pill\">AWS Lambda</span><span class=\"diagram-pill\">Deno</span></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>DATABASE_URL persistante<br><small class=\"diagram-muted\">shared by every instance</small></div></div>",
  "css": ".diagram-deploy{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-deploy .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px 16px}.diagram-deploy .diagram-arrow{font-size:22px;line-height:1}.diagram-deploy .diagram-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}"
}
```

## Définition du préréglage {#setting-the-preset}

Par défaut, Nitro est construit pour Node.js. Pour cibler une autre plate-forme, définissez le préréglage dans votre `vite.config.ts` :

```ts
import { agentNative } from "@agent-native/core/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [agentNative({ nitro: { preset: "vercel" } })],
});
```

Ou utilisez la variable d'environnement `NITRO_PRESET` au moment de la construction :

```bash
NITRO_PRESET=netlify npx @agent-native/core@latest build
```

## Node.js (par défaut) {#nodejs}

Le préréglage par défaut. Créer et exécuter :

```bash
npx @agent-native/core@latest build
node .output/server/index.mjs
```

Définissez `PORT` pour configurer le port d'écoute (par défaut : `3000`).

Utilisez la gamme Node.js LTS actuelle pour les déploiements en production. Depuis mai 2026,
est Node.js 24 ; Le Node.js 20 est arrivé en fin de vie le 30 avril 2026 et non plus
reçoit des mises à jour de sécurité en amont.

### Docker {#docker}

```dockerfile
FROM node:24-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-slim
WORKDIR /app
COPY --from=build /app/.output .output
# data/ est un répertoire SQLite créé au moment de l'exécution — ne copiez pas une base de données de développement dans prod.
# Pour la production, définissez DATABASE_URL sur une instance hébergée de Postgres ou Turso.
RUN mkdir -p /app/data
ENV PORT=3000
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
```

## Vercel {#vercel}

```ts
// vite.config.ts
export default defineConfig({
  plugins: [agentNative({ nitro: { preset: "vercel" } })],
});
```

Déployez via Vercel CLI ou git push :

```bash
vercel deploy
```

Pour un espace de travail, créez chaque application dans un seul bundle Vercel Build Output API :

```bash
npx @agent-native/core@latest deploy --preset vercel
```

Pour les déploiements Vercel Git, définissez la commande build sur :

```bash
npx @agent-native/core@latest deploy --preset vercel --build-only
```

La version de l'espace de travail copie la sortie Nitro `vercel` de chaque application dans la racine `.vercel/output`, attribue à chaque fonction son propre environnement de chemin de montage et écrit la configuration de route qui dessert les applications sur `/<app-id>`.

## Netlify {#netlify}

Le préréglage Nitro `netlify` fonctionne bien et, en pratique, nous a permis des démarrages à froid beaucoup plus rapides que les pages Cloudflare (~ 200 ms TTFB contre ~ 9 s) pour les modèles qui communiquent avec un Postgres externe (Neon). Soit définir le préréglage dans `vite.config.ts` :

```ts
// vite.config.ts
export default defineConfig({
  plugins: [agentNative({ nitro: { preset: "netlify" } })],
});
```

…ou définissez `NITRO_PRESET=netlify` au moment de la construction.

Pour un espace de travail, déployez chaque application à partir d'un site Netlify en exécutant :

```bash
npx @agent-native/core@latest deploy --preset netlify
```

La version de l'espace de travail écrit les ressources statiques sous `dist/_workspace_static/` et achemine chaque application vers sa propre fonction Netlify sans redirection forcée des ressources, de sorte que les fichiers comme `/mail/assets/...` sont servis de manière statique avant que la fonction serveur ne gère les routes des applications.

## Pages Cloudflare {#cloudflare-pages}

```ts
// vite.config.ts
export default defineConfig({
  plugins: [agentNative({ nitro: { preset: "cloudflare_pages" } })],
});
```

## AWS Lambda {#aws-lambda}

```ts
// vite.config.ts
export default defineConfig({
  plugins: [agentNative({ nitro: { preset: "aws_lambda" } })],
});
```

## Déploiement Deno {#deno-deploy}

```ts
// vite.config.ts
export default defineConfig({
  plugins: [agentNative({ nitro: { preset: "deno_deploy" } })],
});
```

## Variables d'environnement {#environment-variables}

### Construction/Exécution {#env-runtime}

| Variable                    | Description                                                                                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                      | Port du serveur (Node.js uniquement)                                                                                                                                    |
| `NITRO_PRESET`              | Remplacer le préréglage de build au moment de la build                                                                                                                  |
| `APP_BASE_PATH`             | Montez l'application sous un préfixe (par exemple `/mail`). Réglé automatiquement par `npx @agent-native/core@latest deploy` ; laissez-le désactivé pour être autonome. |
| `AGENT_PROD_CODE_EXECUTION` | Mode d'exécution du code de production facultatif : `off` (par défaut), `sandboxed` ou `trusted`. Voir [Production Code Execution](#production-code-execution).         |

Les variables de connexion à la base de données (`DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `<APP_NAME>_DATABASE_URL` par application) résident dans [Database](/docs/database#production).

### Obligatoire en production {#env-required-prod}

Ceux-ci doivent être définis avant de promouvoir une application vers un véritable déploiement de production. Les valeurs manquantes sont soit fermées par échec (le framework refuse de démarrer/refuse de traiter les requêtes), soit reviennent à un comportement plus faible avec un avertissement fort.

| Variable                 | Description                                                                                                                                                                                                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`     | Chaîne aléatoire de plus de 32 caractères. Cookies de session de signalisation AND est la solution de secours HMAC pour `OAUTH_STATE_SECRET` et `SECRETS_ENCRYPTION_KEY`. Obligatoire : le framework se lance au démarrage s'il est manquant en production.                                                          |
| `BETTER_AUTH_URL`        | Origine publique de cette application (par exemple `https://mail.example.com`). Utilisé pour le domaine de cookie et la construction de redirection OAuth.                                                                                                                                                           |
| `ANTHROPIC_API_KEY`      | Clé API pour l'agent de production intégré. **Dans les déploiements multi-locataires**, le framework refuse de revenir à cela lorsque l'utilisateur ne dispose pas de clé par utilisateur : apporter votre propre clé est requis. Les installations auto-hébergées à locataire unique l'utilisent comme clé globale. |
| `OAUTH_STATE_SECRET`     | Clé HMAC dédiée aux enveloppes d'état OAuth (Google, Atlassian, Zoom). Revient à `BETTER_AUTH_SECRET` lorsqu'il n'est pas défini, mais une valeur dédiée est recommandée afin que la rotation de l'une n'invalide pas l'autre. Générer via `openssl rand -hex 32`.                                                   |
| `A2A_SECRET`             | HMAC partagé pour A2A JSON-RPC inter-applications. Sans cela, chaque point de terminaison A2A et le point de terminaison à déclenchement automatique `/_agent-native/integrations/process-task` renvoient 503 en production.                                                                                         |
| `SECRETS_ENCRYPTION_KEY` | Clé AES-256-GCM pour le coffre-fort de secrets chiffrés au repos. Revient à `BETTER_AUTH_SECRET`. Échec brutal en production lorsque les deux ne sont pas définis.                                                                                                                                                   |

### Authentification et identité {#env-auth}

Les informations d'identification du fournisseur OAuth (Google, GitHub), les solutions de secours du support MCP statiques (`ACCESS_TOKEN` / `ACCESS_TOKENS`) et les bascules de vérification des e-mails sont documentées dans [Authentication](/docs/authentication). Définissez-les ici selon le mode d'authentification que vous choisissez.

### Entrant Webhooks {#env-webhooks}

Chaque intégration de messagerie nécessite son propre secret de signature en production (les gestionnaires échouent en cas de requêtes falsifiées lorsque le secret est manquant). Les variables par intégration sont répertoriées dans [Messaging](/docs/messaging) et [Security](/docs/security). Pour le développement local uniquement, `AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS=1` revient sur « avertir et accepter » – ne le définissez jamais en production.

### Configuration de la sécurité (adhésion) {#security-config}

Les valeurs par défaut sont strictes. Une poignée d'indicateurs d'adhésion assouplissent le comportement (traces de pile de débogage, webhooks non vérifié, secours de clé à l'échelle de l'espace de travail, commutateur multi-organisation du hub MCP, écritures de la variable d'environnement d'exécution). Ils sont documentés avec leurs compromis en matière de sécurité dans [Security](/docs/security). Ne les définissez pas à moins que vous souhaitiez spécifiquement le chemin détendu.

### Héritage .env de l'espace de travail {#env-inheritance}

Dans un espace de travail, la racine `.env` est chargée automatiquement dans chaque application, de sorte que les clés partagées telles que `ANTHROPIC_API_KEY`, `A2A_SECRET`, `BETTER_AUTH_SECRET` et `OAUTH_STATE_SECRET` ne doivent être définies qu'une seule fois. `apps/<name>/.env` par application gagne en cas de conflit.

### Générer des secrets puissants {#env-generate-secrets}

Pour tout secret marqué « 32+ caractères aléatoires » (`BETTER_AUTH_SECRET`, `OAUTH_STATE_SECRET`, `A2A_SECRET`, `SECRETS_ENCRYPTION_KEY`), générez de nouvelles valeurs avec :

```bash
openssl rand -hex 32
```

Faites-les pivoter en remplaçant la variable d'environnement sur chaque instance et en redéployant : les enveloppes d'état des sessions/OAuth signées sous l'ancienne clé deviennent invalides, les utilisateurs devront donc peut-être se reconnecter.

## Outils d'agent de production {#production-agent-tools}

Les agents de production obtiennent les outils actions enregistrés ainsi que les outils-cadres de l'application
le plugin de chat d'agent. Les écritures de base de données sont activées par défaut car la base de données brute
les outils sont limités à l'utilisateur/à l'organisation authentifié, mais les propriétaires d'applications peuvent restreindre l'accès
faire surface lorsqu'un déploiement devrait être plus opiniâtre :

```ts
// server/plugins/agent-chat.ts
export default createAgentChatPlugin({
  // Default: "write" (also true)
  databaseTools: "read", // "write" | "read" | "off"
  extensionTools: false,
});
```

- `databaseTools: "write"` — par défaut. Registres `db-schema`, `db-query`,
  `db-exec` et `db-patch`. Les écritures sont limitées à l'utilisateur/à l'organisation actuelle et
  les modifications de schéma sont bloquées.
- `databaseTools: "read"` — enregistre uniquement `db-schema` et `db-query` ; agents
  inspectez les données avec SQL mais devez utiliser l'application typée actions pour les écritures.
- `databaseTools: "off"` ou `false` : supprime les outils de base de données brutes du
  surface de l'agent afin que les actions de l'application soient le seul chemin d'accès aux données.
- `extensionTools: false` — supprime la gestion des extensions de framework actions et
  guides rapides (`create-extension`, `update-extension`, etc.) pour les applications qui
  ne souhaitez pas que l'agent crée des mini-applications en bac à sable.

## Exécution du code de production {#production-code-execution}

Par défaut, les agents de production s'exécutent sans outils d'exécution de code. Ils peuvent appeler l'application actions, les outils de base de données, les outils MCP, les outils de navigateur/session et d'autres outils de framework enregistrés, mais ils n'ont pas accès au shell ou au système de fichiers.

Les déploiements compatibles avec les nœuds peuvent opter pour l'exécution du code de production via le plug-in de chat d'agent ou un remplacement d'environnement :

```ts
// server/plugins/agent-chat.ts
export default createAgentChatPlugin({
  codeExecution: { production: "sandboxed" },
});
```

Les modes disponibles sont :

- `off` — valeur par défaut. Aucun outil d'exécution de code n'est enregistré en production.
- `sandboxed` : enregistre `run-code`, un exécuteur Node.js JavaScript isolé avec un environnement épuré, un nouveau répertoire temporaire, des limites de sortie/durée et un pont d'hôte local pour les outils enregistrés sur liste autorisée tels que `provider-api-request`, `provider-api-docs`, `provider-api-catalog`, `web-request` et le pont de fichiers d'espace de travail basé sur les ressources utilisé par `workspaceRead` / `workspaceWrite`.
- `trusted` : enregistre `run-code` ainsi que le registre complet de l'outil de codage (`bash`, `read`, `edit`, `write`). Utilisez-le uniquement pour les déploiements à locataire unique ou contrôlés par un opérateur où l'accès complet du shell à l'hôte est intentionnel.

Définissez `AGENT_PROD_CODE_EXECUTION=sandboxed` ou `AGENT_PROD_CODE_EXECUTION=trusted` pour remplacer l'option du plug-in pour un déploiement spécifique sans modification du code. `AGENT_PROD_CODE_EXECUTION=off` force l'exécution du code même lorsque l'option du plugin l'active.

Le bac à sable `run-code` est une isolation au niveau du processus, pas un conteneur de système d'exploitation. Il supprime les secrets d'application de l'environnement de processus enfant et utilise le modèle d'autorisation Node lorsqu'il est disponible, mais le réseau sortant n'est pas bloqué par Node lui-même ; les appels authentifiés doivent passer par les assistants de pont exposés par l'outil.

## Mise à jour de UI en production {#updating-ui-in-production}

L'une des fonctionnalités principales de l'agent natif est que l'agent peut modifier le code source de votre application : composants, itinéraires, styles, actions. Pendant le développement local, cela fonctionne de manière transparente car l'agent dispose d'un accès complet au système de fichiers.

Dans un déploiement de production standard sans [production code execution](#production-code-execution), l'agent a accès aux outils de l'application (actions, base de données, MCP) mais pas au système de fichiers. Cela signifie que l'agent peut lire et écrire des données, exécuter actions et interagir avec des services externes, mais il ne peut pas modifier vos composants React ni ajouter de nouvelles routes sur une instance déployée.

### Builder.io : Édition visuelle en production {#builderio}

[Builder.io](https://www.builder.io) résout ce problème en fournissant un environnement cloud géré dans lequel l'agent conserve la possibilité de modifier le UI de votre application en production. Connectez votre dépôt à Builder.io et demandez directement les modifications de UI – aucun redéploiement n'est nécessaire.

**Comment ça marche :**

1. Connectez votre dépôt natif d'agent à Builder.io
2. Builder.io fournit un cadre cloud avec l'agent, l'édition visuelle et la collaboration en temps réel
3. Inviter l'agent à apporter des modifications à UI : il modifie vos composants, itinéraires et styles en direct
4. Les modifications sont validées dans votre dépôt

Voir [Frames](/docs/frames) pour en savoir plus sur le panneau d'agent intégré et les options de cadre cloud.

## Déploiements multi-instances {#multi-instance}

Les applications natives d'agent stockent tous les états dans SQL avec Drizzle et synchronisent le UI via [polling](/docs/key-concepts#polling-sync) avec la base de données : pas d'état du système de fichiers, pas de sessions persistantes, pas de caches en mémoire. Cela signifie que les déploiements multi-instances et sans serveur fonctionnent immédiatement : pointez chaque instance vers le même `DATABASE_URL` et elles convergent automatiquement. Voir [Key Concepts — Data in SQL](/docs/key-concepts#data-in-sql) et [Portability](/docs/key-concepts#hosting-agnostic).
