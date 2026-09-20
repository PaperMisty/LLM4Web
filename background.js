importScripts("model_adapter.js");

let popupWindowIds = new Set(); // 追踪所有打开的 popup 窗口，支持多窗口独立运行
let lastExplainTime = 0; // 记录最近一次划词取义的触发时间戳，用于屏蔽焦点竞争导致的秒关

// 初始化呈现模式及图标点击行为
chrome.storage.local.get(["displayMode"], (res) => {
  updateActionBehavior(res.displayMode || "inPage");
});

// 初始化右键上下文菜单（支持网页全篇翻译）
function initContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "llm4web-translate-page",
      title: "🌐 网页全篇翻译 (LLM4Web)",
      contexts: ["page", "selection"]
    }, () => {
      if (chrome.runtime.lastError) {
        // 忽略创建失败
      }
    });
  });
}

chrome.runtime.onInstalled.addListener(initContextMenus);
chrome.runtime.onStartup.addListener(initContextMenus);
initContextMenus();

// 监听右键上下文菜单点击
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "llm4web-translate-page" && tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: "START_PAGE_TRANSLATION" }, () => {
      if (chrome.runtime.lastError) {
        // 当前页面不支持或尚未注入 content script（如 chrome:// 保护页）
        console.warn("[LLM4Web] 无法在当前页面启动翻译:", chrome.runtime.lastError.message);
      }
    });
  }
});

// 判断模型是否支持推理/思考（复用 ModelAdapter）
function isThinkingSupported(modelName) {
  return ModelAdapter.isThinkingSupported(modelName);
}

// 一次性消息监听器（处理配置页面的获取模型与测试连接请求，避免跨域 CORS）
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "GET_MODELS") {
    const { apiKey, baseUrl } = request;
    const url = `${baseUrl.replace(/\/$/, "")}/models`;

    fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`
      }
    })
      .then(res => {
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        return res.json();
      })
      .then(data => {
        if (data && Array.isArray(data.data)) {
          const modelIds = data.data.map(m => m.id);
          sendResponse({ success: true, models: modelIds });
        } else {
          sendResponse({ success: false, error: "返回的接口数据格式不规范，未能获取模型列表" });
        }
      })
      .catch(err => {
        console.error("获取模型列表失败:", err);
        sendResponse({ success: false, error: err.message || "请求失败，请确认 API Key 或 Base URL 是否正确" });
      });

    return true; // 保持异步响应通道
  }

  if (request.type === "TEST_CONNECTION") {
    const { apiKey, baseUrl, model } = request;
    const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

    // 使用模型适配层构建极简连接测试包 (默认开启思考以探测推理返回特征)
    const requestBody = ModelAdapter.buildChatPayload({
      provider: request.provider,
      model: model,
      messages: [{ role: "user", content: "." }],
      stream: false,
      enableThinking: true,
      extraOptions: { max_tokens: 1 }
    });

    // 发送极其简短的单 token 测算，将消耗控制在最低且反应迅速
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    })
      .then(async res => {
        const text = await res.text();
        if (!res.ok) {
          let errJson;
          try { errJson = JSON.parse(text); } catch(e) {}
          throw new Error(errJson?.message || errJson?.error?.message || text || `HTTP error! status: ${res.status}`);
        }
        return text;
      })
      .then(text => {
        // 判定返回的 JSON 中是否含有 "reason" (如 reasoning_content 或 reasoning) 关键字
        const hasReasonField = text.toLowerCase().includes("reason");
        sendResponse({ success: true, supportThinking: hasReasonField });
      })
      .catch(err => {
        console.error("连通性测试失败:", err);
        sendResponse({ success: false, error: err.message || "连接测试失败" });
      });

    return true; // 保持异步响应通道
  }

  if (request.type === "EXPLAIN_TEXT") {
    lastExplainTime = Date.now(); // 记录当前时间，挂起失警自动关闭
    const selectedText = request.text;
    const selectedMode = request.mode || "medium";
    const promptName = request.promptName || "";
    const promptTemplate = request.promptTemplate || "";
    const contextPrefix = request.contextPrefix || "";
    const contextSuffix = request.contextSuffix || "";
    // 1. 将选中文本、对应模式/自定义Prompt以及上下文环境写入 storage 暂存
    chrome.storage.local.set({ 
      pendingSelection: selectedText,
      pendingMode: selectedMode,
      pendingPromptName: promptName,
      pendingPromptTemplate: promptTemplate,
      pendingPrefix: contextPrefix,
      pendingSuffix: contextSuffix
    }, () => {
      // 2. 根据当前的呈现模式，唤起主面板
      chrome.storage.local.get(["displayMode"], (res) => {
        const mode = res.displayMode || "inPage";
        if (mode === "sidePanel") {
          if (sender.tab && sender.tab.id) {
            chrome.sidePanel.open({ tabId: sender.tab.id })
              .catch(err => console.error("打开侧边栏失败:", err));
          }
        } else {
          openNewPopupWindow();
        }
      });
    });
    sendResponse({ success: true });
    return true;
  }

  if (request.type === "TRANSLATE_BATCH") {
    const { items } = request;
    if (!items || !items.length) {
      sendResponse({ success: true, results: [] });
      return true;
    }

    chrome.storage.local.get([
      "channels", "translateChannelId", "translateModel",
      "provider", "currentChannelId", "apiKey", "baseUrl", "model"
    ], async (cfg) => {
      let activeApiKey = "";
      let activeBaseUrl = "";
      let activeModel = "";

      const channels = cfg.channels || [];
      const translateChannelId = cfg.translateChannelId || cfg.provider || "siliconflow";
      const translateChannel = channels.find(c => c.id === translateChannelId);

      // 默认厂商地址预设映射
      const defaultPresetUrls = {
        siliconflow: "https://api.siliconflow.cn/v1",
        deepseek: "https://api.deepseek.com",
        custom: "http://localhost:11434/v1"
      };

      if (translateChannel) {
        // 优先从渠道本身获取，其次从对应渠道独立 key 中获取，再次从全局当前 key 获取
        activeApiKey = translateChannel.apiKey || cfg[`key_${translateChannel.id}`] || (translateChannel.id === cfg.provider ? cfg.apiKey : "") || "";
        activeBaseUrl = translateChannel.baseUrl || cfg[`url_${translateChannel.id}`] || (translateChannel.id === cfg.provider ? cfg.baseUrl : "") || defaultPresetUrls[translateChannel.id] || "";
        activeModel = cfg.translateModel || translateChannel.model || translateChannel.defaultModel || cfg.model || "";
      } else {
        // 兜底回退到主渠道
        activeApiKey = cfg.apiKey || cfg[`key_${cfg.provider}`] || "";
        activeBaseUrl = cfg.baseUrl || cfg[`url_${cfg.provider}`] || defaultPresetUrls[cfg.provider] || "https://api.siliconflow.cn/v1";
        activeModel = cfg.translateModel || cfg.model || "";
      }

      if (!activeBaseUrl && defaultPresetUrls[translateChannelId]) {
        activeBaseUrl = defaultPresetUrls[translateChannelId];
      }

      if (!activeApiKey) {
        sendResponse({ success: false, error: `【网页翻译】所选渠道「${translateChannel?.name || translateChannelId}」尚未配置 API Key，请在设置中先保存该渠道的密钥！` });
        return;
      }
      if (!activeBaseUrl) {
        sendResponse({ success: false, error: `【网页翻译】所选渠道「${translateChannel?.name || translateChannelId}」缺少 Base URL 服务地址，请在设置中检查！` });
        return;
      }
      if (!activeModel) {
        sendResponse({ success: false, error: `【网页翻译】请在设置中选择翻译专用的模型（如 deepseek-chat 或 gpt-4o-mini）！` });
        return;
      }

      // 组织编号列表，保留完整段落上下文
      const numberedText = items.map(it => `[${it.id}] ${it.text}`).join("\n\n");
      const systemPrompt = `你是一个顶级的专业网页翻译引擎。你的任务是将用户提供的按序号编排的网页段落翻译成简体中文。
请结合全部段落的完整上下文语境进行自然、通顺、地道的专业翻译，避免断章取义。

【关键格式与代码/超链接保护规则】：
1. 每一段翻译结果必须严格按如下格式输出，务必保留对应的原序号标号：
[序号] 翻译后的中文文本
2. 严禁合并、遗漏或跳过任何一个序号！
3. 【行内代码占位符绝对保护】：文本中形如 [__CODE_0__]、[__CODE_1__] 的占位符代表行内代码，必须在译文相应位置原样完整保留该占位符及其编号，严禁翻译、修改、删除或拼写篡改任何占位符！
4. 【超链接标签成对保护】：文本中形如 [__L0__]链接文本[__/L0__] 代表网页超链接范围，必须在译文相应位置完整保留成对的 [__L0__] 与 [__/L0__] 标号标签，仅翻译其内部包裹的链接文字（例如将 "[__L0__]Documentation[__/L0__]" 翻译为 "[__L0__]官方文档[__/L0__]"），严禁遗漏或修改标签标号！
5. 请直接输出翻译结果，绝对不要输出任何问候、开场白、总结或额外解释说明！`;

      const requestBody = {
        model: activeModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: numberedText }
        ],
        stream: false,
        temperature: 0.2,
        ...ModelAdapter.getDisableThinkingParams()
      };

      try {
        const targetUrl = `${activeBaseUrl.replace(/\/+$/, "")}/chat/completions`;
        console.log(`[LLM4Web 网页翻译] 发往目标地址: ${targetUrl} | 模型: ${activeModel}`);
        const res = await fetch(targetUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${activeApiKey}`
          },
          body: JSON.stringify(requestBody)
        });

        if (!res.ok) {
          const errText = await res.text();
          let errJson;
          try { errJson = JSON.parse(errText); } catch(e) {}
          throw new Error(errJson?.message || errJson?.error?.message || `HTTP ${res.status}`);
        }

        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || "";

        // 解析 [id] 对应的翻译
        const results = [];
        const pattern = /\[(\d+)\]\s*([\s\S]*?)(?=(?:\[\d+\]|$))/g;
        let match;
        const parsedMap = new Map();
        while ((match = pattern.exec(content)) !== null) {
          const id = parseInt(match[1]);
          const trans = match[2].trim();
          parsedMap.set(id, trans);
        }

        // 整理返回列表
        items.forEach(it => {
          const trans = parsedMap.get(it.id) || "";
          results.push({
            id: it.id,
            translatedText: trans
          });
        });

        sendResponse({ success: true, results: results });
      } catch (err) {
        console.error("网页段落翻译请求失败:", err);
        sendResponse({ success: false, error: err.message || "翻译请求出错" });
      }
    });

    return true; // 保持异步通道
  }
});

// 监听长连接（处理 Panel 的流式对话请求）
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "chat-stream") return;

  let abortController = null;

  port.onMessage.addListener(async (msg) => {
    if (msg.type === "SEND_MESSAGE") {
      if (abortController) {
        abortController.abort();
      }

      abortController = new AbortController();
      const config = msg.config || {};
      const { provider, apiKey, baseUrl, model, enableThinking } = config;
      const history = msg.messages || [];

      if (!baseUrl || !apiKey || !model) {
        const missingFields = [];
        if (!apiKey) missingFields.push("API Key (密钥)");
        if (!baseUrl) missingFields.push("Base URL (接口地址)");
        if (!model) missingFields.push("Model (模型)");
        port.postMessage({
          type: "ERROR",
          error: `当前渠道 [${provider || "默认"}] 缺少必要配置：${missingFields.join("、")}，请在插件设置中填写并保存！`
        });
        return;
      }

      // 测速与用量指标统计
      const startTime = Date.now();
      let firstTokenTime = null;
      let promptTokensVal = 0;
      let completionTokensVal = 0;
      let totalTokensVal = 0;
      let receivedCharCount = 0;

      // 30 秒超时定时器保护，防止网络握手被阻断导致无限等待
      let isTimedOut = false;
      const timeoutTimer = setTimeout(() => {
        isTimedOut = true;
        if (abortController) {
          abortController.abort();
        }
        port.postMessage({
          type: "ERROR",
          error: `大模型请求超时（30秒未收到任何响应数据）。请检查当前渠道 [${provider}] 的服务地址是否可达、是否有网络代理限制，或在设置界面重新测试连通性！`
        });
      }, 30000);

      try {
        // 使用模型参数适配层统一构建请求体
        const requestBody = ModelAdapter.buildChatPayload({
          provider,
          model,
          messages: history,
          stream: true,
          enableThinking
        });

        const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify(requestBody),
          signal: abortController.signal
        });

        if (!response.ok) {
          clearTimeout(timeoutTimer);
          const errText = await response.text();
          let errJson;
          try { errJson = JSON.parse(errText); } catch(e) {}
          const errMsg = errJson?.message || errJson?.error?.message || errText || `HTTP error! status: ${response.status}`;
          port.postMessage({ type: "ERROR", error: `[${response.status} 错误] ${errMsg}` });
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          // 收到数据包，清除超时挂起定时器
          clearTimeout(timeoutTimer);

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop();

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            
            if (trimmed === "data: [DONE]") {
              sendDoneWithMetrics();
              continue;
            }

            if (trimmed.startsWith("data: ")) {
              try {
                const data = JSON.parse(trimmed.slice(6));
                
                if (data.usage) {
                  promptTokensVal = data.usage.prompt_tokens;
                  completionTokensVal = data.usage.completion_tokens;
                  totalTokensVal = data.usage.total_tokens;
                }

                const delta = data.choices?.[0]?.delta;
                if (delta) {
                  const content = delta.content || "";
                  const reasoningContent = delta.reasoning_content || "";
                  if (content || reasoningContent) {
                    if (firstTokenTime === null) {
                      firstTokenTime = Date.now();
                    }
                    receivedCharCount += content.length + reasoningContent.length;

                    port.postMessage({
                      type: "CHUNK",
                      content: content,
                      reasoningContent: reasoningContent
                    });
                  }
                }
              } catch (e) {
                console.warn("解析流数据出错:", e, trimmed);
              }
            }
          }
        }

        clearTimeout(timeoutTimer);

        if (buffer && buffer.startsWith("data: ")) {
          try {
            const trimmed = buffer.trim();
            if (trimmed !== "data: [DONE]") {
              const data = JSON.parse(trimmed.slice(6));
              if (data.usage) {
                promptTokensVal = data.usage.prompt_tokens;
                completionTokensVal = data.usage.completion_tokens;
                totalTokensVal = data.usage.total_tokens;
              }
              const delta = data.choices?.[0]?.delta;
              if (delta) {
                const content = delta.content || "";
                const reasoningContent = delta.reasoning_content || "";
                if (firstTokenTime === null && (content || reasoningContent)) {
                  firstTokenTime = Date.now();
                }
                receivedCharCount += content.length + reasoningContent.length;

                port.postMessage({
                  type: "CHUNK",
                  content: content,
                  reasoningContent: reasoningContent
                });
              }
            }
          } catch (e) {}
        }

        function sendDoneWithMetrics() {
          const duration = Date.now() - startTime;
          const ttft = firstTokenTime ? (firstTokenTime - startTime) : 0;
          
          const promptTokens = promptTokensVal || Math.round(history.reduce((acc, m) => acc + (m.content ? m.content.length : 0), 0) * 1.2);
          const completionTokens = completionTokensVal || Math.round(receivedCharCount * 1.3);
          const totalTokens = totalTokensVal || (promptTokens + completionTokens);
          
          const speed = duration > 0 ? (completionTokens / (duration / 1000)) : 0;

          port.postMessage({
            type: "DONE",
            metrics: {
              duration: (duration / 1000).toFixed(2),
              ttft: ttft,
              speed: speed.toFixed(1),
              promptTokens,
              completionTokens,
              totalTokens
            }
          });
        }

        sendDoneWithMetrics();

      } catch (error) {
        clearTimeout(timeoutTimer);
        if (isTimedOut) {
          return; // 已经发送过超时错误
        }
        if (error.name === "AbortError") {
          console.log("请求被用户中止");
          port.postMessage({ type: "ABORTED" });
        } else {
          console.error("请求 API 失败:", error);
          port.postMessage({ type: "ERROR", error: error.message || "请求失败，请检查网络或服务商配置" });
        }
      }
    }
  });

  port.onDisconnect.addListener(() => {
    if (abortController) {
      abortController.abort();
      console.log("Panel 端口断开，网络请求已中止");
    }
  });
});

// 监听悬浮窗的尺寸与位置变动，实时记忆（任意一个 popup 窗口改变都会保存，作为下一个新窗口的默认值）
chrome.windows.onBoundsChanged.addListener((win) => {
  if (popupWindowIds.has(win.id)) {
    chrome.storage.local.set({
      popupWidth: win.width,
      popupHeight: win.height,
      popupLeft: win.left,
      popupTop: win.top
    });
  }
});

// 窗口关闭时自动从追踪集合中移除
chrome.windows.onRemoved.addListener((windowId) => {
  if (popupWindowIds.has(windowId)) {
    popupWindowIds.delete(windowId);
  }
});

// 监听扩展图标的点击行为（针对悬浮窗口模式 / 页面内悬浮面板模式）
chrome.action.onClicked.addListener(() => {
  chrome.storage.local.get(["displayMode"], (res) => {
    const mode = res.displayMode || "inPage";
    if (mode === "popup") {
      openNewPopupWindow();
    } else if (mode === "inPage") {
      // 通知当前标签页的 content script 切换页面内悬浮面板的显示/隐藏
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs.length > 0) {
          chrome.tabs.sendMessage(tabs[0].id, { type: "TOGGLE_OVERLAY" }, () => {
            if (chrome.runtime.lastError) {
              // 当前页面不支持注入（如 chrome:// 等受保护页面），静默忽略
            }
          });
        }
      });
    }
  });
});

// 监听配置改变（当用户在 options 页面更改呈现方式时，动态调整图标绑定）
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local" && changes.displayMode) {
    updateActionBehavior(changes.displayMode.newValue);
  }
});

// 创建悬浮小窗口
function createWindow() {
  chrome.storage.local.get(["popupWidth", "popupHeight", "popupLeft", "popupTop"], (res) => {
    chrome.windows.getLastFocused((currentWin) => {
      // 默认宽度 380px，高度 680px
      const width = parseInt(res.popupWidth) || 380;
      const height = parseInt(res.popupHeight) || 680;
      
      let left = parseInt(res.popupLeft);
      let top = parseInt(res.popupTop);

      // 若之前无记忆的位置，默认贴着当前活跃浏览器窗口的右边缘对齐
      if (isNaN(left) || isNaN(top)) {
        if (currentWin) {
          left = Math.max(0, currentWin.left + currentWin.width - width - 20);
          top = Math.max(0, currentWin.top + 50);
        } else {
          left = 1000;
          top = 100;
        }
      }

      chrome.windows.create({
        url: "panel.html",
        type: "popup",
        width: width,
        height: height,
        left: left,
        top: top
      }, (win) => {
        if (win) popupWindowIds.add(win.id);
      });
    });
  });
}

// 创建新的独立 popup 窗口（每次调用都新建，支持多窗口并行）
function openNewPopupWindow() {
  createWindow();
}

// 动态调整扩展图标的点击行为
function updateActionBehavior(mode) {
  const isSidePanel = mode === "sidePanel";
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: isSidePanel })
    .catch((error) => console.warn("动态调整侧边栏行为失败:", error));
}

// 监听窗口焦点变化：失焦自动关闭（blur 策略）或什么都不做（manual 策略）
// 不再做"抢焦点置顶"（Chrome API 不支持真正的 always-on-top），inPage 模式已彻底解决此需求
chrome.windows.onFocusChanged.addListener((focusedWindowId) => {
  if (popupWindowIds.size === 0) return;

  if (Date.now() - lastExplainTime < 800) return;

  chrome.storage.local.get(["closeStrategy"], (res) => {
    const strategy = res.closeStrategy || "manual";
    if (strategy === "blur") {
      if (focusedWindowId !== chrome.windows.WINDOW_ID_NONE && !popupWindowIds.has(focusedWindowId)) {
        const idsToClose = [...popupWindowIds];
        idsToClose.forEach((winId) => {
          chrome.windows.remove(winId, () => { /* 忽略已关闭错误 */ });
        });
        popupWindowIds.clear();
        console.log("所有悬浮窗口已由于失去焦点自动关闭");
      }
    }
    // manual 策略：不干预，让用户自行管理多个独立窗口
  });
});
