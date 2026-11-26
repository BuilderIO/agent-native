import type { BuiltinLocaleCode } from "@agent-native/core/client/i18n";

const en = {
  switchLabel: "Save to Builder",
  switchHint:
    "Saves this draft to Builder a few seconds after you stop editing.",
  stateOff: "Automatic saves off",
  stateIdle: "Saves as you edit",
  stateSaving: "Saving…",
  stateSaved: "Saved",
  stateWaiting: "Waiting",
  stateFailed: "Save failed",
  stateReview: "Use Review Builder update",
  savedAt: "Saved {{time}}",
  retry: "Retry",
  openInBuilder: "Open in Builder",
  reasonBuilderEditorChanges:
    "Builder's editor is saving changes to this draft. Content tries again shortly.",
  reasonCheckingLastSave:
    "Content couldn't tell whether the last save reached Builder. It checks again shortly and won't send the save twice.",
  reasonUnconfirmedSave:
    "Content can't confirm the last save reached Builder, so it won't send it again. Settle it with Review Builder update.",
  reasonAnotherSaveRunning:
    "Another save to this article is running. This one goes next.",
  reasonBuilderBodyUnread:
    "Content hasn't read this article's body in Builder yet, so it hasn't saved yours. It checks again shortly.",
  reasonBuilderBodyUnreadable:
    "Content couldn't read this article's body in Builder, so it hasn't saved yours. Retry reads it again first.",
  reasonPublished:
    "This article is published, so automatic saves stopped. Save its changes with Review Builder update.",
  reasonNeedsReview:
    "This change isn't a plain draft save. Save it with Review Builder update.",
  reasonEditConflict:
    "Builder and Content both changed this article. Settle it with Review Builder update.",
  reasonBuilderChanged:
    "Builder's copy changed since Content last read it. Retry reads it again first.",
  reasonSaveFailed: "The save didn't reach Builder.",
  reasonRunFailed:
    "The save didn't run. Content tries again in about 30 seconds.",
  switchFailed: "Couldn't change automatic saves.",
  retryFailed: "Couldn't retry the save.",
};

type BuilderAutosaveMessages = Record<keyof typeof en, string>;

const translations: Record<
  Exclude<BuiltinLocaleCode, "en-US">,
  BuilderAutosaveMessages
> = {
  "es-ES": {
    switchLabel: "Guardar en Builder",
    switchHint:
      "Guarda este borrador en Builder unos segundos después de que dejes de editar.",
    stateOff: "Guardado automático desactivado",
    stateIdle: "Se guarda mientras editas",
    stateSaving: "Guardando…",
    stateSaved: "Guardado",
    stateWaiting: "En espera",
    stateFailed: "No se pudo guardar",
    stateReview: "Usa Revisar actualización de Builder",
    savedAt: "Guardado {{time}}",
    retry: "Reintentar",
    openInBuilder: "Abrir en Builder",
    reasonBuilderEditorChanges:
      "El editor de Builder está guardando cambios en este borrador. Content lo volverá a intentar en breve.",
    reasonCheckingLastSave:
      "Content no pudo saber si el último guardado llegó a Builder. Lo comprobará de nuevo en breve y no enviará el guardado dos veces.",
    reasonUnconfirmedSave:
      "Content no puede confirmar que el último guardado llegara a Builder, así que no lo volverá a enviar. Resuélvelo con Revisar actualización de Builder.",
    reasonAnotherSaveRunning:
      "Hay otro guardado de este artículo en curso. Este va después.",
    reasonBuilderBodyUnread:
      "Content aún no ha leído el cuerpo de este artículo en Builder, así que no ha guardado el tuyo. Lo comprobará de nuevo en breve.",
    reasonBuilderBodyUnreadable:
      "Content no pudo leer el cuerpo de este artículo en Builder, así que no ha guardado el tuyo. Reintentar lo vuelve a leer primero.",
    reasonPublished:
      "Este artículo está publicado, así que el guardado automático se detuvo. Guarda sus cambios con Revisar actualización de Builder.",
    reasonNeedsReview:
      "Este cambio no es un simple guardado de borrador. Guárdalo con Revisar actualización de Builder.",
    reasonEditConflict:
      "Builder y Content cambiaron este artículo. Resuélvelo con Revisar actualización de Builder.",
    reasonBuilderChanged:
      "La copia de Builder cambió desde que Content la leyó. Reintentar la vuelve a leer primero.",
    reasonSaveFailed: "El guardado no llegó a Builder.",
    reasonRunFailed:
      "El guardado no se ejecutó. Content lo intentará de nuevo en unos 30 segundos.",
    switchFailed: "No se pudo cambiar el guardado automático.",
    retryFailed: "No se pudo reintentar el guardado.",
  },
  "fr-FR": {
    switchLabel: "Enregistrer dans Builder",
    switchHint:
      "Enregistre ce brouillon dans Builder quelques secondes après la fin de vos modifications.",
    stateOff: "Enregistrement automatique désactivé",
    stateIdle: "Enregistré au fil de la saisie",
    stateSaving: "Enregistrement…",
    stateSaved: "Enregistré",
    stateWaiting: "En attente",
    stateFailed: "Échec de l'enregistrement",
    stateReview: "Passez par Vérifier la mise à jour Builder",
    savedAt: "Enregistré {{time}}",
    retry: "Réessayer",
    openInBuilder: "Ouvrir dans Builder",
    reasonBuilderEditorChanges:
      "L'éditeur de Builder enregistre des modifications de ce brouillon. Content réessaiera sous peu.",
    reasonCheckingLastSave:
      "Content ne sait pas si le dernier enregistrement a atteint Builder. Il vérifie à nouveau sous peu et n'enverra pas l'enregistrement deux fois.",
    reasonUnconfirmedSave:
      "Content ne peut pas confirmer que le dernier enregistrement a atteint Builder, il ne le renverra donc pas. Réglez-le avec Vérifier la mise à jour Builder.",
    reasonAnotherSaveRunning:
      "Un autre enregistrement de cet article est en cours. Celui-ci passe ensuite.",
    reasonBuilderBodyUnread:
      "Content n'a pas encore lu le corps de cet article dans Builder, il n'a donc pas enregistré le vôtre. Il vérifie à nouveau sous peu.",
    reasonBuilderBodyUnreadable:
      "Content n'a pas pu lire le corps de cet article dans Builder, il n'a donc pas enregistré le vôtre. Réessayer le relit d'abord.",
    reasonPublished:
      "Cet article est publié, l'enregistrement automatique s'est donc arrêté. Enregistrez ses modifications avec Vérifier la mise à jour Builder.",
    reasonNeedsReview:
      "Cette modification n'est pas un simple enregistrement de brouillon. Enregistrez-la avec Vérifier la mise à jour Builder.",
    reasonEditConflict:
      "Builder et Content ont tous deux modifié cet article. Réglez-le avec Vérifier la mise à jour Builder.",
    reasonBuilderChanged:
      "La copie de Builder a changé depuis la dernière lecture de Content. Réessayer la relit d'abord.",
    reasonSaveFailed: "L'enregistrement n'a pas atteint Builder.",
    reasonRunFailed:
      "L'enregistrement ne s'est pas lancé. Content réessaiera dans environ 30 secondes.",
    switchFailed: "Impossible de modifier l'enregistrement automatique.",
    retryFailed: "Impossible de réessayer l'enregistrement.",
  },
  "de-DE": {
    switchLabel: "In Builder speichern",
    switchHint:
      "Speichert diesen Entwurf einige Sekunden nach deiner letzten Änderung in Builder.",
    stateOff: "Automatisches Speichern aus",
    stateIdle: "Speichert beim Bearbeiten",
    stateSaving: "Wird gespeichert…",
    stateSaved: "Gespeichert",
    stateWaiting: "Wartet",
    stateFailed: "Speichern fehlgeschlagen",
    stateReview: "Builder-Update prüfen verwenden",
    savedAt: "Gespeichert {{time}}",
    retry: "Erneut versuchen",
    openInBuilder: "In Builder öffnen",
    reasonBuilderEditorChanges:
      "Der Builder-Editor speichert gerade Änderungen an diesem Entwurf. Content versucht es gleich noch einmal.",
    reasonCheckingLastSave:
      "Content konnte nicht feststellen, ob das letzte Speichern Builder erreicht hat. Es prüft gleich noch einmal und sendet das Speichern nicht doppelt.",
    reasonUnconfirmedSave:
      "Content kann nicht bestätigen, dass das letzte Speichern Builder erreicht hat, und sendet es deshalb nicht erneut. Kläre es mit Builder-Update prüfen.",
    reasonAnotherSaveRunning:
      "Für diesen Artikel läuft bereits ein anderes Speichern. Dieses folgt danach.",
    reasonBuilderBodyUnread:
      "Content hat den Textkörper dieses Artikels in Builder noch nicht gelesen und deinen deshalb nicht gespeichert. Es prüft gleich noch einmal.",
    reasonBuilderBodyUnreadable:
      "Content konnte den Textkörper dieses Artikels in Builder nicht lesen und hat deinen deshalb nicht gespeichert. Erneut versuchen liest ihn zuerst neu.",
    reasonPublished:
      "Dieser Artikel ist veröffentlicht, daher wurde das automatische Speichern beendet. Speichere seine Änderungen mit Builder-Update prüfen.",
    reasonNeedsReview:
      "Diese Änderung ist kein einfaches Speichern eines Entwurfs. Speichere sie mit Builder-Update prüfen.",
    reasonEditConflict:
      "Builder und Content haben diesen Artikel beide geändert. Kläre das mit Builder-Update prüfen.",
    reasonBuilderChanged:
      "Die Kopie in Builder hat sich geändert, seit Content sie gelesen hat. Erneut versuchen liest sie zuerst neu.",
    reasonSaveFailed: "Das Speichern hat Builder nicht erreicht.",
    reasonRunFailed:
      "Das Speichern wurde nicht ausgeführt. Content versucht es in etwa 30 Sekunden erneut.",
    switchFailed: "Automatisches Speichern konnte nicht geändert werden.",
    retryFailed: "Speichern konnte nicht erneut versucht werden.",
  },
  "pt-BR": {
    switchLabel: "Salvar no Builder",
    switchHint:
      "Salva este rascunho no Builder alguns segundos depois que você para de editar.",
    stateOff: "Salvamento automático desativado",
    stateIdle: "Salva enquanto você edita",
    stateSaving: "Salvando…",
    stateSaved: "Salvo",
    stateWaiting: "Aguardando",
    stateFailed: "Falha ao salvar",
    stateReview: "Use Revisar atualização do Builder",
    savedAt: "Salvo {{time}}",
    retry: "Tentar de novo",
    openInBuilder: "Abrir no Builder",
    reasonBuilderEditorChanges:
      "O editor do Builder está salvando alterações neste rascunho. O Content tentará de novo em instantes.",
    reasonCheckingLastSave:
      "O Content não conseguiu saber se o último salvamento chegou ao Builder. Ele confere de novo em instantes e não envia o salvamento duas vezes.",
    reasonUnconfirmedSave:
      "O Content não consegue confirmar que o último salvamento chegou ao Builder, então não vai enviá-lo de novo. Resolva com Revisar atualização do Builder.",
    reasonAnotherSaveRunning:
      "Outro salvamento deste artigo está em andamento. Este vem em seguida.",
    reasonBuilderBodyUnread:
      "O Content ainda não leu o corpo deste artigo no Builder, então não salvou o seu. Ele confere de novo em instantes.",
    reasonBuilderBodyUnreadable:
      "O Content não conseguiu ler o corpo deste artigo no Builder, então não salvou o seu. Tentar de novo o lê antes.",
    reasonPublished:
      "Este artigo está publicado, então o salvamento automático parou. Salve as alterações com Revisar atualização do Builder.",
    reasonNeedsReview:
      "Esta alteração não é um simples salvamento de rascunho. Salve-a com Revisar atualização do Builder.",
    reasonEditConflict:
      "O Builder e o Content alteraram este artigo. Resolva com Revisar atualização do Builder.",
    reasonBuilderChanged:
      "A cópia do Builder mudou desde a última leitura do Content. Tentar de novo a lê antes.",
    reasonSaveFailed: "O salvamento não chegou ao Builder.",
    reasonRunFailed:
      "O salvamento não foi executado. O Content tentará de novo em cerca de 30 segundos.",
    switchFailed: "Não foi possível alterar o salvamento automático.",
    retryFailed: "Não foi possível tentar salvar de novo.",
  },
  "zh-CN": {
    switchLabel: "保存到 Builder",
    switchHint: "停止编辑几秒后，将此草稿保存到 Builder。",
    stateOff: "自动保存已关闭",
    stateIdle: "编辑时自动保存",
    stateSaving: "正在保存…",
    stateSaved: "已保存",
    stateWaiting: "等待中",
    stateFailed: "保存失败",
    stateReview: "请使用“审查 Builder 更新”",
    savedAt: "已于 {{time}} 保存",
    retry: "重试",
    openInBuilder: "在 Builder 中打开",
    reasonBuilderEditorChanges:
      "Builder 编辑器正在保存此草稿的更改。Content 稍后会重试。",
    reasonCheckingLastSave:
      "Content 无法确定上次保存是否已到达 Builder。它稍后会再次检查，不会重复发送这次保存。",
    reasonUnconfirmedSave:
      "Content 无法确认上次保存已到达 Builder，因此不会再次发送。请用“审查 Builder 更新”处理。",
    reasonAnotherSaveRunning:
      "这篇文章的另一次保存正在进行，这次保存随后进行。",
    reasonBuilderBodyUnread:
      "Content 还没有读取这篇文章在 Builder 中的正文，因此尚未保存你的正文。它稍后会再次检查。",
    reasonBuilderBodyUnreadable:
      "Content 无法读取这篇文章在 Builder 中的正文，因此尚未保存你的正文。重试会先重新读取。",
    reasonPublished:
      "这篇文章已发布，因此自动保存已停止。请用“审查 Builder 更新”保存它的更改。",
    reasonNeedsReview:
      "这次更改不是简单的草稿保存。请用“审查 Builder 更新”保存。",
    reasonEditConflict:
      "Builder 和 Content 都更改了这篇文章。请用“审查 Builder 更新”处理。",
    reasonBuilderChanged:
      "自 Content 上次读取以来，Builder 中的副本已更改。重试会先重新读取。",
    reasonSaveFailed: "保存未到达 Builder。",
    reasonRunFailed: "保存未能运行。Content 将在约 30 秒后重试。",
    switchFailed: "无法更改自动保存。",
    retryFailed: "无法重试保存。",
  },
  "zh-TW": {
    switchLabel: "儲存到 Builder",
    switchHint: "停止編輯幾秒後，將此草稿儲存到 Builder。",
    stateOff: "自動儲存已關閉",
    stateIdle: "編輯時自動儲存",
    stateSaving: "正在儲存…",
    stateSaved: "已儲存",
    stateWaiting: "等待中",
    stateFailed: "儲存失敗",
    stateReview: "請使用「審查 Builder 更新」",
    savedAt: "已於 {{time}} 儲存",
    retry: "重試",
    openInBuilder: "在 Builder 中開啟",
    reasonBuilderEditorChanges:
      "Builder 編輯器正在儲存此草稿的變更。Content 稍後會重試。",
    reasonCheckingLastSave:
      "Content 無法確定上次儲存是否已到達 Builder。它稍後會再次檢查，不會重複送出這次儲存。",
    reasonUnconfirmedSave:
      "Content 無法確認上次儲存已到達 Builder，因此不會再次送出。請用「審查 Builder 更新」處理。",
    reasonAnotherSaveRunning:
      "這篇文章的另一次儲存正在進行，這次儲存隨後進行。",
    reasonBuilderBodyUnread:
      "Content 還沒有讀取這篇文章在 Builder 中的內文，因此尚未儲存你的內文。它稍後會再次檢查。",
    reasonBuilderBodyUnreadable:
      "Content 無法讀取這篇文章在 Builder 中的內文，因此尚未儲存你的內文。重試會先重新讀取。",
    reasonPublished:
      "這篇文章已發布，因此自動儲存已停止。請用「審查 Builder 更新」儲存它的變更。",
    reasonNeedsReview:
      "這次變更不是單純的草稿儲存。請用「審查 Builder 更新」儲存。",
    reasonEditConflict:
      "Builder 和 Content 都變更了這篇文章。請用「審查 Builder 更新」處理。",
    reasonBuilderChanged:
      "自 Content 上次讀取以來，Builder 中的副本已變更。重試會先重新讀取。",
    reasonSaveFailed: "儲存未到達 Builder。",
    reasonRunFailed: "儲存未能執行。Content 將在約 30 秒後重試。",
    switchFailed: "無法變更自動儲存。",
    retryFailed: "無法重試儲存。",
  },
  "ja-JP": {
    switchLabel: "Builder に保存",
    switchHint: "編集をやめて数秒後に、この下書きを Builder に保存します。",
    stateOff: "自動保存はオフです",
    stateIdle: "編集中に保存します",
    stateSaving: "保存しています…",
    stateSaved: "保存しました",
    stateWaiting: "待機中",
    stateFailed: "保存できませんでした",
    stateReview: "「Builder の更新を確認」を使ってください",
    savedAt: "{{time}} に保存しました",
    retry: "再試行",
    openInBuilder: "Builder で開く",
    reasonBuilderEditorChanges:
      "Builder のエディターがこの下書きの変更を保存しています。Content はまもなく再試行します。",
    reasonCheckingLastSave:
      "前回の保存が Builder に届いたか Content には分かりませんでした。まもなくもう一度確認し、同じ保存を二重に送ることはありません。",
    reasonUnconfirmedSave:
      "前回の保存が Builder に届いたことを Content が確認できないため、もう一度は送りません。「Builder の更新を確認」で解決してください。",
    reasonAnotherSaveRunning:
      "この記事の別の保存が進行中です。この保存はその後に行われます。",
    reasonBuilderBodyUnread:
      "Content はこの記事の本文をまだ Builder から読み込んでいないため、こちらの本文を保存していません。まもなくもう一度確認します。",
    reasonBuilderBodyUnreadable:
      "Content はこの記事の本文を Builder から読み込めなかったため、こちらの本文を保存していません。再試行するとまず読み込み直します。",
    reasonPublished:
      "この記事は公開済みのため、自動保存は停止しました。変更は「Builder の更新を確認」で保存してください。",
    reasonNeedsReview:
      "この変更は通常の下書き保存ではありません。「Builder の更新を確認」で保存してください。",
    reasonEditConflict:
      "Builder と Content の両方でこの記事が変更されました。「Builder の更新を確認」で解決してください。",
    reasonBuilderChanged:
      "Content が前回読み込んだ後に Builder のコピーが変わりました。再試行するとまず読み込み直します。",
    reasonSaveFailed: "保存は Builder に届きませんでした。",
    reasonRunFailed:
      "保存を実行できませんでした。Content は約 30 秒後に再試行します。",
    switchFailed: "自動保存を切り替えられませんでした。",
    retryFailed: "保存を再試行できませんでした。",
  },
  "ko-KR": {
    switchLabel: "Builder에 저장",
    switchHint: "편집을 멈추고 몇 초 뒤에 이 초안을 Builder에 저장합니다.",
    stateOff: "자동 저장 꺼짐",
    stateIdle: "편집하는 동안 저장",
    stateSaving: "저장 중…",
    stateSaved: "저장됨",
    stateWaiting: "대기 중",
    stateFailed: "저장 실패",
    stateReview: "Builder 업데이트 검토를 사용하세요",
    savedAt: "{{time}}에 저장됨",
    retry: "다시 시도",
    openInBuilder: "Builder에서 열기",
    reasonBuilderEditorChanges:
      "Builder 편집기가 이 초안의 변경 사항을 저장하고 있습니다. Content가 곧 다시 시도합니다.",
    reasonCheckingLastSave:
      "Content가 마지막 저장이 Builder에 도달했는지 알 수 없었습니다. 곧 다시 확인하며, 같은 저장을 두 번 보내지 않습니다.",
    reasonUnconfirmedSave:
      "Content가 마지막 저장이 Builder에 도달했는지 확인할 수 없어 다시 보내지 않습니다. Builder 업데이트 검토로 해결하세요.",
    reasonAnotherSaveRunning:
      "이 글의 다른 저장이 진행 중입니다. 이 저장은 그다음에 진행됩니다.",
    reasonBuilderBodyUnread:
      "Content가 Builder에 있는 이 글의 본문을 아직 읽지 못해 여기서 쓴 본문을 저장하지 않았습니다. 곧 다시 확인합니다.",
    reasonBuilderBodyUnreadable:
      "Content가 Builder에 있는 이 글의 본문을 읽지 못해 여기서 쓴 본문을 저장하지 않았습니다. 다시 시도하면 먼저 다시 읽습니다.",
    reasonPublished:
      "이 글은 게시되어 자동 저장이 멈췄습니다. 변경 사항은 Builder 업데이트 검토로 저장하세요.",
    reasonNeedsReview:
      "이 변경은 단순한 초안 저장이 아닙니다. Builder 업데이트 검토로 저장하세요.",
    reasonEditConflict:
      "Builder와 Content 모두 이 글을 변경했습니다. Builder 업데이트 검토로 해결하세요.",
    reasonBuilderChanged:
      "Content가 마지막으로 읽은 뒤 Builder의 사본이 바뀌었습니다. 다시 시도하면 먼저 다시 읽습니다.",
    reasonSaveFailed: "저장이 Builder에 도달하지 않았습니다.",
    reasonRunFailed:
      "저장이 실행되지 않았습니다. Content가 약 30초 후에 다시 시도합니다.",
    switchFailed: "자동 저장을 바꿀 수 없습니다.",
    retryFailed: "저장을 다시 시도할 수 없습니다.",
  },
  "hi-IN": {
    switchLabel: "Builder में सहेजें",
    switchHint: "संपादन रोकने के कुछ सेकंड बाद यह ड्राफ़्ट Builder में सहेजता है।",
    stateOff: "अपने-आप सहेजना बंद है",
    stateIdle: "संपादन करते समय सहेजता है",
    stateSaving: "सहेजा जा रहा है…",
    stateSaved: "सहेजा गया",
    stateWaiting: "प्रतीक्षा में",
    stateFailed: "सहेजना विफल रहा",
    stateReview: "Builder अपडेट की समीक्षा करें का उपयोग करें",
    savedAt: "{{time}} को सहेजा गया",
    retry: "फिर कोशिश करें",
    openInBuilder: "Builder में खोलें",
    reasonBuilderEditorChanges:
      "Builder का एडिटर इस ड्राफ़्ट के बदलाव सहेज रहा है। Content थोड़ी देर में फिर कोशिश करेगा।",
    reasonCheckingLastSave:
      "Content यह नहीं जान सका कि पिछला सहेजना Builder तक पहुँचा या नहीं। यह थोड़ी देर में फिर जाँचेगा और सहेजना दोबारा नहीं भेजेगा।",
    reasonUnconfirmedSave:
      "Content पुष्टि नहीं कर सकता कि पिछला सहेजना Builder तक पहुँचा, इसलिए वह उसे दोबारा नहीं भेजेगा। इसे Builder अपडेट की समीक्षा करें से सुलझाएँ।",
    reasonAnotherSaveRunning: "इस लेख का एक और सहेजना चल रहा है। यह उसके बाद होगा।",
    reasonBuilderBodyUnread:
      "Content ने Builder में इस लेख का मुख्य भाग अभी नहीं पढ़ा है, इसलिए आपका मुख्य भाग नहीं सहेजा। यह थोड़ी देर में फिर जाँचेगा।",
    reasonBuilderBodyUnreadable:
      "Content इस लेख का मुख्य भाग Builder में नहीं पढ़ सका, इसलिए आपका मुख्य भाग नहीं सहेजा। फिर कोशिश करने पर पहले उसे दोबारा पढ़ा जाता है।",
    reasonPublished:
      "यह लेख प्रकाशित है, इसलिए अपने-आप सहेजना रुक गया। इसके बदलाव Builder अपडेट की समीक्षा करें से सहेजें।",
    reasonNeedsReview:
      "यह बदलाव साधारण ड्राफ़्ट सहेजना नहीं है। इसे Builder अपडेट की समीक्षा करें से सहेजें।",
    reasonEditConflict:
      "Builder और Content दोनों ने यह लेख बदला है। इसे Builder अपडेट की समीक्षा करें से सुलझाएँ।",
    reasonBuilderChanged:
      "Content के पिछली बार पढ़ने के बाद Builder की कॉपी बदल गई। फिर कोशिश करने पर पहले उसे दोबारा पढ़ा जाता है।",
    reasonSaveFailed: "सहेजना Builder तक नहीं पहुँचा।",
    reasonRunFailed: "सहेजना नहीं चला। Content लगभग 30 सेकंड में फिर कोशिश करेगा।",
    switchFailed: "अपने-आप सहेजना बदला नहीं जा सका।",
    retryFailed: "सहेजने की फिर कोशिश नहीं हो सकी।",
  },
  "ar-SA": {
    switchLabel: "الحفظ في Builder",
    switchHint: "يحفظ هذه المسودة في Builder بعد ثوانٍ من توقفك عن التحرير.",
    stateOff: "الحفظ التلقائي متوقف",
    stateIdle: "يحفظ أثناء التحرير",
    stateSaving: "جارٍ الحفظ…",
    stateSaved: "تم الحفظ",
    stateWaiting: "في الانتظار",
    stateFailed: "تعذّر الحفظ",
    stateReview: "استخدم مراجعة تحديث Builder",
    savedAt: "تم الحفظ {{time}}",
    retry: "إعادة المحاولة",
    openInBuilder: "فتح في Builder",
    reasonBuilderEditorChanges:
      "يحفظ محرر Builder تغييرات على هذه المسودة. سيحاول Content مرة أخرى بعد قليل.",
    reasonCheckingLastSave:
      "لم يتمكن Content من معرفة ما إذا كان آخر حفظ قد وصل إلى Builder. سيتحقق مرة أخرى بعد قليل ولن يرسل الحفظ مرتين.",
    reasonUnconfirmedSave:
      "لا يستطيع Content التأكد من وصول آخر حفظ إلى Builder، لذا لن يرسله مرة أخرى. احسم ذلك باستخدام مراجعة تحديث Builder.",
    reasonAnotherSaveRunning:
      "هناك عملية حفظ أخرى لهذه المقالة قيد التنفيذ. هذه العملية تأتي بعدها.",
    reasonBuilderBodyUnread:
      "لم يقرأ Content نص هذه المقالة في Builder بعد، لذلك لم يحفظ نصك. سيتحقق مرة أخرى بعد قليل.",
    reasonBuilderBodyUnreadable:
      "تعذّر على Content قراءة نص هذه المقالة في Builder، لذلك لم يحفظ نصك. إعادة المحاولة تقرأه من جديد أولًا.",
    reasonPublished:
      "هذه المقالة منشورة، لذا توقف الحفظ التلقائي. احفظ تغييراتها باستخدام مراجعة تحديث Builder.",
    reasonNeedsReview:
      "هذا التغيير ليس حفظًا عاديًا لمسودة. احفظه باستخدام مراجعة تحديث Builder.",
    reasonEditConflict:
      "غيّر كل من Builder وContent هذه المقالة. احسم ذلك باستخدام مراجعة تحديث Builder.",
    reasonBuilderChanged:
      "تغيرت نسخة Builder منذ آخر قراءة لها في Content. إعادة المحاولة تقرأها من جديد أولًا.",
    reasonSaveFailed: "لم يصل الحفظ إلى Builder.",
    reasonRunFailed: "لم يُنفَّذ الحفظ. سيحاول Content مجددًا بعد نحو 30 ثانية.",
    switchFailed: "تعذّر تغيير الحفظ التلقائي.",
    retryFailed: "تعذّرت إعادة محاولة الحفظ.",
  },
};

export const builderAutosaveMessagesByLocale: Record<
  BuiltinLocaleCode,
  BuilderAutosaveMessages
> = {
  "en-US": en,
  ...translations,
};
