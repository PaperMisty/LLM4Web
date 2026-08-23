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

// 读取呈现模式，inPage 模式下注入悬浮面板
chrome.storage.local.get(["displayMode"], (res) => {
  displayMode = res.displayMode || "inPage";
  if (displayMode === "inPage") {
    ensureOverlay();
  }
});

// 监听呈现模式切换与尺寸变化，动态注入/移除或缩放悬浮面板
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
      pendingExplainText = null;
      sendExplainToOverlay(text, mode, prefix, suffix);
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

// 把划词文本、解释模式和前后文直接交给 iframe 内的面板
function sendExplainToOverlay(text, mode = "medium", prefix = "", suffix = "") {
  if (!overlayIframe || !overlayIframe.contentWindow) return;
  try {
    overlayIframe.contentWindow.postMessage(
      { type: "LLM4WEB_EXPLAIN", text: text, mode: mode, prefix: prefix, suffix: suffix },
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

// 创建悬浮 AI 按钮栏（并列三个：简易/中等/复杂）
function createFloatingBtn(x, y, text, prefix = "", suffix = "") {
  // 先清理可能存在的旧按钮
  removeFloatingBtn();

  floatingBtn = document.createElement("div");
  floatingBtn.className = "llm4web-floating-bar";
  
  // 创建并列的三个按钮：简易 (⚡)、中等 (🧠)、复杂 (🎓)
  const btnEasy = document.createElement("button");
  btnEasy.className = "llm4web-bar-btn easy";
  btnEasy.title = "简易模式 (约50 tokens限额解释)";
  btnEasy.innerHTML = `<span>⚡</span><span>简易</span>`;

  const btnMedium = document.createElement("button");
  btnMedium.className = "llm4web-bar-btn medium";
  btnMedium.title = "中等模式 (约200 tokens普通解释)";
  btnMedium.innerHTML = `<span>🧠</span><span>中等</span>`;

  const btnComplex = document.createElement("button");
  btnComplex.className = "llm4web-bar-btn complex";
  btnComplex.title = "复杂模式 (不设限制深度解析)";
  btnComplex.innerHTML = `<span>🎓</span><span>复杂</span>`;

  const configs = [
    { el: btnEasy, mode: "easy" },
    { el: btnMedium, mode: "medium" },
    { el: btnComplex, mode: "complex" }
  ];

  configs.forEach(({ el, mode }) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();

      if (displayMode === "inPage") {
        showOverlay();
        if (overlayIframe && overlayIframe.contentWindow) {
          sendExplainToOverlay(text, mode, prefix, suffix);
        } else {
          pendingExplainText = text;
          pendingExplainMode = mode;
          pendingExplainPrefix = prefix;
          pendingExplainSuffix = suffix;
        }
      } else {
        chrome.runtime.sendMessage({
          type: "EXPLAIN_TEXT",
          text: text,
          mode: mode,
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

    floatingBtn.appendChild(el);
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
