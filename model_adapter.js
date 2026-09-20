/**
 * model_adapter.js
 * LLM4Web 模型参数与多厂商协议适配层
 * 
 * 职责：
 * 1. 统一识别模型是否具备推理/思考能力 (isThinkingSupported)
 * 2. 抹平不同 API 提供商 (DeepSeek / SiliconFlow / OpenAI / Claude / OneAPI中转) 对思考入参的方言差异
 * 3. 集中构建各业务场景 (流式对话、连通性探测、全文翻译) 的完整请求 Payload
 */

const ModelAdapter = (function () {
  // 启发式识别具备推理/思考能力特征的模型名关键字
  const THINKING_MODEL_KEYWORDS = [
    "r1",
    "reasoner",
    "deepseek-flash",
    "qwq",
    "distill",
    "v4",      // 兼容 deepseek-v4 等
    "gemini",
    "glm-5",
    "glm-4.7",
    "glm-4.6",
    "o1",
    "o3",
    "sonnet-3.7"
  ];

  /**
   * 判断模型是否具备思考/推理能力
   * @param {string} modelName - 模型 ID 或名称
   * @returns {boolean}
   */
  function isThinkingSupported(modelName) {
    if (!modelName || typeof modelName !== "string") return false;
    const name = modelName.toLowerCase();
    return THINKING_MODEL_KEYWORDS.some(kw => name.includes(kw));
  }

  /**
   * 构造厂商特定的思考控制入参
   * @param {Object} options
   * @param {string} options.provider - 提供商标识 ("deepseek" | "siliconflow" | "openai" | "claude" | "custom")
   * @param {string} options.model - 模型名称
   * @param {boolean} options.enableThinking - 用户是否开启了思考开关
   * @returns {Object} 适配后的参数对象
   */
  function getThinkingParams({ provider, model, enableThinking }) {
    // 若当前模型不支持思考，则绝不注入思考参数，避免某些厂商对非思考模型抛 400 Bad Request
    if (!isThinkingSupported(model)) {
      return {};
    }

    const prov = (provider || "").toLowerCase();

    // 1. DeepSeek 官方 API 协议规范
    if (prov === "deepseek") {
      return {
        thinking: {
          type: enableThinking ? "enabled" : "disabled"
        }
      };
    }

    // 2. SiliconFlow (硅基流动) / 通义千问 QwQ 规范
    if (prov === "siliconflow") {
      return {
        enable_thinking: Boolean(enableThinking)
      };
    }

    // 3. Claude 3.7 Sonnet 思考规范
    if (prov === "claude" || prov === "anthropic") {
      return {
        thinking: {
          type: enableThinking ? "enabled" : "disabled"
        }
      };
    }

    // 4. OpenAI o1/o3 系列规范
    if (prov === "openai") {
      return {
        reasoning_effort: enableThinking ? "medium" : "low"
      };
    }

    // 5. Google / Gemini 系列规范 (针对 Gemini 3.7 / 3.5 / 2.5 系列通过中转调用的思考透传控制)
    if (prov === "gemini" || (model && model.toLowerCase().includes("gemini"))) {
      const level = enableThinking ? "medium" : "low";
      return {
        reasoning_effort: level,
        think_budget: level,
        thinking_budget: level,
        thinking_config: {
          thinking_level: level,
          include_thoughts: Boolean(enableThinking)
        },
        extra_body: {
          google: {
            thinking_config: {
              thinking_level: level
            }
          }
        }
      };
    }

    // 6. Custom / OneAPI / NewAPI / 其它聚合中转
    // 注入全方位兼容协议，确保下游无论映射到哪个渠道都能识别
    return {
      enable_thinking: Boolean(enableThinking),
      thinking: {
        type: enableThinking ? "enabled" : "disabled"
      },
      reasoning_effort: enableThinking ? "medium" : "low",
      think_budget: enableThinking ? "medium" : "low",
      thinking_budget: enableThinking ? "medium" : "low"
    };
  }

  /**
   * 构造“强制关闭/最低思考”的入参 (主要用于网页翻译、格式化提取等追求低延迟的确定性场景)
   * @returns {Object}
   */
  function getDisableThinkingParams() {
    return {
      enable_thinking: false,
      thinking: { type: "disabled" },
      reasoning_effort: "low",
      think_budget: "low",
      thinking_budget: "low",
      thinking_config: {
        thinking_level: "low",
        include_thoughts: false
      },
      extra_body: {
        google: {
          thinking_config: {
            thinking_level: "low"
          }
        }
      }
    };
  }

  /**
   * 统一构建 /chat/completions 的完整请求体 Payload
   * @param {Object} params
   * @param {string} params.provider - 提供商标识
   * @param {string} params.model - 模型 ID
   * @param {Array} params.messages - 对话消息数组
   * @param {boolean} [params.stream=false] - 是否流式传输
   * @param {number} [params.temperature=0.3] - 采样温度
   * @param {boolean} [params.enableThinking=false] - 是否开启思考
   * @param {Object} [params.extraOptions={}] - 其他扩展参数 (如 max_tokens, stream_options 等)
   * @returns {Object}
   */
  function buildChatPayload(params) {
    const {
      provider,
      model,
      messages,
      stream = false,
      temperature = 0.3,
      enableThinking = false,
      extraOptions = {}
    } = params;

    const payload = {
      model,
      messages,
      stream,
      temperature,
      ...extraOptions
    };

    // 仅在已知支持的服务商开启 stream_options 统计 token 消耗
    const prov = (provider || "").toLowerCase();
    if (stream && (prov === "siliconflow" || prov === "deepseek")) {
      payload.stream_options = {
        include_usage: true
      };
    }

    // 注入思考模型参数
    const thinkingParams = getThinkingParams({ provider, model, enableThinking });
    Object.assign(payload, thinkingParams);

    return payload;
  }

  return {
    isThinkingSupported,
    getThinkingParams,
    getDisableThinkingParams,
    buildChatPayload
  };
})();

// 环境挂载 (兼容 ServiceWorker / 浏览器窗口 / 单元测试)
if (typeof self !== "undefined") {
  self.ModelAdapter = ModelAdapter;
}
if (typeof window !== "undefined") {
  window.ModelAdapter = ModelAdapter;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = ModelAdapter;
}
