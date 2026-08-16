let floatingBtn = null;

// ================= 页面内悬浮面板 (inPage 模式) =================
// 面板以 iframe 形式注入到网页中，作为网页内的一层悬浮元素，
// z-index 拉满且不依赖窗口焦点，因此点击页面任何地方都不会"退到后面"。
let overlay = null;          // 悬浮面板容器
let overlayIframe = null;    // 面板 iframe
let displayMode = "popup";   // popup | sidePanel | inPage
let pendingExplainText = null; // iframe 尚未加载完成时暂存的划词文本

// 读取呈现模式，inPage 模式下注入悬浮面板
chrome.storage.local.get(["displayMode"], (res) => {
  displayMode = res.displayMode || "popup";
  if (displayMode === "inPage") {
    ensureOverlay();
  }
});

// 监听呈现模式切换，动态注入/移除悬浮面板
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local" && changes.displayMode) {
    displayMode = changes.displayMode.newValue || "popup";
    if (displayMode === "inPage") {
      ensureOverlay();
    } else {
      removeOverlay();
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

  // 恢复上次记忆的悬浮位置
  chrome.storage.local.get(["overlayPos"], (res) => {
    const pos = res.overlayPos;
    if (pos && typeof pos.left === "number" && typeof pos.top === "number") {
      overlay.style.left = Math.max(0, pos.left) + "px";
      overlay.style.top = Math.max(0, pos.top) + "px";
      overlay.style.right = "auto";
    }
  });

  // iframe 加载完成后，补发暂存的划词文本
  overlayIframe.addEventListener("load", () => {
    if (pendingExplainText) {
      const text = pendingExplainText;
      pendingExplainText = null;
      sendExplainToOverlay(text);
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

// 把划词文本直接交给 iframe 内的面板
function sendExplainToOverlay(text) {
  if (!overlayIframe || !overlayIframe.contentWindow) return;
  try {
    overlayIframe.contentWindow.postMessage(
      { type: "LLM4WEB_EXPLAIN", text: text },
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
  if (e.target.closest(".llm4web-floating-btn")) return;
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

    // 打印调试日志，方便在网页 F12 控制台排查注入状态
    console.log("[LLM4Web] 捕获到划词文本:", selectedText);

    // 创建或更新悬浮小按钮
    createFloatingBtn(e.pageX, e.pageY, selectedText);
  }, 10);
});

// 监听鼠标按下的瞬间，如果点击的不是按钮，提前清理
document.addEventListener("mousedown", (e) => {
  if (floatingBtn && !e.target.closest(".llm4web-floating-btn")) {
    removeFloatingBtn();
  }
});

// 创建悬浮 AI 按钮
function createFloatingBtn(x, y, text) {
  // 先清理可能存在的旧按钮
  removeFloatingBtn();

  floatingBtn = document.createElement("div");
  floatingBtn.className = "llm4web-floating-btn";
  floatingBtn.title = "AI 解释选中文本";
  
  // 注入精美的 AI 闪烁图标 (SVG)
  floatingBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
    </svg>
  `;

  // 精准定位在鼠标落点右下角
  floatingBtn.style.left = `${x + 10}px`;
  floatingBtn.style.top = `${y + 10}px`;

  // 点击事件处理
  floatingBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    
    if (displayMode === "inPage") {
      // 页面内悬浮面板模式：直接显示面板并把文本交给 iframe 内的聊天面板
      showOverlay();
      if (overlayIframe && overlayIframe.contentWindow) {
        sendExplainToOverlay(text);
      } else {
        pendingExplainText = text; // iframe 未就绪时暂存，加载完成后补发
      }
    } else {
      // 原有流程：派发事件通知 background（打开悬浮小窗或侧边栏）
      chrome.runtime.sendMessage({
        type: "EXPLAIN_TEXT",
        text: text
      });
    }

    // 播放点击微动画并移除
    floatingBtn.style.transform = "scale(0.8)";
    floatingBtn.style.opacity = "0";
    setTimeout(() => {
      removeFloatingBtn();
    }, 150);
  });

  document.body.appendChild(floatingBtn);
}

// 移除悬浮按钮
function removeFloatingBtn() {
  if (floatingBtn) {
    floatingBtn.remove();
    floatingBtn = null;
  }
}
