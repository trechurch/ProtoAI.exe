#!/usr/bin/env python3
# ============================================================
# bootstrap.py — ProtoAI Local AI First-Run Setup
# version: 1.0.0
#
# Called by SysProvisionModel.workflow.js via the embedded
# Python runtime. Performs a one-time setup sequence:
#
#   Step 1 — Bootstrap pip into the embedded Python (get-pip.py)
#   Step 2 — Install virtualenv into embedded Python
#   Step 3 — Create venv at %APPDATA%\protoai\ai_env\
#   Step 4 — Install Python packages (torch, transformers, accelerate…)
#   Step 5 — Download Qwen2.5-Omni-7B from HuggingFace
#
# Progress is reported to stdout as JSON lines:
#   { "step": N, "total": 5, "label": "...", "pct": 0-100 }
# Errors:
#   { "error": "..." }
# Completion:
#   { "done": true, "venv": "C:\\...\\ai_env" }
#
# Usage:
#   python bootstrap.py [--model MODEL_NAME] [--venv VENV_PATH]
#                       [--embed-dir EMBED_DIR] [--cuda]
# ============================================================

import os
import sys
import json
import subprocess
import platform
import shutil
import argparse
import time

MODEL_NAME   = "Qwen/Qwen2.5-Omni-7B"
TRANSFORMERS_REPO = "git+https://github.com/huggingface/transformers@v4.51.3-Qwen2.5-Omni-preview"


# ── Helpers ────────────────────────────────────────────────

def emit(data: dict):
    """Write a JSON progress line to stdout (read by Node.js parent)."""
    print(json.dumps(data), flush=True)


def emit_progress(step: int, total: int, label: str, pct: int = 0):
    emit({"step": step, "total": total, "label": label, "pct": pct})


def emit_error(msg: str):
    emit({"error": msg})


def run(cmd: list, **kwargs) -> subprocess.CompletedProcess:
    """Run a subprocess, raising on non-zero exit."""
    result = subprocess.run(cmd, capture_output=True, text=True, **kwargs)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f"Exit {result.returncode}")
    return result


def run_streaming(cmd: list, step: int, total: int, label: str):
    """
    Run a subprocess and stream stderr/stdout lines as progress events.
    pip outputs to stderr; huggingface_hub to stdout.
    """
    emit_progress(step, total, label, 0)
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    lines = []
    for line in proc.stdout:
        line = line.rstrip()
        if line:
            lines.append(line)
            # Forward interesting lines to parent as sub-label
            emit({"step": step, "total": total, "label": label, "sub": line, "pct": 0})
    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError("\n".join(lines[-10:]) or f"Exit {proc.returncode}")
    emit_progress(step, total, label, 100)


# ── Main bootstrap logic ───────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model",     default=MODEL_NAME)
    parser.add_argument("--venv",      default=None,  help="Override venv path")
    parser.add_argument("--embed-dir", default=None,  help="Path to embedded Python dir")
    parser.add_argument("--cuda",      action="store_true", help="Force CUDA torch build")
    args = parser.parse_args()

    # ── Resolve paths ──────────────────────────────────────
    appdata  = os.environ.get("APPDATA") or os.path.expanduser("~")
    venv_dir = args.venv or os.path.join(appdata, "protoai", "ai_env")

    # Prefer the calling interpreter as the embed Python
    embed_python = args.embed_dir
    if embed_python and os.path.isdir(embed_python):
        embed_python = os.path.join(embed_python, "python.exe")
    else:
        embed_python = sys.executable  # fall back to whatever called us

    venv_python = os.path.join(venv_dir, "Scripts", "python.exe")
    venv_pip    = os.path.join(venv_dir, "Scripts", "pip.exe")

    TOTAL_STEPS = 5

    # ── Step 1 — Bootstrap pip into embedded Python ────────
    emit_progress(1, TOTAL_STEPS, "Bootstrapping pip into embedded Python runtime…")

    get_pip = os.path.join(os.path.dirname(embed_python), "get-pip.py")
    if not os.path.exists(get_pip):
        # Try to find it relative to the script
        get_pip = os.path.join(os.path.dirname(__file__), "..", "..", "python-embed", "get-pip.py")

    if os.path.exists(get_pip):
        try:
            run([embed_python, get_pip, "--quiet"])
        except RuntimeError as e:
            # pip may already be installed; non-fatal
            pass
    else:
        emit({"step": 1, "total": TOTAL_STEPS, "label": "pip bootstrap skipped (get-pip.py not found)", "pct": 100})

    emit_progress(1, TOTAL_STEPS, "Pip ready", 100)

    # ── Step 2 — Create virtualenv ─────────────────────────
    emit_progress(2, TOTAL_STEPS, "Creating Python virtual environment…")

    if os.path.exists(venv_python):
        emit({"step": 2, "total": TOTAL_STEPS, "label": "Virtual environment already exists — skipping", "pct": 100})
    else:
        os.makedirs(os.path.dirname(venv_dir), exist_ok=True)
        try:
            run([embed_python, "-m", "pip", "install", "virtualenv", "--quiet"])
            run([embed_python, "-m", "virtualenv", venv_dir, "--quiet"])
        except RuntimeError:
            # Fall back to built-in venv module
            run([embed_python, "-m", "venv", venv_dir])

        if not os.path.exists(venv_python):
            emit_error(f"Failed to create virtual environment at {venv_dir}")
            sys.exit(1)

    emit_progress(2, TOTAL_STEPS, f"Virtual environment ready at {venv_dir}", 100)

    # ── Step 3 — Install PyTorch ───────────────────────────
    emit_progress(3, TOTAL_STEPS, "Installing PyTorch…")

    if args.cuda:
        # CUDA 12.1 wheel index
        torch_cmd = [
            venv_pip, "install", "torch", "--quiet",
            "--index-url", "https://download.pytorch.org/whl/cu121"
        ]
    else:
        torch_cmd = [venv_pip, "install", "torch", "--quiet"]

    run_streaming(torch_cmd, 3, TOTAL_STEPS, "Installing PyTorch (this may take a few minutes)…")

    # ── Step 4 — Install transformers + other deps ─────────
    emit_progress(4, TOTAL_STEPS, "Installing transformers and dependencies…")

    packages = [
        TRANSFORMERS_REPO,
        "accelerate>=0.26.0",
        "safetensors>=0.4.0",
        "huggingface_hub>=0.20.0",
    ]
    run_streaming(
        [venv_pip, "install", "--quiet"] + packages,
        4, TOTAL_STEPS,
        "Installing transformers (Qwen2.5-Omni preview) and dependencies…"
    )

    # ── Step 5 — Download model ────────────────────────────
    emit_progress(5, TOTAL_STEPS, f"Downloading {args.model} from HuggingFace…")

    dl_script = (
        "from huggingface_hub import snapshot_download; "
        f"snapshot_download(repo_id='{args.model}', repo_type='model')"
    )
    run_streaming(
        [venv_python, "-c", dl_script],
        5, TOTAL_STEPS,
        f"Downloading {args.model} (~15 GB — grab a coffee ☕)…"
    )

    # ── Done ───────────────────────────────────────────────
    emit({"done": True, "venv": venv_dir, "model": args.model})


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        emit_error(str(e))
        sys.exit(1)
