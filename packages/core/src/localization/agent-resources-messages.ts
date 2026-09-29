import {
  DEFAULT_LOCALE,
  isLocaleCode,
  type BuiltinLocaleCode,
  type LocaleCode,
} from "./shared.js";

export interface AgentResourcePackMessages {
  exportPack: string;
  importPack: string;
  exportPackSuccess: string;
  exportPackFailed: string;
  importPackSuccess: string;
  importPackFailed: string;
  importPackInvalid: string;
}

export const AGENT_RESOURCE_PACK_MESSAGES: Record<
  BuiltinLocaleCode,
  AgentResourcePackMessages
> = {
  "en-US": {
    exportPack: "Export pack",
    importPack: "Import pack",
    exportPackSuccess: "Downloaded resource pack",
    exportPackFailed: "Could not export pack",
    importPackSuccess: "Imported {{imported}} files, skipped {{skipped}}",
    importPackFailed: "Could not import pack",
    importPackInvalid: "That file is not a valid resource pack",
  },
  "es-ES": {
    exportPack: "Exportar paquete",
    importPack: "Importar paquete",
    exportPackSuccess: "Paquete de recursos descargado",
    exportPackFailed: "No se pudo exportar el paquete",
    importPackSuccess:
      "Se importaron {{imported}} archivos y se omitieron {{skipped}}",
    importPackFailed: "No se pudo importar el paquete",
    importPackInvalid: "Ese archivo no es un paquete de recursos válido",
  },
  "fr-FR": {
    exportPack: "Exporter le pack",
    importPack: "Importer le pack",
    exportPackSuccess: "Pack de ressources téléchargé",
    exportPackFailed: "Impossible d'exporter le pack",
    importPackSuccess: "{{imported}} fichiers importés, {{skipped}} ignorés",
    importPackFailed: "Impossible d'importer le pack",
    importPackInvalid: "Ce fichier n'est pas un pack de ressources valide",
  },
  "de-DE": {
    exportPack: "Paket exportieren",
    importPack: "Paket importieren",
    exportPackSuccess: "Ressourcenpaket heruntergeladen",
    exportPackFailed: "Paket konnte nicht exportiert werden",
    importPackSuccess:
      "{{imported}} Dateien importiert, {{skipped}} übersprungen",
    importPackFailed: "Paket konnte nicht importiert werden",
    importPackInvalid: "Diese Datei ist kein gültiges Ressourcenpaket",
  },
  "pt-BR": {
    exportPack: "Exportar pacote",
    importPack: "Importar pacote",
    exportPackSuccess: "Pacote de recursos baixado",
    exportPackFailed: "Não foi possível exportar o pacote",
    importPackSuccess:
      "{{imported}} arquivos importados, {{skipped}} ignorados",
    importPackFailed: "Não foi possível importar o pacote",
    importPackInvalid: "Esse arquivo não é um pacote de recursos válido",
  },
  "zh-CN": {
    exportPack: "导出资源包",
    importPack: "导入资源包",
    exportPackSuccess: "已下载资源包",
    exportPackFailed: "无法导出资源包",
    importPackSuccess: "已导入 {{imported}} 个文件，已跳过 {{skipped}} 个",
    importPackFailed: "无法导入资源包",
    importPackInvalid: "该文件不是有效的资源包",
  },
  "zh-TW": {
    exportPack: "匯出資源包",
    importPack: "匯入資源包",
    exportPackSuccess: "已下載資源包",
    exportPackFailed: "無法匯出資源包",
    importPackSuccess: "已匯入 {{imported}} 個檔案，已略過 {{skipped}} 個",
    importPackFailed: "無法匯入資源包",
    importPackInvalid: "該檔案不是有效的資源包",
  },
  "ja-JP": {
    exportPack: "パックを書き出す",
    importPack: "パックを読み込む",
    exportPackSuccess: "リソースパックをダウンロードしました",
    exportPackFailed: "パックを書き出せませんでした",
    importPackSuccess:
      "{{imported}} 件のファイルをインポートし、{{skipped}} 件をスキップしました",
    importPackFailed: "パックを読み込めませんでした",
    importPackInvalid: "このファイルは有効なリソースパックではありません",
  },
  "ko-KR": {
    exportPack: "팩 내보내기",
    importPack: "팩 가져오기",
    exportPackSuccess: "리소스 팩을 다운로드했습니다",
    exportPackFailed: "팩을 내보내지 못했습니다",
    importPackSuccess:
      "파일 {{imported}}개를 가져왔고 {{skipped}}개를 건너뛰었습니다",
    importPackFailed: "팩을 가져오지 못했습니다",
    importPackInvalid: "이 파일은 유효한 리소스 팩이 아닙니다",
  },
  "hi-IN": {
    exportPack: "पैक निर्यात करें",
    importPack: "पैक आयात करें",
    exportPackSuccess: "संसाधन पैक डाउनलोड हो गया",
    exportPackFailed: "पैक निर्यात नहीं हो सका",
    importPackSuccess: "{{imported}} फ़ाइलें आयात हुईं, {{skipped}} छोड़ी गईं",
    importPackFailed: "पैक आयात नहीं हो सका",
    importPackInvalid: "यह फ़ाइल एक मान्य संसाधन पैक नहीं है",
  },
  "ar-SA": {
    exportPack: "تصدير الحزمة",
    importPack: "استيراد الحزمة",
    exportPackSuccess: "تم تنزيل حزمة الموارد",
    exportPackFailed: "تعذر تصدير الحزمة",
    importPackSuccess: "تم استيراد {{imported}} من الملفات وتخطي {{skipped}}",
    importPackFailed: "تعذر استيراد الحزمة",
    importPackInvalid: "هذا الملف ليس حزمة موارد صالحة",
  },
};

export function agentResourcePackMessagesForLocale(
  locale: LocaleCode,
): AgentResourcePackMessages {
  return AGENT_RESOURCE_PACK_MESSAGES[
    isLocaleCode(locale) ? locale : DEFAULT_LOCALE
  ];
}
