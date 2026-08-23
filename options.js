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
      "gpt-4-turbo",
      "gpt-3.5-turbo",
      "meta-llama/Llama-3-70b-instruct"
    ]
  }
};

let envConfig = null; // 用于缓存解析出来的 .env 配置

document.addEventListener("DOMContentLoaded", async () => {
  const displayModeSelect = document.getElementById("display-mode");
  const closeStrategySelect = document.getElementById("close-strategy");
  const themeSelectSelect = document.getElementById("theme-select");
  const providerSelect = document.getElementById("provider");
  const baseUrlInput = document.getElementById("base-url");
  const apiKeyInput = document.getElementById("api-key");
  const modelSelect = document.getElementById("model-select");
  const modelCustom = document.getElementById("model-custom");
  const togglePasswordBtn = document.getElementById("toggle-password");
  const settingsForm = document.getElementById("settings-form");
  const envBanner = document.getElementById("env-banner");
  const btnImportEnv = document.getElementById("btn-import-env");

  const windowWidthInput = document.getElementById("window-width");
  const windowHeightInput = document.getElementById("window-height");
  const windowWidthRange = document.getElementById("window-width-range");
  const windowHeightRange = document.getElementById("window-height-range");
  const windowSizeGroup = document.getElementById("window-size-group");
  const windowSizeHint = document.getElementById("window-size-hint");
  const modelSearchInput = document.getElementById("model-search");

  let cachedPopupWidth = 380;
  let cachedPopupHeight = 680;
  let cachedOverlayWidth = 560;
  let cachedOverlayHeight = 640;
  let currentProviderModels = [];

  // 1. 初始化密码显隐切换
  togglePasswordBtn.addEventListener("click", () => {
    const type = apiKeyInput.type === "password" ? "text" : "password";
    apiKeyInput.type = type;
    const svg = togglePasswordBtn.querySelector("svg");
    if (type === "text") {
      svg.innerHTML = `
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
        <line x1="1" y1="1" x2="23" y2="23"></line>
      `;
    } else {
      svg.innerHTML = `
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
      `;
    }
  });

  // 1.5 呈现模式联动：页面内悬浮面板模式不依赖窗口焦点，禁用"关闭方式"设置
  const closeStrategyGroup = document.getElementById("close-strategy-group");
  const closeStrategyHint = document.getElementById("close-strategy-hint");
  const syncCloseStrategyState = () => {
    const isInPage = displayModeSelect.value === "inPage";
    closeStrategySelect.disabled = isInPage;
    closeStrategyGroup.classList.toggle("disabled-option", isInPage);
    closeStrategyHint.classList.toggle("hidden", !isInPage);
  };

  // 呈现模式联动尺寸
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
      windowSizeHint.innerText = "侧边栏模式由浏览器控制尺寸，无需设置大小。";
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
        windowSizeHint.innerText = "设置悬浮小窗口的默认宽度与高度。";
      } else if (newMode === "inPage") {
        windowWidthInput.value = cachedOverlayWidth;
        windowHeightInput.value = cachedOverlayHeight;
        windowWidthRange.value = cachedOverlayWidth;
        windowHeightRange.value = cachedOverlayHeight;
        windowSizeHint.innerText = "设置页面内悬浮面板的默认宽度与高度。";
      }
    }
  };

  // 绑定滑块与输入框的联动事件
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

  let lastDisplayMode = displayModeSelect.value;
  displayModeSelect.addEventListener("change", (e) => {
    const newMode = e.target.value;
    syncWindowSizeState(lastDisplayMode, newMode);
    lastDisplayMode = newMode;
    syncCloseStrategyState();
  });

  // 2. 动态更新模型推荐和默认 URL
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
    customOpt.textContent = "⚙️ 自定义输入...";
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

  modelSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (modelSelect.options.length > 0) {
        let nextIndex = modelSelect.selectedIndex + 1;
        if (nextIndex >= modelSelect.options.length) nextIndex = 0;
        modelSelect.selectedIndex = nextIndex;
        modelSelect.dispatchEvent(new Event("change"));
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (modelSelect.options.length > 0) {
        let prevIndex = modelSelect.selectedIndex - 1;
        if (prevIndex < 0) prevIndex = modelSelect.options.length - 1;
        modelSelect.selectedIndex = prevIndex;
        modelSelect.dispatchEvent(new Event("change"));
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      modelSearchInput.blur();
      showToast(`已选定模型: ${modelSelect.value === "__custom__" ? "自定义输入" : modelSelect.value}`);
    }
  });

  const updateModelSuggestions = (provider, changeUrl = true, modelToSelect = null) => {
    const preset = PRESETS[provider];
    if (!preset) return;

    chrome.storage.local.get([`models_${provider}`], (result) => {
      let modelsList = result[`models_${provider}`];
      if (!modelsList || !Array.isArray(modelsList)) {
        modelsList = preset.models;
      }
      
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
        modelSelect.value = preset.defaultModel;
        modelCustom.classList.add("hidden");
        modelCustom.required = false;
        modelCustom.value = "";
      }
      modelSelect.dispatchEvent(new Event("change"));
    });

    if (changeUrl) {
      if (envConfig) {
        if (provider === "siliconflow" && envConfig.siliconflow_url) {
          baseUrlInput.value = envConfig.siliconflow_url;
          return;
        }
        if (provider === "deepseek" && envConfig.deepseek_url) {
          baseUrlInput.value = envConfig.deepseek_url;
          return;
        }
      }
      baseUrlInput.value = preset.defaultUrl;
    }
  };

  // 监听模型 Select 改变
  modelSelect.addEventListener("change", (e) => {
    if (e.target.value === "__custom__") {
      modelCustom.classList.remove("hidden");
      modelCustom.required = true;
      modelCustom.focus();
    } else {
      modelCustom.classList.add("hidden");
      modelCustom.required = false;
      modelCustom.value = "";
    }
  });

  // 监听 Provider 改变
  providerSelect.addEventListener("change", (e) => {
    const provider = e.target.value;
    updateModelSuggestions(provider, true);

    // 切换 Provider 时，如果内存中有 env 对应的 key，自动填充
    if (envConfig) {
      if (provider === "siliconflow" && envConfig.siliconflow_dsv4) {
        apiKeyInput.value = envConfig.siliconflow_dsv4;
      } else if (provider === "deepseek" && envConfig.deepseek_key) {
        apiKeyInput.value = envConfig.deepseek_key;
      } else {
        apiKeyInput.value = "";
      }
    } else {
      // 从 storage 加载之前保存的该提供商配置
      chrome.storage.local.get([`key_${provider}`, `url_${provider}`, `model_${provider}`], (result) => {
        apiKeyInput.value = result[`key_${provider}`] || "";
        if (result[`url_${provider}`]) {
          baseUrlInput.value = result[`url_${provider}`];
        }
        const savedModel = result[`model_${provider}`] || PRESETS[provider].defaultModel;
        updateModelSuggestions(provider, false, savedModel);
      });
    }
  });

  // 3. 从 storage 加载已保存配置
  chrome.storage.local.get([
    "provider", "apiKey", "baseUrl", "model", "displayMode", "closeStrategy", "theme",
    "popupWidth", "popupHeight", "overlayWidth", "overlayHeight"
  ], (result) => {
    cachedPopupWidth = result.popupWidth || 380;
    cachedPopupHeight = result.popupHeight || 680;
    cachedOverlayWidth = result.overlayWidth || 560;
    cachedOverlayHeight = result.overlayHeight || 640;

    displayModeSelect.value = result.displayMode || "inPage";
    closeStrategySelect.value = result.closeStrategy || "manual";
    syncCloseStrategyState();
    
    lastDisplayMode = displayModeSelect.value;
    if (lastDisplayMode === "sidePanel") {
      windowWidthInput.disabled = true;
      windowHeightInput.disabled = true;
      windowWidthRange.disabled = true;
      windowHeightRange.disabled = true;
      windowSizeGroup.classList.add("disabled-option");
      windowSizeHint.innerText = "侧边栏模式由浏览器控制尺寸，无需设置大小。";
      windowWidthInput.value = 380;
      windowHeightInput.value = 680;
      windowWidthRange.value = 380;
      windowHeightRange.value = 680;
    } else {
      windowWidthInput.disabled = false;
      windowHeightInput.disabled = false;
      windowWidthRange.disabled = false;
      windowHeightRange.disabled = false;
      windowSizeGroup.classList.remove("disabled-option");
      if (lastDisplayMode === "popup") {
        windowWidthInput.value = cachedPopupWidth;
        windowHeightInput.value = cachedPopupHeight;
        windowWidthRange.value = cachedPopupWidth;
        windowHeightRange.value = cachedPopupHeight;
        windowSizeHint.innerText = "设置悬浮小窗口的默认宽度与高度。";
      } else {
        windowWidthInput.value = cachedOverlayWidth;
        windowHeightInput.value = cachedOverlayHeight;
        windowWidthRange.value = cachedOverlayWidth;
        windowHeightRange.value = cachedOverlayHeight;
        windowSizeHint.innerText = "设置页面内悬浮面板的默认宽度与高度。";
      }
    }
    
    const currentTheme = result.theme || "warm-amber";
    themeSelectSelect.value = currentTheme;
    document.documentElement.setAttribute("data-theme", currentTheme);
    
    const savedProvider = result.provider || "siliconflow";
    providerSelect.value = savedProvider;
    baseUrlInput.value = result.baseUrl || PRESETS[savedProvider].defaultUrl;
    apiKeyInput.value = result.apiKey || "";

    const savedModel = result.model || PRESETS[savedProvider].defaultModel;
    updateModelSuggestions(savedProvider, false, savedModel);
  });

  // 绑定实时换肤
  themeSelectSelect.addEventListener("change", (e) => {
    document.documentElement.setAttribute("data-theme", e.target.value);
  });

  // 4. 尝试加载本地 .env 文件
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
          const key = parts[0].trim();
          const value = parts.slice(1).join("=").trim();
          parsedEnv[key] = value;
        }
      }

      if (parsedEnv.siliconflow_dsv4 || parsedEnv.deepseek_key) {
        envConfig = parsedEnv;
        envBanner.classList.remove("hidden");
      }
    }
  } catch (e) {
    console.log("未检测到本地 .env 文件，请手动配置", e);
  }

  // 一键导入本地配置
  btnImportEnv.addEventListener("click", () => {
    if (!envConfig) return;

    const currentProvider = providerSelect.value;
    let importedCount = 0;

    const dataToSave = {};
    if (envConfig.siliconflow_dsv4) {
      dataToSave.key_siliconflow = envConfig.siliconflow_dsv4;
      if (envConfig.siliconflow_url) dataToSave.url_siliconflow = envConfig.siliconflow_url;
    }
    if (envConfig.deepseek_key) {
      dataToSave.key_deepseek = envConfig.deepseek_key;
      if (envConfig.deepseek_url) dataToSave.url_deepseek = envConfig.deepseek_url;
    }

    chrome.storage.local.set(dataToSave, () => {
      if (currentProvider === "siliconflow" && envConfig.siliconflow_dsv4) {
        apiKeyInput.value = envConfig.siliconflow_dsv4;
        if (envConfig.siliconflow_url) baseUrlInput.value = envConfig.siliconflow_url;
        updateModelSuggestions("siliconflow", false, PRESETS.siliconflow.defaultModel);
        importedCount++;
      } else if (currentProvider === "deepseek" && envConfig.deepseek_key) {
        apiKeyInput.value = envConfig.deepseek_key;
        if (envConfig.deepseek_url) baseUrlInput.value = envConfig.deepseek_url;
        updateModelSuggestions("deepseek", false, PRESETS.deepseek.defaultModel);
        importedCount++;
      } else {
        if (envConfig.siliconflow_dsv4 && currentProvider !== "siliconflow") {
          providerSelect.value = "siliconflow";
          apiKeyInput.value = envConfig.siliconflow_dsv4;
          baseUrlInput.value = envConfig.siliconflow_url || PRESETS.siliconflow.defaultUrl;
          updateModelSuggestions("siliconflow", false, PRESETS.siliconflow.defaultModel);
          importedCount++;
        } else if (envConfig.deepseek_key && currentProvider !== "deepseek") {
          providerSelect.value = "deepseek";
          apiKeyInput.value = envConfig.deepseek_key;
          baseUrlInput.value = envConfig.deepseek_url || PRESETS.deepseek.defaultUrl;
          updateModelSuggestions("deepseek", false, PRESETS.deepseek.defaultModel);
          importedCount++;
        }
      }

      if (importedCount > 0) {
        showToast("✨ 本地 .env 变量导入并填充成功！点击“保存配置”生效。");
      } else {
        showToast("⚠️ 未能匹配当前提供商的有效配置");
      }
    });
  });

  // 4.5 模型获取与测试
  const btnFetchModels = document.getElementById("btn-fetch-models");
  const btnTestModel = document.getElementById("btn-test-model");

  btnFetchModels.addEventListener("click", () => {
    const apiKey = apiKeyInput.value.trim();
    const baseUrl = baseUrlInput.value.trim();

    if (!apiKey || !baseUrl) {
      showToast("⚠️ 请先输入 API Key 和 Base URL");
      return;
    }

    btnFetchModels.disabled = true;
    const spinner = btnFetchModels.querySelector(".spinner-sm");
    const textSpan = btnFetchModels.querySelector("span");
    spinner.classList.remove("hidden");
    textSpan.innerText = "正在拉取...";

    chrome.runtime.sendMessage({
      type: "GET_MODELS",
      apiKey,
      baseUrl
    }, (response) => {
      btnFetchModels.disabled = false;
      spinner.classList.add("hidden");
      textSpan.innerText = "🔄 拉取可用模型";

      if (response && response.success) {
        const currentSelected = modelSelect.value === "__custom__" ? modelCustom.value.trim() : modelSelect.value;
        const currentProvider = providerSelect.value;
        
        // 保存拉取到的模型到 storage
        chrome.storage.local.set({ [`models_${currentProvider}`]: response.models });
        
        currentProviderModels = [...response.models];
        modelSearchInput.value = "";
        renderModelOptions("");

        if (response.models.includes(currentSelected)) {
          modelSelect.value = currentSelected;
          modelCustom.classList.add("hidden");
          modelCustom.required = false;
        } else {
          modelSelect.value = "__custom__";
          modelCustom.classList.remove("hidden");
          modelCustom.required = true;
          modelCustom.value = currentSelected;
        }
        modelSelect.dispatchEvent(new Event("change"));

        showToast(`✅ 成功拉取并更新了 ${response.models.length} 个模型！`);
      } else {
        showToast(`❌ 拉取失败: ${response ? response.error : "未知错误"}`);
      }
    });
  });

  btnTestModel.addEventListener("click", () => {
    const apiKey = apiKeyInput.value.trim();
    const baseUrl = baseUrlInput.value.trim();
    const provider = providerSelect.value;
    const model = modelSelect.value === "__custom__" ? modelCustom.value.trim() : modelSelect.value;

    if (!apiKey || !baseUrl || !model) {
      showToast("⚠️ 请先填写完整 API Key、Base URL 以及模型名称");
      return;
    }

    btnTestModel.disabled = true;
    const spinner = btnTestModel.querySelector(".spinner-sm");
    const textSpan = btnTestModel.querySelector("span");
    spinner.classList.remove("hidden");
    textSpan.innerText = "正在测试...";

    chrome.runtime.sendMessage({
      type: "TEST_CONNECTION",
      apiKey,
      baseUrl,
      model,
      provider // 必须加上 provider 参数
    }, (response) => {
      btnTestModel.disabled = false;
      spinner.classList.add("hidden");
      textSpan.innerText = "🔌 测试连接与推理";

      if (response && response.success) {
        const supportThinking = response.supportThinking;
        const storageKey = `support_thinking_${provider}_${model}`;
        chrome.storage.local.set({ [storageKey]: supportThinking }, () => {
          if (supportThinking) {
            showToast(`🟢 连接成功！且检测到此模型支持思考(Thinking)过程。`);
          } else {
            showToast(`🟡 连接成功！但未检测到此模型的推理能力（不支持思考）。`);
          }
        });
      } else {
        showToast(`🔴 连接失败: ${response ? response.error : "未知错误"}`);
      }
    });
  });

  // 5. 保存配置表单
  settingsForm.addEventListener("submit", (e) => {
    e.preventDefault();

    const displayMode = displayModeSelect.value;
    const closeStrategy = closeStrategySelect.value;
    const theme = themeSelectSelect.value;
    const provider = providerSelect.value;
    const baseUrl = baseUrlInput.value.trim();
    const apiKey = apiKeyInput.value.trim();
    const model = modelSelect.value === "__custom__" ? modelCustom.value.trim() : modelSelect.value;

    if (modelSelect.value === "__custom__" && !model) {
      showToast("⚠️ 自定义模型名称不能为空");
      return;
    }

    if (displayMode === "popup") {
      cachedPopupWidth = parseInt(windowWidthInput.value) || 380;
      cachedPopupHeight = parseInt(windowHeightInput.value) || 680;
    } else if (displayMode === "inPage") {
      cachedOverlayWidth = parseInt(windowWidthInput.value) || 560;
      cachedOverlayHeight = parseInt(windowHeightInput.value) || 640;
    }

    const btnSave = document.getElementById("btn-save");
    const spinner = btnSave.querySelector(".spinner");
    btnSave.disabled = true;
    spinner.classList.remove("hidden");

    const settings = {
      displayMode,
      closeStrategy,
      theme,
      provider,
      baseUrl,
      apiKey,
      model,
      popupWidth: cachedPopupWidth,
      popupHeight: cachedPopupHeight,
      overlayWidth: cachedOverlayWidth,
      overlayHeight: cachedOverlayHeight,
      [`key_${provider}`]: apiKey,
      [`url_${provider}`]: baseUrl,
      [`model_${provider}`]: model
    };

    chrome.storage.local.set(settings, () => {
      setTimeout(() => {
        btnSave.disabled = false;
        spinner.classList.add("hidden");
        showToast("✅ 配置保存成功！您可以开始使用 AI 助手了。");
      }, 600);
    });
  });
});

// Toast 提示
function showToast(message) {
  const toast = document.getElementById("toast");
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
