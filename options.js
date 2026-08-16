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
      "deepseek-chat"
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
  const providerSelect = document.getElementById("provider");
  const baseUrlInput = document.getElementById("base-url");
  const apiKeyInput = document.getElementById("api-key");
  const modelInput = document.getElementById("model");
  const modelList = document.getElementById("model-list");
  const togglePasswordBtn = document.getElementById("toggle-password");
  const settingsForm = document.getElementById("settings-form");
  const envBanner = document.getElementById("env-banner");
  const btnImportEnv = document.getElementById("btn-import-env");

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

  // 2. 动态更新模型推荐和默认 URL
  const updateModelSuggestions = (provider, changeUrl = true) => {
    modelList.innerHTML = "";
    const preset = PRESETS[provider];
    if (!preset) return;

    // 填充推荐列表
    preset.models.forEach(modelName => {
      const option = document.createElement("option");
      option.value = modelName;
      modelList.appendChild(option);
    });

    if (changeUrl) {
      // 检查是否有缓存的 env 配置，有的话优先使用 env 里的配置，否则使用默认值
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
        if (result[`model_${provider}`]) {
          modelInput.value = result[`model_${provider}`];
        } else {
          modelInput.value = PRESETS[provider].defaultModel;
        }
      });
    }
  });

  // 3. 从 storage 加载已保存配置
  chrome.storage.local.get(["provider", "apiKey", "baseUrl", "model"], (result) => {
    const savedProvider = result.provider || "siliconflow";
    providerSelect.value = savedProvider;
    updateModelSuggestions(savedProvider, false);

    baseUrlInput.value = result.baseUrl || PRESETS[savedProvider].defaultUrl;
    apiKeyInput.value = result.apiKey || "";
    modelInput.value = result.model || PRESETS[savedProvider].defaultModel;
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

      // 如果解析出至少一个 key，显示导入横幅
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

    // 先在 storage 中持久化存储 env 中的值，方便切换时读取
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
      // 填充当前界面的输入框
      if (currentProvider === "siliconflow" && envConfig.siliconflow_dsv4) {
        apiKeyInput.value = envConfig.siliconflow_dsv4;
        if (envConfig.siliconflow_url) baseUrlInput.value = envConfig.siliconflow_url;
        importedCount++;
      } else if (currentProvider === "deepseek" && envConfig.deepseek_key) {
        apiKeyInput.value = envConfig.deepseek_key;
        if (envConfig.deepseek_url) baseUrlInput.value = envConfig.deepseek_url;
        importedCount++;
      } else {
        // 如果当前 provider 没有配置，但另一个有，可以自动切换
        if (envConfig.siliconflow_dsv4 && currentProvider !== "siliconflow") {
          providerSelect.value = "siliconflow";
          updateModelSuggestions("siliconflow", false);
          apiKeyInput.value = envConfig.siliconflow_dsv4;
          baseUrlInput.value = envConfig.siliconflow_url || PRESETS.siliconflow.defaultUrl;
          modelInput.value = PRESETS.siliconflow.defaultModel;
          importedCount++;
        } else if (envConfig.deepseek_key && currentProvider !== "deepseek") {
          providerSelect.value = "deepseek";
          updateModelSuggestions("deepseek", false);
          apiKeyInput.value = envConfig.deepseek_key;
          baseUrlInput.value = envConfig.deepseek_url || PRESETS.deepseek.defaultUrl;
          modelInput.value = PRESETS.deepseek.defaultModel;
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

  // 5. 保存配置表单
  settingsForm.addEventListener("submit", (e) => {
    e.preventDefault();

    const provider = providerSelect.value;
    const baseUrl = baseUrlInput.value.trim();
    const apiKey = apiKeyInput.value.trim();
    const model = modelInput.value.trim();

    const btnSave = document.getElementById("btn-save");
    const spinner = btnSave.querySelector(".spinner");
    btnSave.disabled = true;
    spinner.classList.remove("hidden");

    // 保存主配置，以及对应的 Provider 独立缓存，防止切换 Provider 时配置丢失
    const settings = {
      provider,
      baseUrl,
      apiKey,
      model,
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
