let floatingBtn = null;

// ================= 页面内悬浮面板 (inPage 模式) =================
// 面板以 iframe 形式注入到网页中，作为网页内的一层悬浮元素，
// z-index 拉满且不依赖窗口焦点，因此点击页面任何地方都不会"退到后面"。
let overlay = null;          // 悬浮面板容器
let overlayIframe = null;    // 面板 iframe
let displayMode = "inPage";   // popup | sidePanel | inPage (inPage 为默认)
let pendingExplainText = null; // iframe 尚未加载完成时暂存的划词文本
let pendingExplainMode = "medium"; // iframe 尚未加载完成时暂存的选定模式
let pendingExplainPrefix = ""; // 暂存的划词前置上下文
let pendingExplainSuffix = ""; // 暂存的划词后置上下文
let pendingExplainPromptName = ""; // 暂存的操作名称
let pendingExplainPromptTemplate = ""; // 暂存的提示词模板

// 默认提示词预设（解耦兜底）
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
    systemPrompt: "请帮我深入、详细地解释以下内容。{context} (请不受任何字数 and 长度限制，结合上述上下文环境提供尽可能详尽、专业的剖析、背景脉络与学术拓展讲解)：\n\n\"{text}\"",
    isDefault: true
  }
];

let activePrompts = [...DEFAULT_PROMPTS];

// 读取配置与提示词列表
chrome.storage.local.get(["displayMode", "customPrompts"], (res) => {
  displayMode = res.displayMode || "inPage";
  if (res.customPrompts && Array.isArray(res.customPrompts) && res.customPrompts.length > 0) {
    activePrompts = res.customPrompts;
  }
  if (displayMode === "inPage") {
    ensureOverlay();
  }
});

// 监听呈现模式切换与提示词变更
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local") {
    if (changes.displayMode) {
      displayMode = changes.displayMode.newValue || "inPage";
      if (displayMode === "inPage") {
        ensureOverlay();
      } else {
        removeOverlay();
      }
    }
    if (changes.customPrompts) {
      activePrompts = changes.customPrompts.newValue || [...DEFAULT_PROMPTS];
    }
    if (changes.overlayWidth && overlay) {
      overlay.style.width = (parseInt(changes.overlayWidth.newValue) || 560) + "px";
    }
    if (changes.overlayHeight && overlay) {
      overlay.style.height = (parseInt(changes.overlayHeight.newValue) || 640) + "px";
    }
  }
});

// 创建悬浮面板容器（iframe 加载扩展内的 panel.html）
function ensureOverlay() {
  if (overlay || !document.body) return;

  overlay = document.createElement("div");
  overlay.className = "llm4web-overlay";

  overlayIframe = document.createElement("iframe");
  overlayIframe.className = "llm4web-overlay-iframe";
  overlayIframe.src = chrome.runtime.getURL("panel.html?embedded=1");
  overlayIframe.setAttribute("scrolling", "no");
  overlayIframe.setAttribute("allowtransparency", "true");
  overlayIframe.setAttribute("frameborder", "0");

  // 关闭按钮（悬停面板时出现）
  const closeBtn = document.createElement("button");
  closeBtn.className = "llm4web-overlay-close";
  closeBtn.title = "隐藏 AI 助手";
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    hideOverlay();
  });

  overlay.appendChild(overlayIframe);
  overlay.appendChild(closeBtn);

  // 恢复上次记忆的悬浮位置与尺寸
  chrome.storage.local.get(["overlayPos", "overlayWidth", "overlayHeight"], (res) => {
    const pos = res.overlayPos;
    if (pos && typeof pos.left === "number" && typeof pos.top === "number") {
      overlay.style.left = Math.max(0, pos.left) + "px";
      overlay.style.top = Math.max(0, pos.top) + "px";
      overlay.style.right = "auto";
    }
    const width = parseInt(res.overlayWidth) || 560;
    const height = parseInt(res.overlayHeight) || 640;
    overlay.style.width = width + "px";
    overlay.style.height = height + "px";
  });

  // iframe 加载完成后，补发暂存的划词文本与对应模式
  overlayIframe.addEventListener("load", () => {
    if (pendingExplainText) {
      const text = pendingExplainText;
      const mode = pendingExplainMode;
      const prefix = pendingExplainPrefix;
      const suffix = pendingExplainSuffix;
      const pName = pendingExplainPromptName;
      const pTpl = pendingExplainPromptTemplate;
      pendingExplainText = null;
      pendingExplainPromptName = "";
      pendingExplainPromptTemplate = "";
      sendExplainToOverlay(text, mode, prefix, suffix, pName, pTpl);
    }
  });

  document.body.appendChild(overlay);
}

function removeOverlay() {
  if (overlay) {
    overlay.remove();
    overlay = null;
    overlayIframe = null;
    pendingExplainText = null;
  }
}

function showOverlay() {
  ensureOverlay();
  overlay.classList.add("llm4web-overlay-visible");
}

function hideOverlay() {
  if (overlay) overlay.classList.remove("llm4web-overlay-visible");
}

function isOverlayVisible() {
  return !!overlay && overlay.classList.contains("llm4web-overlay-visible");
}

// 把划词文本、解释模式和前后文及自定义Prompt直接交给 iframe 内的面板
function sendExplainToOverlay(text, mode = "medium", prefix = "", suffix = "", promptName = "", promptTemplate = "") {
  if (!overlayIframe || !overlayIframe.contentWindow) return;
  try {
    overlayIframe.contentWindow.postMessage(
      {
        type: "LLM4WEB_EXPLAIN",
        text: text,
        mode: mode,
        prefix: prefix,
        suffix: suffix,
        promptName: promptName,
        promptTemplate: promptTemplate
      },
      "*"
    );
  } catch (e) {
    console.warn("[LLM4Web] 向悬浮面板发送文本失败:", e);
  }
}

// 接收 background 转发的图标点击，切换面板显示/隐藏
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "TOGGLE_OVERLAY") {
    if (isOverlayVisible()) {
      hideOverlay();
    } else {
      showOverlay();
    }
    sendResponse({ success: true });
  }
});

// 接收 iframe 内面板发来的"开始拖动"请求，用全屏遮罩接管鼠标事件实现跨 iframe 拖动
window.addEventListener("message", (e) => {
  const data = e.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "LLM4WEB_DRAG_START") {
    startOverlayDrag(data.clientX, data.clientY);
  }
});

function startOverlayDrag(clientX, clientY) {
  if (!overlay) return;

  // 将 iframe 内坐标换算为页面坐标
  const iframeRect = overlayIframe.getBoundingClientRect();
  const startPageX = iframeRect.left + clientX;
  const startPageY = iframeRect.top + clientY;

  const startLeft = overlay.offsetLeft;
  const startTop = overlay.offsetTop;

  // 全屏透明遮罩：盖住 iframe，使后续 mouse 事件全部落在页面 document 上，
  // 从而能跟踪鼠标越过 iframe 边界后的位置，实现流畅拖动
  const mask = document.createElement("div");
  mask.className = "llm4web-drag-mask";
  document.body.appendChild(mask);

  const onMove = (e) => {
    const left = startLeft + (e.clientX - startPageX);
    const top = startTop + (e.clientY - startPageY);
    overlay.style.left = Math.max(0, left) + "px";
    overlay.style.top = Math.max(0, top) + "px";
    overlay.style.right = "auto";
  };

  const onUp = () => {
    mask.remove();
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    // 记忆位置，下次打开面板时恢复
    chrome.storage.local.set({
      overlayPos: { left: overlay.offsetLeft, top: overlay.offsetTop }
    });
  };

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

// ================= 划词悬浮小按钮（原有逻辑） =================

// 监听鼠标抬起事件，用于捕获划词选区
document.addEventListener("mouseup", (e) => {
  // 如果点击的是悬浮按钮本身或面板区域，直接忽略
  if (e.target.closest(".llm4web-floating-bar")) return;
  if (e.target.closest(".llm4web-overlay")) return;

  // 延迟一小会儿，确保选区状态已经更新
  setTimeout(() => {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    // 如果没有选中任何文本，则销毁可能存在的旧按钮
    if (!selectedText) {
      removeFloatingBtn();
      return;
    }

    // 获取选区前后的上下文环境（前后各 50 字符）
    const context = getSelectionContext(selection);

    // 打印调试日志，方便在网页 F12 控制台排查注入状态
    console.log("[LLM4Web] 捕获到划词文本:", selectedText);

    // 创建或更新悬浮小按钮
    createFloatingBtn(e.pageX, e.pageY, selectedText, context.prefix, context.suffix);
  }, 10);
});

// 监听鼠标按下的瞬间，如果点击的不是按钮，提前清理
document.addEventListener("mousedown", (e) => {
  if (floatingBtn && !e.target.closest(".llm4web-floating-bar")) {
    removeFloatingBtn();
  }
});

// 创建悬浮 AI 按钮栏（动态从 activePrompts 渲染解耦的按钮）
function createFloatingBtn(x, y, text, prefix = "", suffix = "") {
  removeFloatingBtn();

  floatingBtn = document.createElement("div");
  floatingBtn.className = "llm4web-floating-bar";
  
  const prompts = (activePrompts && activePrompts.length > 0) ? activePrompts : DEFAULT_PROMPTS;

  prompts.forEach((p) => {
    const btn = document.createElement("button");
    btn.className = `llm4web-bar-btn ${p.id || 'custom'}`;
    btn.title = `${p.name} - ${p.systemPrompt ? p.systemPrompt.slice(0, 50) + '...' : ''}`;
    btn.innerHTML = `<span>${p.icon || '💡'}</span><span>${p.name || '解释'}</span>`;

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();

      const mode = p.id || "medium";
      const promptName = p.name || "";
      const promptTemplate = p.systemPrompt || "";

      if (displayMode === "inPage") {
        showOverlay();
        if (overlayIframe && overlayIframe.contentWindow) {
          sendExplainToOverlay(text, mode, prefix, suffix, promptName, promptTemplate);
        } else {
          pendingExplainText = text;
          pendingExplainMode = mode;
          pendingExplainPrefix = prefix;
          pendingExplainSuffix = suffix;
          pendingExplainPromptName = promptName;
          pendingExplainPromptTemplate = promptTemplate;
        }
      } else {
        chrome.runtime.sendMessage({
          type: "EXPLAIN_TEXT",
          text: text,
          mode: mode,
          promptName: promptName,
          promptTemplate: promptTemplate,
          contextPrefix: prefix,
          contextSuffix: suffix
        });
      }

      // 播放淡出微动画并移除
      floatingBtn.style.transform = "scale(0.8)";
      floatingBtn.style.opacity = "0";
      setTimeout(() => {
        removeFloatingBtn();
      }, 150);
    });

    floatingBtn.appendChild(btn);
  });

  // 精准定位在鼠标落点右下角
  floatingBtn.style.left = `${x + 10}px`;
  floatingBtn.style.top = `${y + 10}px`;

  document.body.appendChild(floatingBtn);
}

// 移除悬浮按钮
function removeFloatingBtn() {
  if (floatingBtn) {
    floatingBtn.remove();
    floatingBtn = null;
  }
}

// ================= 网页全篇智能翻译 (带上下文与原位替换) =================
let isPageTranslating = false;
let abortPageTranslation = false;
let isShowingOriginal = false;
let transControlBar = null;
let translatedElementsMap = new Map(); // id -> { el, originalHtml, translatedText }

// 监听扩展发送的网页翻译指令
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "START_PAGE_TRANSLATION") {
    startPageTranslation();
    sendResponse({ success: true });
  }
});

// 筛选页面中可翻译的文本块（识别并保护行内 <code> 标签）
function collectTranslatableElements() {
  const candidateSelectors = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "dt", "dd", "figcaption"];
  const nodes = document.querySelectorAll(candidateSelectors.join(","));
  const list = [];
  let currentId = 1;

  nodes.forEach((node) => {
    // 排除插件自身控件与代码块、脚本、交互元素
    if (node.closest(".llm4web-overlay, .llm4web-floating-bar, .llm4web-trans-bar, pre, script, style, noscript, svg, button, input, textarea, select, option, iframe")) {
      return;
    }

    // 排除含有大块 pre 代码块的节点
    if (node.tagName.toLowerCase() === "pre" || node.querySelector("pre")) {
      return;
    }

    // 检查元素是否可见
    const isVisible = (node.offsetParent !== null || node.getClientRects().length > 0) && window.getComputedStyle(node).visibility !== "hidden";
    if (!isVisible) return;

    // 识别并保护行内 <code> 标签
    const codeSnippets = [];
    let textToSend = "";

    const inlineCodes = node.querySelectorAll("code");
    if (inlineCodes.length > 0) {
      // 提取所有行内 code 标签并用占位符安全替换
      const clone = node.cloneNode(true);
      const cloneCodes = clone.querySelectorAll("code");
      cloneCodes.forEach((cEl, idx) => {
        const placeholder = `[__CODE_${idx}__]`;
        codeSnippets.push({
          idx: idx,
          placeholder: placeholder,
          html: cEl.outerHTML // 保留原生完整的 code 节点标签和样式内容
        });
        const textNode = document.createTextNode(placeholder);
        cEl.parentNode.replaceChild(textNode, cEl);
      });
      textToSend = clone.innerText ? clone.innerText.trim() : "";
    } else {
      textToSend = node.innerText ? node.innerText.trim() : "";
    }

    // 排除过短、纯数字或无语言字符
    if (textToSend.length < 2 || !/[\p{L}\p{N}]/u.test(textToSend)) {
      return;
    }

    list.push({
      id: currentId++,
      el: node,
      text: textToSend,
      codeSnippets: codeSnippets
    });
  });

  return list;
}

// Token 容量估算函数
function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length * 0.7));
}

// 创建或显示翻译控制浮条
function ensureTransControlBar() {
  if (transControlBar) return transControlBar;

  transControlBar = document.createElement("div");
  transControlBar.className = "llm4web-trans-bar";

  transControlBar.innerHTML = `
    <div class="llm4web-trans-header">
      <div class="llm4web-trans-title-area">
        <span class="llm4web-trans-icon">🌐</span>
        <span class="llm4web-trans-title">网页全篇翻译</span>
      </div>
      <div class="llm4web-trans-actions">
        <button type="button" class="llm4web-trans-btn toggle-view hidden" title="在原文与译文之间切换">👁️ 切换原文</button>
        <button type="button" class="llm4web-trans-btn stop" title="中止后续翻译">⏹️ 停止</button>
        <button type="button" class="llm4web-trans-btn close" title="关闭悬浮条">&times;</button>
      </div>
    </div>
    <div class="llm4web-trans-status">正在分析网页正文段落...</div>
    <div class="llm4web-trans-progress-track">
      <div class="llm4web-trans-progress-fill" style="width: 0%;"></div>
    </div>
  `;

  // 绑定事件
  const btnToggle = transControlBar.querySelector(".toggle-view");
  const btnStop = transControlBar.querySelector(".stop");
  const btnClose = transControlBar.querySelector(".close");

  btnToggle.addEventListener("click", () => {
    isShowingOriginal = !isShowingOriginal;
    if (isShowingOriginal) {
      btnToggle.textContent = "🇨🇳 显示译文";
      translatedElementsMap.forEach(({ el, originalHtml }) => {
        el.innerHTML = originalHtml;
      });
    } else {
      btnToggle.textContent = "👁️ 切换原文";
      translatedElementsMap.forEach(({ el, translatedHtml }) => {
        el.innerHTML = translatedHtml;
      });
    }
  });

  btnStop.addEventListener("click", () => {
    abortPageTranslation = true;
    btnStop.disabled = true;
    btnStop.textContent = "正在停止...";
  });

  btnClose.addEventListener("click", () => {
    transControlBar.remove();
    transControlBar = null;
  });

  document.body.appendChild(transControlBar);
  return transControlBar;
}

// 启动全篇翻译
async function startPageTranslation() {
  if (isPageTranslating) {
    alert("当前网页正在翻译中，请稍候...");
    return;
  }

  const elements = collectTranslatableElements();
  if (elements.length === 0) {
    alert("未在当前网页找到可翻译的正文段落。");
    return;
  }

  const bar = ensureTransControlBar();
  const statusEl = bar.querySelector(".llm4web-trans-status");
  const progressFill = bar.querySelector(".llm4web-trans-progress-fill");
  const btnToggle = bar.querySelector(".toggle-view");
  const btnStop = bar.querySelector(".stop");

  isPageTranslating = true;
  abortPageTranslation = false;
  isShowingOriginal = false;
  btnToggle.classList.add("hidden");
  btnStop.classList.remove("hidden");
  btnStop.disabled = false;
  btnStop.textContent = "⏹️ 停止";

  const total = elements.length;
  statusEl.textContent = `共发现 ${total} 个段落，正在结合上下文分批翻译...`;
  progressFill.style.width = "0%";

  // 备份原内容
  elements.forEach(({ id, el }) => {
    if (!el.dataset.llm4webOriginal) {
      el.dataset.llm4webOriginal = el.innerHTML;
    }
  });

  // 读取用户配置的单批次 Token 大小（默认 4000 tokens）
  const storageSettings = await new Promise(r => chrome.storage.local.get(["translateBatchTokens"], r));
  const maxBatchTokens = parseInt(storageSettings?.translateBatchTokens) || 4000;

  // 分批打包（根据 Token 估算算法动态打包，达到用户设定的单批次容量上限时切分）
  const batches = [];
  let currentBatch = [];
  let currentBatchTokens = 0;

  for (const item of elements) {
    const itemTokens = estimateTokens(item.text);
    if (currentBatch.length > 0 && (currentBatchTokens + itemTokens > maxBatchTokens)) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBatchTokens = 0;
    }
    currentBatch.push(item);
    currentBatchTokens += itemTokens;
  }
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  let completedCount = 0;

  for (let i = 0; i < batches.length; i++) {
    if (abortPageTranslation) {
      statusEl.textContent = `⚠️ 用户已停止翻译 (已完成 ${completedCount}/${total} 段)`;
      break;
    }

    const batch = batches[i];
    statusEl.textContent = `正在翻译第 ${i + 1}/${batches.length} 批 (已完成 ${completedCount}/${total} 段)...`;

    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: "TRANSLATE_BATCH",
          items: batch.map(b => ({ id: b.id, text: b.text }))
        }, (res) => {
          resolve(res);
        });
      });

      if (!response || !response.success) {
        statusEl.innerHTML = `<span style="color: #ef4444;">❌ 翻译中断: ${response ? response.error : '请求异常，请检查配置'}</span>`;
        break;
      }

      // 成功返回，原位替换段落并精准复原行内 <code>
      const results = response.results || [];
      const resultMap = new Map(results.map(r => [r.id, r.translatedText]));

      batch.forEach((item) => {
        const trans = resultMap.get(item.id);
        if (trans) {
          let finalHtml = "";
          if (item.codeSnippets && item.codeSnippets.length > 0) {
            // 对外部文字做基础实体保护
            let safeText = trans
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;");

            // 精确还原 [__CODE_x__] 占位符为原有的 <code>...</code> 原始节点
            item.codeSnippets.forEach(cs => {
              const reg = new RegExp(`\\[\\s*__CODE_${cs.idx}__\\s*\\]`, "g");
              safeText = safeText.replace(reg, cs.html);
            });
            finalHtml = safeText;
            item.el.innerHTML = finalHtml;
          } else {
            item.el.innerText = trans;
            finalHtml = item.el.innerHTML;
          }

          item.el.classList.add("llm4web-translated-node");
          translatedElementsMap.set(item.id, {
            el: item.el,
            originalHtml: item.el.dataset.llm4webOriginal,
            translatedHtml: finalHtml
          });
        }
        completedCount++;
      });

      const pct = Math.round((completedCount / total) * 100);
      progressFill.style.width = `${pct}%`;
    } catch (e) {
      console.error("批次翻译异常:", e);
      statusEl.innerHTML = `<span style="color: #ef4444;">❌ 翻译遇到网络异常</span>`;
      break;
    }
  }

  isPageTranslating = false;
  btnStop.classList.add("hidden");
  if (translatedElementsMap.size > 0) {
    btnToggle.classList.remove("hidden");
    btnToggle.textContent = "👁️ 切换原文";
  }

  if (!abortPageTranslation && completedCount >= total) {
    statusEl.innerHTML = `✅ 网页全篇翻译完成！共翻译 ${completedCount} 个段落。`;
    progressFill.style.width = "100%";
  }
}

// 获取划词选区前后的纯文本上下文（前后各 50 字符）
function getSelectionContext(selection) {
  if (!selection || selection.rangeCount === 0) {
    return { prefix: "", suffix: "" };
  }
  const range = selection.getRangeAt(0);
  
  // 1. 寻找最近的公共祖先元素作为节点边界，防止拉出全文耗费性能
  let container = range.commonAncestorContainer;
  if (container.nodeType === Node.TEXT_NODE) {
    container = container.parentNode;
  }

  let prefix = "";
  let suffix = "";

  try {
    // 2. 提取当前选区前面的文本
    const preRange = document.createRange();
    preRange.setStartBefore(container);
    preRange.setEnd(range.startContainer, range.startOffset);
    const preText = preRange.toString();
    prefix = preText.substring(Math.max(0, preText.length - 50)); // 取最后的 50 个字符
  } catch (e) {
    console.warn("提取前置上下文失败:", e);
  }

  try {
    // 3. 提取当前选区后面的文本
    const postRange = document.createRange();
    postRange.setStart(range.endContainer, range.endOffset);
    postRange.setEndAfter(container);
    const postText = postRange.toString();
    suffix = postText.substring(0, Math.min(50, postText.length)); // 取前 50 个字符
  } catch (e) {
    console.warn("提取后置上下文失败:", e);
  }

  return { prefix, suffix };
}
