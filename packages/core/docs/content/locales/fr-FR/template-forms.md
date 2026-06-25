---
title: "Formulaires"
description: "Générateur de formulaires natif pour agent : créez, modifiez, publiez et acheminez les envois de formulaires via un langage naturel et un éditeur visuel."
---

# Formulaires

Forms est un générateur de formulaires natif pour les agents. Décrivez le formulaire souhaité, affinez-le dans l'éditeur et publiez un formulaire public qui stocke les soumissions dans votre propre base de données SQL.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;min-height:520px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1.4px solid var(--wf-line)'><strong>Inscription bêta</strong><span class='wf-pill accent'>published</span><div style='flex:1'></div><button>Partager</button><button class='primary'>Dépublier</button></div><div style='display:flex;gap:8px;padding:12px 16px;border-bottom:1.4px solid var(--wf-line)'><span class='wf-pill accent'>Modifier</span><span class='wf-pill'>Résultats 187</span><span class='wf-pill'>Paramètres</span><span class='wf-pill'>Intégrations</span></div><div style='display:flex;flex-direction:column;gap:12px;padding:30px 78px;overflow:hidden'><h2 style='margin:0'>Inscription bêta</h2><p class='wf-muted' style='margin:0'>Réservez une place dans la prochaine bêta privée.</p><div class='wf-card'><strong>Nom complet</strong><input value='Ada Lovelace'/></div><div class='wf-card'><strong>E-mail professionnel</strong><input value='you@company.com'/></div><div class='wf-card'><strong>Votre rôle</strong><input value='Select...'/></div><div class='wf-card'><strong>Taille de l’équipe</strong><input value='Select...'/></div></div></div>"
}
```

Lorsque vous ouvrez l'application, vous voyez vos formulaires, l'éditeur actuel et un aperçu en direct. L'agent peut créer un formulaire à partir d'une invite, mettre à jour les étiquettes et les options des champs, modifier la validation et connecter les destinations de soumission en utilisant le même actions que le UI.

```an-diagram title="Construire, publier, collecter" summary="L'agent et l'éditeur visuel modifient une définition de formulaire SQL-backed. La page de remplissage publique n'est pas authentifiée et les soumissions sont acheminées côté serveur vers vos destinations."
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">Prompt agent<br><small class=\"diagram-muted\">\"add an NPS question\"</small></div><div class=\"diagram-node\">Éditeur visuel<br><small class=\"diagram-muted\">libellés, validation, ordre</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">create-form · update-form</span><small class=\"diagram-muted\">JSON de champs, JSON de paramètres</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">forms table<br><small class=\"diagram-muted\">SQL avec Drizzle</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">Page publique de remplissage<br><small class=\"diagram-muted\">unauthenticated</small></div><div class=\"diagram-box\">responses<br><small class=\"diagram-muted\">+ Slack / webhook / feuilles</small></div></div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## Ce que vous pouvez en faire

- **Créez des formulaires de manière conversationnelle.** "Créez un formulaire de contact", "ajoutez une question de score NPS", "rendre le champ e-mail obligatoire." L'agent met à jour le schéma du formulaire et les mises à jour d'aperçu à partir de l'état basé sur SQL.
- **Affinez visuellement.** Modifiez les étiquettes, les espaces réservés, l'état requis, les options et l'ordre des champs à partir du générateur UI lorsque vous souhaitez un contrôle direct.
- **Utilisez les types de champs fournis.** Les champs texte, e-mail, numéro, texte long, sélection, sélection multiple, case à cocher, radio, date, note et échelle sont pris en charge dès le départ.
- **Collectez les réponses.** Chaque soumission est stockée dans SQL avec une vue détaillée par réponse et un tableau de bord pour examiner les entrées.
- **Acheminez les soumissions.** Envoyez les charges utiles de soumission à webhooks, Slack, Discord ou Google Sheets à l'aide des intégrations intégrées.
- **Publiez des formulaires publics.** Partagez un formulaire public URL et affichez un message de remerciement après l'envoi.

## Démarrer

Démo en direct : [forms.agent-native.com](https://forms.agent-native.com).

1. **Créez un formulaire à partir d'une invite.** Demandez le formulaire souhaité, y compris le
   audience et ce qui devrait se passer après la soumission.
2. **Affiner dans l'éditeur.** Ajuster les étiquettes, la validation, les choix et l'ordre dans
   le générateur visuel lors de l'édition directe est plus rapide.
3. **Publiez et partagez.** Utilisez le formulaire public URL pour les répondants, puis regardez
   les résultats arrivent dans la vue Réponses.
4. **Connectez les destinations.** Acheminez les nouvelles soumissions vers Slack, Discord, Google
   Feuilles, webhooks ou votre propre point d'extension.

### Invites utiles

- "Créez un formulaire d'inscription bêta avec le rôle, la taille de l'équipe et le cas d'utilisation prioritaire."
- "Ajoutez une question NPS obligatoire et un suivi en texte libre."
- "Publiez chaque nouvelle réponse sur le canal du produit Slack."
- "Résumez les soumissions de cette semaine et regroupez-les par segment de clientèle."
- "Rendez ce formulaire plus court sans perdre les champs dont nous avons besoin pour le routage."

## Pour les développeurs

Le reste de ce document s'adresse à toute personne qui crée ou étend le modèle Forms.

### Démarrage rapide

```bash
npx @agent-native/core@latest create my-forms --standalone --template forms
cd my-forms
pnpm install
pnpm dev
```

Pour un espace de travail avec Forms aux côtés d’autres applications :

```bash
npx @agent-native/core@latest create my-platform
```

Sélectionnez les formulaires et tout autre modèle souhaité lors de la configuration de l'espace de travail.

### Fonctionnalités clés {#key-features}

**Définitions de formulaire JSON.** Les champs se trouvent dans une colonne `fields` JSON, afin que l'agent puisse effectuer des modifications chirurgicales sans modifier le schéma pour chaque type de champ.

**Pages de remplissage publiques.** Les répondants peuvent soumettre des formulaires non authentifiés, tandis que les paramètres privés sont supprimés avant que les données n'atteignent le navigateur.

**Destinations côté serveur.** Les intégrations Slack, Discord, Google Sheets et webhook se trouvent dans les paramètres du formulaire et s'exécutent après la soumission.

### Modèle de données

Toutes les données résident dans SQL avec Drizzle ORM. Schéma : `templates/forms/server/db/schema.ts`. Les formulaires comportent le standard `ownableColumns` et une table de partages de structure correspondante, ils s'intègrent donc dans le modèle de partage par utilisateur/par organisation.

| Tableau       | Ce qu'il contient                                                                                                                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `forms`       | Une définition de formulaire : `title`, `description`, `slug` unique, `fields` (tableau JSON de `FormField`), `settings` (JSON `FormSettings`), `status` (`draft` / `published` / `closed`) et un `deleted_at` à suppression logicielle |
| `responses`   | Une soumission par ligne : `form_id`, `data` (JSON `{ fieldId: value }`), `submitted_at`, `ip` et `submitter_email` en option                                                                                                           |
| `form_shares` | Framework partage les principes de mappage de table (utilisateurs ou organisations) avec les rôles (spectateur, éditeur, administrateur) par formulaire                                                                                 |

Les formes `fields` et `settings` JSON sont définies dans `templates/forms/shared/types.ts` (`FormField`, `FormSettings`). Les paramètres privés du propriétaire tels que les webhooks d'intégration URL et les origines autorisées sont supprimés avant que les données n'atteignent la page de remplissage publique via `toPublicFormSettings`.

```an-schema title="Modèle de données Forms" summary="Trois tableaux. Les champs et les intégrations sont des colonnes JSON sur les formulaires, de sorte que les modifications de l'agent sont des correctifs chirurgicaux plutôt que des changements de lignes dans un tableau croisé."
{
  "entities": [
    {
      "id": "forms",
      "name": "forms",
      "note": "A form definition (ownable)",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "title", "type": "string" },
        { "name": "description", "type": "string", "nullable": true },
        { "name": "slug", "type": "string", "note": "unique; public URL" },
        { "name": "fields", "type": "json", "note": "FormField[] — tous les types de champs" },
        { "name": "settings", "type": "json", "note": "FormSettings — intégrations, etc." },
        { "name": "status", "type": "enum", "note": "brouillon | publié | fermé" },
        { "name": "deleted_at", "type": "datetime", "nullable": true, "note": "soft delete" },
        { "name": "owner_email", "type": "string" },
        { "name": "org_id", "type": "id", "nullable": true }
      ]
    },
    {
      "id": "responses",
      "name": "responses",
      "note": "Une soumission par ligne",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "form_id", "type": "id", "fk": "forms.id" },
        { "name": "data", "type": "json", "note": "{ fieldId: value }" },
        { "name": "submitted_at", "type": "datetime" },
        { "name": "ip", "type": "string", "nullable": true },
        { "name": "submitter_email", "type": "string", "nullable": true }
      ]
    },
    {
      "id": "form_shares",
      "name": "form_shares",
      "note": "Tableau des partages du framework – principaux aux rôles par formulaire",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "form_id", "type": "id", "fk": "forms.id" },
        { "name": "principal", "type": "string", "note": "user or org" },
        { "name": "role", "type": "enum", "note": "spectateur | éditeur | administrateur" }
      ]
    }
  ],
  "relations": [
    { "from": "forms", "to": "responses", "kind": "1-n", "label": "has responses" },
    { "from": "forms", "to": "form_shares", "kind": "1-n", "label": "has share grants" }
  ]
}
```

### Clé actions

Chaque opération est un fichier TypeScript dans `templates/forms/actions/`, monté automatiquement sur `POST /_agent-native/actions/:name` :

- `create-form` — créer un nouveau formulaire (titre, description, champs, paramètres)
- `update-form` : mettre à jour les champs, les paramètres ou l'état
- `get-form` — récupérer un formulaire par identifiant ou slug
- `list-forms` — répertorie les formulaires accessibles
- `delete-form` — suppression logicielle (définit `deleted_at`)
- `restore-form` — restaurer un formulaire supprimé de manière réversible
- `list-responses` — répertorie les soumissions pour un formulaire avec des filtres facultatifs
- `export-responses` — exporter les réponses au format CSV ou JSON

### Le personnaliser

Demandez d'abord à l'agent le comportement expédié :

- "Ajoutez un champ radio requis pour la méthode de contact préférée."
- "Publiez chaque nouvelle soumission sur Slack." Connectez d'abord Slack via [Messaging](/docs/messaging).
- "Ajouter une destination webhook pour notre CRM."
- "Créez un formulaire de commentaires client avec une échelle de 1 à 10 et un suivi en texte long."
- "Rendre certains formulaires publics et d'autres accessibles uniquement en connexion."

Si vous avez besoin de nouvelles fonctionnalités telles que le téléchargement de fichiers, les signatures ou les widgets de champs personnalisés, traitez-les comme des extensions de modèle : ajoutez ensemble la forme SQL, les contrôles de l'éditeur actions, UI, la prise en charge du moteur de rendu public et les instructions de l'agent. Voir [Creating Templates](/docs/creating-templates) pour le modèle de construction actuel.

## Quelle est la prochaine étape

- [**Templates**](/docs/cloneable-saas) — le modèle cloner et posséder
- [**Actions**](/docs/actions) — le système d'action qui alimente le constructeur
- [**Messaging**](/docs/messaging) — Slack et autres destinations de soumission
