---
title: "Modo de archivo local"
description: "Ejecute aplicaciones nativas del agente con Markdown, MDX y otros archivos de repositorio locales como fuente de verdad, incluidos documentos MDX estilo Obsidian con componentes personalizados."
---

# Modo de archivo local

El modo de archivo local permite que una aplicación nativa del agente adjunte su UI normal y su superficie de acción
directamente a archivos en un repositorio o espacio de trabajo. La aplicación todavía se siente como si estuviera alojada
producto, pero sus vistas de lista, editor y herramientas de agente leen y escriben archivos locales
en lugar de registros de aplicaciones respaldados por SQL.

La primera implementación está en la plantilla de Contenido: la barra lateral izquierda es
rellenado a partir de archivos locales `.md` y `.mdx`; al seleccionar una página se abre el estándar
Editor de contenido y guardar escrituras en el archivo seleccionado. Los mismos archivos pueden
También puede ser editado por Codex, Código Claude, el agente de la barra lateral Agent-Native o un normal
editor.

En cuanto al contenido, esto hace que el producto parezca Obsidian de código abierto para MDX:
tus documentos se guardan como archivos, mientras que la aplicación agrega un editor visual, el agente actions
Copias que se pueden compartir y componentes interactivos enriquecidos de MDX.

Utilice el modo de archivo local cuando desee un flujo de trabajo basado en el repositorio:

- un repositorio de documentos con `docs/*.mdx`
- un blog con `blog/*.mdx`
- recursos como posicionamiento, mensajería o notas del equipo en `resources/*.md`
- una base de conocimientos personal estilo Obsidian con un editor MDX más completo
- Documentos que necesitan bloques MDX personalizados e interactivos generados a partir del código React local
- artefactos de aplicaciones que deberían ser fáciles de inspeccionar y parchar para los agentes de codificación

Utilice el modo de base de datos cuando desee disfrutar de la experiencia de la aplicación colaborativa alojada:
Compartir entre varios usuarios, permisos respaldados por SQL, comentarios, historial de versiones y
alojamiento de producción sin acceso al sistema de archivos local.

## El modelo mental

Hay dos modos de fuente de verdad:

| Modo                  | Fuente de la verdad                                        | Mejor para                                                                                                                   |
| --------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Modo de base de datos | Filas SQL hasta Drizzle                                    | Aplicaciones alojadas, colaboración, uso compartido, comentarios, historial de versiones                                     |
| Modo de archivo local | Archivos de repositorio declarados por `agent-native.json` | Flujos de trabajo locales/de desarrollo, revisión de Git, ediciones del agente de codificación, contenido nativo de archivos |

El UI y el agente actions deben mantener la misma forma en ambos modos. Un contenido
el editor aún edita documentos; la diferencia es si esos documentos resuelven
a filas SQL o archivos locales.

```an-diagram title="Mismas acciones, dos fuentes de verdad" summary="La interfaz de usuario y el agente llaman a acciones idénticas en ambos modos. La capa de acción decide si cada llamada se resuelve en SQL filas o archivos de repositorio."
{
  "html": "<div class=\"diagram-mode\"><div class=\"diagram-col entry\"><div class=\"diagram-node\">UI de contenido</div><div class=\"diagram-node\">Agente + acciones<br><small class=\"diagram-muted\">list/get/update-document</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-row resolve\"><div class=\"diagram-panel\" data-rough><span class=\"diagram-pill accent\">Modo base de datos</span><small class=\"diagram-muted\">SQL rows via Drizzle</small><small class=\"diagram-muted\">alojado · compartir · comentarios · historial</small></div><div class=\"diagram-panel\" data-rough><span class=\"diagram-pill ok\">Local File Mode</span><small class=\"diagram-muted\">repo files via agent-native.json</small><small class=\"diagram-muted\">revisión Git · ediciones del agente de código</small></div></div></div>",
  "css": ".diagram-mode{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-mode .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-mode .diagram-arrow{font-size:22px;line-height:1}.diagram-mode .resolve{display:flex;gap:12px;flex-wrap:wrap}.diagram-mode .diagram-panel{display:flex;flex-direction:column;gap:4px;padding:12px 14px}"
}
```

## Repositorio de ejemplo

Un espacio de trabajo de contenido puede ser tan pequeño como este:

```an-file-tree title="Un repo de workspace de Content"
{
  "entries": [
    { "path": "agent-native.json", "note": "Declara qué carpetas son raíces de contenido y sus tipos" },
    { "path": "docs/", "note": "Raíz de contenido: aparece en la barra lateral como páginas" },
    { "path": "docs/getting-started.mdx" },
    { "path": "docs/guides/custom-components.mdx" },
    { "path": "blog/", "note": "Raíz de contenido" },
    { "path": "blog/launch-post.mdx" },
    { "path": "resources/", "note": "Raíz de contenido" },
    { "path": "resources/messaging/positioning.md" },
    { "path": "components/", "note": "NO es una raíz de contenido: biblioteca de componentes de preview que MDX puede importar" },
    { "path": "components/FrameworkTabs.tsx" },
    { "path": "components/Callout.tsx" },
    { "path": "extensions/", "note": "NO es una raíz de contenido: biblioteca local de extensions (widgets en sandbox)" },
    { "path": "extensions/doc-status/extension.json" },
    { "path": "extensions/doc-status/index.html" }
  ]
}
```

En el modo de archivo local, la barra lateral de Contenido muestra `docs/`, `blog/` y
`resources/` árboles como páginas. Al seleccionar `docs/getting-started.mdx` se abre eso
archivo en el editor de contenido estándar; la edición en el UI escribe de nuevo en
`docs/getting-started.mdx`.

`components/` no es una raíz de contenido. Es una biblioteca de componentes de vista previa que MDX
los archivos pueden importarse o hacer referencia. El editor puede renderizar componentes MDX locales simples
sin necesidad de clonar o bifurcar toda la aplicación de contenido.

`extensions/` tampoco es una raíz de contenido. Es una biblioteca de extensión local:
pequeños widgets aislados que pueden renderizarse en espacios de aplicaciones mientras su fuente permanece en
el repositorio.

## Instalar contenido en un repositorio

Para documentos, blogs o espacios de trabajo MDX existentes, instale los archivos locales de contenido
habilidad:

```bash
npx @agent-native/core@latest skills add content --mode local-files --scope project
```

Esto copia la habilidad `content` en las carpetas de habilidades del agente del repositorio y escribe
o actualiza `agent-native.json` con los valores predeterminados de contenido:

- `mode: "local-files"` a nivel del espacio de trabajo
- `apps.content.mode: "local-files"`
- raíces de contenido para `docs/`, `blog/`, `content/` y `resources/`
- `components/` para componentes locales MDX
- `extensions/` para widgets de extensión local

La habilidad instalada indica a los agentes de codificación que utilicen Content actions
(`list-documents`, `get-document`, `edit-document`, `update-document`,
`share-local-file-document` y archivo de componente actions) cuando se trata de una aplicación de contenido local
o Agent Native Desktop Bridge los expone. Si no hay ningún puente en funcionamiento, la habilidad
recurre a ediciones directas seguras del repositorio mientras conserva el frontmatter, las importaciones, JSX,
y desconocido MDX.

## Configuración

Agregue `agent-native.json` al repositorio o a la raíz del espacio de trabajo:

```json
{
  "version": 1,
  "apps": {
    "content": {
      "mode": "local-files",
      "roots": [
        {
          "name": "Docs",
          "path": "docs",
          "kind": "docs",
          "extensions": [".md", ".mdx"]
        },
        {
          "name": "Blog",
          "path": "blog",
          "kind": "blog",
          "extensions": [".md", ".mdx"]
        },
        {
          "name": "Resources",
          "path": "resources",
          "kind": "resources",
          "extensions": [".md", ".mdx"]
        }
      ],
      "components": "components",
      "extensions": "extensions",
      "hide": ["**/_*.md", "**/_*.mdx"]
    }
  }
}
```

También puedes habilitar archivos locales con `AGENT_NATIVE_MODE=local-files` o
`AGENT_NATIVE_DATA_MODE=local-files`; se prefiere el manifiesto porque
documenta el contrato de la carpeta en el propio repositorio.

## Formato de archivo de contenido

El contenido dice Markdown y MDX. Frontmatter contiene metadatos de la página y el cuerpo es
el documento editable:

```mdx
---
title: "Empezando"
icon: "sparkles"
isFavorite: true
updatedAt: "2026-06-12T20:00:00.000Z"
---

# Empezando

Use <FrameworkTabs value="react" /> to show framework-specific code.
```

El título proviene del frontmatter `title` cuando está presente; de lo contrario, del
nombre de archivo. El editor conserva la fuente MDX que aún no puede editar visualmente, por lo que
Los agentes de codificación y los editores de texto normales siguen siendo puertas de escape seguras.

## Componentes MDX personalizados

El contenido puede obtener una vista previa de los componentes locales desde la carpeta `components` configurada.
Esto está destinado a componentes MDX de estilo documentos, como pestañas, llamadas y paquetes
instale fragmentos o bloques de código específicos del marco.

Por ejemplo, agregue un componente interactivo junto a su contenido:

```tsx
// components/ImpactCounter.tsx
import { useState } from "react";

export function ImpactCounter({
  label = "points",
  accent = "blue",
  featured = false,
}: {
  label?: string;
  accent?: "blue" | "green" | "purple";
  featured?: boolean;
}) {
  const [count, setCount] = useState(3);
  const accentClass =
    accent === "green"
      ? "border-green-300 bg-green-50"
      : accent === "purple"
        ? "border-purple-300 bg-purple-50"
        : "border-blue-300 bg-blue-50";

  return (
    <div className={`rounded-md border p-4 ${accentClass}`}>
      <div className="text-sm text-muted-foreground">Launch impact</div>
      <div className="mt-1 text-3xl font-semibold">
        {count} {label}
      </div>
      {featured ? <div className="mt-1 text-sm">Featured metric</div> : null}
      <button
        type="button"
        className="mt-3 rounded border px-3 py-1 text-sm"
        onClick={() => setCount((value) => value + 1)}
      >
        Add point
      </button>
    </div>
  );
}

export const ImpactCounterInputs = {
  label: {
    type: "string",
    label: "Metric label",
    default: "points",
  },
  accent: {
    type: "select",
    label: "Accent",
    options: ["blue", "green", "purple"],
    default: "blue",
  },
  featured: {
    type: "boolean",
    label: "Featured",
    default: false,
  },
};
```

Luego úselo desde cualquier archivo MDX local:

```mdx
---
title: "Notas de lanzamiento"
---

# Notas de lanzamiento

<ImpactCounter label="wins" />
```

El servidor de desarrollo de contenido descubre las exportaciones con nombre de PascalCase y el valor predeterminado de PascalCase
exportaciones de archivos `.tsx`, `.jsx`, `.ts` y `.js` en `components/`. Esos
Los componentes se procesan dentro del editor y aparecen en el menú diagonal debajo
**Componentes locales**. La inserción de barra diagonal crea una etiqueta mínima como
`<ImpactCounter />`; agregue accesorios en la fuente MDX cuando sea necesario.

La ejecución de componentes es intencionalmente una capacidad de puente entre desarrollo local y escritorio, no
acceso simple a la carpeta del navegador alojado. Si abres `content.agent-native.com`,
elija **Archivos locales** y elija una carpeta en Chrome, la aplicación puede leer y escribir
los archivos `.md` y `.mdx` a través del navegador File System Access API, pero
Chrome no expone una ruta de carpeta absoluta para que Vite pueda compilar
`components/*.tsx`. Para obtener una vista previa y recargar en caliente componentes React personalizados, ejecute
Contenido local o use Agent Native Desktop para que el puente local confiable pueda
registre el espacio de trabajo elegido con el servidor de desarrollo de contenido local. En ese modo,
ediciones en archivos de componentes existentes, recarga en caliente a través de Vite y adición o
Al eliminar los archivos de componentes se vuelve a cargar el registro de componentes y el menú diagonal.

Los agentes también pueden trabajar con esos archivos de componentes registrados. Usar
`list-local-component-files` para encontrar la identificación del espacio de trabajo registrado, luego
`write-local-component-file` para crear o actualizar `.tsx`, `.jsx`, `.ts` o
Archivos `.js` en la carpeta `components/` del espacio de trabajo. Los archivos MDX siguen siendo los
fuente de verdad para el uso de componentes; los archivos componentes permanecen en el repositorio normal
archivos fuente revisados con Git.

Si un componente exporta metadatos de entrada, seleccione el componente en el editor
muestra un botón de edición en la esquina superior derecha del componente. Tipos de entrada admitidos
son `string`, `textarea`, `number`, `boolean` y `select`. El formulario escribe
vuelve a la etiqueta MDX, por lo que los archivos locales siguen siendo la fuente de la verdad. El
Los metadatos se pueden exportar como `ComponentNameInputs`, `ComponentNameConfig.inputs`,
`Component.inputs` o `agentNative.inputs`.

Las etiquetas de componentes simples con accesorios literales pueden obtener una vista previa en línea:

```mdx
<FrameworkTabs value="react" />

<Callout type="warning">This setting affects production deploys.</Callout>
```

Las expresiones JSX complejas se conservan en el código fuente. Si el editor no puede hacerlo de forma segura
obtenga una vista previa de la propiedad de un componente todavía, muestra un marcador de posición de advertencia en lugar de
soltar datos silenciosamente.

## Compartir archivos locales

Los archivos locales no se comparten directamente porque otros usuarios no pueden leer una ruta
tu máquina. El botón Compartir de la barra de herramientas Contenido crea o actualiza un
copia respaldada por la base de datos del archivo seleccionado, navega hasta esa copia y abre el
ventana emergente de compartir normal. El archivo local original permanece en Archivos locales; el
La copia de la base de datos aparece en Copias compartidas en modo de archivo local y utiliza el
modelo estándar para compartir documentos.

## Extensiones locales

El modo de archivo local también puede cargar extensiones respaldadas por repositorio desde el archivo configurado
Carpeta `extensions`. Cada extensión es un directorio con un `extension.json`
manifiesto y un archivo de entrada HTML:

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

`index.html` es el mismo formato de cuerpo de extensión Alpine/Tailwind utilizado por normal
extensiones respaldadas por bases de datos. Cuando la aplicación Contenido ve una extensión local que
declara `content.sidebar.bottom`, representa esa extensión en la parte inferior de
la barra lateral de Contenido. El anfitrión pasa `window.slotContext` con el seleccionado
ID del documento, título, metadatos de origen y si el contenido está en modo de archivo local.

La aplicación obtiene una vista previa de las extensiones locales, pero las edita como archivos. Las extensiones
la lista los muestra con una insignia de Archivo local y el visor de página completa apunta a
el archivo de entrada. Extensión respaldada por SQL actions, como actualizar, eliminar, compartir y
el historial no se aplica; use su editor, Codex, código Claude o historial de Git para
cambios de fuente.

Para v1, las extensiones locales son intencionalmente conservadoras:

- pueden usar `extensionData` para su propio estado de ejecución pequeño
- solo pueden llamar a los `appAction` enumerados en `extension.json`
- Los asistentes SQL sin formato y `extensionFetch` externos están deshabilitados
- Los destinos de ranura se declaran en `extension.json`, no se instalan a través de SQL

Esto proporciona a los espacios de trabajo locales una superficie de complemento similar a Obsidian sin permitir que
El archivo de repositorio arbitrario hereda todas las capacidades de una extensión respaldada por una base de datos.

## Cómo lo usan las aplicaciones

El modo de archivo local se implementa a través de los asistentes de artefactos locales del marco.
Una aplicación declara raíces para los tipos de artefactos que posee, luego lee y escribe
a través de la misma superficie de acción que su UI y su agente ya utilizan.

Para Contenido, eso significa:

- `list-documents` enumera los archivos `.md` y `.mdx` configurados.
- `get-document` lee un archivo local seleccionado.
- `update-document` escribe el archivo local seleccionado.
- `create-document` crea un nuevo archivo `.mdx` local en la carpeta seleccionada.
- `delete-document` elimina el archivo local.
- La búsqueda se ejecuta en los archivos locales configurados.

Mover, renombrar y reordenar páginas de archivos locales desde UI de contenido no lo es
aún es compatible. Realice esas operaciones en el espacio de trabajo o con un agente de codificación; el
La barra lateral de contenido reflejará el árbol de archivos resultante.

Esto simplifica el contrato del agente: el agente puede seguir usando Content actions,
y esos actions deciden si el objetivo está respaldado por SQL o por archivos.

Otras aplicaciones pueden adoptar el mismo patrón con el tiempo. Una aplicación de Presentaciones puede mapear
`slides/*.mdx` a cubiertas, una aplicación de Planes puede asignar `plans/*` a documentos de planos y
La aplicación Paneles puede asignar `dashboards/*.mdx` a paneles. Aquellos específicos de la aplicación
Las carpetas son convenciones superpuestas al mismo contrato de artefacto local.

## Archivos locales frente a exportación/importación

El contenido tiene dos flujos de trabajo de archivos diferentes:

| Flujo de trabajo                       | Qué pasa                                                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exportación/importación `/local-files` | El modo de base de datos sigue siendo la fuente de la verdad. Los archivos son una superficie de sincronización explícita que puedes exportar, editar, obtener una vista previa e importar. |
| Modo de archivo local                  | Los archivos son la fuente de la verdad. La barra lateral de contenido y el editor funcionan directamente en archivos locales.                                                              |

Utilice exportar/importar cuando desee revisar archivos ocasionalmente en un espacio de trabajo alojado.
Utilice el modo de archivo local cuando el repositorio en sí sea el espacio de trabajo.

## Historia y colaboración

El modo de archivo local se basa en el historial nativo del archivo:

- realizar cambios importantes en Git
- usar solicitudes de extracción para revisión
- permitir que los agentes de codificación editen los mismos archivos directamente
- use diferencias de archivos normales para comprender los cambios

El modo de base de datos sigue siendo el más adecuado para funciones de colaboración alojadas como
Compartir, comentarios, historial de versiones respaldado por SQL y edición multiusuario en vivo.

La sincronización del proveedor se puede superponer a cualquier modo. Por ejemplo, un repositorio de documentos puede
Agregue actions que extraiga contenido de un CMS a archivos MDX locales o envíe los seleccionados
archivos locales de regreso a ese CMS.

## Seguridad en la producción

El modo de archivo local le da a la aplicación actions acceso directo de escritura al espacio de trabajo configurado
archivos. Esto es apropiado para el desarrollo local y un archivo de inquilino único confiable
puentes, pero no es el modelo de seguridad de producción predeterminado.

Cuando `NODE_ENV=production`, el marco rechaza el modo `local-files` a menos que usted
conjunto:

```bash
AGENT_NATIVE_ALLOW_LOCAL_FILES_IN_PRODUCTION=true
```

Establezca esto solo para una implementación confiable de un solo inquilino donde todos los que puedan usarlo
la aplicación puede leer y escribir los archivos configurados. Para alojamiento normal,
aplicaciones multiusuario, uso del modo de base de datos y uso compartido respaldado por SQL.
