import { describe, expect, it } from "vitest";

import * as arSA from "./ar-SA.js";
import * as deDE from "./de-DE.js";
import * as enUS from "./en-US.js";
import * as esES from "./es-ES.js";
import * as frFR from "./fr-FR.js";
import * as hiIN from "./hi-IN.js";
import * as jaJP from "./ja-JP.js";
import * as koKR from "./ko-KR.js";
import * as ptBR from "./pt-BR.js";
import * as zhCN from "./zh-CN.js";
import * as zhTW from "./zh-TW.js";

const completionMessages = {
  "ar-SA": [arSA.mcpSettingsMessages, "اكتمل الاتصال"],
  "de-DE": [deDE.mcpSettingsMessages, "Verbindung hergestellt"],
  "en-US": [enUS.mcpSettingsMessages, "Connection done"],
  "es-ES": [esES.mcpSettingsMessages, "Conexión completada"],
  "fr-FR": [frFR.mcpSettingsMessages, "Connexion terminée"],
  "hi-IN": [hiIN.mcpSettingsMessages, "कनेक्शन पूरा हुआ"],
  "ja-JP": [jaJP.mcpSettingsMessages, "接続が完了しました"],
  "ko-KR": [koKR.mcpSettingsMessages, "연결 완료"],
  "pt-BR": [ptBR.mcpSettingsMessages, "Conexão concluída"],
  "zh-CN": [zhCN.mcpSettingsMessages, "连接完成"],
  "zh-TW": [zhTW.mcpSettingsMessages, "連線完成"],
} as const;

describe("MCP OAuth completion copy", () => {
  it("provides localized completion text in every supplemental catalog", () => {
    for (const [locale, [messages, expected]] of Object.entries(
      completionMessages,
    )) {
      expect(messages.mcpOAuthConnectionDone, locale).toBe(expected);
    }
  });
});
