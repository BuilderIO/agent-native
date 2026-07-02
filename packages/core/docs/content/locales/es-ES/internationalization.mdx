---
title: "Internacionalización"
description: "Localice aplicaciones Agent Native con catálogos de configuración regional compartidos, un selector de idioma, respaldo de idioma del navegador y contenido de documentos compatible con la configuración regional."
---

# Internacionalización

Las aplicaciones Agent Native pueden localizar el marco y la plantilla UI a través del recurso compartido
Tiempo de ejecución `@agent-native/core/client/i18n`. El marco almacena el usuario
elección de idioma en la configuración de SQL, lo expone como actions y vuelve a
Inglés cuando una aplicación aún no ha traducido una cadena.

## Tiempo de ejecución

Utilice el proveedor a través de `AppProviders`:

```tsx
import { AppProviders, getLocaleInitScript } from "@agent-native/core/client";
import { i18nCatalog } from "./i18n";

const LOCALE_INIT_SCRIPT = getLocaleInitScript();

<script
  data-agent-native-locale-init
  dangerouslySetInnerHTML={{ __html: LOCALE_INIT_SCRIPT }}
/>;

<AppProviders queryClient={queryClient} i18n={{ catalog: i18nCatalog }}>
  <Outlet />
</AppProviders>;
```

`getLocaleInitScript()` establece los valores iniciales `lang`, `dir` y
`window.__AGENT_NATIVE_LOCALE__` antes de que React se hidrate. Las rutas públicas SSR pueden
llamar a `resolveLocaleFromRequest()` desde `@agent-native/core/server` y pasar el
Resolvió la configuración regional/catálogo en ese script para evitar discrepancias en la hidratación.

## Catálogos

Cada plantilla localizada mantiene catálogos en `app/i18n/`:

```ts
// app/i18n/index.ts
import enUS from "./en-US";
import type { AgentNativeI18nCatalog } from "@agent-native/core/client";

export const i18nCatalog = {
  sourceLocale: "en-US",
  messages: enUS,
  loadMessages: async (locale) => {
    switch (locale) {
      case "zh-CN":
        return (await import("./zh-CN")).default;
      default:
        return null;
    }
  },
} satisfies AgentNativeI18nCatalog;
```

Siempre incluya `en-US`. Importación dinámica de catálogos que no están en inglés para que sean solo usuarios
descargar la configuración regional activa. Los códigos locales admitidos son `en-US`, `zh-CN`,
`es-ES`, `fr-FR`, `de-DE`, `ja-JP`, `ko-KR`, `pt-BR`, `hi-IN` y `ar-SA`.

## UI

Utilice `useT()` para cadenas de interfaz y coloque `<LanguagePicker />` en la aplicación
Página `/settings`. Las aplicaciones de la barra lateral deben exponer **Configuración** en la barra lateral de la aplicación;
el ícono de idioma del encabezado es solo un acceso directo.

```tsx
import {
  LanguagePicker,
  openAgentSettings,
  useT,
} from "@agent-native/core/client";

function SettingsPage() {
  const t = useT();
  return (
    <>
      <h2>{t("settings.languageTitle")}</h2>
      <LanguagePicker label={t("settings.languageLabel")} />

      <h2>{t("settings.agentTitle")}</h2>
      <p>{t("settings.agentDescription")}</p>
      <button type="button" onClick={() => openAgentSettings()}>
        {t("settings.openAgentSettings")}
      </button>
    </>
  );
}
```

El control "Configuración del agente" debería abrir la pestaña Configuración de la barra lateral derecha del agente
para modelo, clave API, automatización, voz y otros controles a nivel de marco.
Las aplicaciones pueden duplicar configuraciones de marco de alto valor en su propia página de configuración
cuando la configuración es central para la aplicación, pero la pestaña de configuración de la barra lateral sigue siendo la
fuente de la verdad.

Utilice `useFormatters()` para fechas, números, tiempo relativo y listas. No poner
Formato de fecha/número sensible a la configuración regional dentro de las cadenas de traducción.

## Contenido del sitio de documentos {#docs-site-content}

Las páginas de documentos públicos utilizan el mismo proveedor principal, pero con
`persistPreference={false}`, por lo que el tráfico de documentos anónimos utiliza localStorage y
idioma del navegador en lugar de configuración de SQL actions. La fuente inglesa permanece en
`packages/core/docs/content/*.md`. Las anulaciones de páginas localizadas aparecen junto a ella en
`packages/core/docs/content/locales/<locale>/<slug>.md`.

Utilice los mismos códigos locales BCP-47 que los catálogos de aplicaciones. Mantenga la misma babosa que el
Fuente en inglés, conserva anclajes estables con `{#anchor}` en los títulos traducidos,
y dejar rutas, nombres de acciones, campos de protocolo, variables de entorno y nombres de proveedores
sin traducir. Si una configuración regional no tiene Markdown traducido para una página, el sitio de documentos
vuelve al inglés para esa página sin dejar de localizar la navegación y Chrome.

El Markdown de docs puede incluir bloques visuales estructurados `an-*`. Traduce sus campos de texto visibles cuando tenga sentido, como títulos de file-tree y `entries[].note`, cuerpos de callout, etiquetas de tabs y labels/notes de annotated-code. Mantén sin cambios los identificadores estables: nombres de archivo, paths, env vars, rutas, nombres de actions, language tags, fragmentos de código, claves JSON y nombres de protocolo.

## Actions y persistencia

Cada aplicación hereda:

- `get-localization-preference`: lee el `{ locale }` del usuario actual
- `set-localization-preference`: configure `"system"` o una configuración regional compatible

El valor duradero se encuentra en la configuración SQL definida por el usuario en `localization`.
`localStorage` solo se usa para prehidratación y respaldo anónimo. El activo
La configuración regional se refleja en el estado de la aplicación como contexto ambiental para que los agentes puedan ver
el idioma actual de la interfaz.

## Guardia

Ejecutar:

```bash
pnpm guard:i18n-catalogs
```

El guardia verifica los nombres de archivos locales admitidos, la paridad de claves, la paridad de marcadores de posición,
claves obsoletas y categorías plurales de CLDR hasta `Intl.PluralRules`. Se comprueba
estructura, no calidad de la traducción; Las cadenas de alta visibilidad todavía necesitan humanos
revisar.

No traduzca identificadores estables como nombres de acciones, rutas, valores de enumeración,
claves de estado de aplicación, valores de base de datos, campos de protocolo, nombres de var de entorno o proveedor
nombres.
