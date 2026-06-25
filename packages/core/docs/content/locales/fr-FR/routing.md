---
title: "Routage"
description: "Routage basé sur des fichiers pour les applications natives d'agent avec React Router v8 : pages, paramètres dynamiques et navigation."
---

# Routage

Les applications natives d'agent utilisent le **routeur React v8** avec un routage basé sur des fichiers via `flatRoutes()` à partir de `@react-router/fs-routes`. Chaque fichier de `app/routes/` devient un URL. Les modèles utilisent la convention de notation par points : des points séparent les segments URL à l'intérieur d'un seul nom de fichier.

## Routage basé sur des fichiers {#file-based-routing}

### Fichier → Mappage URL

| Fichier               | URL                  | Remarques                                       |
| --------------------- | -------------------- | ----------------------------------------------- |
| `_index.tsx`          | `/`                  | Indexer l'itinéraire                            |
| `settings.tsx`        | `/settings`          | Page simple                                     |
| `inbox.$threadId.tsx` | `/inbox/:threadId`   | Point = `/`, `$` = paramètre dynamique          |
| `_app.tsx`            | (pas de segment URL) | Mise en page sans chemin – préfixe avec `_`     |
| `inbox/route.tsx`     | `/inbox`             | Formulaire de dossier — `route.tsx` est l'index |

Préfixez un segment avec `$` pour un paramètre dynamique. Préfixez `_` pour en faire un itinéraire de tracé sans chemin (pas de segment URL). Les modèles utilisent `flatRoutes()` — le fichier de notation par points ci-dessus est principal ; le formulaire de dossier imbriqué `inbox/route.tsx` fonctionne également.

```an-diagram title="La mise en page sans chemin enveloppe les pages" summary="Une disposition _app.tsx (pas de segment URL) restitue le shell partagé une fois ; les pages correspondantes s'affichent dans son <Outlet/>, de sorte que la barre latérale de l'agent ne remonte jamais lors de la navigation."
{
"html": "<div class=\"diagram-layout\" data-rough><div class=\"diagram-shell\"><span class=\"diagram-pill accent\">_app.tsx</span><small class=\"diagram-muted\">layout sans chemin · shell persistant + barre agent</small><div class=\"diagram-outlet\" data-rough><small class=\"diagram-muted\">&lt;Outlet/&gt; — the matched page</small><div class=\"diagram-row\"><span class=\"diagram-pill\">_index.tsx &rarr; /</span><span class=\"diagram-pill\">settings.tsx &rarr; /settings</span><span class=\"diagram-pill\">inbox.$threadId.tsx &rarr; /inbox/:threadId</span></div></div></div></div>",
"css": ".diagram-layout .diagram-shell{display:flex;flex-direction:column;gap:8px;padding:16px}.diagram-layout .diagram-outlet{display:flex;flex-direction:column;gap:8px;padding:14px;margin-top:6px}.diagram-layout .diagram-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}"
}

```

## Ajout d'une nouvelle page {#adding-a-page}

Créez le fichier et exportez un composant par défaut :

```tsx
// app/routes/settings.tsx
export function meta() {
  return [{ title: "Settings" }];
}

export default function SettingsPage() {
  return <div>Settings</div>;
}
```

C'est tout – Le routeur React le récupère automatiquement, aucune inscription n'est nécessaire.

## Paramètres dynamiques {#dynamic-params}

```tsx
// app/routes/inbox/$threadId.tsx
import { useParams } from "react-router";

export default function ThreadPage() {
  const { threadId } = useParams();
  return <div>Thread: {threadId}</div>;
}
```

## Navigation {#navigation}

Utilisez `<Link>` pour la navigation côté client et `useNavigate()` pour la navigation par programmation :

```tsx
import { Link, useNavigate } from "react-router";

// In JSX
<Link to="/settings">Settings</Link>;

// Programmatic
const navigate = useNavigate();
navigate(`/inbox/${threadId}`);
```

## Quelle est la prochaine étape

- [**Client**](/docs/client) — les hooks et utilitaires de navigateur natifs de l'agent
- [**Server**](/docs/server) — routes de serveur basées sur des fichiers et espace de noms `/_agent-native/`
