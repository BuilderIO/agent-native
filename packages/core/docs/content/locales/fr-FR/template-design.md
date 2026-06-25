---
title: "Conception"
description: "Un studio de prototypage HTML natif avec agent : générez, affinez, prévisualisez et exportez des conceptions interactives Alpine/Tailwind avec un agent."
---

# Conception

Design est un studio de prototypage HTML natif avec agent. Au lieu d'un canevas de dessin en couches, l'agent génère des prototypes Alpine/Tailwind HTML autonomes complets, les restitue dans une iframe et vous permet d'affiner le résultat avec des invites et des contrôles d'ajustement.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:14px;padding:18px;min-height:520px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>Page de lancement produit</h1><span class='wf-pill accent'>Desktop</span><span class='wf-pill'>Tablet</span><span class='wf-pill'>Mobile</span><div style='flex:1'></div><button>Preview</button><button class='primary'>Export code</button></div><div class='wf-card' style='flex:1;display:grid;grid-template-rows:auto 1fr auto;gap:12px'><div style='display:flex;gap:8px'><span class='wf-pill accent'>Hero</span><span class='wf-pill'>Pricing</span><span class='wf-pill'>FAQ</span></div><div class='wf-box' style='display:flex;align-items:center;justify-content:center;min-height:230px'><strong>Prototype HTML généré</strong></div><div class='wf-card' style='display:flex;align-items:center;gap:10px'><span class='wf-muted'>Rendez le hero plus dense et le CTA plus clair.</span><div style='flex:1'></div><button class='primary'>Appliquer la révision</button></div></div></div>"
}
```

Lorsque vous ouvrez l'application, le prototype généré est au centre de l'espace de travail, avec des modes de prévisualisation, des révisions rapides et des contrôles d'exportation à portée de main. Tout ce que l'agent produit est du vrai HTML que vous pouvez affiner, exporter ou transférer.

```an-diagram title="Un artefact, pas de traduction" summary="L'agent génère Alpine/Tailwind HTML autonome ; l'iframe, la source modifiable et chaque exportation lisent tous les mêmes fichiers. Un système de conception lié alimente les jetons dans chaque passe."
{
  "html": "<div class=\"diagram-design\"><div class=\"diagram-col\"><div class=\"diagram-node\">Invite<br><small class=\"diagram-muted\">describe screen / page</small></div><div class=\"diagram-pill\">Système de design</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough><span class=\"diagram-pill accent\">Génération agent</span><small class=\"diagram-muted\">fichiers HTML / JSX autonomes</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>iframe preview<br><small class=\"diagram-muted\">ajuster les réglages · affiner avec Cmd+I</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill ok\">Export</span><small class=\"diagram-muted\">HTML · ZIP · PDF · transfert</small></div></div>",
  "css": ".diagram-design{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-design .diagram-col{display:flex;flex-direction:column;gap:8px;align-items:flex-start}.diagram-design .diagram-box{display:flex;flex-direction:column;gap:4px}.diagram-design .diagram-arrow{font-size:20px;line-height:1}.diagram-design .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## Quand le choisir

- **Vous souhaitez un concept de page de destination raffiné, une direction de produit UI ou une exploration de la marque** qui puisse laisser l'outil tel qu'un véritable HTML, et non une toile de dessin en couches.
- **Vous voulez un prototype interactif fonctionnel**, avec le style Alpine interactions et Tailwind, au lieu de maquettes statiques.
- **Vous souhaitez comparer rapidement les directions**, générer quelques variantes, choisir la plus forte et continuer à affiner.
- **Vous voulez que le résultat de conception vous appartienne** : exportez HTML, ZIP ou PDF, ou confiez le prototype à un outil de codage.

## Ce que vous pouvez en faire

- **Générez des prototypes complets.** Décrivez l'écran ou la page dont vous avez besoin et l'agent crée un document HTML fonctionnel avec le style Tailwind et Alpine interactions.
- **Comparez les variantes.** Commencez par plusieurs directions, choisissez la plus forte, puis continuez à affiner.
- **Ajustez visuellement.** Utilisez les commandes d'ajustement intégrées pour les modifications courantes ou demandez à l'agent des mises à jour de copie, de mise en page, de couleur, d'espacement et d'interaction.
- **Appliquez les systèmes de conception.** Enregistrez et réutilisez les préférences du système de conception afin que le travail généré reste plus proche de votre marque.
- **Importer des références.** Introduire un HTML existant ou un matériau de référence comme contexte pour une nouvelle passe de conception.
- **Exportez des fichiers réels.** Exportez HTML, ZIP ou PDF à partir du prototype généré.

## Démarrer

Démo en direct : [design.agent-native.com](https://design.agent-native.com).

1. **Décrivez l'artefact.** Demandez l'écran, le flux, la page de destination ou le visuel
   direction souhaitée. Incluez l'audience, le ton et toutes les contraintes liées au produit.
2. **Comparez les instructions.** Générez quelques variantes, choisissez la plus forte et
   continuez à affiner au lieu de recommencer.
3. **Ajustez les détails.** Utilisez les commandes de réglage pour les changements visuels courants, ou demandez
   l'agent pour les modifications de mise en page, de copie, de réactivité et d'interaction.
4. **Exportez quand cela est utile.** Téléchargez HTML, ZIP ou PDF une fois le prototype
   est prêt à être remis à un autre outil ou coéquipier.

### Invites utiles

- "Créez trois directions de page de destination pour un produit d'analyse technique."
- "Rendre ce tableau de bord plus dense et plus facile à analyser pour une équipe opérationnelle."
- "Appliquez notre système de conception enregistré et simplifiez la mise en page mobile."
- "Exportez ce prototype en tant que ZIP une fois la variante finale sélectionnée."
- "Transformez ce HTML en une page de tarification plus solide sans changer les couleurs de la marque."

## Pour les développeurs

Le reste de ce document s'adresse à toute personne qui crée ou étend le modèle de conception.

### Démarrage rapide

```bash
npx @agent-native/core@latest create my-design --standalone --template design
cd my-design
pnpm install
pnpm dev
```

### Modèle de données

Toutes les données se trouvent dans SQL avec Drizzle ORM. Schéma : `templates/design/server/db/schema.ts`. Les conceptions et les systèmes de conception portent la norme `ownableColumns` et une table de partages de framework correspondante, ils s'intègrent donc dans le modèle de partage par utilisateur/par organisation.

| Tableau                                  | Ce qu'il contient                                                                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `designs`                                | Un projet de conception : `title`, `description`, `project_type` (`prototype` / `other`), le blob `data` JSON et un lien `design_system_id` en option |
| `design_files`                           | Fichiers individuels appartenant à une conception (`filename`, `content`, `file_type` par défaut à `html`)                                            |
| `design_versions`                        | `snapshot` ponctuels d'une conception avec un `label` en option, pour l'historique et la restauration                                                 |
| `design_systems`                         | Jetons de marque réutilisables – `data` (couleurs/typographie/espacement), `assets`, `custom_instructions` et un drapeau `is_default`                 |
| `design_shares` / `design_system_shares` | Framework partage des tables mappant les principaux (utilisateurs ou organisations) aux rôles (spectateur, éditeur, administrateur)                   |

```an-schema title="Modèle de données de conception" summary="Une conception est propriétaire de ses fichiers et de ses instantanés versionnés, et relie éventuellement un système de conception réutilisable. Les conceptions et les systèmes peuvent être possédés, chacun avec une table de partage de cadre."
{
  "entities": [
    { "id": "designs", "name": "designs", "note": "A design project (ownable)", "fields": [
      { "name": "id", "type": "id", "pk": true },
      { "name": "title", "type": "text" },
      { "name": "description", "type": "text", "nullable": true },
      { "name": "project_type", "type": "text", "note": "prototype / other" },
      { "name": "data", "type": "json", "note": "starts as {}" },
      { "name": "design_system_id", "type": "id", "fk": "design_systems.id", "nullable": true }
    ] },
    { "id": "files", "name": "design_files", "note": "Fichiers dans une conception", "fields": [
      { "name": "design_id", "type": "id", "fk": "designs.id" },
      { "name": "filename", "type": "text" },
      { "name": "content", "type": "text" },
      { "name": "file_type", "type": "text", "note": "defaults to html" }
    ] },
    { "id": "versions", "name": "design_versions", "note": "Historique / restauration", "fields": [
      { "name": "design_id", "type": "id", "fk": "designs.id" },
      { "name": "snapshot", "type": "json" },
      { "name": "label", "type": "text", "nullable": true }
    ] },
    { "id": "systems", "name": "design_systems", "note": "Reusable brand tokens (ownable)", "fields": [
      { "name": "id", "type": "id", "pk": true },
      { "name": "data", "type": "json", "note": "colors / typography / spacing" },
      { "name": "assets", "type": "json", "nullable": true },
      { "name": "custom_instructions", "type": "text", "nullable": true },
      { "name": "is_default", "type": "boolean" }
    ] },
    { "id": "design_shares", "name": "design_shares", "note": "Tableau des partages du framework", "fields": [
      { "name": "design_id", "type": "id", "fk": "designs.id" },
      { "name": "role", "type": "text", "note": "viewer / editor / admin" }
    ] },
    { "id": "system_shares", "name": "design_system_shares", "note": "Tableau des partages du framework", "fields": [
      { "name": "design_system_id", "type": "id", "fk": "design_systems.id" },
      { "name": "role", "type": "text", "note": "viewer / editor / admin" }
    ] }
  ],
  "relations": [
    { "from": "designs", "to": "files", "kind": "1-n" },
    { "from": "designs", "to": "versions", "kind": "1-n" },
    { "from": "systems", "to": "designs", "kind": "1-n", "label": "applied to" },
    { "from": "designs", "to": "design_shares", "kind": "1-n" },
    { "from": "systems", "to": "system_shares", "kind": "1-n" }
  ]
}
```

Un projet de conception est un shell jusqu'à ce qu'il ait du contenu : `create-design` crée une ligne vide (`data: "{}"`), puis `generate-design` écrit les fichiers HTML/JSX autonomes. L'artefact généré, la source modifiable et chaque exportation proviennent tous du même HTML, il n'y a donc pas de format de « maquette IA » distinct à traduire. Un système de conception lié fournit des jetons et des `custom_instructions` que l'agent honore à chaque génération.

Les itinéraires du UI sont disponibles sous `templates/design/app/routes/` : `_index.tsx` (liste), `design.$id.tsx` (éditeur), `present.$id.tsx` (présentation), `design-systems.tsx` et `design-systems_.setup.tsx`, `templates.tsx`, `examples.tsx`, plus `settings.tsx` et `team.tsx`.

### Clé actions

Chaque opération appelable par un agent est un fichier TypeScript dans `templates/design/actions/`, monté automatiquement sur `POST /_agent-native/actions/:name` et exécutable à partir du CLI en tant que `pnpm action <name>`. Les regroupements :

- **Designs** — `create-design` (coque vide), `generate-design` (contenu HTML/JSX généré par écriture), `update-design`, `get-design`, `list-designs`, `duplicate-design`, `delete-design` et `apply-tweaks` pour conserver les valeurs du bouton de réglage en direct (couleur d'accent, densité, etc.).
- **Fichiers** — `create-file`, `update-file`, `list-files`, `delete-file` pour les fichiers contenus dans un projet de conception.
- **Systèmes de conception** : `create-design-system`, `update-design-system`, `get-design-system`, `list-design-systems`, `delete-design-system`, `set-default-design-system` et `analyze-brand-assets` pour collecter des données de marque avant l'analyse.
- **Importer** — `import-code`, `import-figma`, `import-github`, `import-from-url`, `import-document` (DOCX/PPTX/PDF/XLSX) et `import-design-project` pour extraire un système de conception d'un projet existant.
- **Exportation et transfert** : `export-html`, `export-pdf`, `export-svg`, `export-zip` et `export-coding-handoff` pour transformer une conception en transfert d'outil de codage.
- **Contexte et navigation** – `view-screen` (conception actuelle, fichier ouvert, vue, question en attente ou grille de variantes), `get-design-snapshot` (état actuel à partir duquel un agent externe peut continuer) et `navigate`.

### Travailler avec l'agent

L'agent sait toujours ce que vous avez ouvert. La conception actuelle, le fichier ouvert, la vue active et toute question en attente ou grille de variantes sont renvoyés par `view-screen` et injectés dans chaque message, vous pouvez donc dire « rendre cela plus dense » ou « exporter cette variante » sans nommer la conception.

Étant donné qu'une conception n'est constituée que de fichiers HTML/JSX autonomes, l'agent édite la même source que celle du rendu iframe et celle d'où provient chaque exportation : il n'existe pas de format de « maquette IA » distinct à traduire. Un système de conception lié fournit des jetons et `custom_instructions` que l'agent honore à chaque passage de génération. Sélectionnez du texte ou une région dans l'aperçu et appuyez sur Cmd+I pour concentrer l'agent exactement sur cette partie.

### Le personnaliser

Design est un modèle complet et clonable. Quelques idées d'extension pratiques :

- "Ajoutez un système de conception de commerce électronique réutilisable avec nos jetons et exemples de composants."
- "Ajoutez une étape d'exportation qui télécharge le ZIP dans notre système de révision interne."
- "Permettez-moi de coller la page de destination HTML existante et de demander à l'agent trois versions plus puissantes."
- "Ajoutez une bibliothèque d'invites enregistrée pour les résumés de la page produit, du tableau de bord et de l'écran d'intégration."
- "Ajoutez un paramètre prédéfini d'exportation PDF personnalisé pour examen par les parties prenantes."

L'agent modifie les itinéraires, les composants, les modèles basés sur actions et SQL selon les besoins. Consultez [Templates](/docs/cloneable-saas) pour le clonage complet, la personnalisation, le flux de déploiement et [Getting Started](/docs/getting-started) s'il s'agit de votre premier modèle natif d'agent.

## Quelle est la prochaine étape

- [**Templates**](/docs/cloneable-saas) — le modèle cloner et posséder
- [**Context Awareness**](/docs/context-awareness) : comment l'agent sait ce que l'utilisateur consulte
- [**Creating Templates**](/docs/creating-templates) – modèles de build actuels pour les modèles natifs d'agent
