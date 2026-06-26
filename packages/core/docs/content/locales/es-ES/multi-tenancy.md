---
title: "Multi-inquilino"
description: "Cada aplicación nativa del agente es multiinquilino lista para usar: organizaciones, miembros del equipo, roles y aislamiento de datos por organización, sin configuración."
---

# Multi-inquilino

Cada aplicación nativa del agente es multiinquilino lista para usar. Las organizaciones, los miembros del equipo, el acceso basado en roles y el aislamiento de datos por organización están integrados en el marco sin configuración.

## Lo que obtienes gratis {#free}

Ya se envía un andamio `npx @agent-native/core@latest create` nuevo con:

- **Registro e inicio de sesión de usuario**: consulte [Authentication](/docs/authentication).
- **Organizaciones**: los usuarios crean organizaciones e invitan a miembros por correo electrónico. Cada organización es un inquilino completamente aislado.
- **Roles**: cada miembro es `owner`, `admin` o `member`; actions puede verificar el rol para obtener autorización.
- **Cambio de organización**: la sesión realiza un seguimiento de la organización activa (`session.orgId`) y al cambiarla se cambian los datos que ven el usuario y el agente.
- **Aislamiento de datos por organización**: cada consulta se limita automáticamente a la organización activa.

Si está evaluando un agente nativo para un CRM, un rastreador de proyectos, una bandeja de entrada de soporte o cualquier herramienta de equipo, la base multiinquilino ya está ahí. Todas las plantillas propias son multiinquilino; consulte [Cloneable SaaS templates](/docs/cloneable-saas) para ver la lista.

```an-diagram title="Membresía y aislamiento de la organización" summary="Los usuarios se unen a organizaciones como owner/admin/member. Cada fila poseíble lleva el org_id del inquilino propietario y ninguna fila cruza el límite."
{
  "html": "<div class=\"mt-grid\"><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Org. A</span><small class=\"diagram-muted\">members: alice (owner), bob (member)</small><div class=\"diagram-box\">rows where org_id = A</div></div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Org. B</span><small class=\"diagram-muted\">members: carol (owner)</small><div class=\"diagram-box\">rows where org_id = B</div></div></div><div class=\"mt-wall\" aria-hidden=\"true\"><span class=\"diagram-pill warn\">no cross-org reads</span></div>",
  "css": ".mt-grid{display:flex;gap:16px;flex-wrap:wrap}.mt-grid .diagram-card{display:flex;flex-direction:column;gap:8px;padding:14px 16px;flex:1;min-width:200px}.mt-wall{display:flex;justify-content:center;margin-top:12px}"
}
```

## El selector de organizaciones UI {#org-switcher}

El conmutador de organización y los miembros UI se representan en cada plantilla sin código adicional. Impulsan las rutas principales de la organización REST bajo `/_agent-native/org/*` (crear organización, cambiar de organización, listar/invitar/eliminar miembros, cambiar roles, establecer dominio de correo electrónico permitido). Los usuarios eligen la organización activa del conmutador; el panel de miembros maneja las invitaciones y los cambios de roles.

Este es el módulo `org/` propio del marco, no el complemento de organización de Better Auth (que intencionalmente no está registrado). La superficie completa de administración de la organización (`createOrganization`, las rutas REST y los contenedores `defineAction` creados por plantillas como `invite-member`) está documentada en [Authentication → Organizations](/docs/authentication#organizations).

## Cómo funciona el aislamiento {#isolation}

Los datos del inquilino están aislados mediante una columna `org_id` (agregada por `ownableColumns()`) y el marco abarca cada consulta a la organización activa automáticamente: `session.orgId → AGENT_ORG_ID → SQL`. Cuando un usuario cambia de organización, UI, actions y el agente ven solo los datos de esa organización; el agente no puede acceder a los datos de una organización de la que el usuario no es miembro.

```an-diagram title="De la sesión al ámbito SQL" summary="La organización activa en la sesión se convierte en AGENT_ORG_ID, que el marco integra en la cláusula WHERE de cada consulta."
{
  "html": "<div class=\"mt-pipe\"><div class=\"diagram-node\">session.orgId<br><small class=\"diagram-muted\">active org on session</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">AGENT_ORG_ID<br><small class=\"diagram-muted\">request context</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">SQL row scoping<br><small class=\"diagram-muted\">WHERE owner_email = ? AND org_id = ?</small></div></div>",
  "css": ".mt-pipe{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.mt-pipe .diagram-node{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.mt-pipe .diagram-arrow{font-size:22px;line-height:1}"
}
```

Esta es la misma canalización utilizada para el alcance por usuario. Para conocer las mecánicas de nivel SQL, el contrato `ownableColumns()` y los guardias `accessFilter` / `resolveAccess` / `assertAccess`, consulte [Security → Data Scoping](/docs/security#data-scoping): la única fuente de verdad para el proceso de alcance.

## Documentos relacionados {#related}

- [Authentication](/docs/authentication#organizations): sesiones, proveedores sociales y la superficie de gestión de la organización
- [Security → Data Scoping](/docs/security#data-scoping): aislamiento de nivel SQL, contrato `ownableColumns()` y guardias de acceso
- [Multi-App Workspace](/docs/multi-app-workspace): aloja múltiples aplicaciones nativas del agente en un monorepo con autenticación compartida y RBAC
