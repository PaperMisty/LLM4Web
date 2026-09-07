// 预设模型列表
const PRESETS = {
  siliconflow: {
    defaultUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "deepseek-ai/DeepSeek-R1",
    models: [
      "deepseek-ai/DeepSeek-R1",
      "deepseek-ai/DeepSeek-V3",
      "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
      "deepseek-ai/DeepSeek-R1-Distill-Qwen-8B",
      "deepseek-ai/DeepSeek-R1-Distill-Llama-8B",
      "Qwen/Qwen2.5-72B-Instruct",
      "Qwen/Qwen2.5-Coder-32B-Instruct"
    ]
  },
  deepseek: {
    defaultUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-reasoner",
    models: [
      "deepseek-reasoner",
      "deepseek-chat",
      "deepseek-v4-pro",
      "deepseek-v4-flash"
    ]
  },
  custom: {
    defaultUrl: "http://localhost:11434/v1",
    defaultModel: "llama3",
    models: [
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4-turbo",
      "gpt-3.5-turbo",
      "meta-llama/Llama-3-70b-instruct"
    ]
  }
};

// 默认预设渠道列表
const DEFAULT_CHANNELS = [
  {
    id: "siliconflow",
    name: "硅基流动 (SiliconFlow)",
    baseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "deepseek-ai/DeepSeek-R1",
    models: [
      "deepseek-ai/DeepSeek-R1",
      "deepseek-ai/DeepSeek-V3",
      "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
      "deepseek-ai/DeepSeek-R1-Distill-Qwen-8B",
      "deepseek-ai/DeepSeek-R1-Distill-Llama-8B",
      "Qwen/Qwen2.5-72B-Instruct",
      "Qwen/Qwen2.5-Coder-32B-Instruct"
    ],
    isPreset: true
  },
  {
    id: "deepseek",
    name: "DeepSeek 官方",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-reasoner",
    models: [
      "deepseek-reasoner",
      "deepseek-chat",
      "deepseek-v4-pro",
      "deepseek-v4-flash"
    ],
    isPreset: true
  },
  {
    id: "custom",
    name: "自定义 (Custom OpenAI-compatible)",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3",
    models: [
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4-turbo",
      "gpt-3.5-turbo",
      "meta-llama/Llama-3-70b-instruct"
    ],
    isPreset: true
  }
];

// 预设默认划词提示词
const DEFAULT_PROMPTS = [
  {
    id: "easy",
    name: "简易",
    icon: "⚡",
    systemPrompt: "请帮我简明扼要地解释以下内容。{context}（请严格限制在 50 个 Token 左右，回答必须极其简短、直奔主题，无需任何客套与前缀说明）：\n\n\"{text}\"",
    isDefault: true
  },
  {
    id: "medium",
    name: "中等",
    icon: "🧠",
    systemPrompt: "请帮我解释以下内容。{context}（请控制在 200 个 Token 左右，结合上述上下文环境简明说明其核心要义即可，直击要点）：\n\n\"{text}\"",
    isDefault: true
  },
  {
    id: "complex",
    name: "复杂",
    icon: "🎓",
    systemPrompt: "请帮我深入、详细地解释以下内容。{context} (请不受任何字数与长度限制，结合上述上下文环境提供尽可能详尽、专业的剖析、背景脉络与学术拓展讲解)：\n\n\"{text}\"",
    isDefault: true
  }
];

let envConfig = null;

document.addEventListener("DOMContentLoaded", async () => {
  // 1. 获取所有 DOM 元素
  const displayModeSelect = document.getElementById("display-mode");
  const closeStrategySelect = document.getElementById("close-strategy");
  const closeStrategyGroup = document.getElementById("close-strategy-group");
  const closeStrategyHint = document.getElementById("close-strategy-hint");
  const themeSelect = document.getElementById("theme-select");

  const windowWidthInput = document.getElementById("window-width");
  const windowHeightInput = document.getElementById("window-height");
  const windowWidthRange = document.getElementById("window-width-range");
  const windowHeightRange = document.getElementById("window-height-range");
  const windowSizeGroup = document.getElementById("window-size-group");
  const windowSizeHint = document.getElementById("window-size-hint");

  const providerSelect = document.getElementById("provider");
  const baseUrlInput = document.getElementById("base-url");
  const apiKeyInput = document.getElementById("api-key");
  const togglePasswordBtn = document.getElementById("toggle-password");
  const modelSearchInput = document.getElementById("model-search");
  const modelSelect = document.getElementById("model-select");
  const modelCustom = document.getElementById("model-custom");
  const btnFetchModels = document.getElementById("btn-fetch-models");
  const btnTestModel = document.getElementById("btn-test-model");

  const btnAddChannel = document.getElementById("btn-add-channel");
  const btnDeleteChannel = document.getElementById("btn-delete-channel");
  const channelModal = document.getElementById("channel-modal");
  const channelForm = document.getElementById("channel-form");
  const btnChannelModalClose = document.getElementById("btn-channel-modal-close");
  const btnChannelModalCancel = document.getElementById("btn-channel-modal-cancel");
  const newChannelNameInput = document.getElementById("new-channel-name");
  const newChannelUrlInput = document.getElementById("new-channel-url");
  const newChannelKeyInput = document.getElementById("new-channel-key");
  const newChannelModelInput = document.getElementById("new-channel-model");

  // 右栏：翻译独立路由 DOM
  const translateChannelSelect = document.getElementById("translate-channel-select");
  const translateBindingUrl = document.getElementById("translate-binding-url");
  const translateBindingKey = document.getElementById("translate-binding-key");
  const translateModelSelect = document.getElementById("translate-model-select");
  const translateModelCustom = document.getElementById("translate-model-custom");
  const btnTestTranslate = document.getElementById("btn-test-translate");
  const translateBatchTokensInput = document.getElementById("translate-batch-tokens");
  const translateBatchTokensRange = document.getElementById("translate-batch-tokens-range");

  // 提示词相关 DOM
  const promptsListEl = document.getElementById("prompts-list");
  const btnAddPrompt = document.getElementById("btn-add-prompt");
  const btnResetPrompts = document.getElementById("btn-reset-prompts");
  const promptModal = document.getElementById("prompt-modal");
  const promptForm = document.getElementById("prompt-form");
  const promptIdInput = document.getElementById("prompt-id");
  const promptIconInput = document.getElementById("prompt-icon");
  const promptNameInput = document.getElementById("prompt-name");
  const promptTemplateInput = document.getElementById("prompt-template");
  const modalTitle = document.getElementById("modal-title");
  const btnModalClose = document.getElementById("btn-modal-close");
  const btnModalCancel = document.getElementById("btn-modal-cancel");

  const envBanner = document.getElementById("env-banner");
  const btnImportEnv = document.getElementById("btn-import-env");
  const settingsForm = document.getElementById("settings-form");
  const btnSave = document.getElementById("btn-save");

  // 2. 内存状态
  let channels = [];
  let currentChannelId = "siliconflow";
  let translateChannelId = "siliconflow";
  let translateModelVal = "deepseek-ai/DeepSeek-V3";
  let customPrompts = [];

  let cachedPopupWidth = 380;
  let cachedPopupHeight = 680;
  let cachedOverlayWidth = 560;
  let cachedOverlayHeight = 640;
  let currentProviderModels = [];

  // ====================== A. 密码显隐小眼睛切换 ======================
  if (togglePasswordBtn && apiKeyInput) {
    togglePasswordBtn.addEventListener("click", () => {
      const isPassword = apiKeyInput.type === "password";
      apiKeyInput.type = isPassword ? "text" : "password";
      togglePasswordBtn.innerHTML = isPassword
        ? `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
            <line x1="1" y1="1" x2="23" y2="23"></line>
          </svg>`
        : `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>`;
    });
  }

  // ====================== B. 尺寸滑块与输入数值双向联动 ======================
  const syncWindowSizeState = (prevMode, newMode) => {
    if (prevMode === "popup") {
      cachedPopupWidth = parseInt(windowWidthInput.value) || 380;
      cachedPopupHeight = parseInt(windowHeightInput.value) || 680;
    } else if (prevMode === "inPage") {
      cachedOverlayWidth = parseInt(windowWidthInput.value) || 560;
      cachedOverlayHeight = parseInt(windowHeightInput.value) || 640;
    }

    if (newMode === "sidePanel") {
      windowWidthInput.disabled = true;
      windowHeightInput.disabled = true;
      windowWidthRange.disabled = true;
      windowHeightRange.disabled = true;
      windowSizeGroup.classList.add("disabled-option");
      windowSizeHint.innerText = "侧边栏模式由浏览器自身控制侧边宽度，无需设置尺寸。";
    } else {
      windowWidthInput.disabled = false;
      windowHeightInput.disabled = false;
      windowWidthRange.disabled = false;
      windowHeightRange.disabled = false;
      windowSizeGroup.classList.remove("disabled-option");

      if (newMode === "popup") {
        windowWidthInput.value = cachedPopupWidth;
        windowHeightInput.value = cachedPopupHeight;
        windowWidthRange.value = cachedPopupWidth;
        windowHeightRange.value = cachedPopupHeight;
        windowSizeHint.innerText = "设置独立悬浮小窗口的初始宽度与高度。";
      } else if (newMode === "inPage") {
        windowWidthInput.value = cachedOverlayWidth;
        windowHeightInput.value = cachedOverlayHeight;
        windowWidthRange.value = cachedOverlayWidth;
        windowHeightRange.value = cachedOverlayHeight;
        windowSizeHint.innerText = "设置网页内浮动遮罩面板的初始宽度与高度。";
      }
    }
  };

  windowWidthRange.addEventListener("input", (e) => {
    windowWidthInput.value = e.target.value;
  });
  windowHeightRange.addEventListener("input", (e) => {
    windowHeightInput.value = e.target.value;
  });
  windowWidthInput.addEventListener("input", (e) => {
    const val = parseInt(e.target.value);
    if (!isNaN(val) && val >= 200 && val <= 2000) {
      windowWidthRange.value = val;
    }
  });
  windowHeightInput.addEventListener("input", (e) => {
    const val = parseInt(e.target.value);
    if (!isNaN(val) && val >= 200 && val <= 2000) {
      windowHeightRange.value = val;
    }
  });

  const syncCloseStrategyState = () => {
    const isInPage = displayModeSelect.value === "inPage";
    closeStrategySelect.disabled = isInPage;
    closeStrategyGroup.classList.toggle("disabled-option", isInPage);
    closeStrategyHint.classList.toggle("hidden", !isInPage);
  };

  let lastDisplayMode = "popup";
  displayModeSelect.addEventListener("change", (e) => {
    const newMode = e.target.value;
    syncWindowSizeState(lastDisplayMode, newMode);
    lastDisplayMode = newMode;
    syncCloseStrategyState();
  });

  // 主题实时切换
  themeSelect.addEventListener("change", (e) => {
    document.documentElement.setAttribute("data-theme", e.target.value);
  });

  // 翻译单批次 token 上限双向联动
  translateBatchTokensInput.addEventListener("input", () => {
    translateBatchTokensRange.value = translateBatchTokensInput.value;
  });
  translateBatchTokensRange.addEventListener("input", () => {
    translateBatchTokensInput.value = translateBatchTokensRange.value;
  });

  // ====================== C. 渠道管理与模型联动 ======================
  function saveCurrentFormToChannel(channelId) {
    const ch = channels.find(c => c.id === channelId);
    if (ch) {
      ch.baseUrl = baseUrlInput.value.trim();
      ch.apiKey = apiKeyInput.value.trim();
      const currentSelectedModel = modelSelect.value === "__custom__" ? modelCustom.value.trim() : modelSelect.value;
      ch.model = currentSelectedModel;
      if (!ch.models) ch.models = [];
      if (currentSelectedModel && !ch.models.includes(currentSelectedModel)) {
        ch.models.push(currentSelectedModel);
      }
    }
  }

  function loadChannelToForm(channel) {
    if (!channel) return;
    baseUrlInput.value = channel.baseUrl || (PRESETS[channel.id]?.defaultUrl || "");
    apiKeyInput.value = channel.apiKey || "";
    const modelToLoad = channel.model || channel.defaultModel || (PRESETS[channel.id]?.defaultModel || "");
    updateModelSuggestions(channel.id, false, modelToLoad);

    if (channel.isPreset) {
      btnDeleteChannel.classList.add("hidden");
    } else {
      btnDeleteChannel.classList.remove("hidden");
    }
  }

  const renderChannelsUI = () => {
    providerSelect.innerHTML = "";
    translateChannelSelect.innerHTML = "";

    channels.forEach(ch => {
      const opt1 = document.createElement("option");
      opt1.value = ch.id;
      opt1.textContent = ch.name;
      providerSelect.appendChild(opt1);

      const opt2 = document.createElement("option");
      opt2.value = ch.id;
      opt2.textContent = ch.name;
      translateChannelSelect.appendChild(opt2);
    });

    providerSelect.value = currentChannelId;
    translateChannelSelect.value = translateChannelId;

    const currentChannel = channels.find(c => c.id === currentChannelId);
    if (currentChannel && !currentChannel.isPreset) {
      btnDeleteChannel.classList.remove("hidden");
    } else {
      btnDeleteChannel.classList.add("hidden");
    }

    updateTranslateModelSuggestions();
  };

  const renderModelOptions = (filterText = "") => {
    const prevValue = modelSelect.value;
    const prevCustomValue = modelCustom.value;

    modelSelect.innerHTML = "";
    const query = filterText.toLowerCase().trim();
    const filtered = currentProviderModels.filter(m => m.toLowerCase().includes(query));

    filtered.forEach(modelName => {
      const option = document.createElement("option");
      option.value = modelName;
      option.textContent = modelName;
      modelSelect.appendChild(option);
    });

    const customOpt = document.createElement("option");
    customOpt.value = "__custom__";
    customOpt.textContent = "⚙️ 自定义输入模型...";
    modelSelect.appendChild(customOpt);

    if (prevValue === "__custom__") {
      modelSelect.value = "__custom__";
      modelCustom.value = prevCustomValue;
    } else if (filtered.includes(prevValue)) {
      modelSelect.value = prevValue;
    } else if (filtered.length > 0) {
      modelSelect.value = filtered[0];
    } else {
      modelSelect.value = "__custom__";
    }

    modelSelect.dispatchEvent(new Event("change"));
  };

  modelSearchInput.addEventListener("input", (e) => {
    renderModelOptions(e.target.value);
  });

  const updateModelSuggestions = (providerId, changeUrl = true, modelToSelect = null) => {
    const channel = channels.find(c => c.id === providerId);
    const preset = PRESETS[providerId];
    let modelsList = channel?.models || preset?.models || [channel?.defaultModel || "default"];

    currentProviderModels = [...modelsList];
    modelSearchInput.value = "";
    renderModelOptions("");

    if (modelToSelect) {
      const exists = currentProviderModels.includes(modelToSelect);
      if (exists) {
        modelSelect.value = modelToSelect;
        modelCustom.classList.add("hidden");
        modelCustom.required = false;
        modelCustom.value = "";
      } else {
        modelSelect.value = "__custom__";
        modelCustom.classList.remove("hidden");
        modelCustom.required = true;
        modelCustom.value = modelToSelect;
      }
    } else {
      const def = channel?.defaultModel || preset?.defaultModel || currentProviderModels[0];
      modelSelect.value = def || "__custom__";
      modelCustom.classList.add("hidden");
      modelCustom.required = false;
      modelCustom.value = "";
    }
    modelSelect.dispatchEvent(new Event("change"));

    if (changeUrl && channel?.baseUrl) {
      baseUrlInput.value = channel.baseUrl;
    } else if (changeUrl && preset?.defaultUrl) {
      baseUrlInput.value = preset.defaultUrl;
    }
  };

  modelSelect.addEventListener("change", (e) => {
    if (e.target.value === "__custom__") {
      modelCustom.classList.remove("hidden");
      modelCustom.required = true;
      modelCustom.focus();
    } else {
      modelCustom.classList.add("hidden");
      modelCustom.required = false;
    }
  });

  providerSelect.addEventListener("change", (e) => {
    saveCurrentFormToChannel(currentChannelId);
    currentChannelId = e.target.value;
    const ch = channels.find(c => c.id === currentChannelId);
    loadChannelToForm(ch);
  });

  // 渠道增删模态框
  btnAddChannel.addEventListener("click", () => {
    newChannelNameInput.value = "";
    newChannelUrlInput.value = "";
    newChannelKeyInput.value = "";
    newChannelModelInput.value = "";
    channelModal.classList.remove("hidden");
    newChannelNameInput.focus();
  });

  const closeChannelModal = () => {
    channelModal.classList.add("hidden");
  };

  btnChannelModalClose.addEventListener("click", closeChannelModal);
  btnChannelModalCancel.addEventListener("click", closeChannelModal);

  channelForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = newChannelNameInput.value.trim();
    const url = newChannelUrlInput.value.trim();
    const key = newChannelKeyInput.value.trim();
    const model = newChannelModelInput.value.trim();

    if (!name || !url) {
      showToast("⚠️ 请填写渠道名称与 Base URL");
      return;
    }

    saveCurrentFormToChannel(currentChannelId);

    const newId = "channel_" + Date.now();
    const newChan = {
      id: newId,
      name: name,
      baseUrl: url,
      apiKey: key,
      defaultModel: model || "gpt-4o-mini",
      models: model ? [model] : ["gpt-4o-mini"],
      isPreset: false
    };

    channels.push(newChan);
    currentChannelId = newId;
    renderChannelsUI();
    loadChannelToForm(newChan);
    closeChannelModal();
    showToast(`✅ 已新增并切换到渠道: ${name}`);
  });

  btnDeleteChannel.addEventListener("click", () => {
    const ch = channels.find(c => c.id === currentChannelId);
    if (!ch || ch.isPreset) return;

    if (confirm(`确定要删除自定义渠道「${ch.name}」吗？`)) {
      channels = channels.filter(c => c.id !== currentChannelId);
      currentChannelId = "siliconflow";
      renderChannelsUI();
      const nextChan = channels.find(c => c.id === currentChannelId);
      loadChannelToForm(nextChan);
      showToast("🗑️ 渠道已删除并切回硅基流动渠道");
    }
  });

  // ====================== D. 翻译专用路由 ======================
  // 实时刷新翻译渠道绑定的 Base URL 和 密钥状态
  const updateTranslateBindingStatus = () => {
    const channelId = translateChannelSelect.value;
    const channel = channels.find(c => c.id === channelId);
    if (!channel) return;

    // 优先读取该渠道配置，若正好是左侧正在编辑的主渠道则读取实时输入框
    const activeUrl = (channelId === currentChannelId ? baseUrlInput.value.trim() : "") ||
                      channel.baseUrl || PRESETS[channelId]?.defaultUrl || "";
    const activeKey = (channelId === currentChannelId ? apiKeyInput.value.trim() : "") ||
                      channel.apiKey || "";

    if (translateBindingUrl) {
      translateBindingUrl.textContent = activeUrl || "（未设置服务地址）";
    }
    if (translateBindingKey) {
      if (activeKey) {
        translateBindingKey.textContent = "已就绪";
        translateBindingKey.className = "binding-status-badge ready";
      } else {
        translateBindingKey.textContent = "未配置密钥 (请在左侧切换该渠道填写)";
        translateBindingKey.className = "binding-status-badge missing";
      }
    }
  };

  const updateTranslateModelSuggestions = () => {
    const channel = channels.find(c => c.id === translateChannelSelect.value);
    if (!channel) return;

    translateModelSelect.innerHTML = "";
    const modelsList = channel.models || PRESETS[channel.id]?.models || [channel.defaultModel || "deepseek-chat"];
    modelsList.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      translateModelSelect.appendChild(opt);
    });

    const customOpt = document.createElement("option");
    customOpt.value = "__custom__";
    customOpt.textContent = "⚙️ 自定义输入模型...";
    translateModelSelect.appendChild(customOpt);

    if (translateModelVal && modelsList.includes(translateModelVal)) {
      translateModelSelect.value = translateModelVal;
      translateModelCustom.classList.add("hidden");
    } else if (translateModelVal) {
      translateModelSelect.value = "__custom__";
      translateModelCustom.classList.remove("hidden");
      translateModelCustom.value = translateModelVal;
    } else {
      translateModelSelect.value = modelsList[0] || "__custom__";
      translateModelCustom.classList.add("hidden");
    }

    // 同步更新绑定状态
    updateTranslateBindingStatus();
  };

  translateChannelSelect.addEventListener("change", (e) => {
    translateChannelId = e.target.value;
    updateTranslateModelSuggestions();
  });

  translateModelSelect.addEventListener("change", (e) => {
    if (e.target.value === "__custom__") {
      translateModelCustom.classList.remove("hidden");
      translateModelCustom.focus();
    } else {
      translateModelCustom.classList.add("hidden");
      translateModelVal = e.target.value;
    }
  });

  translateModelCustom.addEventListener("input", (e) => {
    translateModelVal = e.target.value.trim();
  });

  // 左侧输入框实时修改时，若右侧选的恰好是该渠道，自动联动更新绑定卡片
  baseUrlInput.addEventListener("input", () => {
    const ch = channels.find(c => c.id === currentChannelId);
    if (ch) ch.baseUrl = baseUrlInput.value.trim();
    if (translateChannelSelect.value === currentChannelId) {
      updateTranslateBindingStatus();
    }
  });
  apiKeyInput.addEventListener("input", () => {
    const ch = channels.find(c => c.id === currentChannelId);
    if (ch) ch.apiKey = apiKeyInput.value.trim();
    if (translateChannelSelect.value === currentChannelId) {
      updateTranslateBindingStatus();
    }
  });

  // 独立测试翻译连通性
  btnTestTranslate.addEventListener("click", async () => {
    const channelId = translateChannelSelect.value;
    const ch = channels.find(c => c.id === channelId);
    if (!ch) {
      showToast("⚠️ 未找到所选翻译渠道");
      return;
    }

    const testUrl = ((channelId === currentChannelId ? baseUrlInput.value.trim() : "") || ch.baseUrl || PRESETS[channelId]?.defaultUrl || "").replace(/\/+$/, "");
    const testKey = (channelId === currentChannelId ? apiKeyInput.value.trim() : "") || ch.apiKey || "";
    const testModel = translateModelSelect.value === "__custom__" ? translateModelCustom.value.trim() : translateModelSelect.value;

    if (!testKey) {
      showToast(`⚠️ 翻译渠道「${ch.name}」尚未配置 API Key，请先在左侧切换至该渠道输入密钥并保存！`);
      return;
    }
    if (!testUrl) {
      showToast(`⚠️ 翻译渠道「${ch.name}」缺少 Base URL！`);
      return;
    }
    if (!testModel) {
      showToast("⚠️ 请指定翻译测试模型");
      return;
    }

    const spinner = btnTestTranslate.querySelector(".spinner-sm");
    btnTestTranslate.disabled = true;
    spinner.classList.remove("hidden");

    try {
      const response = await fetch(`${testUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${testKey}`
        },
        body: JSON.stringify({
          model: testModel,
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 5
        })
      });

      if (response.ok) {
        showToast(`🎉 翻译通道连通性测试成功！(${testModel})`);
      } else {
        const errJson = await response.json().catch(() => ({}));
        showToast(`❌ 翻译测试失败: ${response.status} ${errJson.error?.message || response.statusText}`);
      }
    } catch (err) {
      showToast(`❌ 翻译网络连接异常: ${err.message}`);
    } finally {
      btnTestTranslate.disabled = false;
      spinner.classList.add("hidden");
    }
  });

  // ====================== E. 聊天主模型测试与拉取 ======================
  btnFetchModels.addEventListener("click", async () => {
    const baseUrl = baseUrlInput.value.trim().replace(/\/+$/, "");
    const apiKey = apiKeyInput.value.trim();
    if (!baseUrl) {
      showToast("⚠️ 请先填写 API Base URL");
      return;
    }

    const spinner = btnFetchModels.querySelector(".spinner-sm");
    btnFetchModels.disabled = true;
    spinner.classList.remove("hidden");

    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: {
          "Authorization": apiKey ? `Bearer ${apiKey}` : ""
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      let fetchedModels = [];
      if (Array.isArray(data.data)) {
        fetchedModels = data.data.map(item => item.id).filter(Boolean);
      } else if (Array.isArray(data)) {
        fetchedModels = data.map(item => item.id || item.name).filter(Boolean);
      }

      if (fetchedModels.length > 0) {
        const ch = channels.find(c => c.id === currentChannelId);
        if (ch) ch.models = fetchedModels;
        currentProviderModels = fetchedModels;
        renderModelOptions("");
        showToast(`🎉 成功拉取到 ${fetchedModels.length} 个可用模型！`);
      } else {
        showToast("⚠️ 未能在接口返回中识别到模型列表");
      }
    } catch (err) {
      showToast(`❌ 拉取模型失败: ${err.message}`);
    } finally {
      btnFetchModels.disabled = false;
      spinner.classList.add("hidden");
    }
  });

  btnTestModel.addEventListener("click", async () => {
    const baseUrl = baseUrlInput.value.trim().replace(/\/+$/, "");
    const apiKey = apiKeyInput.value.trim();
    const model = modelSelect.value === "__custom__" ? modelCustom.value.trim() : modelSelect.value;

    if (!baseUrl || !apiKey || !model) {
      showToast("⚠️ 请先完整填写 Base URL、API Key 与模型");
      return;
    }

    const spinner = btnTestModel.querySelector(".spinner-sm");
    btnTestModel.disabled = true;
    spinner.classList.remove("hidden");

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 5
        })
      });

      if (response.ok) {
        showToast(`🎉 聊天模型连通性测试成功！(${model})`);
      } else {
        const errJson = await response.json().catch(() => ({}));
        showToast(`❌ 测试失败: ${response.status} ${errJson.error?.message || response.statusText}`);
      }
    } catch (err) {
      showToast(`❌ 连接失败: ${err.message}`);
    } finally {
      btnTestModel.disabled = false;
      spinner.classList.add("hidden");
    }
  });

  // ====================== F. 划词提示词 CRUD ======================
  const renderPromptsList = () => {
    promptsListEl.innerHTML = "";
    customPrompts.forEach(p => {
      const card = document.createElement("div");
      card.className = "prompt-card";
      card.innerHTML = `
        <div class="prompt-card-main">
          <div class="prompt-card-header">
            <span class="prompt-card-icon">${p.icon || "✨"}</span>
            <span class="prompt-card-name">${p.name}</span>
            ${p.isDefault ? '<span class="prompt-badge-default">预设</span>' : ''}
          </div>
          <div class="prompt-card-template">${escapeHtml(p.systemPrompt || "")}</div>
        </div>
        <div class="prompt-card-actions">
          <button type="button" class="btn-card-action edit-btn" data-id="${p.id}">编辑</button>
          ${!p.isDefault ? `<button type="button" class="btn-card-action delete delete-btn" data-id="${p.id}">删除</button>` : ''}
        </div>
      `;
      promptsListEl.appendChild(card);
    });

    promptsListEl.querySelectorAll(".edit-btn").forEach(btn => {
      btn.addEventListener("click", () => openPromptModal(btn.dataset.id));
    });
    promptsListEl.querySelectorAll(".delete-btn").forEach(btn => {
      btn.addEventListener("click", () => deletePrompt(btn.dataset.id));
    });
  };

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  const openPromptModal = (id = null) => {
    if (id) {
      const target = customPrompts.find(p => p.id === id);
      if (!target) return;
      modalTitle.innerText = "编辑提示词";
      promptIdInput.value = target.id;
      promptIconInput.value = target.icon || "✨";
      promptNameInput.value = target.name || "";
      promptTemplateInput.value = target.systemPrompt || "";
    } else {
      modalTitle.innerText = "新增划词提示词";
      promptIdInput.value = "";
      promptIconInput.value = "⚡";
      promptNameInput.value = "";
      promptTemplateInput.value = "";
    }
    promptModal.classList.remove("hidden");
  };

  const closePromptModal = () => {
    promptModal.classList.add("hidden");
  };

  btnModalClose.addEventListener("click", closePromptModal);
  btnModalCancel.addEventListener("click", closePromptModal);
  btnAddPrompt.addEventListener("click", () => openPromptModal());

  promptForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = promptIdInput.value;
    const icon = promptIconInput.value.trim() || "✨";
    const name = promptNameInput.value.trim();
    const template = promptTemplateInput.value.trim();

    if (!name || !template) {
      showToast("⚠️ 请填写名称与提示词内容");
      return;
    }

    if (id) {
      const index = customPrompts.findIndex(p => p.id === id);
      if (index !== -1) {
        customPrompts[index].icon = icon;
        customPrompts[index].name = name;
        customPrompts[index].systemPrompt = template;
      }
    } else {
      const newPrompt = {
        id: "prompt_" + Date.now(),
        icon: icon,
        name: name,
        systemPrompt: template,
        isDefault: false
      };
      customPrompts.push(newPrompt);
    }

    renderPromptsList();
    closePromptModal();
    showToast("✅ 提示词已保存");
  });

  const deletePrompt = (id) => {
    if (confirm("确定要删除此提示词项吗？")) {
      customPrompts = customPrompts.filter(p => p.id !== id);
      renderPromptsList();
      showToast("🗑️ 提示词已删除");
    }
  };

  btnResetPrompts.addEventListener("click", () => {
    if (confirm("确定要恢复默认预设的“简易、中等、复杂”提示词吗？")) {
      customPrompts = JSON.parse(JSON.stringify(DEFAULT_PROMPTS));
      renderPromptsList();
      showToast("🔄 已恢复为默认提示词预设");
    }
  });

  // ====================== G. 本地 .env 文件探测与导入 ======================
  try {
    const res = await fetch(chrome.runtime.getURL(".env"));
    if (res.ok) {
      const text = await res.text();
      const parsedEnv = {};
      const lines = text.split("\n");
      for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith("#")) continue;
        const parts = line.split("=");
        if (parts.length >= 2) {
          const k = parts[0].trim();
          const v = parts.slice(1).join("=").trim();
          parsedEnv[k] = v;
        }
      }

      const hasValidKey = parsedEnv.siliconflow_dsv4 || parsedEnv.siliconflow_key ||
                          parsedEnv.SILICONFLOW_API_KEY || parsedEnv.deepseek_key ||
                          parsedEnv.DEEPSEEK_API_KEY || parsedEnv.OPENAI_API_KEY;
      if (hasValidKey) {
        envConfig = parsedEnv;
        envBanner.classList.remove("hidden");
      }
    }
  } catch (err) {
    console.log("未探测到本地 .env 文件或读取受限", err);
  }

  btnImportEnv.addEventListener("click", () => {
    if (!envConfig) return;

    const sfKey = envConfig.siliconflow_dsv4 || envConfig.siliconflow_key || envConfig.SILICONFLOW_API_KEY;
    const sfUrl = envConfig.siliconflow_url || envConfig.SILICONFLOW_URL || envConfig.SILICONFLOW_BASE_URL;
    const dsKey = envConfig.deepseek_key || envConfig.DEEPSEEK_API_KEY;
    const dsUrl = envConfig.deepseek_url || envConfig.DEEPSEEK_URL || envConfig.DEEPSEEK_BASE_URL;

    // 回填入渠道数组
    channels.forEach(ch => {
      if (ch.id === "siliconflow") {
        if (sfKey) ch.apiKey = sfKey;
        if (sfUrl) ch.baseUrl = sfUrl;
      }
      if (ch.id === "deepseek") {
        if (dsKey) ch.apiKey = dsKey;
        if (dsUrl) ch.baseUrl = dsUrl;
      }
    });

    const activeCh = channels.find(c => c.id === currentChannelId);
    if (activeCh) loadChannelToForm(activeCh);

    showToast("🎉 已从 .env 成功导入并同步配置！");
  });

  // ====================== H. 页面初始数据加载 ======================
  chrome.storage.local.get(null, (result) => {
    // 1. 初始化渠道数据
    if (result.channels && Array.isArray(result.channels) && result.channels.length > 0) {
      channels = result.channels;
    } else {
      channels = JSON.parse(JSON.stringify(DEFAULT_CHANNELS));
    }

    // 深度补齐各个渠道可能存放在单独 key_ 或 url_ 下的配置
    channels.forEach(ch => {
      if (!ch.apiKey && result[`key_${ch.id}`]) {
        ch.apiKey = result[`key_${ch.id}`];
      }
      if (!ch.baseUrl && result[`url_${ch.id}`]) {
        ch.baseUrl = result[`url_${ch.id}`];
      }
      if (!ch.baseUrl && PRESETS[ch.id]?.defaultUrl) {
        ch.baseUrl = PRESETS[ch.id].defaultUrl;
      }
    });

    currentChannelId = result.provider || "siliconflow";
    translateChannelId = result.translateChannelId || "siliconflow";
    translateModelVal = result.translateModel || "deepseek-ai/DeepSeek-V3";

    // 2. 初始化尺寸
    cachedPopupWidth = result.popupWidth || 380;
    cachedPopupHeight = result.popupHeight || 680;
    cachedOverlayWidth = result.overlayWidth || 560;
    cachedOverlayHeight = result.overlayHeight || 640;

    // 3. 呈现模式与外观
    const displayMode = result.displayMode || "popup";
    displayModeSelect.value = displayMode;
    lastDisplayMode = displayMode;
    syncWindowSizeState("popup", displayMode);

    closeStrategySelect.value = result.closeStrategy || "manual";
    syncCloseStrategyState();

    const theme = result.theme || "warm-amber";
    themeSelect.value = theme;
    document.documentElement.setAttribute("data-theme", theme);

    // 4. 翻译批次与提示词
    const batchTokens = result.translateBatchTokens || 4000;
    translateBatchTokensInput.value = batchTokens;
    translateBatchTokensRange.value = batchTokens;

    if (result.customPrompts && Array.isArray(result.customPrompts) && result.customPrompts.length > 0) {
      customPrompts = result.customPrompts;
    } else {
      customPrompts = JSON.parse(JSON.stringify(DEFAULT_PROMPTS));
    }
    renderPromptsList();

    // 5. 渲染渠道与表单回填
    renderChannelsUI();

    const currentChannel = channels.find(c => c.id === currentChannelId) || channels[0];
    if (result.apiKey) currentChannel.apiKey = result.apiKey;
    if (result.baseUrl) currentChannel.baseUrl = result.baseUrl;
    if (result.model) currentChannel.model = result.model;

    loadChannelToForm(currentChannel);
    updateTranslateBindingStatus();
  });

  // ====================== I. 全局保存配置 ======================
  settingsForm.addEventListener("submit", (e) => {
    e.preventDefault();

    saveCurrentFormToChannel(currentChannelId);

    const provider = providerSelect.value;
    const baseUrl = baseUrlInput.value.trim();
    const apiKey = apiKeyInput.value.trim();
    const model = modelSelect.value === "__custom__" ? modelCustom.value.trim() : modelSelect.value;

    const finalTranslateModel = translateModelSelect.value === "__custom__" ? translateModelCustom.value.trim() : translateModelSelect.value;
    const finalTranslateTokens = parseInt(translateBatchTokensInput.value) || 4000;

    const currentMode = displayModeSelect.value;
    if (currentMode === "popup") {
      cachedPopupWidth = parseInt(windowWidthInput.value) || cachedPopupWidth;
      cachedPopupHeight = parseInt(windowHeightInput.value) || cachedPopupHeight;
    } else if (currentMode === "inPage") {
      cachedOverlayWidth = parseInt(windowWidthInput.value) || cachedOverlayWidth;
      cachedOverlayHeight = parseInt(windowHeightInput.value) || cachedOverlayHeight;
    }

    const spinner = btnSave.querySelector(".spinner");
    btnSave.disabled = true;
    spinner.classList.remove("hidden");

    const settings = {
      provider: provider,
      baseUrl: baseUrl,
      apiKey: apiKey,
      model: model,
      displayMode: currentMode,
      closeStrategy: closeStrategySelect.value,
      theme: themeSelect.value,
      popupWidth: cachedPopupWidth,
      popupHeight: cachedPopupHeight,
      overlayWidth: cachedOverlayWidth,
      overlayHeight: cachedOverlayHeight,
      channels: channels,
      translateChannelId: translateChannelSelect.value,
      translateModel: finalTranslateModel,
      translateBatchTokens: finalTranslateTokens,
      customPrompts: customPrompts,
      [`key_${provider}`]: apiKey,
      [`url_${provider}`]: baseUrl,
      [`model_${provider}`]: model
    };

    // 为 channels 中的所有渠道均独立持久化 key 与 url
    channels.forEach(ch => {
      if (ch.apiKey) settings[`key_${ch.id}`] = ch.apiKey;
      if (ch.baseUrl) settings[`url_${ch.id}`] = ch.baseUrl;
      if (ch.model) settings[`model_${ch.id}`] = ch.model;
    });

    chrome.storage.local.set(settings, () => {
      setTimeout(() => {
        btnSave.disabled = false;
        spinner.classList.add("hidden");
        showToast("✅ 配置保存成功！设置已立即生效。");
      }, 400);
    });
  });
});

// Toast 提示
function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.innerText = message;
  toast.classList.remove("hidden");
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => {
      toast.classList.add("hidden");
    }, 300);
  }, 3000);
}
