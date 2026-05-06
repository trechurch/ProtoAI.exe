@echo off
echo Configuring Claude CLI for Anthropic...

:: Clear the custom base URL (uses default Anthropic endpoint)
reg delete "HKCU\Environment" /F /V ANTHROPIC_BASE_URL >nul 2>&1

:: Set your Anthropic API Key
setx ANTHROPIC_API_KEY "YOUR_ANTHROPIC_KEY"

:: Remove the experimental beta flag restriction
reg delete "HKCU\Environment" /F /V CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS >nul 2>&1

echo Configuration set! Please close and reopen your terminal for changes to take effect.
pause