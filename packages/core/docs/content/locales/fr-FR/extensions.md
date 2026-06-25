---
title: "Extensions"
description: "Mini-applications que vos utilisateurs créent à l'intérieur de votre modèle : une vignette KPI personnalisée dans Analytics, une liste de contrôle de préparation à une réunion dans Calendrier, un widget de contact CRM dans Mail. Aucun déploiement, aucune modification de code, aucune modification de schéma."
---

# Extensions

Les extensions sont des **mini-applications que vos utilisateurs créent dans votre modèle**.

Si vous avez utilisé QuickBooks en ligne, vous avez vu le modèle : QBO est livré avec un produit comptable de base et les utilisateurs superposent de petits widgets personnalisés (un rapport personnalisé, un calculateur de paie, un vérificateur de règles fiscales) qui se trouvent dans la même application et utilisent les mêmes données. Les extensions sont la version native de l'agent de cette idée, sauf que vos utilisateurs n'écrivent aucun code. Ils décrivent ce qu'ils veulent et l'agent le construit.

Le cadrage est important : une extension n'est pas un bac à sable générique "faites ce que vous voulez". Il s'agit d'une **mini-application qui étend un modèle spécifique** (Mail, Analytics, Calendrier, Clips, Conception) et utilise le actions et les données de ce modèle. Une extension Mail lit les e-mails. Une extension Analytics lit les métriques d'un tableau de bord. Une extension Calendrier agit sur l'événement ouvert. Ils ont l'impression de faire partie du produit hôte car ils _font_ partie du produit hôte.

Trois éléments font que les extensions fonctionnent :

- **Pas de code, pas de déploiement.** L'agent les écrit et ils sont opérationnels en quelques secondes. Stocké dans la base de données, pas dans le dépôt.
- **Accès complet aux données du modèle.** Les extensions peuvent appeler le même actions que l'agent appelle : `list-emails` dans Mail, `list-decks` dans Slides, `list-recordings` dans Clips – elles disposent donc de tout ce que l'application hôte possède.
- **Stockage intégré.** Chaque extension possède son propre magasin de valeurs-clés par utilisateur/par organisation, elle peut donc enregistrer l'état sans que vous ayez à ajouter une nouvelle table SQL.

Si un modèle ne doit pas exposer les extensions créées par l'utilisateur, définissez
`extensionTools: false` sur `createAgentChatPlugin()`. Cela supprime le
Extension actions destinée aux agents et conseils rapides tout en quittant le reste du
Agent d'application intact.

```an-diagram title="Le pont du bac à sable" summary="L'extension HTML s'exécute dans une iframe isolée et atteint l'hôte uniquement via un ensemble fixe d'assistants de pont : chaque appel est limité et son accès est vérifié."
{
  "html": "<div class=\"ext-bridge\"><div class=\"diagram-card sandbox\" data-rough><span class=\"diagram-pill warn\">Sandboxed iframe</span><small class=\"diagram-muted\">Alpine.js HTML &middot; no host cookies, session, or DOM</small><div class=\"ext-helpers\"><span class=\"diagram-pill\">appAction</span><span class=\"diagram-pill\">appFetch</span><span class=\"diagram-pill\">dbQuery / dbExec</span><span class=\"diagram-pill\">extensionData</span><span class=\"diagram-pill\">extensionFetch</span></div></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&harr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">Template hôte<br><small class=\"diagram-muted\">actions, SQL auto-scopé</small></div><div class=\"diagram-box\">Secret proxy<br><small class=\"diagram-muted\"><code>${keys.NAME}</code>, verrouillé au domaine</small></div><div class=\"diagram-box\">APIs externes<br><small class=\"diagram-muted\">uniquement via extensionFetch</small></div></div></div>",
  "css": ".ext-bridge{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.ext-bridge .sandbox{display:flex;flex-direction:column;gap:8px;padding:16px 18px;flex:1;min-width:240px}.ext-bridge .ext-helpers{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}.ext-bridge .diagram-col{display:flex;flex-direction:column;gap:8px}.ext-bridge .diagram-arrow{font-size:24px}"
}
```

Les extensions peuvent également être **repo-backed en mode fichier local**. Dans ce flux de travail,
`agent-native.json` déclare un dossier `extensions`, chaque extension possède un
Manifeste `extension.json` plus un fichier d'entrée HTML, et l'application les restitue
fichiers via le même bac à sable. Les extensions basées sur des fichiers sont modifiées en modifiant
les fichiers du dépôt ; les extensions basées sur une base de données conservent le runtime créer/modifier/partager
expérience décrite ci-dessous.

## Une galerie rapide {#gallery}

De vraies extensions que les gens créeraient réellement, regroupées selon le modèle dans lequel ils vivent. Chacune d'elles est une chose ciblée, pas un couteau suisse.

### Courrier

Un utilisateur lit un e-mail provenant de `priya@acme.com`. Quel type de widget serait utile ?

- **Notes de contact** : un bloc-notes autocollant épinglé à la personne à qui l'utilisateur envoie un e-mail. Charge des notes pour ce contact, permet à l'utilisateur d'en écrire davantage.
- **Discussions récentes avec cette personne** : une petite liste des cinq dernières discussions avec le contact ouvert, distincte de la vue de la boîte de réception.
- **Enrichissement CRM** : extrait la taille de l'entreprise du contact, la date de la dernière réunion ou les offres ouvertes à partir de votre CRM.
- **Raccourci du planificateur de réunions** : transforme « Trouver une heure la semaine prochaine » en un widget « envoyer ces créneaux » en un seul clic.

Esquisse – Notes de contact (enregistre une note liée à la personne à qui vous envoyez un e-mail) :

```html
<div
  class="p-4"
  x-data="{
    contactEmail: window.slotContext?.contactEmail,
    note: '',
    async init() {
      if (!this.contactEmail) return;
      const saved = await extensionData.get('notes', this.contactEmail);
      if (saved) this.note = JSON.parse(saved.data).text;
    },
    async save() {
      await extensionData.set('notes', this.contactEmail, { text: this.note });
    }
  }"
>
  <p class="text-xs text-muted-foreground mb-2" x-text="contactEmail"></p>
  <textarea
    x-model="note"
    @blur="save()"
    class="w-full rounded-md border bg-background p-2 text-sm"
    rows="4"
    placeholder="Notes about this contact..."
  ></textarea>
</div>
```

### Analyses

Un utilisateur consulte un tableau de bord. Quelle est la tuile manquante ?

- **Boîte KPI personnalisée** : un seul grand nombre pour une métrique qui n'est pas un panneau intégré. "Les essais ont commencé cette semaine", "Delta MRR par rapport au mois dernier."
- **Goal Tracker** : extrait une mesure choisie par l'utilisateur et affiche la progression par rapport à un objectif saisi par l'utilisateur.
- **Classement des meilleurs clients** : rejoint une mesure avec un tableau de clients et classe les 10 meilleurs.

Esquisse – Zone KPI personnalisée (appelle l'une des requêtes `appAction` du modèle d'analyse) :

```html
<div
  class="p-4"
  x-data="{
  value: null,
  async init() {
    const result = await appAction('query-agent-native-analytics', {
      metric: 'trials_started',
      range: '7d'
    });
    this.value = result?.total ?? 0;
  }
}"
>
  <p class="text-xs uppercase tracking-wider text-muted-foreground">
    Trials this week
  </p>
  <p class="text-3xl font-bold mt-1" x-text="value ?? '—'"></p>
</div>
```

### Calendrier

L'utilisateur a un événement ouvert. Qu'est-ce qui pourrait aider à ce moment-là ?

- **Liste de contrôle de préparation à la réunion** : charge automatiquement les points de l'ordre du jour, les participants et les résumés des fils de discussion précédents pour l'événement ouvert.
- **Durée du trajet** – "vous avez 35 minutes avant votre prochain rendez-vous sur le lieu de la mission."
- **Aide au fuseau horaire** : affiche en un coup d'œil l'heure de la réunion dans l'heure locale de chaque participant.

### Extraits

Un utilisateur est en train de consulter un enregistrement d'écran. Qu'est-ce qui améliore cette vue ?

- **Extracteur d'éléments d'action** : lit la transcription du clip (l'agent la récupère via `appAction`), répertorie les tâches.
- **Partage automatique** : un clic "publier le lien de ce clip sur ma chaîne #recordings Slack."
- **Highlight reel** : extrait les chapitres générés par l'agent et les transforme en un menu de navigation rapide.

### Conception

Un utilisateur a un brouillon de page Alpine/Tailwind ouvert. Qu'est-ce qui faciliterait la boucle de prototypage ?

- **Échantillon de couleur de marque** : palette extraite de la configuration de la marque de l'utilisateur, cliquez pour copier une couleur dans l'éditeur.
- **Sélecteur d'éléments** : répertorie les images que l'utilisateur a téléchargées et dépose le URL en un clic.
- **Inspecteur d'espacement** : affiche les jetons d'espacement/padding/marge utilisés par la page active, afin que l'utilisateur puisse rester cohérent.

Modèle pour tous ces éléments : les extensions concernent **le moment** dans lequel se trouve l'utilisateur à l'intérieur du modèle hôte. L'agent sait déjà quel contact, quel tableau de bord, quel événement, quel clip — l'extension utilise ce contexte.

## Comment un utilisateur en crée un {#building}

Le chemin simple :

1. **Cliquez sur "Nouvelle extension"** dans la barre latérale (ou demandez simplement dans le chat).
2. **Décrivez ce que vous voulez en une phrase.** "Un bloc-notes autocollant pour le contact auquel j'envoie un e-mail." "Une box KPI pour les essais a débuté cette semaine."
3. **L'agent l'écrit et il apparaît dans votre liste d'extensions, prêt à être utilisé.**

Aucun fichier à modifier, pas de déploiement. L'agent sélectionne les bons assistants (`appAction`, `extensionData`, `extensionFetch`) et écrit le fichier Alpine.js HTML.

Si l'extension a besoin d'une clé API (un jeton CRM, une météo API), l'agent vous indique quoi ajouter et où l'ajouter. Les clés sont stockées cryptées et verrouillées sur des domaines spécifiques.

Si vous souhaitez modifier quelque chose plus tard, dites-le : "Ajouter un champ de recherche à mes notes de contact". L'agent modifie le HTML sur place — pas de régénération de l'ensemble.

Chaque modification est versionnée. Ouvrez le contrôle Historique de la visionneuse d'extensions pour voir
versions enregistrées, inspectez la différence par rapport à la version précédente et restaurez un
ancien nom/description/icône/instantané de contenu sans changement de propriétaire ou
partage.

## Ce qu'une extension peut faire {#capabilities}

Dans le bac à sable iframe, chaque extension dispose de ces assistants sur `window` :

| Aide                                             | Objectif                                                                         | Exemple                                                   |
| ------------------------------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `appAction(name, params)`                        | Appelez l'un des actions du modèle hôte                                          | `appAction('list-emails', { view: 'inbox' })`             |
| `appFetch(path, options)`                        | Appeler les points de terminaison du framework autorisés sous `/_agent-native/*` | `appFetch('/_agent-native/application-state/navigation')` |
| `dbQuery(sql, args)`                             | Lecture à partir de SQL (portée automatiquement sur l'utilisateur)               | `dbQuery('SELECT id, name FROM tools')`                   |
| `dbExec(sql, args)`                              | Écrire dans SQL                                                                  | `dbExec('INSERT INTO ...')`                               |
| `extensionFetch(url, options)`                   | Atteignez les API externes via un proxy sécurisé avec des secrets                | `extensionFetch('https://api.github.com/user')`           |
| `extensionData.set(collection, id, data, opts?)` | Conserver les données par extension (portée utilisateur/organisation)            | `extensionData.set('notes', id, { text: '...' })`         |
| `extensionData.list(collection, opts?)`          | Liste des éléments persistants                                                   | `extensionData.list('notes', { scope: 'all' })`           |
| `extensionData.get(collection, id, opts?)`       | Obtenir un seul objet                                                            | `extensionData.get('notes', 'note-1')`                    |
| `extensionData.remove(collection, id, opts?)`    | Supprimer un élément persistant                                                  | `extensionData.remove('notes', 'note-1')`                 |

Trois règles empiriques :

- **Préférez `appAction` à `dbQuery`.** Actions est la surface officielle du modèle : ils gèrent le contrôle d'accès, la portée et la validation pour vous. N'utilisez le SQL brut que lorsqu'aucune action ne vous convient.
- **Utilisez `appAction` pour les données de modèle.** L'extension `appFetch` est limitée aux points de terminaison du framework `/_agent-native/*` ; Les routes du modèle `/api/*` sont bloquées par le pont iframe.
- **Préférez `extensionData` plutôt que de créer de nouvelles tables.** Chaque extension obtient son propre magasin de valeurs-clés isolé. Pas de schéma, pas de migration. Définissez `{ scope: 'org' }` pour partager avec l'organisation de l'utilisateur, `'user'` (par défaut) pour privé.

```html
<script>
  // Private to me
  await extensionData.set('notes', 'note-1', { title: 'My note' });

  // Shared with my org
  await extensionData.set('notes', 'team-note', { title: 'Team note' }, { scope: 'org' });

  // List everything visible to me (mine + org)
  const all = await extensionData.list('notes', { scope: 'all' });
</script>
```

Les API externes passent par `extensionFetch`, qui remplace l'appel côté serveur et remplace les secrets via le modèle `${keys.NAME}` :

```html
<script>
  const res = await extensionFetch('https://api.github.com/user', {
    headers: { Authorization: 'Bearer ${keys.GITHUB_TOKEN}' },
  });
</script>
```

La clé réelle n'atteint jamais le navigateur. Chaque clé est verrouillée sur une liste autorisée de domaines, de sorte qu'une extension divulguée ne peut pas l'exfiltrer ailleurs.

## Slots – placer une extension à l'intérieur de l'hôte UI {#slots}

La galerie ci-dessus décrit _ce que_ fait une extension. Les emplacements décrivent _où_ il apparaît.

Par défaut, une extension se trouve sur sa propre page dans la liste des extensions : ouvrez-la comme une petite application. C'est parfait pour les tableaux de bord, les calculatrices et les widgets autonomes.

Mais le cas d'utilisation le plus proche de QBO est différent : l'utilisateur souhaite que son widget soit épinglé _à l'intérieur_ du UI du modèle — sous les informations de contact dans la barre latérale de Mail, dans le coin d'un tableau de bord Analytics, sur le côté droit d'un événement de calendrier. C'est à cela que servent les **emplacements**.

Un emplacement est une zone de widget nommée fournie par un modèle :

| Modèle         | Exemple d'emplacement          | Où il apparaît                                         |
| -------------- | ------------------------------ | ------------------------------------------------------ |
| **Courrier**   | `mail.contact-sidebar.bottom`  | Sous les coordonnées sur chaque fil de discussion      |
| **Analyses**   | `analytics.dashboard.tiles`    | À côté des panneaux intégrés du tableau de bord        |
| **Calendrier** | `calendar.event-detail.bottom` | Sous l'événement ouvert                                |
| **Extraits**   | `clips.right-panel.tabs`       | Un nouvel onglet dans le panneau de révision des clips |

Lorsqu'une extension est **installée dans un emplacement**, l'hôte envoie le contexte pertinent (l'adresse e-mail du contact, l'identifiant du tableau de bord, l'identifiant de l'événement) dans l'iframe. L'extension lit `window.slotContext` pour savoir ce que l'utilisateur regarde.

```an-diagram title="Les emplacements poussent le contexte dans le widget" summary="Le modèle hôte possède des emplacements nommés ; l'installation d'une extension dans une extension l'alimente window.slotContext pour tout ce que l'utilisateur consulte actuellement."
{
"html": "<div class=\"slot\"><div class=\"diagram-card\"><span class=\"diagram-pill\">Fil de mail</span><small class=\"diagram-muted\">slot <code>mail.contact-sidebar.bottom</code></small></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box accent\"><code>window.slotContext</code><br><small class=\"diagram-muted\">{ contactEmail }</small></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">Notes de contact</span><small class=\"diagram-muted\">loads notes for that contact &mdash; same widget, different context</small></div></div>",
"css": ".slot{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.slot .diagram-card{display:flex;flex-direction:column;gap:4px;padding:14px 16px;min-width:180px}.slot .diagram-arrow{font-size:22px}"
}

```

### Un exemple concret

Imaginez l'extension de notes de contact de la galerie. À lui seul, c'est un widget autonome. Pour le faire apparaître dans la barre latérale des contacts Mail :

1. Créez l'extension une fois. Utilisez `window.slotContext.contactEmail` pour qu'il sache à quel contact se trouve l'utilisateur.
2. Dites-lui l'emplacement qu'il peut remplir : `add-extension-slot-target { extensionId, slotId: "mail.contact-sidebar.bottom" }`.
3. Installez-le : `install-extension { extensionId, slotId: "mail.contact-sidebar.bottom" }`.

La prochaine fois que vous ouvrirez un fil de discussion, votre bloc-notes se trouvera juste sous les informations de contact et sera rempli de notes pour la personne à qui vous envoyez un e-mail. Basculez vers un autre fil de discussion, les notes pour _ce_ contact se chargent. Même extension, contexte différent, pas de réécriture.

En pratique, vous n'exécutez pas ces trois commandes à la main. Dites simplement « épingler ce widget dans la barre latérale de mes contacts » et l'agent gère la cible + l'installation pour vous.

> **Les emplacements sont une fonctionnalité _ajoutée_, pas une condition préalable.** De nombreuses extensions utiles ne sont jamais installées dans un emplacement - elles vivent heureusement sur leur propre page. Recherchez les emplacements lorsque le widget doit être _à côté_ de ce que l'utilisateur regarde dans le modèle hôte.

Pour plus de détails sur les emplacements (comment les déclarer dans votre modèle, comment fonctionne le contrat de contexte, comment les installations sont définies), consultez la compétence `extension-points`. Skills est livré dans chaque modèle d'échafaudage sous `.agents/skills/` ; voir [Skills Guide](/docs/skills-guide) pour savoir comment ils fonctionnent.

## Extensions de fichiers locales {#local-file-extensions}

Le mode fichier local permet à un espace de travail de conserver les extensions dans le dépôt :

```text
extensions/
  doc-status/
    extension.json
    index.html
```

```json
{
  "id": "doc-status",
  "name": "Doc Status",
  "description": "Shows metadata for the selected Content file.",
  "entry": "index.html",
  "slots": ["content.sidebar.bottom"],
  "permissions": {
    "appActions": ["list-documents"],
    "extensionData": true
  }
}
```

Ajoutez le dossier à l'application appropriée dans `agent-native.json` :

```json
{
  "apps": {
    "content": {
      "mode": "local-files",
      "roots": [{ "name": "Docs", "path": "docs", "extensions": [".mdx"] }],
      "components": "components",
      "extensions": "extensions"
    }
  }
}
```

L'application répertorie les extensions sauvegardées sur des fichiers ainsi que celles sauvegardées sur une base de données et les rendus
les via l'iframe sandbox normal. Déclarations d'emplacement dans `extension.json`
montez automatiquement l'extension dans les `ExtensionSlot` correspondants ; il n'y a pas de par utilisateur
Ligne d'installation SQL pour les extensions locales.

Les extensions locales ont un modèle d'autorisation v1 plus strict :

- `extensionData` est disponible pour les petits états d'exécution, sauf s'il est désactivé.
- Les appels `appAction` doivent être explicitement répertoriés dans `permissions.appActions`.
- `dbQuery`, `dbExec` et `extensionFetch` sont bloqués pour le moment.
- La mise à jour, la suppression, le partage et l'historique basés sur SQL actions renvoient un message qui
  pointe vers le fichier d'entrée local.

Utilisez des extensions basées sur une base de données lorsque les utilisateurs doivent créer/partager/modifier des widgets sur
environnement d'exécution. Utiliser des extensions de fichiers locales lorsque l'extension fait d'abord partie d'un dépôt
espace de travail et doit être révisable, patchable et versionné avec le reste de
les fichiers.

## Partage {#sharing}

Les extensions sont privées par défaut pour l'utilisateur qui les a créées. Pour partager :

- **Visible par l'organisation** : tous les membres de l'organisation peuvent le voir et l'utiliser.
- **Subventions par utilisateur** : invitez des personnes spécifiques en tant que spectateur/éditeur/administrateur.

Les extensions partagées ont leurs propres URL et se connectent à la même boîte de dialogue de partage que les documents, les présentations et les tableaux de bord. Les installations d'emplacements sont toujours personnelles : le partage d'une extension signifie que d'autres _peuvent_ l'installer ; il ne l'épingle pas automatiquement sur leur UI.

## Extensions ou modification du code de l'application {#vs-app-code}

Le framework permet à l'agent de modifier directement le code source de l'application : composants, itinéraires, styles. Alors, quand devriez-vous plutôt demander une extension ?

|                              | Extension                                                     | Modification du code de l'application                    |
| ---------------------------- | ------------------------------------------------------------- | -------------------------------------------------------- |
| **Créé par**                 | Agent (ou utilisateur) au moment de l'exécution               | Agent modifiant les fichiers sources                     |
| **Stocké dans**              | La base de données                                            | Le dépôt git                                             |
| **Nécessite une build**      | Non                                                           | Oui                                                      |
| **Nécessite un déploiement** | Non                                                           | Oui                                                      |
| **Portée**                   | Un utilisateur (ou partagé avec l'organisation)               | Le produit dans son intégralité, chaque utilisateur      |
| **Idéal pour**               | Widgets personnels, KPI personnalisés, utilitaires par équipe | Fonctionnalités de base fournies à tous les utilisateurs |

Règle générale : **si c'est pour un utilisateur ou une équipe, c'est une extension.** Si chaque utilisateur du modèle doit l'obtenir, expédiez-le comme une véritable fonctionnalité.

## Sécurité {#security}

```an-callout
{ "tone": "success", "body": "**The raw secret never reaches the browser.** `extensionFetch` substitutes `${keys.NAME}` server-side and each key is locked to a URL allowlist, so even a leaked extension can't exfiltrate it elsewhere." }
```

Les extensions s'exécutent dans une iframe en bac à sable :

- **Isolé** des cookies, de la session et de DOM de l'application parent.
- **Injection de secret côté serveur** via le modèle `${keys.NAME}` — la valeur réelle de la clé n'atteint jamais le navigateur.
- **Secrets verrouillés par domaine** — chaque clé est liée à une liste verte URL ; le proxy refuse les demandes adressées aux autres hôtes.
- **Protection des réseaux privés** : les extensions ne peuvent pas atteindre les adresses internes.
- **Authentification requise** : les extensions ne s'exécutent que pour les utilisateurs connectés et les appels `dbQuery`/`dbExec` sont automatiquement étendus.

## Quelques choses à savoir sur la dénomination {#naming-back-compat}

Si vous parcourez le SQL ou la source, vous verrez un mélange de noms d'"extension" et d'"outil". Décodeur rapide :

- La primitive destinée à l'utilisateur s'appelait autrefois « Outils ». C'est maintenant **Extensions**.
- Les tables physiques SQL (`tools`, `tool_data`, `tool_shares`, `tool_slots`, `tool_slot_installs`) conservent leurs noms d'origine : renommer une table est une migration destructrice, et le framework ne propose pas de migrations destructrices.
- Les exports Drizzle / TypeScript utilisent les nouveaux noms : `extensions`, `extensionData`, `extensionShares`, `extensionSlots`, `extensionSlotInstalls`.
- Dans l'iframe d'une extension, les assistants canoniques sont `extensionFetch` et `extensionData`. Les anciens noms `toolFetch` et `toolData` sont toujours résolus, donc l'ancienne extension HTML continue de fonctionner.

Vous ne verrez pas cela non plus en utilisation normale, mais l'agent a un troisième concept connexe appelé « outils LLM » : la surface d'appel de fonction sur un tour de modèle (définie via `defineAction`, MCP, etc.). Ce sont les primitives d'appel de fonctions, pas les widgets destinés à l'utilisateur. Lorsque cette page indique « extension », cela signifie le widget destiné à l'utilisateur ; quand d'autres documents disent « outil » à côté de `defineAction`, c'est le concept LLM.

## Quelle est la prochaine étape

- [**Templates**](/docs/cloneable-saas) : les extensions des applications hôtes s'étendent
- [**Actions**](/docs/actions) — les opérations qu'un poste appelle via `appAction`
- [**Sharing & Privacy**](/docs/sharing) : fonctionnement de la visibilité des extensions, du partage d'organisation et des subventions par utilisateur
- [**Onboarding & API Keys**](/docs/onboarding) — comment les secrets apparaissent dans les paramètres UI
- [**Security**](/docs/security) – le modèle de portée et d'accès aux données du framework
