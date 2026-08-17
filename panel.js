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
      triggerExplain(data.text, data.mode || "medium", data.prefix || "", data.suffix || "");
    }
  });

  // 头部拖拽：按下时通知父页面（content script）开始拖动面板
  // 父页面会创建全屏遮罩接管后续鼠标事件，从而支持拖出 iframe 边界
  const headerEl = document.querySelector(".panel-header");
  if (headerEl) {
    headerEl.addEventListener("mousedown", (e) => {
      // 排除交互控件（思考开关、垃圾桶、设置、清空等按钮）
      if (e.target.closest("button") || e.target.closest("input") || e.target.closest("label") || e.target.closest(".switch")) {
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
function loadConfig() {
  chrome.storage.local.get(["provider", "apiKey", "baseUrl", "model", "enableThinking", "theme"], (result) => {
    appConfig = result;
    
    // 应用主题换肤（默认为 warm-amber 淡黄）
    const theme = result.theme || "warm-amber";
    document.documentElement.setAttribute("data-theme", theme);

    // 如果没有配置过的“思考”开关状态，默认设为开启
    const enableThinking = result.enableThinking !== false;
    cbThinkingEl.checked = enableThinking;

    if (!result.apiKey || !result.baseUrl || !result.model) {
      setupWarningEl.classList.remove("hidden");
      chatInputEl.disabled = true;
      btnSendEl.disabled = true;
      modelStatusEl.innerText = "未配置";
      modelStatusEl.className = "model-badge warning";
    } else {
      setupWarningEl.classList.add("hidden");
      chatInputEl.disabled = false;
      btnSendEl.disabled = false;
      modelStatusEl.innerText = result.model;
      modelStatusEl.className = "model-badge";

      // 推理支持探测双保险：优先读取测试连接的存储缓存，如无则使用启发式命名检索兜底
      const cacheKey = `support_thinking_${result.provider}_${result.model}`;
      chrome.storage.local.get([cacheKey], (cacheResult) => {
        let supportThinking = cacheResult[cacheKey];
        if (supportThinking === undefined) {
          supportThinking = isThinkingSupported(result.model);
        }

        if (supportThinking) {
          thinkingToggleContainer.classList.remove("hidden");
        } else {
          thinkingToggleContainer.classList.add("hidden");
        }
      });
    }
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
        chrome.storage.local.get(["pendingMode", "pendingPrefix", "pendingSuffix"], (res) => {
          const mode = res.pendingMode || "medium";
          const prefix = res.pendingPrefix || "";
          const suffix = res.pendingSuffix || "";
          chrome.storage.local.remove(["pendingSelection", "pendingMode", "pendingPrefix", "pendingSuffix"], () => {
            triggerExplain(selection, mode, prefix, suffix);
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
  chrome.storage.local.get(["pendingSelection", "pendingMode", "pendingPrefix", "pendingSuffix"], (res) => {
    if (res.pendingSelection) {
      const selection = res.pendingSelection;
      const mode = res.pendingMode || "medium";
      const prefix = res.pendingPrefix || "";
      const suffix = res.pendingSuffix || "";
      chrome.storage.local.remove(["pendingSelection", "pendingMode", "pendingPrefix", "pendingSuffix"], () => {
        triggerExplain(selection, mode, prefix, suffix);
      });
    }
  });
}

// 触发解释选中文本的对话动作
function triggerExplain(text, mode = "medium", prefix = "", suffix = "") {
  if (!text) return;
  welcomeViewEl.classList.add("hidden");

  // 1. 组装网页上下文提示说明（仅面向模型，不在对话框中向用户展示）
  let contextPrompt = "";
  if (prefix || suffix) {
    contextPrompt = `\n[划词所处的网页上下文环境（仅供辅助理解背景，请优先聚焦在解释划词文本本身上）：]\n前文："${prefix}"\n划词目标："${text}"\n后文："${suffix}"\n\n`;
  }

  // 2. 组装只面向模型的完整底层提示词指令（包含约束条件）
  let apiText = "";
  if (mode === "easy") {
    apiText = `请帮我简明扼要地解释以下内容。${contextPrompt}（请严格限制在 50 个 Token 左右，回答必须极其简短、直奔主题，无需任何客套与前缀说明）：\n\n"${text}"`;
  } else if (mode === "complex") {
    apiText = `请帮我深入、详细地解释以下内容。${contextPrompt} (请不受任何字数 and 长度限制，结合上述上下文环境提供尽可能详尽、专业的剖析、背景脉络与学术拓展讲解)：\n\n"${text}"`;
  } else {
    // 默认是中等 (medium)
    apiText = `请帮我解释以下内容。${contextPrompt}（请控制在 200 个 Token 左右，结合上述上下文环境简明说明其核心要义即可，直击要点）：\n\n"${text}"`;
  }

  // 3. 组装展示给用户的纯净文字（不污染聊天记录上下文）
  const uiText = `📖 解释选中文本：\n"${text}"`;
  
  // 延迟一小会儿，确保 UI 已经聚焦且配置已加载完成
  setTimeout(() => {
    handleSend(apiText, uiText);
  }, 200);
}

// 3. 处理发送消息逻辑
function handleSend(apiText = null, uiText = null) {
  const rawText = chatInputEl.value.trim();
  const text = apiText || rawText;
  const displayText = uiText || rawText;

  if (!text || isStreaming) return;

  // 如果没有正确配置，拦截发送
  if (!appConfig || !appConfig.apiKey || !appConfig.model) {
    chrome.runtime.openOptionsPage();
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

  // 渲染 AI 消息占位框架，为流式写入做准备
  const { bubbleElement, thoughtContentEl, textContentEl, thoughtBoxEl } = createAssistantBubbleSkeleton();

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
          // 如果是第一次输出思考内容，显示思考框
          thoughtBoxEl.classList.remove("hidden");
          hasCreatedThought = true;
        }
        thoughtContentEl.innerText = accumulatedReasoning;
        thoughtContentEl.scrollTop = thoughtContentEl.scrollHeight; // 滚动到底部
      }

      // 2. 处理常规回复内容
      if (content) {
        // 如果思考框被创建了，但是思考动画还没结束（现在既然已经输出正文，说明思考完毕了）
        if (hasCreatedThought) {
          const spinIcon = thoughtBoxEl.querySelector(".thought-icon-spin");
          if (spinIcon && !spinIcon.classList.contains("done")) {
            spinIcon.classList.add("done");
            // 思考完毕，在标题显示“已完成思考”
            thoughtBoxEl.querySelector(".thought-title").innerText = "已完成思考";
          }
        }
        accumulatedContent += content;
        textContentEl.innerHTML = renderMarkdown(accumulatedContent);
      }

      // 去除自动滚屏逻辑以实现生成期间界面悬停
    } else if (msg.type === "DONE") {
      finishStreaming(accumulatedContent, accumulatedReasoning, thoughtBoxEl, false, msg.metrics);
    } else if (msg.type === "ERROR") {
      setStreamingState(false);
      textContentEl.innerHTML = `<span style="color: #ef4444;">⚠️ 发生错误: ${escapeHtml(msg.error)}</span>`;
      currentPort.disconnect();
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
      content: text // 使用真实提示词（带 Easy/Medium/Complex 前缀）替换
    };
  }

  // 发送消息载荷
  currentPort.postMessage({
    type: "SEND_MESSAGE",
    messages: messagesToSend,
    config: {
      provider: appConfig.provider,
      apiKey: appConfig.apiKey,
      baseUrl: appConfig.baseUrl,
      model: appConfig.model,
      enableThinking: cbThinkingEl.checked
    }
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
function createAssistantBubbleSkeleton() {
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
  textContent.innerHTML = `<span style="color: var(--text-muted);">正在连接 API...</span>`;

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
