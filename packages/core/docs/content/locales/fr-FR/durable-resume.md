---
title: "CV durable"
description: "Lorsqu'une exécution d'un agent hébergé est interrompue et reprend, les appels d'outils à effets secondaires terminés ne sont pas réexécutés : un journal des appels d'outils dérivé du grand livre durable bloque les envois, les frais et les tickets en double."
---

# CV durable

> **À qui s'adresse-t-il :** toute personne souhaitant comprendre le fonctionnement du framework
> évite les effets secondaires en double. Il s'agit d'un comportement intégré — il y a
> rien à câbler.

L'exécution d'un agent hébergé est interrompue : une fonction sans serveur atteint son délai d'expiration en cours de route, une passerelle interrompt la connexion au bout de 45 s, un socket raccroche, la plate-forme démarre à froid. Le framework s'en récupère déjà en enregistrant le préfixe de conversation et en réexécutant l'appel LLM (« continuez là où vous vous êtes arrêté »). Mais la récupération seule a un avantage : si la tentative interrompue **a déjà envoyé un e-mail ou créé un ticket**, un CV naïf pourrait recommencer.

Un CV durable comble cet écart. À la reprise, le framework sait quels appels d'outils à effets secondaires ont déjà été effectués et refuse de les réexécuter - sur deux couches.

```an-diagram title="Deux couches bloquent les effets secondaires en double lors de la reprise" summary="Le journal lit le grand livre durable et classe les appels antérieurs ; la couche 1 indique au modèle, la couche 2 bloque en dur une écriture redistribuée qui correspond à une entrée terminée."
{
  "html": "<div class=\"diagram-durable\"><div class=\"diagram-box\" data-rough>Run-event ledger<br><small class=\"diagram-muted\">tool_start / tool_done</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><strong>Tool-call journal</strong><small class=\"diagram-ok\">completed = start+done</small><small class=\"diagram-warn\">interrupted = start, no done</small></div><div class=\"diagram-col\"><div class=\"diagram-pill\">Layer 1 · prompt note &rarr; model</div><div class=\"diagram-pill accent\">Couche 2 · écriture re-dispatchée avec blocage dur</div></div></div>",
  "css": ".diagram-durable{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-durable .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-durable .diagram-arrow{font-size:22px;line-height:1}.diagram-durable .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## Le journal des appels d'outils {#journal}

Le journal est une **lecture pure sur le grand livre durable des événements d'exécution** : il n'y a pas de nouveau point d'enregistrement dans le chemin actif. Il classe les appels d'outils déjà enregistrés pour le tour en cours :

- **Terminé** — un `tool_start` avec un `tool_done` correspondant. L'appel a été lancé, son effet secondaire s'est produit et son résultat a été enregistré. **Ne réexécutez pas.**
- **Interrompu** — un `tool_start` avec **aucun** correspondant à `tool_done`. L’appel a commencé, ses effets secondaires ont peut-être eu lieu ou non, et l’interruption a rongé le résultat. Résultat inconnu.

La correspondance reflète la façon dont les virages durables sont reconstruits ailleurs : un `tool_done` s'associe au plus ancien `tool_start` encore ouvert pour le même nom d'outil (FIFO par outil). Un événement `clear` (sortie partielle rejetée) réinitialise le décompte par tour afin que les partiels abandonnés ne laissent pas d'appels fantômes ouverts.

## Couche 1 : note de journal au niveau de l'invite {#prompt-note}

Lorsqu'une exécution reprend (délai d'expiration logiciel, délai d'expiration de la passerelle ou toute erreur de transport pouvant être reprise), le framework ajoute une **note de journal structuré** à l'invite de reprise, juste après le coup de pouce « reprendre là où vous vous êtes arrêté ». La note indique au modèle, en texte brut :

- quel outil appelle **déjà terminé** (avec des résultats courts) afin qu'il les réutilise et ne les réexécute **pas**, et
- quels appels d'outil ont été **interrompus avec un résultat inconnu** afin qu'il vérifie l'état avant de supposer un succès ou un échec.

Lorsque le journal est vide (un tour sans activité d'outil ou une continuation propre), rien de plus n'est ajouté et le comportement de reprise est octet pour octet ce qu'il était avant. La note est de la meilleure des manières : un échec de lecture du grand livre ne bloque jamais une récupération qui autrement réussirait.

## Couche 2 : bloc dur de la couche d'outils {#hard-block}

La note d'invite est consultative : un modèle bien élevé en tient compte, mais un modèle n'est pas une garantie. La boucle l'applique donc également au niveau de la couche d'outils.

Avant que la boucle ne s'exécute dans un morceau repris, elle prend un instantané du journal une fois (en capturant uniquement les morceaux **précédents** de ce tour logique). Lorsque le modèle réexpédie un outil **d'écriture** dont le nom d'outil **et l'entrée** correspondent à une entrée de journal terminée, la boucle court-circuite : elle renvoie le résultat journalisé au lieu d'exécuter l'action, avec une note indiquant que l'appel a déjà été terminé lors d'une tentative interrompue antérieure et n'a pas été réexécuté pour éviter un effet secondaire en double.

Propriétés clés :

- **Outils d'écriture uniquement.** Lecture seule (`readOnly` / GET) Les actions ne sont jamais bloqués — la relecture est sûre et idempotente.
- **Contenu adressé.** La correspondance porte sur le nom de l'outil + la signature d'entrée, donc un appel repris à une position différente dans le tour correspond toujours ; un appel _différent_ (arguments différents) est traité comme nouveau et s'exécute normalement.
- **À consommer une fois.** Chaque entrée terminée est réclamée lorsqu'elle correspond, de sorte que deux nouveaux appels identiques véritablement distincts au cours du même tour ne court-circuitent pas tous les deux lors d'une achèvement journalisée.
- **Les nouveaux appels restent intacts.** Un appel au premier tour voit un journal vide ; rien ne change pour les exécutions normales.

```an-callout
{
  "tone": "success",
  "body": "Together the two layers mean an interrupted run that already had a real side effect resumes **without repeating it** — no duplicate emails, charges, or tickets — while genuinely new work still runs. Read-only actions are never blocked; re-reading is always safe."
}
```

## Connexe

- [**Real-Time Sync**](/docs/real-time-collaboration) : comment le grand livre d'exécution durable est diffusé vers le client et rejoué lors de la reconnexion.
- [**Actions**](/docs/actions) : `readOnly` indique que la lecture est sûre et peut être réexécutée ; tout le reste est traité comme un effet secondaire.
- [**In-Loop Processors**](/docs/processors) — une autre couture de durcissement interne à la boucle.
