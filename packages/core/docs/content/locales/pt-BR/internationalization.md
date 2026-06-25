---
title: "Internacionalização"
description: "Localize aplicativos Agent Native com catálogos de localidade compartilhados, um seletor de idioma, substituto de idioma do navegador e conteúdo de documentos com reconhecimento de localidade."
---

# Internacionalização

Os aplicativos Agent Native podem localizar a estrutura e o modelo UI por meio do compartilhamento
Tempo de execução `@agent-native/core/client/i18n`. A estrutura armazena
escolha de idioma nas configurações de SQL, expõe-no como actions e volta para
Inglês quando um aplicativo ainda não traduziu uma string.

## Tempo de execução

Use o provedor por meio de `AppProviders`:

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

`getLocaleInitScript()` define os valores iniciais `lang`, `dir` e
`window.__AGENT_NATIVE_LOCALE__` antes de React hidratar. Rotas públicas SSR podem
chame `resolveLocaleFromRequest()` de `@agent-native/core/server` e passe o
localidade/catálogo resolvidos nesse script para evitar incompatibilidades de hidratação.

## Catálogos

Cada modelo localizado mantém catálogos em `app/i18n/`:

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

Sempre inclua `en-US`. Importação dinâmica de catálogos em idiomas diferentes do inglês apenas para usuários
baixe a localidade ativa. Os códigos de localidade suportados são `en-US`, `zh-CN`,
`es-ES`, `fr-FR`, `de-DE`, `ja-JP`, `ko-KR`, `pt-BR`, `hi-IN` e `ar-SA`.

## UI

Use `useT()` para strings de interface e coloque `<LanguagePicker />` no aplicativo
Página `/settings`. Os aplicativos da barra lateral devem expor **Configurações** na barra lateral do aplicativo;
o ícone do idioma do cabeçalho é apenas um atalho.

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

O controle "Configurações do agente" deve abrir a guia Configurações da barra lateral direita do agente
para modelo, chave API, automação, voz e outros controles em nível de estrutura.
Os aplicativos podem duplicar configurações de estrutura de alto valor em suas próprias páginas de configurações
quando a configuração é central para o aplicativo, mas a guia de configurações da barra lateral permanece a mesma
fonte da verdade.

Use `useFormatters()` para datas, números, tempo relativo e listas. Não coloque
formatação de data/número sensível à localidade dentro de strings de tradução.

## Conteúdo do site do Documentos {#docs-site-content}

As páginas de documentos públicos usam o mesmo provedor principal, mas com
`persistPreference={false}` para que o tráfego de documentos anônimos use localStorage e o
idioma do navegador em vez das configurações SQL actions. A fonte em inglês permanece em
`packages/core/docs/content/*.md`. As substituições de página localizadas ficam ao lado dela em
`packages/core/docs/content/locales/<locale>/<slug>.md`.

Use os mesmos códigos de localidade BCP-47 dos catálogos de aplicativos. Mantenha o mesmo slug do
Fonte em inglês, preserve âncoras estáveis com `{#anchor}` em títulos traduzidos,
e deixe rotas, nomes de ações, campos de protocolo, variáveis de ambiente e nomes de provedores
não traduzido. Se uma localidade não tiver Markdown traduzido para uma página, o site de documentos
volta para o inglês para essa página enquanto ainda localiza a navegação e o Chrome.

O Markdown dos docs pode incluir blocos visuais estruturados `an-*`. Traduza os campos de texto visíveis quando fizer sentido, como títulos de file-tree e `entries[].note`, corpos de callout, labels de tabs e labels/notes de annotated-code. Mantenha identificadores estáveis sem alterações: nomes de arquivo, paths, env vars, strings de rota, nomes de actions, language tags, trechos de código, chaves JSON e nomes de protocolo.

## Actions e persistência

Todo aplicativo herda:

- `get-localization-preference` — lê o `{ locale }` do usuário atual
- `set-localization-preference` — defina `"system"` ou uma localidade compatível

O valor durável reside nas configurações SQL com escopo do usuário em `localization`.
`localStorage` é usado apenas para pré-hidratação e reserva anônima. O ativo
a localidade é espelhada no estado do aplicativo como contexto do ambiente para que os agentes possam ver
o idioma da interface atual.

## Guarda

Executar:

```bash
pnpm guard:i18n-catalogs
```

O guarda verifica nomes de arquivos de localidade suportados, paridade de chave, paridade de espaço reservado,
chaves obsoletas e categorias plurais CLDR por meio de `Intl.PluralRules`. Ele verifica
estrutura, não qualidade da tradução; strings de alta visibilidade ainda precisam de humanos
revisão.

Não traduza identificadores estáveis, como nomes de ações, rotas, valores enum,
chaves de estado do aplicativo, valores de banco de dados, campos de protocolo, nomes de variáveis de ambiente ou provedor
nomes.
