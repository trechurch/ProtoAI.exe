@echo off
setlocal

REM Resolve node.exe relative to this script's location:
REM Script is at C:\ProtoAI.exe\cli\claude-select.cmd
REM Node sidecar:    C:\ProtoAI.exe\tauri-app\src-tauri\binaries\node-x86_64-pc-windows-msvc.exe

set SCRIPT_PATH=%~dp0claude-select.cjs
set NODE_PATH=%~dp0..\tauri-app\src-tauri\binaries\node-x86_64-pc-windows-msvc.exe

REM Fallback: use node from PATH if sidecar not found
if not exist "%NODE_PATH%" set NODE_PATH=node

"%NODE_PATH%" "%SCRIPT_PATH%" %*

endlocal
