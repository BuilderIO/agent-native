---
title: "Vidéo"
description: "Un studio vidéo programmatique pour les animations graphiques, les démonstrations de produits et le texte cinétique. Générez des animations à partir d'une invite et ajustez-les sur une chronologie."
---

# Vidéo

Un studio vidéo programmatique pour le type d'animations graphiques, de démonstrations de produits et de vidéos de texte cinétique qui sont difficiles à créer manuellement des images clés. Demandez à l'agent "un logo de 6 secondes qui apparaît en fondu au bout de 2 secondes" et il crée l'animation. Ajustez le timing, l'accélération et les mouvements de caméra sur une chronologie, puis effectuez le rendu sur MP4 ou WebM.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:12px;padding:16px;min-height:530px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>Révélation du logo</h1><span class='wf-pill accent'>6 seconds</span><div style='flex:1'></div><button>Preview</button><button class='primary'>Render</button></div><div class='wf-card' style='flex:1;display:flex;align-items:center;justify-content:center;min-height:250px'><div style='text-align:center'><strong>Aperçu Remotion</strong><br/><small class='wf-muted'>logo scales in as the title fades</small></div></div><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><div style='display:flex;gap:8px;align-items:center'><span class='wf-pill'>0s</span><span class='wf-pill'>2s</span><span class='wf-pill'>4s</span><span class='wf-pill'>6s</span><div style='flex:1'></div><button>Nouvelle piste</button></div><div class='wf-box'>Fondu du titre · images 0-48</div><div class='wf-box'>Échelle du logo · images 48-120</div><div class='wf-box'>Travelling caméra · images 72-144</div></div></div>"
}
```

Lorsque vous ouvrez le studio, vous verrez une liste de compositions sur l'écran d'accueil. Cliquez dessus et vous obtenez un lecteur en haut, une chronologie en bas et un panneau de propriétés à droite. L'agent sait toujours quelle composition vous avez ouverte.

```an-diagram title="Animation en tant que données" summary="Une composition est un composant React ; chaque animation lit une piste afin que l'agent et la chronologie éditent les mêmes données."
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">Timeline<br><small class=\"diagram-muted\">glisser, redimensionner, parcourir</small></div><div class=\"diagram-node\">Agent<br><small class=\"diagram-muted\">\"fade in at 2s\"</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">AnimationTrack</span><small class=\"diagram-muted\">startFrame / easing / animatedProps</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Composition React<br><small class=\"diagram-muted\">Remotion &lt;Player&gt;</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">MP4 / WebM</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## Ce que vous pouvez en faire

- **Générez des animations à partir d'une invite.** "Ajoutez une carte de titre qui apparaît en fondu toutes les 2 secondes et dure jusqu'à 5 secondes." L'agent modifie la composition.
- **Ajustez le timing sur une chronologie.** Faites glisser et redimensionnez les pistes d'animation, parcourez les images, définissez visuellement les courbes d'accélération.
- **Animez la caméra.** Effectuez des panoramiques, des zooms et des inclinaisons avec les outils à l'écran. Cliquez sur l'outil, faites glisser dans l'aperçu et une image clé est créée automatiquement.
- **Partez d'une composition vierge ou d'un exemple.** Le modèle contient une composition intégrée au code (`BlankComposition`) à partir de laquelle commencer ; exemples de compositions — texte cinétique, révélations de logo, éclats de particules, démos interactives UI, diaporamas — chargez-les à partir de la base de données et vous pouvez ajouter les vôtres.
- **Modifiez visuellement les courbes d'assouplissement.** Plus de 30 courbes livrées : puissance, retour, rebond, circulation, élastique, expo, sinus et physique du ressort.
- **Rendu au format MP4 ou WebM** avec un suréchantillonnage 1x, 2x ou 3x pour un texte et des vecteurs nets pendant le zoom de la caméra.

Il s'agit davantage d'un outil destiné aux développeurs que d'autres modèles : les compositions sont des composants React, afin que les utilisateurs expérimentés (ou l'agent) puissent écrire de tout nouveaux types d'animation à partir de zéro. Mais les ajustements quotidiens (« ralentir la frappe », « réduire le nombre de particules à 12 ») ne sont que du bavardage.

## Démarrer

Démo en direct : [videos.agent-native.com](https://videos.agent-native.com).

Lorsque vous ouvrez le studio :

1. Choisissez une composition sur l'écran d'accueil.
2. Essayez l'agent : "ajoutez un logo qui apparaît en fondu au bout de 2 secondes". Regardez la mise à jour de la chronologie.
3. Faites glisser les pistes pour les resynchroniser, cliquez sur l'outil Caméra, parcourez le lecteur.

### Invites utiles

- "Ajoutez une carte de titre qui apparaît en fondu toutes les 2 secondes et reste en place jusqu'à 5 secondes."
- "Changez la caméra pour zoomer 2x sur le logo entre les images 60 et 90."
- "Rend la saisie plus lente — 40 % plus longue."
- "L'éclatement de particules est trop dense. Réduisez le compte à 12."
- "Créez une nouvelle composition appelée intro-loop, 1080x1080, 6 secondes."
- "Ajoutez une animation de clic sur la zone du bouton et animez-y le curseur."
- "Donnez à ce morceau un assouplissement printanier au lieu d'un relâchement."

Si vous sélectionnez une piste dans la timeline et appuyez sur Cmd+I, l'agent reprend cette sélection : "rendre celle-ci plus vive" fonctionne tout simplement.

## Pour les développeurs

Le reste de ce document s'adresse à toute personne qui crée le modèle vidéo ou l'étend. Ce modèle est plus orienté code que les autres : chaque composition est un composant React et chaque animation est une donnée sur une piste.

### Architecture

Tout ce que vous voyez dans le studio est du code. Une composition est un `CompositionEntry` dans `app/remotion/registry.ts` qui pointe vers un composant React dans `app/remotion/compositions/`. Chaque animation de ce composant est lue à partir d'un `AnimationTrack` afin que les utilisateurs puissent la faire glisser, la redimensionner et la resynchroniser dans la chronologie UI. L'agent peut créer de nouvelles compositions, ajouter des pistes, régler l'assouplissement et écrire des composants React entiers qui se connectent au registre.

Le studio fonctionne sur le `<Player>` de Remotion pour la prévisualisation et sur le Remotion CLI pour le rendu final. La sortie par défaut est 1 920 x 1 080 à 30 ips.

### Démarrage rapide

Élaborez une nouvelle application vidéo à partir du CLI :

```bash
npx @agent-native/core@latest create my-video-app --standalone --template videos
cd my-video-app
pnpm install
pnpm dev
```

Ouvrez le studio dans votre navigateur, créez une composition et repartez de zéro. Demandez à l'agent quelque chose comme "ajouter un logo qui apparaît en fondu au bout de 2 secondes" et il modifiera la composition pour vous.

### Fonctionnalités clés

**Compositions basées sur React.** Les vidéos sont des composants React basés sur Remotion, avec des compositions utilisateur basées sur SQL et un registre de code facultatif pour les valeurs par défaut locales.

**Animation basée sur la chronologie.** Les pistes de durée, les images clés, les courbes d'accélération, les mouvements de caméra et les pistes d'expression programmatique modifient tous les mêmes données de composition.

**Systèmes de mouvement réglables.** Les paramètres, les pistes de curseur, les zones de survol interactives, la navigation par plage et la lecture répétée rendent les animations générées réglables sans code.

**Rendu et persistance.** Les paramètres de composition, la qualité, les images par seconde, les valeurs de suivi et les remplacements persistent par composition et sont rendus sur MP4 ou WebM via Remotion.

### Travailler avec l'agent

L'agent sait toujours quelle composition vous avez ouverte. L'état de navigation (`{ view, compositionId }`) est écrit dans la table `application_state` du framework, et l'action `view-screen` le renvoie plus un indice pointant vers `app/remotion/registry.ts`. Vous n'êtes pas obligé de dire à l'agent à quelle composition vous appartenez : demandez-lui d'agir sur "celle-ci" et il le fera.

Sous le capot, l'agent appelle actions comme `navigate`, `save-composition` et `generate-animated-component`. Les enregistrements de composition basés sur SQL sont créés ou mis à jour via `save-composition` ; Les composants Remotion basés sur du code sont toujours présents dans `app/remotion/compositions/*.tsx` et sont enregistrés dans `app/remotion/registry.ts`.

### Modèle de données

Le schéma côté serveur est dans `templates/videos/server/db/schema.ts` :

```an-schema title="Modèle de données vidéo" summary="Compositions adossées à SQL, ainsi que des systèmes de conception et des dossiers imbriqués, chacun avec une table de partage de cadre."
{
  "entities": [
    {
      "id": "compositions",
      "name": "compositions",
      "note": "User-created compositions and overrides; ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "title", "type": "text" },
        { "name": "type", "type": "text" },
        { "name": "data", "type": "text", "note": "Composition complète JSON blob" },
        { "name": "created_at", "type": "text" },
        { "name": "updated_at", "type": "text" }
      ]
    },
    {
      "id": "design_systems",
      "name": "design_systems",
      "note": "Reusable brand tokens; ownableColumns",
      "fields": [
        { "name": "data", "type": "text", "note": "colors / typography / spacing" },
        { "name": "assets", "type": "text", "nullable": true },
        { "name": "custom_instructions", "type": "text", "nullable": true },
        { "name": "is_default", "type": "boolean" }
      ]
    },
    {
      "id": "folders",
      "name": "folders",
      "note": "Nestable folders; ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "name", "type": "text" }
      ]
    },
    {
      "id": "folder_memberships",
      "name": "folder_memberships",
      "note": "Plusieurs à plusieurs se joignent",
      "fields": [
        { "name": "folder_id", "type": "text", "fk": "folders.id" },
        { "name": "composition_id", "type": "text", "fk": "compositions.id" }
      ]
    }
  ],
  "relations": [
    { "from": "folders", "to": "folder_memberships", "kind": "1-n", "label": "members" },
    { "from": "compositions", "to": "folder_memberships", "kind": "1-n", "label": "in folders" }
  ]
}
```

Chaque table dispose également d'une table de partages de framework correspondante (`composition_shares`, `design_system_shares`, `folder_shares`) produite par `createSharesTable()`.

- `compositions` : identifiant, titre, type, `data` (composition complète JSON blob), colonnes de propriété, horodatages.
- `composition_shares` — attributions d'actions standard produites par `createSharesTable()`.
- `design_systems` — jetons de marque réutilisables (couleurs, typographie, espacement, éléments, instructions personnalisées, drapeau `is_default`) avec `ownableColumns`.
- `design_system_shares` — attribution de parts pour les systèmes de conception.
- `folders` — dossiers emboîtables pour l'organisation de la bibliothèque, avec `ownableColumns`.
- `folder_shares` – octrois de partage pour les dossiers.
- `folder_memberships` — jointure plusieurs-à-plusieurs entre un `folder_id` et un `composition_id`.

### Dossiers et systèmes de conception

Les compositions peuvent être organisées en dossiers et stylisées avec des systèmes de conception. Actions : `create-folder`, `rename-folder`, `delete-folder`, `move-composition-to-folder`. Système de conception actions : `create-design-system`, `update-design-system`, `get-design-system`, `list-design-systems`, `set-default-design-system`, `apply-design-system`, `analyze-brand-assets`. Importer actions : `import-github`, `import-from-url`, `import-document` (DOCX/PPTX/PDF).

Le registre dans `app/remotion/registry.ts` est la source de vérité dans le code pour ce qui est livré avec le modèle. La table SQL stocke les compositions et les remplacements créés par l'utilisateur. L'état du studio (modifications de piste par composition, remplacements d'accessoires, paramètres de composition) est mis en miroir sur `localStorage` sous `videos-tracks:<id>`, `videos-props:<id>` et `videos-comp-settings:<id>`, et fusionné en profondeur dans les valeurs par défaut du registre au chargement.

Formes principales TypeScript (`app/types.ts`) :

- `AnimationTrack` — `id`, `label`, `startFrame`, `endFrame`, `easing`, `animatedProps[]`.
- `AnimatedProp` — `property`, `from`, `to`, `unit`, plus `keyframes`, `programmatic`, `description`, `codeSnippet`, `parameters`, `parameterValues` en option.
- `CompositionEntry` — `id`, `title`, `description`, `component`, `durationInFrames`, `fps`, `width`, `height`, `defaultProps`, `tracks`.

Les compositions sont privées par défaut. La visibilité peut être `private`, `org` ou `public`, et les attributions de partage donnent des rôles `viewer`, `editor` ou `admin` – câblés via la primitive de partage du framework.

### Le personnaliser

Le dossier du modèle est `templates/videos/` (le slug destiné à l'utilisateur est `video`, mais le dossier est au pluriel).

**Actions** — `templates/videos/actions/`

- `view-screen.ts` : renvoie l'état de navigation actuel de l'agent.
- `navigate.ts` : accédez à une composition (`--compositionId <id>`) ou à la vue d'accueil (`--view home`).
- `save-composition.ts` : créez ou mettez à jour un enregistrement de composition basé sur SQL.
- `generate-animated-component.ts` — génère un nouveau fichier de composant Remotion avec un passe-partout.
- `validate-compositions.ts` — vérifiez toutes les compositions enregistrées pour déceler des problèmes structurels.
- `list-compositions.ts`, `get-composition.ts`, `update-composition.ts`, `delete-composition.ts` — lire, mettre à jour et supprimer les enregistrements de composition sauvegardés sur SQL.

**Itinéraires** — `templates/videos/app/routes/`

- `_index.tsx` — studio à domicile ; restitue le shell et la liste de composition.
- `c.$compositionId.tsx` — éditeur de composition (timeline, lecteur, panneau de propriétés).
- `components.tsx` — navigateur de bibliothèques de composants.
- `team.tsx` — gestion d'équipe.

**Internes de la rémotion** — `templates/videos/app/remotion/`

- `registry.ts` — la liste de composition faisant autorité.
- `compositions/` — un `.tsx` par composition, plus un baril `index.ts`.
- `trackAnimation.ts` — `trackProgress`, `getPropValue`, `findTrack`, `getPropValueKeyframed`.
- `CameraHost.tsx` : encapsule le contenu de la composition avec la transformation de la caméra.
- `hooks/`, `ui-components/`, `components/` — assistants d'éléments interactifs, rendu du curseur, wrappers d'éléments animés.

**Studio UI** — `templates/videos/app/components/`

- `Timeline.tsx` — la chronologie entièrement contrôlée (`viewStart` / `viewEnd` ne possèdent aucun état en interne).
- `VideoPlayer.tsx` — Wrapper Remotion `<Player>` avec lecture limitée en plage.
- `TrackPropertiesPanel.tsx`, `CompSettingsEditor.tsx`, `PropsEditor.tsx` — les panneaux latéraux droits.
- `CameraToolbar.tsx`, `CameraControls.tsx` : outils de caméra et commandes numériques.

**Instructions de l'agent** — `templates/videos/AGENTS.md` est le guide détaillé que lit l'agent. Il couvre la règle d'animation en tant que piste, le système de caméra, le système de curseur, les unités de filtrage CSS, l'enregistrement des composants interactifs, l'espacement UI et les listes de contrôle pour la création ou l'édition de compositions.

**Skills** — `templates/videos/.agents/skills/`

- `composition-management/SKILL.md` — comment créer et enregistrer des compositions.
- `animation-tracks/SKILL.md` — comment éditer des pistes et des accessoires animés.
- Plus le cadre standard skills : `actions`, `self-modifying-code`, `delegate-to-agent`, `storing-data`, `security`, `frontend-design`, `create-skill`, `capture-learnings`.

Pour ajouter une nouvelle composition, suivez la liste de contrôle dans `AGENTS.md` : créez le composant, déclarez `FALLBACK_TRACKS`, utilisez `findTrack` / `trackProgress` / `getPropValue` (ne codez jamais de frames en dur), exportez depuis `compositions/index.ts`, ajoutez un `CompositionEntry` au registre et exécutez `pnpm typecheck`.
