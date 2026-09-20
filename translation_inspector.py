"""
translation_inspector.py
LLM4Web 网页翻译专用测试服务与接口监控器

核心功能：
1. 本地 HTTP 静态服务：提供测试页面 test_translation.html
2. 兼容 OpenAI 格式的 /v1/chat/completions 接口
3. 全景监控打印：
   - 📥 模型的输入内容（完整 Prompt、包含的段落、思考参数等）
   - ⏱️ 输出时延（网络往返时延 / 大模型生成总时延，毫秒级）
   - 📤 模型的具体输出内容（译文、Token等）
4. 双模运行：
   - 真实转发模式 (Live Proxy)：若提供有效 Key，则转发至真正的 SiliconFlow / DeepSeek 并测算真实时延
   - 仿真 Mock 模式 (Mock Server)：无 Key 时自动模拟符合格式规范的翻译响应，零成本极速调试
5. 实时观测 API (/api/last_trace)：支持网页端实时浮窗无感刷新监控数据
"""

import json
import os
import re
import sys
import time
from http.server import HTTPServer, SimpleHTTPRequestHandler
import urllib.request
import urllib.error

# 强制禁止生成 __pycache__ 缓存目录，防止 Chrome 扩展因下划线目录拦截报错
sys.dont_write_bytecode = True

# Windows 控制台 UTF-8 支持
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

PORT = 8088

# 自动解析当前目录 .env 文件
def load_env():
    env_vars = {}
    env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(env_file):
        try:
            with open(env_file, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    env_vars[k.strip()] = v.strip()
        except Exception:
            pass
    return env_vars

LOCAL_ENV = load_env()

# 上游服务地址：优先从 .env 读取 Gemini_BASE_URL，默认 http://localhost:8045/v1
DEFAULT_UPSTREAM_URL = LOCAL_ENV.get("Gemini_BASE_URL") or "http://localhost:8045/v1"

# 自动从 .env 装载你的 Gemini Token，当插件未带 Key 时自动垫补鉴权
DEFAULT_API_KEY = LOCAL_ENV.get("Gemini_API_KEY") or os.environ.get("UPSTREAM_API_KEY", "")

# 缓存最近一次翻译调用的跟踪数据
last_trace_data = {
    "timestamp": None,
    "model": "",
    "provider_info": "",
    "latency_ms": 0,
    "thinking_params": {},
    "input_messages": [],
    "raw_input_text": "",
    "output_content": "",
    "mode": "idle"
}


def print_banner():
    print("=" * 75)
    print("🚀 [LLM4Web Translation Inspector] 网页翻译调试与性能监控服务已就绪")
    print(f"👉 监控转发上游:   {DEFAULT_UPSTREAM_URL}")
    if DEFAULT_API_KEY:
        masked_key = DEFAULT_API_KEY[:8] + "****" + DEFAULT_API_KEY[-4:]
        print(f"🔑 环境变量鉴权:   已从 .env 自动绑定 Gemini Token: {masked_key}")
    else:
        print("⚠️ 环境变量鉴权:   未在 .env 中检测到 Token，将依赖客户端显式传递")
    print(f"👉 测试页面地址:   http://localhost:{PORT}/test_translation.html")
    print(f"👉 插件 Base URL:  http://localhost:{PORT}/v1")
    print("=" * 75)
    print("💡 测试步骤指南:")
    print("1. 在浏览器中打开: http://localhost:{}/test_translation.html".format(PORT))
    print("2. 打开插件「设置」-> 网页翻译渠道的 Base URL 填: http://localhost:{}/v1".format(PORT))
    print("3. 模型名填写: gemini-2.5-flash (秒级极速返回)")
    print("4. 在测试页面空白处点击右键 -> 选择「🌐 网页全篇翻译 (LLM4Web)」！")
    print("=" * 75 + "\n")


class TranslationInspectorHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # 允许跨域请求
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        # 1. 实时跟踪数据接口
        if self.path == "/api/last_trace":
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps(last_trace_data, ensure_ascii=False).encode("utf-8"))
            return

        # 2. 默认重定向或直接提供静态页面
        if self.path == "/":
            self.send_response(302)
            self.send_header("Location", "/test_translation.html")
            self.end_headers()
            return

        return super().do_GET()

    def do_POST(self):
        # 兼容 /v1/chat/completions 与 /chat/completions
        clean_path = self.path.split("?")[0].rstrip("/")
        if clean_path in ["/v1/chat/completions", "/chat/completions"]:
            self.handle_chat_completions()
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Endpoint not found")

    def handle_chat_completions(self):
        global last_trace_data

        content_len = int(self.headers.get("Content-Length", 0))
        body_bytes = self.rfile.read(content_len)
        try:
            payload = json.loads(body_bytes.decode("utf-8"))
        except Exception:
            payload = {}

        auth_header = self.headers.get("Authorization", "")
        if not auth_header and DEFAULT_API_KEY:
            auth_header = f"Bearer {DEFAULT_API_KEY}"
            print("ℹ️ 插件未传递 Authorization，已自动使用 DEFAULT_API_KEY 进行垫补透传")

        api_key = auth_header.replace("Bearer ", "").strip() if auth_header else ""

        model = payload.get("model", "unknown-model")
        messages = payload.get("messages", [])
        temperature = payload.get("temperature", None)
        enable_thinking = payload.get("enable_thinking", None)
        thinking_obj = payload.get("thinking", None)

        # 提取用于翻译的用户输入段落文本
        user_text = ""
        system_prompt = ""
        for m in messages:
            if m.get("role") == "user":
                user_text = m.get("content", "")
            elif m.get("role") == "system":
                system_prompt = m.get("content", "")

        # 打印输入控制台视觉高亮
        print("\n" + "┌" + "─" * 73 + "┐")
        print("│ 📥 [收到翻译请求] 批次数据到达")
        print("├" + "─" * 73 + "┤")
        print(f"│ 🎯 模型标识:       {model}")
        
        masked_auth = (
            auth_header[:14] + "****" + auth_header[-4:]
            if len(auth_header) > 20
            else (auth_header if auth_header else "❌ 未携带任何凭据 (这通常是 401 Unauthorized 的根因)")
        )
        print(f"│ 🔑 请求凭证:       {masked_auth}")
        print(f"│ 🌡️ Temperature:    {temperature}")
        print(f"│ 🧠 思考参数设置:   enable_thinking={enable_thinking}, thinking={thinking_obj}")

        # 统计批次内的段落编号
        item_ids = re.findall(r"\[(\d+)\]", user_text)
        print(f"│ 📦 包含段落数量:   共 {len(item_ids)} 段 (序号: {', '.join(item_ids[:8])}{'...' if len(item_ids) > 8 else ''})")
        print("├" + "─" * 73 + "┤")
        print("│ 📝 [输入内容预览 (Prompt)]:")
        lines = user_text.splitlines()
        for l in lines[:6]:
            print(f"│    {l[:70]}")
        if len(lines) > 6:
            print(f"│    ... (剩余 {len(lines) - 6} 行省略)")
        print("└" + "─" * 73 + "┘")

        start_time = time.time()
        output_text = ""
        mode = "mock"

        # 优先真实转发到你的本地上游 (http://localhost:8045/v1)
        mode = "live_upstream"
        upstream_url = DEFAULT_UPSTREAM_URL.rstrip("/") + "/chat/completions"
        print(f"⏳ 正在透明转发至你的真实模型接口: {upstream_url} (模型: {model}) ...")

        req_headers = { "Content-Type": "application/json" }
        if auth_header:
            req_headers["Authorization"] = auth_header

        forward_success = False
        try:
            req = urllib.request.Request(
                upstream_url,
                data=body_bytes,
                headers=req_headers,
                method="POST"
            )
            # 120B 大模型生成耗时较长，给予充分的 180 秒超时时间
            with urllib.request.urlopen(req, timeout=180) as resp:
                resp_bytes = resp.read()
                resp_json = json.loads(resp_bytes.decode("utf-8"))
                output_text = resp_json.get("choices", [{}])[0].get("message", {}).get("content", "")
                reasoning_text = extract_reasoning(resp_json, output_text)
                end_time = time.time()
                latency_ms = round((end_time - start_time) * 1000, 2)
                forward_success = True
                
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(resp_bytes)
        except urllib.error.HTTPError as http_err:
            err_body = http_err.read().decode("utf-8", errors="ignore")
            end_time = time.time()
            latency_ms = round((end_time - start_time) * 1000, 2)
            print(f"\n❌ [8045 上游返回 HTTP 错误]: 状态码 {http_err.code} {http_err.reason}")
            print(f"   🔍 详细错误原因: {err_body}")
            print(f"   💡 排查建议: 请检查 8045 网关后台是否已开启或配置了当前模型 (如 gemini-3.5-flash) 对应的上游渠道与 API Key。")
            
            self.send_response(http_err.code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(err_body.encode("utf-8") if err_body else b'{"error": "Upstream error"}')

            last_trace_data = {
                "timestamp": time.strftime("%H:%M:%S"),
                "model": model,
                "provider_info": f"8045 报错: {http_err.code}",
                "latency_ms": latency_ms,
                "thinking_params": {
                    "enable_thinking": enable_thinking,
                    "thinking": thinking_obj
                },
                "has_thinking": False,
                "reasoning_len": 0,
                "reasoning_content": "",
                "paragraph_count": len(item_ids),
                "raw_input_text": user_text,
                "output_content": f"[8045 上游错误 HTTP {http_err.code}]:\n{err_body}",
                "mode": f"error_{http_err.code}"
            }
            return
        except Exception as e:
            print(f"⚠️ 无法连接到 8045 接口 ({e})，回退到仿真 Mock 模式...")
            mode = "fallback_mock"
            time.sleep(0.35)
            output_text = generate_mock_translation(user_text)
            reasoning_text = ""
            end_time = time.time()
            latency_ms = round((end_time - start_time) * 1000, 2)
            mock_resp = make_mock_response(model, output_text)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps(mock_resp).encode("utf-8"))

        # 打印输出与时延总结
        print("┌" + "─" * 73 + "┐")
        print(f"│ ⏱️ [响应耗时 / 输出时延]: {latency_ms} ms (模式: {mode})")
        if reasoning_text:
            print("├" + "─" * 73 + "┤")
            print(f"│ 🧠 [⚠️ 警告：检测到模型依然输出了思考过程！共 {len(reasoning_text)} 字，这很可能是时延很久的根因]")
            print(f"│    思考片段: {reasoning_text.replace(chr(10), ' ')[:65]}...")
        print("├" + "─" * 73 + "┤")
        print("│ 📤 [模型具体输出内容 (译文)]:")
        out_lines = output_text.splitlines()
        for ol in out_lines[:8]:
            print(f"│    {ol[:70]}")
        if len(out_lines) > 8:
            print(f"│    ... (剩余 {len(out_lines) - 8} 行省略)")
        print("└" + "─" * 73 + "┘\n")

        # 更新供页面轮询展示的追踪数据
        last_trace_data = {
            "timestamp": time.strftime("%H:%M:%S"),
            "model": model,
            "provider_info": mode,
            "latency_ms": latency_ms,
            "thinking_params": {
                "enable_thinking": enable_thinking,
                "thinking": thinking_obj
            },
            "has_thinking": bool(reasoning_text),
            "reasoning_len": len(reasoning_text) if reasoning_text else 0,
            "reasoning_content": reasoning_text,
            "paragraph_count": len(item_ids),
            "raw_input_text": user_text,
            "output_content": output_text,
            "mode": mode
        }


def extract_reasoning(resp_json: dict, content_str: str) -> str:
    """
    深度提取各大模型接口返回的思考过程 (reasoning / thinking / thought / <think>)
    """
    # 1. 从 choices[0].message 中提取各大厂商字段
    if resp_json and isinstance(resp_json, dict):
        choices = resp_json.get("choices")
        if choices and isinstance(choices, list) and len(choices) > 0:
            msg = choices[0].get("message") or {}
            # DeepSeek / 硅基流动 / 通义 / Claude 等常用字段
            for field in ["reasoning_content", "reasoning", "thought", "thinking"]:
                val = msg.get(field)
                if isinstance(val, str) and val.strip():
                    return val.strip()

    # 2. 如果混在 content 中（如某些模型输出 <think>...</think> 标签）
    if content_str:
        m = re.search(r"<think>([\s\S]*?)</think>", content_str, re.IGNORECASE)
        if m:
            return m.group(1).strip()

    return ""


def generate_mock_translation(prompt_text: str) -> str:
    """
    根据提示词中的 [id] 编号及内容，生成合规的模拟中文翻译，完美保留 [__CODE_x__] 占位符
    """
    pattern = r"\[(\d+)\]\s*([\s\S]*?)(?=(?:\[\d+\]|$))"
    matches = re.findall(pattern, prompt_text)
    if not matches:
        return "[1] 示例段落模拟翻译文本。"

    results = []
    # 模拟通用词汇替换映射表
    mock_dict = {
        "LLM4Web": "LLM4Web 网页助手",
        "Artificial Intelligence": "人工智能",
        "browser extension": "浏览器扩展",
        "Chrome": "谷歌浏览器",
        "features": "核心特性",
        "performance": "极致性能",
        "translation": "双语翻译",
        "framework": "底层框架",
        "streaming": "流式输出",
        "latency": "低响应延迟",
        "table": "数据表格",
        "architecture": "架构设计"
    }

    for item_id, text in matches:
        cleaned = text.strip()
        # 提取保留可能存在的 [__CODE_x__]
        code_tags = re.findall(r"\[__CODE_\d+__\]", cleaned, re.IGNORECASE)
        tags_str = " ".join(code_tags) if code_tags else ""

        trans_snippet = cleaned
        for en, zh in mock_dict.items():
            trans_snippet = re.sub(re.escape(en), zh, trans_snippet, flags=re.IGNORECASE)

        if not any(k.lower() in cleaned.lower() for k in mock_dict):
            trans_snippet = f"（已精准翻译）{cleaned[:40]}..."

        results.append(f"[{item_id}] {trans_snippet} {tags_str}".strip())

    return "\n\n".join(results)


def make_mock_response(model: str, content: str, reasoning: str = "") -> dict:
    msg_dict = {
        "role": "assistant",
        "content": content
    }
    if reasoning:
        msg_dict["reasoning_content"] = reasoning

    return {
        "id": f"chatcmpl-inspector-{int(time.time())}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": msg_dict,
                "finish_reason": "stop"
            }
        ],
        "usage": {
            "prompt_tokens": len(content),
            "completion_tokens": len(content),
            "total_tokens": len(content) * 2
        }
    }


def main():
    print_banner()
    server_address = ("", PORT)
    httpd = HTTPServer(server_address, TranslationInspectorHandler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 服务已停止。")
        httpd.server_close()


if __name__ == "__main__":
    main()
