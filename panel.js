// 预设模型列表，用于页眉选择器兜底
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

let chatHistory = []; // 存储当前会话的上下文
let isStreaming = false;
let currentPort = null;
let appConfig = null;

// DOM 元素引用
const chatHistoryEl = document.getElementById("chat-history");
const welcomeViewEl = document.getElementById("welcome-view");
const chatInputEl = document.getElementById("chat-input");
const btnSendEl = document.getElementById("btn-send");
const btnClearEl = document.getElementById("btn-clear");
const btnSettingsEl = document.getElementById("btn-settings");
const cbThinkingEl = document.getElementById("cb-thinking");
const modelStatusEl = document.getElementById("model-status");
const setupWarningEl = document.getElementById("setup-warning");
const btnGoToSettingsEl = document.getElementById("btn-go-to-settings");
const thinkingToggleContainer = document.getElementById("thinking-toggle-container");
const headerProviderSelect = document.getElementById("header-provider-select");
const headerModelSelect = document.getElementById("header-model-select");

// 1. 初始化页面并读取配置
document.addEventListener("DOMContentLoaded", () => {
  loadConfig();
  initEventListeners();
  // 检查是否有网页滑词触发的待解释文本
  setTimeout(checkPendingSelection, 100);
  // 检测是否为页面内悬浮面板（iframe 嵌入）模式
  if (new URLSearchParams(location.search).get("embedded") === "1") {
    initEmbeddedMode();
  }
});

// 嵌入模式（页面内悬浮面板）专用逻辑：
// 1) 接收 content script 直传的划词文本；2) 头部拖拽移动整个悬浮面板
function initEmbeddedMode() {
  // 接收 content script 发来的划词解释请求
  window.addEventListener("message", (e) => {
    const data = e.data;
    if (data && typeof data === "object" && data.type === "LLM4WEB_EXPLAIN" && typeof data.text === "string") {
      triggerExplain(
        data.text,
        data.mode || "medium",
        data.prefix || "",
        data.suffix || "",
        data.promptName || "",
        data.promptTemplate || ""
      );
    }
  });

  // 头部拖拽：按下时通知父页面（content script）开始拖动面板
  // 父页面会创建全屏遮罩接管后续鼠标事件，从而支持拖出 iframe 边界
  const headerEl = document.querySelector(".panel-header");
  if (headerEl) {
    headerEl.addEventListener("mousedown", (e) => {
      // 排除交互控件（思考开关、垃圾桶、设置、清空等按钮、下拉菜单）
      if (e.target.closest("button") || e.target.closest("input") || e.target.closest("select") || e.target.closest("label") || e.target.closest(".switch")) {
        return;
      }
      e.preventDefault();
      window.parent.postMessage(
        { type: "LLM4WEB_DRAG_START", clientX: e.clientX, clientY: e.clientY },
        "*"
      );
    });
  }
}

// 加载 Chrome Storage 中的配置
function loadConfig(callback) {
  chrome.storage.local.get(null, (result) => {
    // 统一 provider 和 currentChannelId：优先以设置保存的 provider 为准
    const currentProvider = result.provider || result.currentChannelId || "siliconflow";
    const channels = result.channels || [];
    const activeChannel = channels.find(c => c.id === currentProvider);

    // 智能多层合并获取真实的 API Key、Base URL 与 Model
    // 核心修复：优先取当前激活渠道自身的配置，坚决杜绝顶层失效旧配置污染
    const activeApiKey = activeChannel?.apiKey || result[`key_${currentProvider}`] || (result.provider === currentProvider ? result.apiKey : "") || "";
    const activeBaseUrl = activeChannel?.baseUrl || result[`url_${currentProvider}`] || (result.provider === currentProvider ? result.baseUrl : "") || PRESETS[currentProvider]?.defaultUrl || "";
    const activeModel = activeChannel?.model || activeChannel?.defaultModel || result[`model_${currentProvider}`] || (result.provider === currentProvider ? result.model : "") || PRESETS[currentProvider]?.defaultModel || "";

    appConfig = {
      ...result,
      provider: currentProvider,
      currentChannelId: currentProvider,
      apiKey: activeApiKey,
      baseUrl: activeBaseUrl,
      model: activeModel
    };
    
    // 应用主题换肤（默认为 warm-amber 淡黄）
    const theme = result.theme || "warm-amber";
    document.documentElement.setAttribute("data-theme", theme);

    // 如果没有配置过的“思考”开关状态，默认设为开启
    const enableThinking = result.enableThinking !== false;
    cbThinkingEl.checked = enableThinking;

    // 动态填充页眉渠道下拉菜单
    headerProviderSelect.innerHTML = "";
    if (channels.length > 0) {
      channels.forEach(ch => {
        const opt = document.createElement("option");
        opt.value = ch.id;
        opt.textContent = ch.name;
        headerProviderSelect.appendChild(opt);
      });
    } else {
      ["siliconflow", "deepseek", "custom"].forEach(p => {
        const opt = document.createElement("option");
        opt.value = p;
        opt.textContent = p;
        headerProviderSelect.appendChild(opt);
      });
    }
    headerProviderSelect.value = currentProvider;

    const cacheKeyModels = `models_${currentProvider}`;
    let modelsList = result[cacheKeyModels];
    if (!modelsList || !Array.isArray(modelsList)) {
      modelsList = activeChannel?.models || PRESETS[currentProvider]?.models || (activeModel ? [activeModel] : []);
    }

    headerModelSelect.innerHTML = "";
    modelsList.forEach(m => {
      const option = document.createElement("option");
      option.value = m;
      option.textContent = m;
      headerModelSelect.appendChild(option);
    });

    // 如果当前模型不在列表中，动态追加
    if (activeModel && !modelsList.includes(activeModel)) {
      const option = document.createElement("option");
      option.value = activeModel;
      option.textContent = activeModel;
      headerModelSelect.appendChild(option);
    }

    headerModelSelect.value = activeModel;

    if (!activeApiKey || !activeBaseUrl || !activeModel) {
      setupWarningEl.classList.remove("hidden");
      chatInputEl.disabled = true;
      btnSendEl.disabled = true;
      modelStatusEl.innerText = "未配置";
      modelStatusEl.className = "model-badge warning";
    } else {
      setupWarningEl.classList.add("hidden");
      chatInputEl.disabled = false;
      btnSendEl.disabled = false;
      modelStatusEl.innerText = activeModel;
      modelStatusEl.className = "model-badge";

      // 推理支持探测双保险：优先读取测试连接的存储缓存，如无则使用启发式命名检索兜底
      const cacheKey = `support_thinking_${currentProvider}_${activeModel}`;
      let supportThinking = result[cacheKey];
      if (supportThinking === undefined) {
        supportThinking = isThinkingSupported(activeModel);
      }

      if (supportThinking) {
        thinkingToggleContainer.classList.remove("hidden");
      } else {
        thinkingToggleContainer.classList.add("hidden");
      }
    }

    if (typeof callback === "function") callback(appConfig);
  });
}

// 2. 绑定事件监听
function initEventListeners() {
  // 设置按钮跳转
  const openSettings = () => {
    chrome.runtime.openOptionsPage();
  };
  btnSettingsEl.addEventListener("click", openSettings);
  btnGoToSettingsEl.addEventListener("click", openSettings);

  // 页眉提供商/渠道选择框改变事件
  headerProviderSelect.addEventListener("change", (e) => {
    const newChannelId = e.target.value;
    chrome.storage.local.get(null, (res) => {
      const channels = res.channels || [];
      const ch = channels.find(c => c.id === newChannelId);
      const newKey = ch?.apiKey || res[`key_${newChannelId}`] || "";
      const newUrl = ch?.baseUrl || res[`url_${newChannelId}`] || PRESETS[newChannelId]?.defaultUrl || "";
      const newModel = ch?.model || ch?.defaultModel || res[`model_${newChannelId}`] || PRESETS[newChannelId]?.defaultModel || "";

      chrome.storage.local.set({
        provider: newChannelId,
        currentChannelId: newChannelId,
        apiKey: newKey,
        baseUrl: newUrl,
        model: newModel
      }, () => {
        loadConfig();
      });
    });
  });

  // 页眉模型选择框改变事件
  headerModelSelect.addEventListener("change", (e) => {
    const newModel = e.target.value;
    const provider = headerProviderSelect.value;
    chrome.storage.local.set({
      model: newModel,
      [`model_${provider}`]: newModel
    }, () => {
      if (appConfig) appConfig.model = newModel;
      modelStatusEl.innerText = newModel;
    });
  });

  // 清空对话
  btnClearEl.addEventListener("click", () => {
    if (isStreaming) {
      stopGeneration();
    }
    chatHistory = [];
    // 保留欢迎界面，清除气泡
    const bubbles = chatHistoryEl.querySelectorAll(".message-row");
    bubbles.forEach(b => b.remove());
    welcomeViewEl.classList.remove("hidden");
  });

  // 思考开关状态变更时，实时同步到 storage
  cbThinkingEl.addEventListener("change", (e) => {
    chrome.storage.local.set({ enableThinking: e.target.checked });
  });

  // 输入框高度自适应
  chatInputEl.addEventListener("input", () => {
    chatInputEl.style.height = "auto";
    chatInputEl.style.height = (chatInputEl.scrollHeight) + "px";
  });

  // 输入框快捷按键（Enter 发送，Shift+Enter 换行）
  chatInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // 发送/停止按钮点击
  btnSendEl.addEventListener("click", () => {
    if (isStreaming) {
      stopGeneration();
    } else {
      handleSend();
    }
  });

  // 快捷问题推荐卡片点击
  document.querySelectorAll(".tip-card").forEach(card => {
    card.addEventListener("click", () => {
      const prompt = card.getAttribute("data-prompt");
      if (prompt) {
        chatInputEl.value = prompt;
        // 触发自适应高度
        chatInputEl.style.height = "auto";
        chatInputEl.style.height = (chatInputEl.scrollHeight) + "px";
        handleSend();
      }
    });
  });

  // 监听 Storage 变更
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local") {
      if (changes.pendingSelection && changes.pendingSelection.newValue) {
        const selection = changes.pendingSelection.newValue;
        chrome.storage.local.get(["pendingMode", "pendingPrefix", "pendingSuffix", "pendingPromptName", "pendingPromptTemplate"], (res) => {
          const mode = res.pendingMode || "medium";
          const prefix = res.pendingPrefix || "";
          const suffix = res.pendingSuffix || "";
          const promptName = res.pendingPromptName || "";
          const promptTemplate = res.pendingPromptTemplate || "";
          chrome.storage.local.remove(["pendingSelection", "pendingMode", "pendingPrefix", "pendingSuffix", "pendingPromptName", "pendingPromptTemplate"], () => {
            triggerExplain(selection, mode, prefix, suffix, promptName, promptTemplate);
          });
        });
      } else {
        loadConfig();
      }
    }
  });
}

// 检查并提取待解释的网页选中文本
function checkPendingSelection() {
  chrome.storage.local.get(["pendingSelection", "pendingMode", "pendingPrefix", "pendingSuffix", "pendingPromptName", "pendingPromptTemplate"], (res) => {
    if (res.pendingSelection) {
      const selection = res.pendingSelection;
      const mode = res.pendingMode || "medium";
      const prefix = res.pendingPrefix || "";
      const suffix = res.pendingSuffix || "";
      const promptName = res.pendingPromptName || "";
      const promptTemplate = res.pendingPromptTemplate || "";
      chrome.storage.local.remove(["pendingSelection", "pendingMode", "pendingPrefix", "pendingSuffix", "pendingPromptName", "pendingPromptTemplate"], () => {
        triggerExplain(selection, mode, prefix, suffix, promptName, promptTemplate);
      });
    }
  });
}

// 触发解释选中文本的对话动作（已解耦为支持任意自定义 Prompt 模板）
function triggerExplain(text, mode = "medium", prefix = "", suffix = "", promptName = "", promptTemplate = "") {
  if (!text) return;

  // 关键自愈：如果上一次流式未结束或网络卡死，立即中止并重置状态，保证下一次划词 100% 能够响应
  if (isStreaming) {
    stopGeneration();
  }

  welcomeViewEl.classList.add("hidden");

  // 1. 组装网页上下文提示说明（仅面向模型，不在对话框中向用户展示）
  let contextPrompt = "";
  if (prefix || suffix) {
    contextPrompt = `\n[划词所处的网页上下文环境（仅供辅助理解背景，请优先聚焦在解释划词文本本身上）：]\n前文："${prefix}"\n划词目标："${text}"\n后文："${suffix}"\n\n`;
  }

  // 2. 组装只面向模型的完整底层提示词指令
  let apiText = "";
  if (promptTemplate) {
    let replaced = promptTemplate;
    if (replaced.includes("{context}")) {
      replaced = replaced.replace(/\{context\}/g, contextPrompt);
    } else if (contextPrompt) {
      replaced = contextPrompt + replaced;
    }

    if (replaced.includes("{text}")) {
      replaced = replaced.replace(/\{text\}/g, text);
    } else {
      replaced = `${replaced}\n\n"${text}"`;
    }
    apiText = replaced;
  } else if (mode === "easy") {
    apiText = `请帮我简明扼要地解释以下内容。${contextPrompt}（请严格限制在 50 个 Token 左右，回答必须极其简短、直奔主题，无需任何客套与前缀说明）：\n\n"${text}"`;
  } else if (mode === "complex") {
    apiText = `请帮我深入、详细地解释以下内容。${contextPrompt} (请不受任何字数 and 长度限制，结合上述上下文环境提供尽可能详尽、专业的剖析、背景脉络与学术拓展讲解)：\n\n"${text}"`;
  } else {
    // 默认是中等 (medium)
    apiText = `请帮我解释以下内容。${contextPrompt}（请控制在 200 个 Token 左右，结合上述上下文环境简明说明其核心要义即可，直击要点）：\n\n"${text}"`;
  }

  // 3. 组装展示给用户的纯净文字（不污染聊天记录上下文）
  const displayActionName = promptName ? promptName : (mode === "easy" ? "简易解释" : (mode === "complex" ? "复杂解析" : "解释选中文本"));
  const uiText = `📖 ${displayActionName}：\n"${text}"`;
  
  // 延迟一小会儿，确保 UI 已经聚焦且配置已加载完成
  setTimeout(() => {
    handleSend(apiText, uiText);
  }, 100);
}

// 3. 处理发送消息逻辑
function handleSend(apiText = null, uiText = null) {
  const rawText = chatInputEl.value.trim();
  const text = apiText || rawText;
  const displayText = uiText || rawText;

  if (!text) return;

  // 如果正在生成中但用户再次主动点击/回车，中止旧生成
  if (isStreaming) {
    stopGeneration();
  }

  // 每次发送前直接从 Storage 获取当前渠道最新凭证，防止内存过期
  chrome.storage.local.get(null, (result) => {
    const currentProvider = headerProviderSelect.value || result.provider || result.currentChannelId || "siliconflow";
    const channels = result.channels || [];
    const activeChannel = channels.find(c => c.id === currentProvider);

    const activeApiKey = activeChannel?.apiKey || result[`key_${currentProvider}`] || (result.provider === currentProvider ? result.apiKey : "") || "";
    const activeBaseUrl = activeChannel?.baseUrl || result[`url_${currentProvider}`] || (result.provider === currentProvider ? result.baseUrl : "") || PRESETS[currentProvider]?.defaultUrl || "";
    const activeModel = headerModelSelect.value || activeChannel?.model || activeChannel?.defaultModel || result[`model_${currentProvider}`] || (result.provider === currentProvider ? result.model : "") || PRESETS[currentProvider]?.defaultModel || "";

    appConfig = {
      ...result,
      provider: currentProvider,
      currentChannelId: currentProvider,
      apiKey: activeApiKey,
      baseUrl: activeBaseUrl,
      model: activeModel
    };

    // 检查配置是否齐全
    if (!activeApiKey || !activeBaseUrl || !activeModel) {
      welcomeViewEl.classList.add("hidden");
      appendMessage("user", displayText);
      const row = document.createElement("div");
      row.className = "message-row assistant";
      const bubble = document.createElement("div");
      bubble.className = "message-bubble";
      bubble.innerHTML = `<span style="color: #ef4444; font-size: 13px;">⚠️ 当前渠道「${activeChannel?.name || currentProvider}」尚未完整配置 (API Key 或 Base URL 为空)。<br>请点击右上角 ⚙️ 打开设置页面填写并保存！</span>`;
      row.appendChild(bubble);
      chatHistoryEl.appendChild(row);
      setStreamingState(false);
      return;
    }

    // 隐藏欢迎视图
    welcomeViewEl.classList.add("hidden");

    // 在界面上渲染用户消息（显示纯净无内部指令版）
    appendMessage("user", displayText);

    // 清空并重置输入框
    chatInputEl.value = "";
    chatInputEl.style.height = "auto";

    // 添加到历史中（UI 洁净版，防止上下文被模板提示词污染）
    chatHistory.push({ role: "user", content: displayText });

    // 渲染 AI 消息占位框架，明确告知当前正在连接的目标与模型
    const channelDisplayName = activeChannel?.name || currentProvider;
    const { bubbleElement, thoughtContentEl, textContentEl, thoughtBoxEl } = createAssistantBubbleSkeleton(channelDisplayName, activeModel);

    // 更新发送按钮为“停止”状态
    setStreamingState(true);

    // 建立与 Background 的长连接端口
    currentPort = chrome.runtime.connect({ name: "chat-stream" });

    let accumulatedContent = "";
    let accumulatedReasoning = "";
    let hasCreatedThought = false;

    // 监听流式块
    currentPort.onMessage.addListener((msg) => {
      if (msg.type === "CHUNK") {
        const { content, reasoningContent } = msg;

        // 1. 处理思考过程
        if (reasoningContent) {
          accumulatedReasoning += reasoningContent;
          if (!hasCreatedThought) {
            thoughtBoxEl.classList.remove("hidden");
            hasCreatedThought = true;
          }
          thoughtContentEl.innerText = accumulatedReasoning;
          thoughtContentEl.scrollTop = thoughtContentEl.scrollHeight;
        }

        // 2. 处理常规回复内容
        if (content) {
          if (hasCreatedThought) {
            const spinIcon = thoughtBoxEl.querySelector(".thought-icon-spin");
            if (spinIcon && !spinIcon.classList.contains("done")) {
              spinIcon.classList.add("done");
              thoughtBoxEl.querySelector(".thought-title").innerText = "已完成思考";
            }
          }
          accumulatedContent += content;
          textContentEl.innerHTML = renderMarkdown(accumulatedContent);
        }
      } else if (msg.type === "DONE") {
        finishStreaming(accumulatedContent, accumulatedReasoning, thoughtBoxEl, false, msg.metrics);
      } else if (msg.type === "ERROR") {
        setStreamingState(false);
        textContentEl.innerHTML = `<span style="color: #ef4444; line-height: 1.5;">⚠️ <strong>API 连接报错</strong>: ${escapeHtml(msg.error)}</span>`;
        if (currentPort) {
          currentPort.disconnect();
          currentPort = null;
        }
      } else if (msg.type === "ABORTED") {
        finishStreaming(accumulatedContent, accumulatedReasoning, thoughtBoxEl, true);
      }
    });

    // 监听端口异常断开
    currentPort.onDisconnect.addListener(() => {
      if (isStreaming) {
        finishStreaming(accumulatedContent, accumulatedReasoning, thoughtBoxEl, true);
      }
    });

    // 在发送给 background 之前复制一份历史，把最后一条用户消息的内容替换成真实的带提示词指令版本
    const messagesToSend = [...chatHistory];
    if (messagesToSend.length > 0) {
      messagesToSend[messagesToSend.length - 1] = {
        role: "user",
        content: text
      };
    }

    // 发送消息载荷
    currentPort.postMessage({
      type: "SEND_MESSAGE",
      messages: messagesToSend,
      config: {
        provider: currentProvider,
        apiKey: activeApiKey,
        baseUrl: activeBaseUrl,
        model: activeModel,
        enableThinking: cbThinkingEl.checked
      }
    });
  });
}

// 4. 中止生成
function stopGeneration() {
  if (currentPort) {
    currentPort.disconnect(); // 断开端口，触发 background 侧的 AbortController
    currentPort = null;
  }
  setStreamingState(false);
}

// 5. 状态转换辅助函数
function setStreamingState(streaming) {
  isStreaming = streaming;
  if (streaming) {
    btnSendEl.classList.add("streaming");
    btnSendEl.title = "停止生成";
    btnSendEl.querySelector(".send-icon").classList.add("hidden");
    btnSendEl.querySelector(".stop-icon").classList.remove("hidden");
  } else {
    btnSendEl.classList.remove("streaming");
    btnSendEl.title = "发送";
    btnSendEl.querySelector(".send-icon").classList.remove("hidden");
    btnSendEl.querySelector(".stop-icon").classList.add("hidden");
  }
}

// 完成流处理
function finishStreaming(content, reasoning, thoughtBoxEl, isAborted = false, metrics = null) {
  setStreamingState(false);
  
  if (currentPort) {
    currentPort.disconnect();
    currentPort = null;
  }

  // 如果有思考框，将其标志修改为完成状态
  if (thoughtBoxEl && !thoughtBoxEl.classList.contains("hidden")) {
    const spinIcon = thoughtBoxEl.querySelector(".thought-icon-spin");
    if (spinIcon) {
      spinIcon.classList.add("done");
      thoughtBoxEl.querySelector(".thought-title").innerText = "已完成思考";
    }
  }

  // 整理并推入历史记录中
  const responseMsg = { role: "assistant", content: content };
  if (reasoning) {
    responseMsg.reasoning_content = reasoning;
  }
  
  if (isAborted) {
    responseMsg.content += "\n\n*(生成已由用户中止)*";
    const bubbleText = thoughtBoxEl.parentNode.querySelector(".msg-text");
    if (bubbleText) {
      bubbleText.innerHTML = renderMarkdown(content + "\n\n*(生成已由用户中止)*");
    }
  } else if (metrics && thoughtBoxEl) {
    // 正常流式生成结束后，在助理气泡底部追加渲染性能指标与 Token 用量
    const bubble = thoughtBoxEl.parentNode;
    if (bubble) {
      const metricsEl = document.createElement("div");
      metricsEl.className = "metrics-bar";
      metricsEl.innerHTML = `
        <span class="metrics-item" title="大模型首字延迟 (Time to First Token)">⏱️ TTFT: ${metrics.ttft}ms</span>
        <span class="metrics-item" title="平均每秒生成 Token 速率">⚡ 速度: ${metrics.speed} t/s</span>
        <span class="metrics-item" title="提示词与补全所消耗的 Token 用量">🪙 消耗: ${metrics.totalTokens} t (${metrics.promptTokens} in / ${metrics.completionTokens} out)</span>
      `;
      bubble.appendChild(metricsEl);
    }
  }

  chatHistory.push(responseMsg);
  // 结束生成时保持悬停，不强制滚屏
}

// 6. UI DOM 渲染与追加
function appendMessage(role, text) {
  const row = document.createElement("div");
  row.className = `message-row ${role}`;
  
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  
  if (role === "user") {
    bubble.innerText = text;
  } else {
    bubble.innerHTML = renderMarkdown(text);
  }
  
  row.appendChild(bubble);
  chatHistoryEl.appendChild(row);
  chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
}

// 创建 AI 气泡的骨架并返回各区域节点
function createAssistantBubbleSkeleton(providerName = "大模型", modelName = "") {
  const row = document.createElement("div");
  row.className = "message-row assistant";

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";

  // 1. 思考盒模型
  const thoughtBox = document.createElement("div");
  thoughtBox.className = "thought-box hidden"; // 默认隐藏，有思考内容时才显示
  
  const thoughtHeader = document.createElement("div");
  thoughtHeader.className = "thought-header";
  thoughtHeader.innerHTML = `
    <div class="thought-title-wrapper">
      <div class="thought-icon-spin"></div>
      <span class="thought-title">思考过程</span>
    </div>
    <span class="thought-arrow">▼</span>
  `;

  const thoughtContent = document.createElement("div");
  thoughtContent.className = "thought-content";

  // 点击折叠展开思考内容
  thoughtHeader.addEventListener("click", () => {
    thoughtBox.classList.toggle("collapsed");
  });

  thoughtBox.appendChild(thoughtHeader);
  thoughtBox.appendChild(thoughtContent);

  // 2. 正文盒模型
  const textContent = document.createElement("div");
  textContent.className = "msg-text";
  const displayTarget = modelName ? `连接 ${providerName} (${modelName})` : `连接 ${providerName}`;
  textContent.innerHTML = `<span style="color: var(--text-muted); font-size: 13px;">正在${displayTarget}...</span>`;

  bubble.appendChild(thoughtBox);
  bubble.appendChild(textContent);
  row.appendChild(bubble);
  
  chatHistoryEl.appendChild(row);
  chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;

  return {
    bubbleElement: bubble,
    thoughtBoxEl: thoughtBox,
    thoughtContentEl: thoughtContent,
    textContentEl: textContent
  };
}

// 7. 混合 Markdown 与 KaTeX 数学公式渲染器
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderMarkdown(text) {
  if (!text) return "";

  const mathBlocks = [];
  let html = text;

  // 1. 提取并保护块级公式 \[...\]
  html = html.replace(/\\\[([\s\S]+?)\\\]/g, (match, formula) => {
    try {
      const rendered = katex.renderToString(formula, {
        displayMode: true,
        throwOnError: false
      });
      const placeholder = `@@BLOCK_MATH_${mathBlocks.length}@@`;
      mathBlocks.push({ placeholder, html: `<div class="katex-display-wrapper">${rendered}</div>` });
      return placeholder;
    } catch (e) {
      console.warn("KaTeX 块级公式 \\[ 解析出错:", e);
      return match;
    }
  });

  // 2. 提取并保护块级公式 $$...$$
  html = html.replace(/\$\$([\s\S]+?)\$\$/g, (match, formula) => {
    try {
      const rendered = katex.renderToString(formula, {
        displayMode: true,
        throwOnError: false
      });
      const placeholder = `@@BLOCK_MATH_${mathBlocks.length}@@`;
      mathBlocks.push({ placeholder, html: `<div class="katex-display-wrapper">${rendered}</div>` });
      return placeholder;
    } catch (e) {
      console.warn("KaTeX 块级公式 $$ 解析出错:", e);
      return match;
    }
  });

  // 3. 提取并保护行内公式 \(...\)
  html = html.replace(/\\\(([\s\S]+?)\\\)/g, (match, formula) => {
    try {
      const rendered = katex.renderToString(formula, {
        displayMode: false,
        throwOnError: false
      });
      const placeholder = `@@INLINE_MATH_${mathBlocks.length}@@`;
      mathBlocks.push({ placeholder, html: rendered });
      return placeholder;
    } catch (e) {
      console.warn("KaTeX 行内公式 \\( 解析出错:", e);
      return match;
    }
  });

  // 4. 提取并保护行内公式 $...$
  html = html.replace(/\$([^\$\n]+?)\$/g, (match, formula) => {
    try {
      const rendered = katex.renderToString(formula, {
        displayMode: false,
        throwOnError: false
      });
      const placeholder = `@@INLINE_MATH_${mathBlocks.length}@@`;
      mathBlocks.push({ placeholder, html: rendered });
      return placeholder;
    } catch (e) {
      console.warn("KaTeX 行内公式 $ 解析出错:", e);
      return match;
    }
  });

  // 5. 使用 marked 将文本解析为 Markdown HTML
  let parsedMarkdown = "";
  try {
    parsedMarkdown = marked.parse(html, {
      breaks: true,
      gfm: true
    });
  } catch (e) {
    console.error("Marked 解析出错:", e);
    // 简易换行兜底
    parsedMarkdown = html.replace(/\n/g, "<br>");
  }

  // 6. 将数学公式占位符还原回 KaTeX HTML
  mathBlocks.forEach(item => {
    parsedMarkdown = parsedMarkdown.replace(item.placeholder, item.html);
  });

  return parsedMarkdown;
}

// 启发式判断模型是否支持推理/思考
function isThinkingSupported(modelName) {
  if (!modelName) return false;
  const name = modelName.toLowerCase();
  const keywords = [
    "r1",
    "reasoner",
    "thinking",
    "qwq",
    "distill",
    "v4",      // 兼容 deepseek-v4-flash, deepseek-v4-pro 等
    "v3.2",    // 兼容 deepseek-v3.2 等
    "glm-5",
    "glm-4.7",
    "glm-4.6"
  ];
  return keywords.some(keyword => name.includes(keyword));
}
