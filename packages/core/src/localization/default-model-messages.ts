import { getUserSetting } from "../settings/user-settings.js";
import {
  DEFAULT_LOCALE,
  LOCALIZATION_SETTING_KEY,
  normalizeLocalizationPreference,
  type BuiltinLocaleCode,
} from "./shared.js";

interface DefaultModelMessages {
  configurationOverride: string;
  configurationUnavailable: string;
  organizationSelected: string;
  userSelected: string;
  appOverridePreserved: string;
}

export const DEFAULT_MODEL_MESSAGES: Record<
  BuiltinLocaleCode,
  DefaultModelMessages
> = {
  "en-US": {
    configurationOverride:
      "App configuration currently uses {{model}} via {{engine}}.",
    configurationUnavailable:
      "App configuration currently has no usable model; it remains unchanged.",
    organizationSelected:
      "Organization default set to {{model}} via {{engine}}. All app overrides and explicit chat and automation models are unchanged.",
    userSelected:
      "Personal default set to {{model}} via {{engine}}. All app overrides and explicit chat and automation models are unchanged.",
    appOverridePreserved:
      "{{appId}} currently uses {{model}} via {{engine}}. Its app override is preserved.",
  },
  "es-ES": {
    configurationOverride:
      "La configuración de la aplicación usa actualmente {{model}} mediante {{engine}}.",
    configurationUnavailable:
      "La configuración de la aplicación no tiene un modelo utilizable actualmente; no cambia.",
    organizationSelected:
      "Modelo predeterminado de la organización establecido en {{model}} mediante {{engine}}. Todos los valores propios de las aplicaciones y los modelos explícitos de chats y automatizaciones no cambian.",
    userSelected:
      "Modelo predeterminado personal establecido en {{model}} mediante {{engine}}. Todos los valores propios de las aplicaciones y los modelos explícitos de chats y automatizaciones no cambian.",
    appOverridePreserved:
      "{{appId}} usa actualmente {{model}} mediante {{engine}}. Se conserva su valor propio de aplicación.",
  },
  "fr-FR": {
    configurationOverride:
      "La configuration de l’application utilise actuellement {{model}} via {{engine}}.",
    configurationUnavailable:
      "La configuration de l’application ne dispose actuellement d’aucun modèle utilisable ; elle reste inchangée.",
    organizationSelected:
      "Modèle par défaut de l’organisation défini sur {{model}} via {{engine}}. Tous les réglages propres aux applications et les modèles explicites des conversations et automatisations restent inchangés.",
    userSelected:
      "Modèle par défaut personnel défini sur {{model}} via {{engine}}. Tous les réglages propres aux applications et les modèles explicites des conversations et automatisations restent inchangés.",
    appOverridePreserved:
      "{{appId}} utilise actuellement {{model}} via {{engine}}. Son réglage propre est conservé.",
  },
  "de-DE": {
    configurationOverride:
      "Die App-Konfiguration verwendet derzeit {{model}} über {{engine}}.",
    configurationUnavailable:
      "Die App-Konfiguration hat derzeit kein verwendbares Modell; sie bleibt unverändert.",
    organizationSelected:
      "Organisationsstandard auf {{model}} über {{engine}} gesetzt. Alle App-Einstellungen und expliziten Chat- und Automationsmodelle bleiben unverändert.",
    userSelected:
      "Persönlicher Standard auf {{model}} über {{engine}} gesetzt. Alle App-Einstellungen und expliziten Chat- und Automationsmodelle bleiben unverändert.",
    appOverridePreserved:
      "{{appId}} verwendet derzeit {{model}} über {{engine}}. Die eigene App-Einstellung bleibt erhalten.",
  },
  "pt-BR": {
    configurationOverride:
      "A configuração do aplicativo usa atualmente {{model}} via {{engine}}.",
    configurationUnavailable:
      "A configuração do aplicativo não tem um modelo utilizável no momento; ela permanece inalterada.",
    organizationSelected:
      "Modelo padrão da organização definido como {{model}} via {{engine}}. Todos os padrões específicos de aplicativos e modelos explícitos de chats e automações permanecem inalterados.",
    userSelected:
      "Modelo padrão pessoal definido como {{model}} via {{engine}}. Todos os padrões específicos de aplicativos e modelos explícitos de chats e automações permanecem inalterados.",
    appOverridePreserved:
      "{{appId}} usa atualmente {{model}} via {{engine}}. Seu padrão específico é preservado.",
  },
  "zh-CN": {
    configurationOverride: "应用配置当前通过 {{engine}} 使用 {{model}}。",
    configurationUnavailable: "应用配置当前没有可用模型；其设置保持不变。",
    organizationSelected:
      "组织默认模型已通过 {{engine}} 设置为 {{model}}。所有应用的独立设置以及聊天和自动化中明确指定的模型保持不变。",
    userSelected:
      "个人默认模型已通过 {{engine}} 设置为 {{model}}。所有应用的独立设置以及聊天和自动化中明确指定的模型保持不变。",
    appOverridePreserved:
      "{{appId}} 当前通过 {{engine}} 使用 {{model}}。其应用独立设置已保留。",
  },
  "zh-TW": {
    configurationOverride: "應用程式設定目前透過 {{engine}} 使用 {{model}}。",
    configurationUnavailable: "應用程式設定目前沒有可用模型；其設定保持不變。",
    organizationSelected:
      "組織預設模型已透過 {{engine}} 設為 {{model}}。所有應用程式的獨立設定以及聊天和自動化中明確指定的模型保持不變。",
    userSelected:
      "個人預設模型已透過 {{engine}} 設為 {{model}}。所有應用程式的獨立設定以及聊天和自動化中明確指定的模型保持不變。",
    appOverridePreserved:
      "{{appId}} 目前透過 {{engine}} 使用 {{model}}。其應用程式獨立設定已保留。",
  },
  "ja-JP": {
    configurationOverride:
      "アプリの設定は現在 {{engine}} 経由で {{model}} を使用しています。",
    configurationUnavailable:
      "アプリの設定には現在利用可能なモデルがありません。設定は変更されません。",
    organizationSelected:
      "組織の既定モデルを {{engine}} 経由で {{model}} に設定しました。すべてのアプリ固有設定と、チャットや自動化で明示的に指定したモデルは変更されません。",
    userSelected:
      "個人の既定モデルを {{engine}} 経由で {{model}} に設定しました。すべてのアプリ固有設定と、チャットや自動化で明示的に指定したモデルは変更されません。",
    appOverridePreserved:
      "{{appId}} は現在 {{engine}} 経由で {{model}} を使用しています。アプリ固有設定は保持されます。",
  },
  "ko-KR": {
    configurationOverride:
      "앱 설정은 현재 {{engine}}을 통해 {{model}}을 사용합니다.",
    configurationUnavailable:
      "앱 설정에는 현재 사용 가능한 모델이 없습니다. 설정은 변경되지 않습니다.",
    organizationSelected:
      "{{engine}}을 통해 조직 기본 모델을 {{model}}로 설정했습니다. 모든 앱별 설정과 채팅 및 자동화에서 명시적으로 지정한 모델은 변경되지 않습니다.",
    userSelected:
      "{{engine}}을 통해 개인 기본 모델을 {{model}}로 설정했습니다. 모든 앱별 설정과 채팅 및 자동화에서 명시적으로 지정한 모델은 변경되지 않습니다.",
    appOverridePreserved:
      "{{appId}}은(는) 현재 {{engine}}을 통해 {{model}}을 사용합니다. 앱별 설정은 유지됩니다.",
  },
  "hi-IN": {
    configurationOverride:
      "ऐप का कॉन्फ़िगरेशन अभी {{engine}} के माध्यम से {{model}} इस्तेमाल करता है।",
    configurationUnavailable:
      "ऐप के कॉन्फ़िगरेशन में अभी कोई उपयोग योग्य मॉडल नहीं है; वह नहीं बदला है।",
    organizationSelected:
      "{{engine}} के माध्यम से संगठन का डिफ़ॉल्ट मॉडल {{model}} सेट किया गया। सभी ऐप के अपने सेटिंग और चैट तथा ऑटोमेशन के स्पष्ट मॉडल नहीं बदले हैं।",
    userSelected:
      "{{engine}} के माध्यम से व्यक्तिगत डिफ़ॉल्ट मॉडल {{model}} सेट किया गया। सभी ऐप के अपने सेटिंग और चैट तथा ऑटोमेशन के स्पष्ट मॉडल नहीं बदले हैं।",
    appOverridePreserved:
      "{{appId}} अभी {{engine}} के माध्यम से {{model}} इस्तेमाल करता है। उसकी अपनी ऐप सेटिंग सुरक्षित है।",
  },
  "ar-SA": {
    configurationOverride:
      "تستخدم إعدادات التطبيق حاليًا {{model}} عبر {{engine}}.",
    configurationUnavailable:
      "لا تحتوي إعدادات التطبيق حاليًا على نموذج قابل للاستخدام؛ وهي لم تتغير.",
    organizationSelected:
      "تم تعيين النموذج الافتراضي للمؤسسة إلى {{model}} عبر {{engine}}. لم تتغير أي إعدادات خاصة بالتطبيقات ولا النماذج المحددة صراحةً للمحادثات والأتمتة.",
    userSelected:
      "تم تعيين النموذج الافتراضي الشخصي إلى {{model}} عبر {{engine}}. لم تتغير أي إعدادات خاصة بالتطبيقات ولا النماذج المحددة صراحةً للمحادثات والأتمتة.",
    appOverridePreserved:
      "يستخدم {{appId}} حاليًا {{model}} عبر {{engine}}. تم الحفاظ على إعداده الخاص بالتطبيق.",
  },
};

export async function defaultModelMessagesForUser(
  userEmail?: string | null,
): Promise<DefaultModelMessages> {
  const preference = userEmail
    ? normalizeLocalizationPreference(
        await getUserSetting(userEmail, LOCALIZATION_SETTING_KEY),
      )
    : { locale: DEFAULT_LOCALE };
  return (
    DEFAULT_MODEL_MESSAGES[preference.locale as BuiltinLocaleCode] ??
    DEFAULT_MODEL_MESSAGES[DEFAULT_LOCALE]
  );
}
