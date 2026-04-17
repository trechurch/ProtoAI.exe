@echo off
setlocal

REM ProtoAI File Permissions CLI
REM Usage: file-permissions <command> --project <name> [options]

set SCRIPT_PATH=%~dp0permissions.js
set NODE_PATH=%~dp0..\..\tauri-app\src-tauri\binaries\node-x86_64-pc-windows-msvc.exe

REM Fallback: use node from PATH if sidecar not found
if not exist "%NODE_PATH%" set NODE_PATH=node

"%NODE_PATH%" "%SCRIPT_PATH%" %*

endlocal
