import { getUserSetting } from "../settings/user-settings.js";
import {
  DEFAULT_LOCALE,
  LOCALIZATION_SETTING_KEY,
  normalizeLocalizationPreference,
  type BuiltinLocaleCode,
} from "./shared.js";

interface DefaultModelMessages {
  configurationConflict: string;
  selected: string;
}

export const DEFAULT_MODEL_MESSAGES: Record<
  BuiltinLocaleCode,
  DefaultModelMessages
> = {
  "en-US": {
    configurationConflict:
      "App configuration overrides this selection. Change agent.engine or agent.model in the app configuration before setting a different default.",
    selected:
      "Default model set to {{model}} via {{engine}}. Explicit chat and automation models and other apps' defaults are unchanged.",
  },
  "es-ES": {
    configurationConflict:
      "La configuración de la aplicación tiene prioridad sobre esta selección. Cambia agent.engine o agent.model en la configuración antes de establecer otro modelo predeterminado.",
    selected:
      "Modelo predeterminado establecido en {{model}} mediante {{engine}}. Los modelos explícitos de chats y automatizaciones y los valores predeterminados de otras aplicaciones no cambian.",
  },
  "fr-FR": {
    configurationConflict:
      "La configuration de l’application remplace cette sélection. Modifiez agent.engine ou agent.model dans la configuration avant de définir un autre modèle par défaut.",
    selected:
      "Modèle par défaut défini sur {{model}} via {{engine}}. Les modèles explicites des conversations et automatisations et les valeurs par défaut des autres applications restent inchangés.",
  },
  "de-DE": {
    configurationConflict:
      "Die App-Konfiguration hat Vorrang vor dieser Auswahl. Ändere agent.engine oder agent.model in der App-Konfiguration, bevor du einen anderen Standard festlegst.",
    selected:
      "Standardmodell auf {{model}} über {{engine}} gesetzt. Explizite Chat- und Automationsmodelle sowie die Standards anderer Apps bleiben unverändert.",
  },
  "pt-BR": {
    configurationConflict:
      "A configuração do aplicativo tem prioridade sobre esta seleção. Altere agent.engine ou agent.model na configuração antes de definir outro padrão.",
    selected:
      "Modelo padrão definido como {{model}} via {{engine}}. Os modelos explícitos de chats e automações e os padrões de outros aplicativos permanecem inalterados.",
  },
  "zh-CN": {
    configurationConflict:
      "应用配置会覆盖此选择。设置其他默认模型前，请先修改应用配置中的 agent.engine 或 agent.model。",
    selected:
      "默认模型已通过 {{engine}} 设置为 {{model}}。聊天和自动化中明确指定的模型以及其他应用的默认值保持不变。",
  },
  "zh-TW": {
    configurationConflict:
      "應用程式設定會覆蓋此選擇。設定其他預設模型前，請先修改應用程式設定中的 agent.engine 或 agent.model。",
    selected:
      "預設模型已透過 {{engine}} 設為 {{model}}。聊天和自動化中明確指定的模型以及其他應用程式的預設值保持不變。",
  },
  "ja-JP": {
    configurationConflict:
      "アプリの設定がこの選択より優先されます。別の既定モデルを設定する前に、アプリ設定の agent.engine または agent.model を変更してください。",
    selected:
      "既定モデルを {{engine}} 経由で {{model}} に設定しました。チャットや自動化で明示的に指定したモデルと、他のアプリの既定値は変更されません。",
  },
  "ko-KR": {
    configurationConflict:
      "앱 설정이 이 선택보다 우선합니다. 다른 기본 모델을 설정하기 전에 앱 설정의 agent.engine 또는 agent.model을 변경하세요.",
    selected:
      "{{engine}}을 통해 기본 모델을 {{model}}로 설정했습니다. 채팅과 자동화에서 명시적으로 지정한 모델 및 다른 앱의 기본값은 변경되지 않습니다.",
  },
  "hi-IN": {
    configurationConflict:
      "ऐप का कॉन्फ़िगरेशन इस चयन को ओवरराइड करता है। कोई दूसरा डिफ़ॉल्ट सेट करने से पहले ऐप के कॉन्फ़िगरेशन में agent.engine या agent.model बदलें।",
    selected:
      "{{engine}} के माध्यम से डिफ़ॉल्ट मॉडल {{model}} सेट किया गया। चैट और ऑटोमेशन के स्पष्ट मॉडल और दूसरे ऐप के डिफ़ॉल्ट नहीं बदले हैं।",
  },
  "ar-SA": {
    configurationConflict:
      "تتجاوز إعدادات التطبيق هذا الاختيار. غيّر agent.engine أو agent.model في إعدادات التطبيق قبل تعيين نموذج افتراضي مختلف.",
    selected:
      "تم تعيين النموذج الافتراضي إلى {{model}} عبر {{engine}}. لم تتغير النماذج المحددة صراحةً للمحادثات والأتمتة ولا الإعدادات الافتراضية للتطبيقات الأخرى.",
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
