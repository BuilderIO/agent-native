---
title: "Mémoire d'observation"
description: "Compactage en arrière-plan à trois niveaux (bruts récents → observations → réflexions) qui maintient les longs threads d'agent bon marché et stables dans le cache d'invite sans toucher aux conversations courtes."
---

# Mémoire d'observation

Un thread d'agent de longue durée accumule une énorme transcription : chaque message, chaque appel d'outil, chaque résultat. Rejouer toute cette histoire dans le modèle à chaque tour coûte cher et finit par faire exploser la fenêtre contextuelle. La **mémoire d'observation (OM)** compacte la partie la plus ancienne d'un long fil de discussion en un résumé daté et superposé afin que le modèle sache toujours ce qui s'est passé (juste pour une fraction du coût du jeton) tandis que les tours les plus récents restent textuellement.

OM est entièrement automatique et limité au propriétaire. **Les threads courts ne sont pas affectés** : jusqu'à ce qu'un thread franchisse le premier seuil de compactage, OM est un non-op et le contexte est octet pour octet ce qu'il serait sans lui.

## Les trois niveaux {#tiers}

OM représente un long fil de discussion composé de trois couches, du plus distillé au plus récent :

| Niveau                     | Qu'est-ce que c'est                                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Réflexions**             | Niveau le plus élevé, condensé à partir du journal d'observation une fois qu'il devient volumineux. Le résumé en arc long.    |
| **Observations**           | Des entrées denses et datées qui regroupent une série de messages bruts dans un enregistrement compact de ce qui s'est passé. |
| **Messages bruts récents** | Les N derniers tours, conservés **textuellement** — jamais pliés — afin que l'agent voie toujours le dernier contexte.        |

```an-diagram title="Trois niveaux, distillés au récent" summary="Le préfixe plus ancien se replie en observations datées et en une réflexion en arc long ; seuls les tours les plus récents restent textuellement."
{
  "html": "<div class=\"om\"><div class=\"diagram-card\"><span class=\"diagram-pill\">Réflexions</span><small class=\"diagram-muted\">synthèse longue condensée depuis le journal d’observations</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&uarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Observations</span><small class=\"diagram-muted\">entrées denses et datées regroupant des séries de messages bruts</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&uarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill ok\">Messages bruts récents</span><small class=\"diagram-muted\">last N turns, kept <strong>verbatim</strong> — jamais repliés</small></div></div>",
  "css": ".om{display:flex;flex-direction:column-reverse;align-items:stretch;gap:8px}.om .diagram-card{display:flex;flex-direction:column;gap:4px;padding:12px 16px}.om .diagram-arrow{text-align:center;font-size:20px;line-height:1}"
}
```

À chaque tour, le côté lecture les assemble en un seul bloc `[Observational Memory]` auto-étiqueté qui remplace l'ancien préfixe brut, conserve la fenêtre brute récente intacte et indique au modèle de traiter l'enregistrement compacté comme faisant autorité (ne refaites pas le travail terminé, faites confiance aux décisions, noms, dates et statuts enregistrés).

## Comment se déroule le compactage {#compaction}

Deux passes s'exécutent comme une étape **de tir et d'oubli, au mieux** _après_ un tour propre, de sorte qu'elles n'ajoutent jamais de latence à la réponse visible par l'utilisateur et que tout échec est avalé :

1. **Observateur** — une fois que les messages _non observés_ d'un fil dépassent le seuil du jeton d'observation, les regroupe en une seule entrée d'observation dense.
2. **Réflecteur** — une fois que le journal d'observation persistant lui-même dépasse le seuil du jeton de réflexion, condense les observations en une réflexion de niveau supérieur.

```an-diagram title="Deux passes au mieux après un virage propre" summary="Chaque passage sans opération en dessous de son seuil, donc faire fonctionner le compacteur à chaque tour est bon marché. Les échecs sont avalés et n’ajoutent jamais de latence."
{
  "html": "<div class=\"om-pass\"><div class=\"diagram-node\">Fin de tour propre<br><small class=\"diagram-muted\">fire-and-forget</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Observer</span><small class=\"diagram-muted\">unobserved tokens &gt; 30k? &rarr; fold into one observation</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Reflector</span><small class=\"diagram-muted\">observation log &gt; 40k? &rarr; condense into a reflection</small></div></div>",
  "css": ".om-pass{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.om-pass .diagram-node,.om-pass .diagram-card{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.om-pass .diagram-arrow{font-size:22px;line-height:1}"
}
```

Les deux passent sans opération en dessous de leurs seuils, donc appeler le compacteur après chaque tour est bon marché. Étant donné que OM remplace le préfixe brut volatile par du texte compacté stable, il conserve également l'invite **stable en cache** au fil des tours d'un long thread.

Les données OM résident dans la propre base de données SQL de l'application, limitée au propriétaire (et à l'organisation le cas échéant) – le même modèle de portée que le reste du framework. Il n'est jamais partagé entre les utilisateurs.

## Configuration {#config}

Les valeurs par défaut sont conservatrices. Un opérateur peut composer le compactage au moment du déploiement avec les variables d'environnement `AGENT_NATIVE_OM_*` (aucun redéploiement du code de l'application n'est nécessaire) ; une valeur invalide ou manquante revient toujours à la valeur par défaut nommée.

| Variable d'environnement                      | Par défaut | Ce qu'il contrôle                                                                                     |
| --------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| `AGENT_NATIVE_OM_OBSERVATION_TOKEN_THRESHOLD` | `30000`    | Jetons de message non observés qui incitent l'observateur à les regrouper en une seule observation.   |
| `AGENT_NATIVE_OM_REFLECTION_TOKEN_THRESHOLD`  | `40000`    | Jetons de journal d'observation qui déclenchent la condensation du réflecteur en une réflexion.       |
| `AGENT_NATIVE_OM_RECENT_RAW_MESSAGE_COUNT`    | `12`       | Combien de messages parmi les plus récents restent textuellement (jamais intégrés à une observation). |

Les capuchons de sortie Observer et Reflector (4 000 / 2 000 jetons) empêchent une seule passe de compactage de faire exploser le budget ; ils sont réglables dans le code via `resolveObservationalMemoryConfig({ ... })` mais ne sont pas exposés à l'environnement.

> [!TIP]
> Abaissez les seuils pour compacter plus tôt (threads longs moins chers, légèrement plus de résumé) ; augmentez-les pour conserver un historique plus brut dans son contexte avant de les compacter. Définissez `AGENT_NATIVE_OM_RECENT_RAW_MESSAGE_COUNT` plus haut si vos flux de travail nécessitent une queue textuelle plus longue.

## Quand il entre en jeu {#when}

OM ne modifie le comportement que pour les threads suffisamment longtemps pour avoir produit au moins une observation ou une réflexion. Concrètement :

- Un fil de discussion tout nouveau ou court : aucune entrée OM pour l'instant → le contexte est la transcription simple, inchangée.
- Un long fil de discussion qui a franchi le seuil d'observation : l'ancien préfixe est remplacé par le bloc `[Observational Memory]` compacté, la queue brute récente reste textuellement et l'utilisation des jetons diminue considérablement.

L'injection se fait au mieux et sans danger pour les limites : si un point de découpage sûr ne peut pas être trouvé (par exemple, une paire outil-utilisation/résultat en attente se trouve au bord de la fenêtre), OM injecte le bloc de mémoire _de manière additive_ sans couper plutôt que de risquer de supprimer un résultat d'outil en attente.

## Connexe

- [**Using Your Agent**](/docs/using-your-agent) : la boucle quotidienne de travail avec l'agent ancré à côté de votre application.
- [**Observability**](/docs/observability) – mesures de jetons et de coûts par exécution, où les économies d'OM apparaissent.
- [**Custom Agents & Teams**](/docs/agent-teams) : les longues exécutions de sous-agents bénéficient du même compactage.
