---
title: "Approbations humaines dans la boucle"
description: " Suspendre l'agent avant l'exécution d'une action à conséquences élevées : la porte needApproval de defineAction émet un événement d'approbation_required, l'humain approuve, et ensuite seulement l'outil s'exécute."
---

# Approbations humaines dans la boucle

La plupart des actions devraient simplement s'exécuter. Quelques-unes – envoyer un e-mail, charger une carte, supprimer un compte – sont orientées vers l'extérieur et difficiles à annuler, et vous ne voulez pas que l'agent les fasse de manière autonome. Pour ceux-ci, `defineAction` dispose d'une **porte d'approbation** opt-in : lorsque l'agent tente d'appeler l'action, la boucle s'arrête, présente une autorisation Approuver/Refuser à l'humain et exécute l'action _uniquement_ après que l'humain ait approuvé cet appel spécifique.

> [!WARNING]
> Gardez les approbations rares. Chaque action fermée est un arrêt brutal dans la boucle de l'agent : elle interrompt l'exécution et nécessite un aller-retour humain. Utilisez le `needsApproval` uniquement pour les opérations véritablement lourdes de conséquences, difficiles à annuler et orientées vers l'extérieur. Si vous vous retrouvez à bloquer des lectures ou des écritures de routine, vous vous trompez. La valeur par défaut est **off**, et presque toutes les actions devraient la laisser désactivée.

## La porte `needsApproval` {#needs-approval}

Définissez `needsApproval` sur un `defineAction`. Il accepte un booléen ou un prédicat :

```an-annotated-code title="Gating la seule action conséquente"
{
  "filename": "actions/send-email.ts",
  "language": "ts",
  "code": "export default defineAction({\n  description: \"Send an email via Gmail.\",\n  schema: z.object({\n    to: z.string(),\n    subject: z.string(),\n    body: z.string(),\n  }),\n  // Sending is outward-facing and hard to undo, so the agent can never send\n  // without a human approving the specific call. Drafting/queueing is\n  // unaffected — only the real send is gated.\n  needsApproval: true,\n  run: async (args) => {\n    /* ...actually send... */\n  },\n});",
  "annotations": [
    { "lines": "10", "label": "Toute la porte", "note": "Un drapeau. Avec la vérité et l'appel non approuvé, la boucle s'arrête avant `run` — le modèle n'atteint jamais l'effet secondaire de lui-même." },
    { "lines": "11-13", "label": "run() is untouched", "note": "Le gestionnaire reste le même. L'approbation est appliquée par la boucle qui l'entoure, et non par quoi que ce soit à l'intérieur de `run`." }
  ]
}
```

- **`needsApproval: true`** — nécessite toujours une approbation.
- **`needsApproval: (args, ctx) => boolean | Promise<boolean>`** : nécessite une approbation uniquement lorsque le prédicat renvoie vrai. Porte conditionnellement, par ex. uniquement pour les destinataires externes ou uniquement au-dessus d'un seuil monétaire :

  ```ts
  needsApproval : (args) => !args.to.endsWith("@votre-entreprise.com"),
  ```

  Gardez le prédicat pur et rapide. **La fermeture échoue** : si le prédicat est lancé, le framework traite cela comme une « approbation requise » plutôt que d'exécuter silencieusement une action à haute conséquence.

Lorsque `needsApproval` est omis, le comportement reste inchangé octet par octet — il n'y a aucun coût supplémentaire sur le chemin commun.

Cela fonctionne de la même manière pour les anciens actions de style `parameters` et les actions basés sur un schéma, ainsi que pour l'agent intégré à l'application, les sous-agents, les appelants A2A et MCP (chaque surface d'agent est acheminée via la même boucle).

## Comment la boucle se met en pause {#loop}

Lorsque l'agent appelle une action fermée et que cet appel spécifique n'a **pas** déjà été approuvé, la boucle n'exécute **pas** `run()`. Au lieu de cela :

1. Résout la porte. Pour un prédicat, il appelle `needsApproval(input, ctx)` ; un lancer est traité comme "doit approuver" (échec clos).
2. Émet un événement `tool_start` (donc le UI affiche l'appel) suivi immédiatement d'un événement **`approval_required`**, puis arrête le tour. L'effet secondaire de l'action ne se produit jamais.

L'événement `approval_required` contient tout ce dont le client a besoin pour proposer une offre :

| Champ         | Tapez    | Remarques                                                              |
| ------------- | -------- | ---------------------------------------------------------------------- |
| `tool`        | `string` | Le nom de l'action que l'agent a tenté d'appeler.                      |
| `input`       | objet    | Les arguments transmis par l'agent.                                    |
| `approvalKey` | `string` | **Clé stable** que le client renvoie pour approuver _cet appel exact_. |
| `toolCallId`  | `string` | L'identifiant d'appel d'outil côté modèle, lorsqu'il est disponible.   |

Le `approvalKey` est dérivé de manière déterministe du nom de l'outil et de son entrée, de sorte que le même appel logique produit toujours la même clé. Le modèle ne le voit ni ne le définit jamais : il s'agit simplement d'une poignée de main entre le cadre et l'accessibilité d'approbation de l'humain.

L'outil en pause renvoie un résultat indiquant au modèle que le virage est en pause et qu'il ne doit pas réessayer, afin que le modèle ne tourne pas.

## Comment l'humain approuve {#approve}

Sur `approval_required`, le chat UI affiche une autorisation **Approuver/Refuser** lors de l'appel d'outil en pause. Ceci est automatiquement intégré dans `AssistantChat` — vous ne le construisez pas par modèle.

- **Approuver** réémet le tour (un message de suite ordinaire) portant la clé d'appel dans `approvedToolCalls: [approvalKey]`. Au tour réédité, la porte voit la clé dans le jeu approuvé et laisse cet appel spécifique se dérouler normalement.
- **Deny** rejette l'affordance localement ; rien n'est réédité, donc l'action ne s'exécute jamais.

`approvedToolCalls` est un champ sur la demande de chat (`AgentChatRequest.approvedToolCalls`). Les clés qui n'y sont pas présentes restent en pause : l'approbation d'un appel n'en approuve jamais directement les autres. Parce que la clé est adressée au contenu, une approbation autorise *cet appel avec ces arguments* ; si le modèle propose ultérieurement un envoi différent, c'est une nouvelle clé et une nouvelle approbation.

## De bout en bout {#flow}

```an-diagram title="L'interruption d'approbation" summary="Un appel fermé interrompt le tour avant que run() ne se déclenche. L'approbation réémet le tour porteur de la clé d'appel ; ce n’est qu’alors que l’effet secondaire se produit."
{
  "html": "<div class=\"diagram-approve\"><div class=\"diagram-box\" data-rough>L’agent appelle send-email</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-panel warn\" data-rough><strong>Gate vrai, appel pas encore approuvé</strong><small class=\"diagram-muted\">loop emits tool_start + approval_required { tool, input, approvalKey }</small><span class=\"diagram-pill warn\">turn pauses &mdash; run() did NOT execute</span></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>L’humain clique sur Approuver dans le chat<br><small class=\"diagram-muted\">le client relance le tour avec approvedToolCalls: [approvalKey]</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-panel ok\" data-rough><span class=\"diagram-pill ok\">Gate sees the key &rarr; run() executes &rarr; email sends</span></div></div>",
  "css": ".diagram-approve{display:flex;flex-direction:column;align-items:center;gap:8px}.diagram-approve .diagram-panel{display:flex;flex-direction:column;gap:6px;align-items:center;padding:12px 16px;text-align:center}.diagram-approve .diagram-arrow{font-size:22px;line-height:1}"
}
```

L'utilisation canonique (et intentionnellement rare) de cette porte dans le framework est l'action `send-email` du modèle de courrier, qui définit `needsApproval: true` afin que l'agent puisse rédiger et mettre en file d'attente librement mais ne puisse jamais réellement envoyer un message sans qu'un humain n'approuve l'envoi spécifique.

## Connexe

- [**Actions**](/docs/actions#needs-approval) : la surface `defineAction` complète, y compris `outputSchema` pour valider les valeurs de retour.
- [**Security**](/docs/security) – quand atteindre une porte d'approbation ou cacher une action au modèle.
- [**Mail template**](/docs/template-mail) — `send-email` est l'exemple de référence.
