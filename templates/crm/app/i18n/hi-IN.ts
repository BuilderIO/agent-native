const messages = {
  intelligence: {
    title: "इंटेलिजेंस",
    description:
      "सीमित कॉल प्रमाण में CRM को जिन क्षणों पर ध्यान देना चाहिए उन्हें चुनें। स्मार्ट ट्रैकर Ask CRM के माध्यम से मूल्यांकित होते हैं, इस सेटिंग स्क्रीन में सीधे नहीं।",
    loading: "ट्रैकर लोड हो रहे हैं…",
    kindKeyword: "कीवर्ड",
    kindSmart: "स्मार्ट",
    enable: "सक्षम करें",
    disable: "अक्षम करें",
    toggleTracker: "{{name}} को {{action}}",
    emptyTitle: "अभी कोई सिग्नल ट्रैकर नहीं है",
    emptyDescription:
      "निर्धारित मिलान के लिए कीवर्ड या Ask CRM द्वारा समीक्षा के लिए स्मार्ट मानदंड जोड़ें।",
    trackerDeleted: "ट्रैकर हटाया गया।",
    trackerEnabled: "ट्रैकर सक्षम किया गया।",
    trackerDisabled: "ट्रैकर अक्षम किया गया।",
    trackerUpdateFailed: "ट्रैकर अपडेट नहीं हो सका।",
    trackerCreated: "ट्रैकर बनाया गया।",
    trackerCreationFailed: "ट्रैकर नहीं बनाया जा सका।",
    newTracker: "नया ट्रैकर",
    createTitle: "सिग्नल ट्रैकर बनाएं",
    createDescription:
      "निर्धारित कीवर्ड ट्रैक करें या Ask CRM द्वारा कॉल प्रमाण पर मूल्यांकन के लिए सीमित स्मार्ट मानदंड तय करें।",
    name: "नाम",
    trackerDescription: "विवरण",
    detector: "डिटेक्टर",
    keywords: "कीवर्ड",
    keywordsPlaceholder: "मूल्य निर्धारण, नवीनीकरण, सुरक्षा समीक्षा",
    keywordsHelp: "कॉमा से अलग करके अधिकतम 40 कीवर्ड जोड़ें।",
    classificationCriterion: "वर्गीकरण मानदंड",
    criterionPlaceholder: "कार्यान्वयन समय के बारे में स्पष्ट चिंता का मिलान करें।",
    creating: "बनाया जा रहा है…",
    create: "ट्रैकर बनाएं",
    deleteTrackerAria: "{{name}} हटाएं",
    deleteTrackerTitle: "{{name}} हटाएं?",
    deleteTrackerDescription:
      "यह भविष्य के सिग्नल रन को इस ट्रैकर का उपयोग करने से रोकता है। मौजूदा समीक्षा किए गए सिग्नल अपरिवर्तित रहेंगे।",
    cancel: "रद्द करें",
    deleteTracker: "ट्रैकर हटाएं",
    keywordsSummary: "कीवर्ड: {{keywords}}",
    noKeywordsConfigured: "कोई कीवर्ड कॉन्फ़िगर नहीं है।",
    evaluatedThroughAsk: "Ask CRM के माध्यम से मूल्यांकित।",
  },
  recordActions: {
    evidenceAttached: "कॉल प्रमाण संलग्न किया गया।",
    evidenceAttachFailed: "प्रमाण संलग्न नहीं किया जा सका।",
    addEvidence: "प्रमाण जोड़ें",
    attachEvidenceTitle: "Clips प्रमाण संलग्न करें",
    attachEvidenceDescription:
      "एक स्थायी Clips पेज लिंक का उपयोग करें। CRM केवल आर्टिफैक्ट संदर्भ, पेज URL और सीमित अंश संग्रहीत करता है—मीडिया या ट्रांसक्रिप्ट कभी नहीं।",
    artifactId: "आर्टिफैक्ट आईडी",
    clipsUrl: "Clips का URL",
    summary: "सारांश",
    shortExcerpt: "छोटा अंश",
    attachEvidence: "प्रमाण संलग्न करें",
    automate: "स्वचालित करें",
    reviewNewClipsCalls: "नई Clips कॉल की समीक्षा करें",
    reviewDescription:
      "Clips मीडिया या ट्रांसक्रिप्ट कॉपी किए बिना इस CRM रिकॉर्ड के लिए समीक्षा रेसिपी तैयार करें।",
    disabledAutomationDescription:
      "यह अक्षम रूप में शुरू होता है और {{name}} से जुड़ा रहता है। स्पष्ट रूप से सक्रिय होने पर, हर नई क्लिप केवल अपने एक्सेस-जांचे गए रिकॉर्डिंग-पेज संदर्भ को इस रिकॉर्ड से जोड़ सकती है।",
    handoffDescription:
      "हैंडऑफ़ केवल एक अपारदर्शी क्लिप आईडी, एक स्थायी {{path}} पेज URL और कैप्चर समय रखता है। यह इवेंट URL, मीडिया, एक्सेस टोकन, ट्रांसक्रिप्ट, अनुमानित रिकॉर्ड और प्रदाता लेखन अस्वीकार करता है।",
    manageAutomations: "स्वचालन प्रबंधित करें",
    configureWithAgent: "एजेंट के साथ कॉन्फ़िगर करें",
  },
  dashboard: {
    metaTitle: "पाइपलाइन · CRM",
    pipeline: "पाइपलाइन",
    ready: "पाइपलाइन डैशबोर्ड तैयार है।",
    installFailed: "पाइपलाइन डैशबोर्ड इंस्टॉल नहीं हो सका।",
    loadingDescription: "आपका एक्सेस-स्कोप वाला पाइपलाइन डैशबोर्ड लोड हो रहा है…",
    emptyDescription: "चरण के अनुसार अवसर मूल्य का एक लाइव, अनुमति-सचेत दृश्य।",
    installTitle: "पाइपलाइन डैशबोर्ड इंस्टॉल करें",
    installDescription:
      "यह आपके वर्तमान कार्यक्षेत्र के लिए CRM-स्वामित्व वाला डेटा प्रोग्राम और निजी डैशबोर्ड बनाता है।",
    installAction: "पाइपलाइन डैशबोर्ड इंस्टॉल करें",
    liveDescription:
      "लाइव अवसर योग वर्तमान दर्शक की CRM पहुंच का उपयोग करते हैं और कैश किए गए डेटा प्रोग्राम से रीफ़्रेश होते हैं।",
    updating: "अपडेट हो रहा है…",
    updatePack: "पैक अपडेट करें",
  },
};

export default messages;
