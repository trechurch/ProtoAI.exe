setx ANTHROPIC_API_KEY ""
setx ANTHROPIC_MODEL "deepseek/deepseek-r1"

@echo off
echo Configuring Claude CLI for OpenRouter...

:: Set the OpenRouter API endpoint
setx ANTHROPIC_BASE_URL "https://openrouter.ai/api/v1"

:: Set your OpenRouter API Key
setx ANTHROPIC_API_KEY "YOUR_OPENROUTER_KEY_HERE"

setx ANTHROPIC_MODEL "nvidia/nemotron-nano-9b-v2:free"

:: Disable experimental features that often break proxies
setx CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS "1"

echo Configuration set! Please close and reopen your terminal for changes to take effect.
pause