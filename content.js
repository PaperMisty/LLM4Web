let floatingBtn = null;

// 监听鼠标抬起事件，用于捕获划词选区
document.addEventListener("mouseup", (e) => {
  // 如果点击的是悬浮按钮本身，直接忽略，让其点击事件自行处理
  if (e.target.closest(".llm4web-floating-btn")) return;

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
    
    // 派发事件通知 background
    chrome.runtime.sendMessage({
      type: "EXPLAIN_TEXT",
      text: text
    });

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
