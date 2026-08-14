# dsh-codex-auth

> Run DeepSeek Harness on your **ChatGPT (Codex) subscription quota** — one-click ChatGPT login in the UI, automatic token refresh, and a live remaining-quota badge.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/nzfern/dsh-codex-auth)](https://github.com/nzfern/dsh-codex-auth/releases)
[![Stars](https://img.shields.io/github/stars/nzfern/dsh-codex-auth)](https://github.com/nzfern/dsh-codex-auth)
[![issues](https://img.shields.io/github/issues/nzfern/dsh-codex-auth)](https://github.com/nzfern/dsh-codex-auth)

**中文版:** [README.zh.md](README.zh.md)

Run models in [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) using your **ChatGPT (Codex) quota** — no OpenAI API key needed. If you have a ChatGPT Plus/Pro/Team/Enterprise subscription, you already have Codex capacity; this plugin lets the Harness use it.

## ✨ Features

| Feature | Description |
| --- | --- |
| 🔑 **One-click ChatGPT login in the UI** | Settings → General card: click "Log in with ChatGPT", authorize in the browser with the device code, done |
| 🔄 **Automatic access-token refresh** | Checks every 30s and swaps a fresh access token from the refresh token before expiry |
| 📊 **Remaining-quota badge** | Passive floating badge (bottom-right) with `Codex remaining xx%` + reset date/time; color-coded green/orange/red; toggleable in settings |
| 📈 **Plan & windows** | Shows your ChatGPT plan (plus/pro/…) and per-window remaining quota (fast window / daily window) via the official WHAM usage endpoint |
| 💻 **CLI** | `codex-login` / `codex-status` / `codex-logout` commands and standalone scripts work without a GUI |

## 📸 Screenshots
<img width="1028" height="980" alt="image" src="https://github.com/user-attachments/assets/e6876200-7539-42a8-b330-94f46c61316f" />


## 🚀 Install (recommended)

```powershell
# 1. Make sure pnpm is available (once)
npm install -g pnpm

# 2. Install the plugin into the web profile (pnpm fetches from GitHub and registers the bundle)
dsh plugin --profile web add github:nzfern/dsh-codex-auth

# 3. Activate the provider and restart
#    Under llm-pi-ai.providers in $DSH_HOME/settings.yaml add:
#      openai-codex:
#        apiKeyEnv: OPENAI_CODEX_ACCESS_TOKEN
#    Then restart dsh web
```

Or run the one-liner installer (installs pnpm, installs the plugin, writes settings.yaml):

```powershell
Set-ExecutionPolicy -Scope Process Bypass; iex (irm https://raw.githubusercontent.com/nzfern/dsh-codex-auth/main/install.ps1)
```

## 🖥️ Manual install

1. Clone/download this repo into the profile's plugin directory and register it as a bundle.
2. Activate the provider in `$DSH_HOME/settings.yaml`:

```yaml
llm-pi-ai:
  providers:
    openai-codex:
      apiKeyEnv: OPENAI_CODEX_ACCESS_TOKEN
```

3. Restart `dsh web`.

## 🔑 Login

**Web UI (recommended)**: after restart, open Settings → General, find "ChatGPT · Codex 额度", click **Log in with ChatGPT** → follow the inline link to `https://auth.openai.com/codex/device`, enter the code and authorize with your ChatGPT account → the card flips to "Connected".

**CLI**:

```powershell
node "$env:USERPROFILE\.dsh\profiles\web\node_modules\dsh-codex-auth\bin\codex-login.mjs"
node "$env:USERPROFILE\.dsh\profiles\web\node_modules\dsh-codex-auth\bin\codex-status.mjs"
```

## 💡 Usage

After logging in, pick an **openai-codex** model in the model picker:

- `gpt-5.4` / `gpt-5.4-mini` (image input supported)
- `gpt-5.5` / `gpt-5.6-luna` / `gpt-5.6-sol` / `gpt-5.6-terra`
- `gpt-5.3-codex-spark`

The model list comes from pi-ai's catalog and updates with the dependency.

## ⚙️ How it works

The Harness ships the `openai-codex` provider inside `dsh-llm-pi-ai` (pi-ai), which talks to
`https://chatgpt.com/backend-api/codex/responses` with a **ChatGPT access token** as the bearer credential —
but it cannot log in or keep the token alive (access tokens expire in ~10 minutes). This plugin fills in the OAuth lifecycle:

- **Device-code login flow** (same as the official Codex CLI); the refresh token is stored in the Harness credential store and hot-reloaded by the web service;
- **Auto-refresh**: on boot and every 30s, exchange the refresh token for a fresh access token;
- **Quota**: read plan type and window remaining from `chatgpt.com/backend-api/wham/usage`.

## ❓ FAQ

- **Requires a subscription**: Codex needs ChatGPT Plus / Pro / Team / Enterprise (free tier gets little to none).
- **Usage limit errors**: ChatGPT rate-limits Codex usage; the error tells you when to retry.
- **Login invalidated**: if the refresh token is revoked (password change, sign-out elsewhere), `/codex-status` shows logged out; just log in again.
- **Badge missing**: toggle "在主页面显示用量" off in Settings → General; or you're logged out / the usage endpoint is unavailable.
- **Configuration**: the `codex-auth:` section in `$DSH_HOME/settings.yaml` can tune clientId, credential refs, refresh interval, etc.

## 📦 Files

- `lib/codex.js` — OAuth protocol core (device flow, refresh, WHAM usage query)
- `lib/index.js` — host plugin (token keep-alive, `/api/codex.*` endpoints, commands)
- `lib/client.js` — browser plugin (settings login card, floating quota badge)
- `bin/codex-login.mjs` / `bin/codex-status.mjs` / `bin/codex-logout.mjs` — CLI

## 🤝 Support & Contributing

- Bugs → [Issues](https://github.com/nzfern/dsh-codex-auth/issues)
- Ideas → [Discussions](https://github.com/nzfern/dsh-codex-auth/discussions)
- Like it? Give it a ⭐ so more people can use their Codex quota!
