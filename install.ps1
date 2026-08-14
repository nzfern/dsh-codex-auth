# dsh-codex-auth — one-line installer for the DeepSeek Harness
#
# Usage (PowerShell):
#   Set-ExecutionPolicy -Scope Process Bypass; iex (irm https://raw.githubusercontent.com/NZFERN/dsh-codex-auth/main/install.ps1)
#
# Or after cloning the repo:
#   powershell -ExecutionPolicy Bypass -File install.ps1
#
# What it does:
#   1. Ensures pnpm is available (installs it via npm if missing).
#   2. Installs dsh-codex-auth into the `web` profile as an out-of-tree plugin
#      (registers the bundle layer in dsh.profile.bundles).
#   3. Activates the `openai-codex` provider in $DSH_HOME/settings.yaml
#      (apiKeyEnv: OPENAI_CODEX_ACCESS_TOKEN) without clobbering other
#      providers.
#   4. Tells you to restart `dsh web`.
param(
    [string]$Profile = "web",
    [switch]$SkipPnpm
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Err($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red }
function Write-Ok($msg) { Write-Host "OK: $msg" -ForegroundColor Green }

# --- 1. pnpm ---------------------------------------------------------------
if (-not $SkipPnpm) {
    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        Write-Step "pnpm not found; installing via npm..."
        npm install -g pnpm
        if ($LASTEXITCODE -ne 0) { Write-Err "npm install -g pnpm failed"; exit 1 }
        # refresh PATH for this session
        $env:PATH = "$env:APPDATA\npm;$env:PATH"
    } else {
        Write-Ok "pnpm $(pnpm --version)"
    }
}

# --- 2. resolve the dsh CLI ------------------------------------------------
$dsh = Get-Command dsh -ErrorAction SilentlyContinue
if (-not $dsh) {
    Write-Err "dsh CLI not found on PATH. Install DeepSeek Harness first (npx @deepseek-ai/dsh)."
    exit 1
}
Write-Ok "dsh: $($dsh.Source)"

# --- 3. install the plugin into the profile --------------------------------
# The repo checkout is the directory this script lives in.
$repoRoot = $PSScriptRoot
if (-not $repoRoot) { $repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path }

Write-Step "Installing dsh-codex-auth into profile '$Profile' (this may take a while)..."
dsh plugin --profile $Profile add $repoRoot
if ($LASTEXITCODE -ne 0) { Write-Err "dsh plugin add failed (exit $LASTEXITCODE)"; exit 1 }
Write-Ok "plugin dependency installed and bundle registered"

# --- 4. activate the openai-codex provider in settings.yaml ----------------
$home = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE ".dsh" }
$settingsPath = Join-Path $home "settings.yaml"
$providerBlock = "    openai-codex:`n      apiKeyEnv: OPENAI_CODEX_ACCESS_TOKEN"

Write-Step "Configuring $settingsPath ..."
$content = ""
if (Test-Path $settingsPath) { $content = Get-Content $settingsPath -Raw -Encoding utf8 }

# Insert the llm-pi-ai / providers skeleton when absent, then the profile.
if ($content -notmatch "(?m)^llm-pi-ai:\s*$") {
    $content += "`nllm-pi-ai:`n  providers:`n"
}
if ($content -notmatch "(?m)^llm-pi-ai:\s*$") {
    # providers skeleton also missing
    $content = $content -replace "(?m)^llm-pi-ai:\s*$", "llm-pi-ai:`n  providers:"
}
if ($content -notmatch "openai-codex") {
    $content = $content -replace "(?m)^(llm-pi-ai:\s*$)", "llm-pi-ai:`n  providers:`n$providerBlock"
    if ($content -notmatch "openai-codex") {
        # providers section already existed under llm-pi-ai: append under it
        $content = $content -replace "(?m)^  providers:\s*$", "  providers:`n$providerBlock"
    }
}
# Defensive: if still absent (unusual layout), append the whole section.
if ($content -notmatch "openai-codex") {
    $content += "`nllm-pi-ai:`n  providers:`n$providerBlock`n"
}
Set-Content -Path $settingsPath -Value $content -Encoding utf8 -NoNewline
Write-Ok "openai-codex provider activated in settings.yaml"

# --- 5. done ---------------------------------------------------------------
Write-Host ""
Write-Host "Install complete!" -ForegroundColor Green
Write-Host "Next steps:"
Write-Host "  1. Restart your harness server: stop 'dsh web' and run it again (e.g. 'dsh web --port 3080')."
Write-Host "  2. Log in once with your ChatGPT account (needs Plus/Pro/Team/Enterprise):"
Write-Host "     - In the UI, run the '/codex-login' command, or"
Write-Host "     - From a terminal: node `"$repoRoot\bin\codex-login.mjs`""
Write-Host "  3. Pick an openai-codex model (gpt-5.4, gpt-5.5, ...) in the model picker."
