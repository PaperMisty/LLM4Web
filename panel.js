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
});

// 加载 Chrome Storage 中的配置
function loadConfig() {
  chrome.storage.local.get(["provider", "apiKey", "baseUrl", "model", "enableThinking"], (result) => {
    appConfig = result;
    
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

  // 监听 Storage 变更（当用户在 options 页面更新配置时，这里能够实时拉取更新）
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local") {
      loadConfig();
    }
  });
}

// 3. 处理发送消息逻辑
function handleSend() {
  const text = chatInputEl.value.trim();
  if (!text || isStreaming) return;

  // 如果没有正确配置，拦截发送
  if (!appConfig || !appConfig.apiKey || !appConfig.model) {
    chrome.runtime.openOptionsPage();
    return;
  }

  // 隐藏欢迎视图
  welcomeViewEl.classList.add("hidden");

  // 在界面上渲染用户消息
  appendMessage("user", text);

  // 清空并重置输入框
  chatInputEl.value = "";
  chatInputEl.style.height = "auto";

  // 添加到历史中
  chatHistory.push({ role: "user", content: text });

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

      // 自动滚屏
      chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
    } else if (msg.type === "DONE") {
      finishStreaming(accumulatedContent, accumulatedReasoning, thoughtBoxEl);
    } else if (msg.type === "ERROR") {
      setStreamingState(false);
      textContentEl.innerHTML = `<span style="color: #ef4444;">⚠️ 发生错误: ${escapeHtml(msg.error)}</span>`;
      chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
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

  // 发送消息载荷
  currentPort.postMessage({
    type: "SEND_MESSAGE",
    messages: chatHistory,
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
function finishStreaming(content, reasoning, thoughtBoxEl, isAborted = false) {
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
  // 为了支持带有 reasoning_content 的结构，我们用标准的 OpenAI 思考字段（如果有的话）
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
  }

  chatHistory.push(responseMsg);
  chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
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

// 7. 简易流式 Markdown 转换器
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderMarkdown(text) {
  if (!text) return "";

  // 1. 转义 HTML 预防注入
  let escaped = escapeHtml(text);

  // 2. 解析代码块 ``` [lang] \n [code] \n ```
  // 考虑到流式文本时代码块可能会未闭合，采用基于分割符的分段解析器
  const parts = escaped.split("```");
  let html = "";

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      // 偶数索引：普通文本段落
      let segment = parts[i];
      
      // 行内代码: `code`
      segment = segment.replace(/`([^`]+)`/g, "<code>$1</code>");
      
      // 粗体: **bold**
      segment = segment.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      
      // 换行符替换为网页折行
      segment = segment.replace(/\n/g, "<br>");
      
      html += segment;
    } else {
      // 奇数索引：代码块内容
      let codeContent = parts[i];
      let lang = "";

      // 提取代码语言（如果是第一行）
      const firstLineBreak = codeContent.indexOf("&lt;br&gt;"); // 因为之前已经转义过了
      const firstLineBreakRaw = codeContent.indexOf("\n");
      const breakIdx = firstLineBreak !== -1 ? firstLineBreak : firstLineBreakRaw;
      
      if (breakIdx !== -1) {
        lang = codeContent.substring(0, breakIdx).replace(/&lt;br&gt;/g, "").trim();
        codeContent = codeContent.substring(breakIdx + (firstLineBreak !== -1 ? 10 : 1));
      }

      // 清除代码块头尾多余的空行/换行
      codeContent = codeContent.replace(/^(<br>|\n)+/, "").replace(/(<br>|\n)+$/, "");
      // 还原被误替换成 <br> 的换行（部分场景下可能存在）
      codeContent = codeContent.replace(/<br>/g, "\n").replace(/&lt;br&gt;/g, "\n");

      html += `<pre><code class="language-${lang}">${codeContent}</code></pre>`;
    }
  }

  return html;
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
