#!/usr/bin/env python3
# ============================================================
# qwen_server.py — ProtoAI Local AI Inference Server
# version: 1.0.0
#
# Serves Qwen2.5-Omni-7B as a minimal HTTP API on localhost.
# Default port: 17892 (pass --port N to override).
#
# Signals readiness to the Node.js parent via stdout:
#   QWEN_SERVER_READY:<port>
#
# Endpoints:
#   GET  /health    → { ok, model, ready, device }
#   POST /generate  → { prompt, system_prompt?, max_new_tokens?, temperature? }
#                  ← { text, model }
# ============================================================

import os
import sys
import json
import time
import argparse
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler

MODEL_NAME = os.environ.get("PROTOAI_MODEL", "Qwen/Qwen2.5-Omni-7B")

# ── Globals (populated by load_model) ─────────────────────
_model      = None
_processor  = None
_device     = "cpu"
_model_lock = threading.Lock()
_loading    = False
_load_error = None


# ── Model loading ──────────────────────────────────────────

def load_model():
    global _model, _processor, _device, _loading, _load_error
    _loading = True
    try:
        import torch
        from transformers import Qwen2_5OmniModel, Qwen2_5OmniProcessor

        _device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype   = torch.float16 if _device == "cuda" else torch.float32

        print(f"[qwen_server] Loading {MODEL_NAME} on {_device} ({dtype})...", flush=True)
        t0 = time.time()

        _processor = Qwen2_5OmniProcessor.from_pretrained(MODEL_NAME)
        _model = Qwen2_5OmniModel.from_pretrained(
            MODEL_NAME,
            torch_dtype=dtype,
            device_map="auto" if _device == "cuda" else None,
            low_cpu_mem_usage=True,
        )
        if _device == "cpu":
            _model = _model.to(_device)
        _model.eval()

        elapsed = time.time() - t0
        print(f"[qwen_server] Model ready in {elapsed:.1f}s", flush=True)

    except Exception as e:
        _load_error = str(e)
        print(f"[qwen_server] ERROR loading model: {e}", flush=True)
    finally:
        _loading = False


# ── Text inference ─────────────────────────────────────────

def generate_text(prompt: str, system_prompt: str = "", max_new_tokens: int = 512, temperature: float = 0.7) -> str:
    """
    Text-only inference for Silent Partner commentary.
    Uses the chat template so system instructions are respected.
    """
    import torch

    messages = []
    if system_prompt:
        messages.append({
            "role": "system",
            "content": [{"type": "text", "text": system_prompt}]
        })
    messages.append({
        "role": "user",
        "content": [{"type": "text", "text": prompt}]
    })

    text_input = _processor.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
    )

    inputs = _processor(
        text=text_input,
        return_tensors="pt",
        padding=True,
    )
    inputs = {k: v.to(_model.device) for k, v in inputs.items()}

    with torch.no_grad():
        output_ids = _model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            temperature=temperature if temperature > 0 else 1.0,
            do_sample=temperature > 0,
            pad_token_id=_processor.tokenizer.eos_token_id,
        )

    # Decode only the newly generated tokens
    input_len = inputs["input_ids"].shape[1]
    new_ids   = output_ids[:, input_len:]
    result    = _processor.batch_decode(new_ids, skip_special_tokens=True)[0]
    return result.strip()


# ── HTTP handler ───────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        # Suppress default access log noise
        pass

    def _send_json(self, code: int, data: dict):
        body = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "null")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "null")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {
                "ok":     True,
                "model":  MODEL_NAME,
                "ready":  _model is not None,
                "loading": _loading,
                "device": _device,
                "error":  _load_error,
            })
        else:
            self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/generate":
            self._send_json(404, {"error": "Not found"})
            return

        # Parse body
        try:
            length = int(self.headers.get("Content-Length", 0))
            body   = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception as e:
            self._send_json(400, {"error": f"Bad request: {e}"})
            return

        prompt        = body.get("prompt", "").strip()
        system_prompt = body.get("system_prompt", "")
        max_new_tokens = int(body.get("max_new_tokens", 512))
        temperature    = float(body.get("temperature", 0.7))

        if not prompt:
            self._send_json(400, {"error": "'prompt' is required"})
            return

        if _model is None:
            if _loading:
                self._send_json(503, {"error": "Model is still loading, please retry shortly"})
            elif _load_error:
                self._send_json(500, {"error": f"Model failed to load: {_load_error}"})
            else:
                self._send_json(503, {"error": "Model not loaded"})
            return

        try:
            with _model_lock:
                text = generate_text(prompt, system_prompt, max_new_tokens, temperature)
            self._send_json(200, {"text": text, "model": MODEL_NAME})
        except Exception as e:
            print(f"[qwen_server] generate error: {e}", flush=True)
            self._send_json(500, {"error": str(e)})


# ── Entry point ────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="ProtoAI Qwen2.5-Omni-7B inference server")
    parser.add_argument("--port", type=int, default=17892, help="Port to listen on (default: 17892)")
    parser.add_argument("--lazy", action="store_true", help="Defer model load until first /generate request")
    args = parser.parse_args()

    server = HTTPServer(("127.0.0.1", args.port), Handler)

    if not args.lazy:
        # Load model in a background thread so the server can start immediately
        # and respond to /health while loading is in progress
        threading.Thread(target=load_model, daemon=True).start()
    else:
        # Wrap handler to load model on first POST /generate
        original_do_post = Handler.do_POST
        def lazy_post(self):
            global _model
            if _model is None and not _loading and not _load_error:
                threading.Thread(target=load_model, daemon=True).start()
            original_do_post(self)
        Handler.do_POST = lazy_post

    # Signal readiness to the Node.js parent process
    print(f"QWEN_SERVER_READY:{args.port}", flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[qwen_server] Shutting down.", flush=True)


if __name__ == "__main__":
    main()
