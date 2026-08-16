// 开启点击图标打开 Side Panel
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("设置侧边栏行为失败:", error));

// 监听长连接
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "chat-stream") return;

  let abortController = null;

  port.onMessage.addListener(async (msg) => {
    if (msg.type === "SEND_MESSAGE") {
      // 如果之前有未完成的请求，先中断
      if (abortController) {
        abortController.abort();
      }

      abortController = new AbortController();
      const { provider, apiKey, baseUrl, model, messages, enableThinking } = msg.config;
      const history = msg.messages;

      try {
        // 构建请求体
        const requestBody = {
          model: model,
          messages: history,
          stream: true
        };

        // 根据提供商做个性化适配
        if (provider === "siliconflow") {
          // 硅基流动的 DeepSeek 模型支持 enable_thinking 开关
          if (model.includes("deepseek") && model.includes("R1")) {
            requestBody.enable_thinking = enableThinking;
          }
        } else if (provider === "deepseek") {
          // DeepSeek 官方 API 自身没有 enable_thinking 参数，
          // 它的思考是通过 deepseek-reasoner 模型自动输出的，deepseek-chat 模型则没有思考过程。
          // 故不传递 enable_thinking 字段，避免官方 API 报错
        } else {
          // 自定义提供商兼容
          if (model.includes("deepseek")) {
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
          try {
            errJson = JSON.parse(errText);
          } catch(e) {}
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
          // 留下最后一行未完成的内容放入下一次循环处理
          buffer = lines.pop();

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            
            // 处理 SSE 结束标志
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
                // 部分 API 可能会返回不规范的 SSE 数据，忽略解析错误以防止中断流式展示
                console.warn("解析流数据出错:", e, trimmed);
              }
            }
          }
        }

        // 确保最后的 buffer 也能被处理（如果有的话）
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

  // 端口断开时（用户关闭 Panel 或页面刷新），自动中止请求
  port.onDisconnect.addListener(() => {
    if (abortController) {
      abortController.abort();
      console.log("Panel 端口断开，网络请求已中止");
    }
  });
});
