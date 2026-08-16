// 开启点击图标打开 Side Panel
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("设置侧边栏行为失败:", error));

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

    // 构建极简连接测试包
    const requestBody = {
      model: model,
      messages: [{ role: "user", content: "." }],
      max_tokens: 1,
      stream: false
    };

    // 默认开启思考以探测返回数据中是否包含推理特征
    if (isThinkingSupported(model)) {
      if (request.provider === "deepseek") {
        requestBody.thinking = { type: "enabled" };
      } else {
        requestBody.enable_thinking = true;
      }
    }

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
      const { provider, apiKey, baseUrl, model, messages, enableThinking } = msg.config;
      const history = msg.messages;

      try {
        const requestBody = {
          model: model,
          messages: history,
          stream: true
        };

        // API 提供商适配逻辑
        if (provider === "deepseek") {
          // DeepSeek 官方接口：新版 V4 等模型采用顶级 thinking 参数字典控制
          if (isThinkingSupported(model)) {
            requestBody.thinking = {
              type: enableThinking ? "enabled" : "disabled"
            };
          }
        } else if (provider === "siliconflow") {
          // 硅基流动平台继续使用原本有效的 enable_thinking 参数控制
          if (isThinkingSupported(model)) {
            requestBody.enable_thinking = enableThinking;
          }
        } else {
          // 自定义提供商兼容
          if (isThinkingSupported(model)) {
            requestBody.enable_thinking = enableThinking;
          }
        }

        const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
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
          const errText = await response.text();
          let errJson;
          try { errJson = JSON.parse(errText); } catch(e) {}
          const errMsg = errJson?.message || errJson?.error?.message || errText || `HTTP error! status: ${response.status}`;
          port.postMessage({ type: "ERROR", error: errMsg });
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

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop();

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            
            if (trimmed === "data: [DONE]") {
              port.postMessage({ type: "DONE" });
              continue;
            }

            if (trimmed.startsWith("data: ")) {
              try {
                const data = JSON.parse(trimmed.slice(6));
                const delta = data.choices?.[0]?.delta;
                if (delta) {
                  const content = delta.content || "";
                  const reasoningContent = delta.reasoning_content || "";
                  if (content || reasoningContent) {
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

        if (buffer && buffer.startsWith("data: ")) {
          try {
            const trimmed = buffer.trim();
            if (trimmed !== "data: [DONE]") {
              const data = JSON.parse(trimmed.slice(6));
              const delta = data.choices?.[0]?.delta;
              if (delta) {
                port.postMessage({
                  type: "CHUNK",
                  content: delta.content || "",
                  reasoningContent: delta.reasoning_content || ""
                });
              }
            }
          } catch (e) {}
        }

        port.postMessage({ type: "DONE" });

      } catch (error) {
        if (error.name === "AbortError") {
          console.log("请求被用户中止");
          port.postMessage({ type: "ABORTED" });
        } else {
          console.error("请求 API 失败:", error);
          port.postMessage({ type: "ERROR", error: error.message || "请求失败，请检查网络或配置" });
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
