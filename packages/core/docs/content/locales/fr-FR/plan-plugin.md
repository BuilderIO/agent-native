---
title: "Plugin de planification et place de marché"
description: "Installez le Plan Agent-Native skills (/visual-plan, /visual-recap) ainsi que le connecteur Plan MCP hébergé en tant que code Claude ou plugin Codex, ou avec le CLI universel. Comment fonctionnent les mises à jour et si vous devez soumettre quelque chose."
---

# Plugin et place de marché du plan

L'application Agent-Native **Plan** est livrée sous la forme d'un ensemble installable. Une seule installation ajoute à la fois la commande slash Plan skills **et** connecte le connecteur Plan MCP hébergé, afin que l'agent puisse générer des plans et que le skills puisse les publier directement dans l'application Plan.

## Ce que vous obtenez {#what-you-get}

Une installation vous offre :

- **Deux skills** — `/visual-plan` (le point d'entrée canonique) et `/visual-recap`.
- **Le connecteur Plan MCP** — enregistré auprès de l'application hébergée sur `https://plan.agent-native.com` (point de terminaison MCP `https://plan.agent-native.com/_agent-native/mcp`, nom de serveur `plan`).

```an-diagram title="Trois itinéraires, un forfait" summary="Les plugins universels CLI, Claude Code et Codex installent tous les mêmes deux compétences plus le connecteur Plan hébergé."
{
  "html": "<div class=\"diagram-routes\"><div class=\"diagram-col\"><div class=\"diagram-node\">Universal CLI<br><small class=\"diagram-muted\">skills add visual-plan</small></div><div class=\"diagram-node\">Plugin Claude Code<br><small class=\"diagram-muted\">/plugin install</small></div><div class=\"diagram-node\">Plugin Codex<br><small class=\"diagram-muted\">codex plugin add</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">/visual-plan</span><span class=\"diagram-pill accent\">/visual-recap</span><small class=\"diagram-muted\">two skills</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">Plan MCP connector<br><small class=\"diagram-muted\">plan.agent-native.com/_agent-native/mcp</small></div></div>",
  "css": ".diagram-routes{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-routes .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-routes .diagram-arrow{font-size:22px;line-height:1}.diagram-routes .center{display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center}.diagram-routes .center .diagram-pill{margin:2px}"
}
```

Par défaut, les deux skills publient sur l'application Plan hébergée : ils créent un plan via
le connecteur MCP et vous remettra un lien ou un plan en ligne à examiner. Ils ne jettent jamais
un plan Markdown/ASCII en ligne dans le chat comme livrable. Si un outil Planifier
renvoie `needs auth`, `Unauthorized` ou `Session terminated`, ré-authentifier
le connecteur au lieu de revenir à la sortie en ligne. Les jetons d'accès sont
longue durée de vie (30 jours par défaut, actualisation glissante sur 365 jours), cela devrait donc être rare ;
Quand cela se produit, la solution légère est la suivante :

```bash
npx -y @agent-native/core@latest reconnect https://plan.agent-native.com --client codex
```

`reconnect` recherche et actualise le connecteur par URL pour le local sélectionné
client : aucune réinstallation n'est nécessaire. Démarrez un nouveau thread Codex après vous être reconnecté afin que
rechargement du registre des outils. Dans le code Claude, l'équivalent est `/mcp` →
**Authentifier / Reconnecter**, ou la même commande avec `--client claude-code`.

L'exception est le **mode de confidentialité des fichiers locaux** explicite. Quand vous ne demandez pas de DB
écrit ou définit `AGENT_NATIVE_PLANS_MODE=local-files`, le skills ne doit pas appeler
le connecteur Plan MCP. Ils écrivent `plans/<slug>/plan.mdx` plus facultatif
`canvas.mdx`, `prototype.mdx` et `.plan-state.json`, puis prévisualisez localement avec :

```bash
npx @agent-native/core@latest plan local serve --dir plans/<slug> --kind plan --open
```

Cela démarre un petit pont localhost et ouvre le plan UI par rapport au local
dossier. (`plan local preview` exécute à la place une route de serveur de développement Plan local, et
`plan local preview --out preview.html` est une trappe de secours héritée qui écrit un
fichier HTML statique autonome. `plan serve` est accepté comme alias court pour
`plan local serve`.)

Quelques pièges du mode fichiers locaux à connaître :

- **Utilisez un navigateur Chromium.** Safari bloque la page du plan HTTPS hébergée
  lecture du pont localhost `http://127.0.0.1` (contenu mixte / privé
  réseau), la page se bloque donc sur "Plan de chargement". Déjà sur macOS `--open`
  préfère Chrome/Chromium/Edge/Brave ; si Safari s'ouvre quand même, rouvrez le fichier imprimé
  URL dans un navigateur Chromium.
- **Le URL servi est écrit dans `plans/<slug>/.plan-url`** (remplacer par
  `--url-file`). Un agent en arrière-plan ou sans tête peut lire ce fichier au lieu de
  grattage de la sortie standard `serve` de longue durée. Traitez-le comme un fichier de jeton local et
  ne le commettez pas.
- **Vérifiez sans interface graphique** lorsqu'aucun navigateur n'est disponible :
  `npx @agent-native/core@latest plan local verify --dir plans/<slug>` démarre le
  pont, vérifie le contrôle en amont du réseau privé et la charge utile JSON, imprime
  diagnostics et sorties non nulles en cas d'échec – aucun œil humain requis.
- **Exécutez d'abord `plan local check`.** Il valide le MDX par rapport au plan
  Schéma de bloc du moteur de rendu (y compris les champs obligatoires comme l'élément `checklist`
  `id`/`label` et `question-form` question `id`/`title`/`mode`), donc création
  des erreurs font surface avant le transfert du navigateur au lieu d'un chargeur bloqué.

Pour les dossiers du dépôt actuel, la route locale directe inclut `?path=...` donc
l'application Plan locale peut conserver les modifications du navigateur enregistrées dans le dossier du dépôt. Le plan
l'application utilise `apps.plan.roots[0].path` dans `agent-native.json` comme emplacement par défaut
pour enregistrer les plans locaux promus, en revenant à `plans/`.

Cela maintient le contenu du plan hors de la base de données du plan Agent-Native. Partage hébergé,
les commentaires, les captures d'écran et l'historique du plan ne sont pas disponibles jusqu'à ce que vous l'ayez explicitement
publier plus tard.

```an-diagram title="Mode hébergé ou fichiers locaux" summary="Par défaut, les compétences sont publiées via le connecteur ; Le mode fichiers locaux écrit MDX sur le disque et prévisualise via un pont localhost à la place."
{
  "html": "<div class=\"diagram-modes\"><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Par défaut · hébergé</span><strong>Publier dans l’app Plan</strong><small class=\"diagram-muted\">MCP connector &rarr; hosted DB &rarr; share links, comments, history, screenshots</small></div><div class=\"diagram-card\"><span class=\"diagram-pill warn\">Confidentialité fichiers locaux</span><strong>Écrire le MDX sur disque</strong><small class=\"diagram-muted\">plan.mdx + canvas.mdx + prototype.mdx &rarr; localhost bridge &rarr; hosted Plan UI reads local source. No Écriture BDs until <code>publish-visual-plan</code>.</small></div></div>",
  "css": ".diagram-modes{display:flex;gap:14px;flex-wrap:wrap}.diagram-modes .diagram-card{flex:1 1 260px;display:flex;flex-direction:column;gap:6px;padding:16px 18px}"
}
```

Agent Native Desktop dispose d'un chemin de synchronisation de fichiers locaux distinct pour les forfaits hébergés : le
L'application de bureau peut refléter un plan hébergé dans des fichiers MDX locaux et réimporter les modifications
sans cloner l'application Plan ni exécuter un CLI. Ce workflow conserve l'hébergement
Planifier la base de données comme source de vérité ; utiliser le mode de confidentialité des fichiers locaux lorsque l'objectif
il n'y a pas d'écriture dans la base de données Plan.

> Le plugin (`agent-native-visual-plans`) porte l'identifiant d'application `visual-plans`, c'est pourquoi le nom du plugin Claude Code et le nom du plugin Codex sont tous deux `agent-native-visual-plans`. Le nom d'affichage de l'application Plan est "Agent-Native Plan".

## Installer des itinéraires {#install}

Il existe trois façons d'y accéder. La **route universelle CLI** est celle que nous recommandons par défaut, car elle installe le skills **et** vous permet de choisir le mode hébergé, fichiers locaux ou auto-hébergé en un seul flux. Les routes de plugins sont destinées aux hôtes dotés d'un système de plugins/place de marché de première classe et utilisent des plans hébergés par défaut.

### Itinéraire de compétences universel (n'importe quel hôte MCP) {#universal}

Fonctionne pour n'importe quel hôte : code Claude, Codex, Cursor, Cline, Goose, applications ChatGPT personnalisées MCP, Claude Cowork et tout ce qui est compatible avec MCP. Le Agent-Native CLI installe les deux skills, enregistre le connecteur Plan MCP hébergé et **et exécute l'authentification pour le(s) client(s) local(s) sélectionné(s) au cours de la même étape**, afin que votre premier appel d'outil ne heurte pas un mur OAuth :

```bash
npx @agent-native/core@latest skills add visual-plan
```

Cela installe `visual-plan` ainsi que la compétence associée `visual-recap`, puis enregistre le connecteur `plan`, puis exécute l'authentification (invite OAuth pour le partage hébergé/soutenu par un compte). Indicateurs utiles :

- `--client codex|claude-code|claude-code-cli|cowork|all` — pour quels agents locaux écrire la configuration MCP (`all` par défaut).
- `--no-connect` : enregistre le connecteur sans authentification ; exécutez `npx @agent-native/core@latest connect https://plan.agent-native.com --client all` plus tard ou choisissez un `--client` plus étroit.
- `--mode hosted|local-files|self-hosted` : choisissez le partage hébergé, les fichiers MDX entièrement locaux ou votre propre application Plan.
- `--mcp-url <url>` : pointez le connecteur vers une origine personnalisée (un tunnel ngrok, un serveur de développement local ou un déploiement auto-hébergé) au lieu de l'origine hébergée par défaut.
- `--with-github-action` — rédigez également l'action PR Visual Recap GitHub (voir [PR Visual Recap](/docs/pr-visual-recap)).

Les installations interactives proposent également l'action PR Visual Recap lorsqu'aucun flux de travail n'est disponible
présent. Dites oui pour l'ajouter lors de la configuration des compétences, ou exécutez la commande ci-dessus plus tard
avec `--with-github-action`. Une fois le workflow écrit, exécutez :

```bash
npx @agent-native/core@latest recap setup
npx @agent-native/core@latest recap doctor
```

`recap setup` configure les secrets et les variables de l'action GitHub lorsque cela est possible,
et `recap doctor` vérifie le workflow, le jeton de publication local, le dépôt GitHub
accès et configuration Actions requise. Une fois l'installation terminée, redémarrez ou
rechargez le client de l'agent pour que le nouveau skills et les nouveaux outils se chargent, puis exécutez
`/visual-plan`.

> Remarque : le `npx skills@latest add BuilderIO/agent-native --skill visual-plan` nu (Vercel/open Skills CLI) installe **instructions uniquement** — il n'enregistre pas le connecteur MCP. Utilisez le Agent-Native CLI ci-dessus lorsque vous souhaitez également câbler le connecteur.

### Code Claude (plugin) {#claude-code}

Le référentiel public `BuilderIO/agent-native` est lui-même un marché de plugins Claude Code, vous l'ajoutez donc directement – sans étape de construction. À l'intérieur du code Claude :

```text
/plugin marketplace add BuilderIO/agent-native
/plugin install agent-native-visual-plans@agent-native-apps
/reload-plugins
/mcp        # authenticate the Plan connector (one OAuth approval)
```

`/plugin install` ajoute à la fois le plan skills et une configuration MCP **URL uniquement** (aucun secret dans le package) ; `/mcp` → **Authentifier** termine la négociation OAuth. Utilisez plutôt la route universelle CLI lorsque vous souhaitez des fichiers locaux ou un mode auto-hébergé.

> Le catalogue Marketplace s'appelle `agent-native-apps` et le plug-in Plan est `agent-native-visual-plans`, la cible d'installation est donc toujours `agent-native-visual-plans@agent-native-apps`.

### Codex (plug-in) {#codex}

Le même référentiel est un marché de plugins Codex. Ajoutez-le, installez le plugin, puis authentifiez le connecteur :

```bash
codex plugin marketplace add BuilderIO/agent-native
codex plugin add agent-native-visual-plans@agent-native-apps
codex mcp login plan   # OAuth dans le navigateur
```

Après l'installation, **démarrez un nouveau thread Codex** pour que les outils skills et MCP se chargent dans la session. Le plugin est livré avec un connecteur uniquement URL (`[mcp_servers.plan]` → `https://plan.agent-native.com/_agent-native/mcp`) ; `codex mcp login plan` exécute le flux OAuth. La route universelle CLI ci-dessus fonctionne également pour Codex (`npx @agent-native/core@latest skills add visual-plan --client codex`) si vous préférez une commande qui s'installe et s'authentifie ensemble, ou lorsque vous souhaitez des fichiers locaux ou un mode auto-hébergé.

> **Installations plus anciennes :** si votre configuration a toujours une entrée `agent-native-plans` pointant vers le même URL, exécutant `npx -y @agent-native/core@latest reconnect https://plan.agent-native.com --client codex` pour Codex, ou la même commande avec votre `--client` cible, la consolide avec le nom canonique `plan`.

## Mises à jour {#updates}

Le plugin achemine la mise à jour automatique : vous ne reconditionnez ni n'ajoutez de nouveau le marché pour les changements de compétences de routine :

- **Code Claude** — l'entrée du marché définit `autoUpdate: true` et le plugin utilise la gestion des versions commit-SHA, donc le code Claude extrait les nouvelles versions du référentiel au démarrage ; exécutez `/reload-plugins` pour l'activer. Chaque poussée vers la branche par défaut du dépôt atteint automatiquement les utilisateurs installés.
- **Codex** — le plugin `version` intègre un hachage de contenu du point de terminaison skills et MCP groupé (par exemple `1.0.0+codex.<hash>`), de sorte que toute modification de compétence ou de point de terminaison génère une nouvelle version. La mise à niveau automatique de démarrage de Codex réinstalle seule les places de marché Git configurées ; il suffit de **démarrer un nouveau fil** pour prendre en compte le changement. Aucun `codex plugin marketplace upgrade` manuel n'est nécessaire pour les mises à jour de routine.
- **Route universelle CLI** — exécutez `npx @agent-native/core@latest skills status visual-plan` pour vérifier les dossiers de compétences copiés, ou `npx @agent-native/core@latest skills update visual-plan` pour les actualiser. La réexécution de `skills add visual-plan` fonctionne toujours lorsque vous souhaitez également réenregistrer/authentifier le connecteur. `@latest` extrait toujours le skills actuel du package `@agent-native/core` publié.

Le connecteur pointe vers une application **hébergée**, de sorte que le actions et la surface de l'outil en direct de l'application Plan reflètent toujours la version déployée, quel que soit le moment où vous l'avez installé ; seules les instructions de compétences groupées suivent les mécanismes de mise à jour ci-dessus.

> **Mainteneurs :** le bundle de marché (`.claude-plugin/`, `.agents/plugins/`) est généré à partir du plan canonique skills par `pnpm sync:plan-marketplace` et vérifié dans CI par `pnpm guard:plan-marketplace`, de sorte que le marché publié correspond toujours au plan canonique skills. Modifiez la compétence, exécutez `pnpm sync:plan-marketplace` et validez.

## Avez-vous besoin de soumettre quelque chose ? {#submission}

**Aucune soumission ou révision n'est requise pour distribuer ou installer ceci.** `BuilderIO/agent-native` est un marché git public et auto-hébergé, les utilisateurs l'ajoutent donc directement avec les commandes ci-dessus sur **à la fois le code Claude et le Codex** — aucune demande ni approbation. L'itinéraire universel CLI ne nécessite aucun marché.

Découverte facultative, si vous souhaitez une liste publique :

- **Claude Code** dispose d'un marché communautaire auquel vous pouvez _éventuellement_ soumettre votre annonce (soumission plus un examen automatisé). Le marché officiel organisé par Anthropic est répertorié à la discrétion d'Anthropic — il n'y a pas d'application libre-service ouverte. Ni l'un ni l'autre n'est requis pour utiliser les commandes d'installation ci-dessus.
- **Codex** dispose d'un catalogue de plugins organisé par OpenAI (une liste verte fermée, provenant d'un partenariat plutôt que d'une soumission en libre-service). Les marchés Git auto-hébergés et la route CLI ne nécessitent aucune soumission pour fonctionner.

En bref : expédiez-le en tant que marché git auto-hébergé/public et les utilisateurs l'installent directement ; soumettez-le à un catalogue organisé uniquement si vous souhaitez qu'il soit répertorié pour la découverte.

## Plugin vs compétence {#plugin-vs-skill}

Une **compétence** est un fichier d'instructions `SKILL.md` unique que l'agent lit lorsqu'une tâche correspond. Un **plugin** (plugin Claude Code Marketplace ou plugin Codex) est un package qui regroupe un ou plusieurs skills **plus** un connecteur MCP et des métadonnées, afin qu'un hôte puisse tout installer en une seule étape.

Sous le capot, les trois routes sont produites à partir de la même source par le `npx @agent-native/core@latest app-skill` CLI : `app-skill pack` construit les adaptateurs de marché/plug-in, et `skills add` est le programme d'installation convivial en une étape qui enregistre et authentifie également le connecteur MCP. Voir [Skills Guide](/docs/skills-guide) pour le format du manifeste de compétence d'application et [External Agents](/docs/external-agents) pour connecter n'importe quel hôte MCP et le flux `npx @agent-native/core@latest connect`.

## Quelle est la prochaine étape {#whats-next}

- [**Visual Plans**](/docs/template-plan) — que font les skills et comment les utiliser
- [**PR Visual Recap**](/docs/pr-visual-recap) – exécutez `/visual-recap` automatiquement à chaque demande d'extraction
- [**Skills Guide**](/docs/skills-guide) — skills basé sur l'application et format manifeste
- [**External Agents**](/docs/external-agents) : connectez n'importe quel hôte MCP et artefacts aller-retour
