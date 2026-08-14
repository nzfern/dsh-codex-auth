# dsh-codex-auth

> 用 **ChatGPT 账号(Plus / Pro / Team / Enterprise)的 Codex 额度**在 DeepSeek Harness 里跑模型,无需 OpenAI API key。

**English:** [README.md](README.md)

## ✨ 功能

| 功能 | 说明 |
| --- | --- |
| 🔑 **UI 一键登录** | 设置 → General 的登录卡片,点"用 ChatGPT 登录",内联显示验证链接 + 授权代码,浏览器授权后自动完成 |
| 🔄 **Access token 自动续期** | 每 30 秒检查,临近过期自动用 refresh token 换新 |
| 📊 **余量悬浮徽标** | 主页面右下角小徽标常驻显示 `Codex 余量 xx%` + 重置日期时间,颜色提示余量健康度,可在设置中开关 |
| 📈 **订阅计划与窗口** | 通过官方 WHAM 接口显示 ChatGPT 订阅计划(plus/pro…)与限流窗口(快速/每日)的剩余量 |
| 💻 **CLI 支持** | `codex-login` / `codex-status` / `codex-logout` 命令与独立脚本,无 GUI 环境也能登录 |

## 📸 截图

*(欢迎贡献截图:设置页登录卡片、右下角余量徽标、模型选择器中的 openai-codex)*

## 🚀 一键安装(推荐)

```powershell
# 1. 确保 pnpm 可用(只需要一次)
npm install -g pnpm

# 2. 安装插件到 web profile(pnpm 自动从 GitHub 拉取并注册 bundle)
dsh plugin --profile web add github:nzfern/dsh-codex-auth

# 3. 激活 provider 并重启
#    在 $DSH_HOME/settings.yaml 的 llm-pi-ai.providers 下加入:
#      openai-codex:
#        apiKeyEnv: OPENAI_CODEX_ACCESS_TOKEN
#    然后重启 dsh web
```

或一条命令(自动装 pnpm + 装插件 + 写 settings.yaml):

```powershell
Set-ExecutionPolicy -Scope Process Bypass; iex (irm https://raw.githubusercontent.com/nzfern/dsh-codex-auth/main/install.ps1)
```

## 🖥️ 手动安装

1. 克隆/下载本仓库到 profile 的插件目录,并注册为 bundle;
2. 在 `$DSH_HOME/settings.yaml` 里激活 provider:

```yaml
llm-pi-ai:
  providers:
    openai-codex:
      apiKeyEnv: OPENAI_CODEX_ACCESS_TOKEN
```

3. 重启 `dsh web`。

## 🔑 登录

**网页端(推荐)**:重启后打开 设置 → General,找到 "ChatGPT · Codex 额度",点 **用 ChatGPT 登录** → 按内联提示打开 `https://auth.openai.com/codex/device` 输入代码并用 ChatGPT 账号授权 → 卡片变为"已连接"。

**命令行**:

```powershell
node "$env:USERPROFILE\.dsh\profiles\web\node_modules\dsh-codex-auth\bin\codex-login.mjs"
node "$env:USERPROFILE\.dsh\profiles\web\node_modules\dsh-codex-auth\bin\codex-status.mjs"
```

## 💡 使用

登录后,在模型选择器里选 **openai-codex** 下的模型:

- `gpt-5.4` / `gpt-5.4-mini`(支持图片输入)
- `gpt-5.5` / `gpt-5.6-luna` / `gpt-5.6-sol` / `gpt-5.6-terra`
- `gpt-5.3-codex-spark`

模型列表由 pi-ai 目录提供,自动随依赖更新。

## ⚙️ 原理

Harness 自带的 `dsh-llm-pi-ai`(底层 pi-ai 库)已内置 `openai-codex` provider(请求发往
`https://chatgpt.com/backend-api/codex/responses`),只需要一个 **ChatGPT access token** 作为 Bearer 凭证,
但它不负责登录和续期(access token 约 10 分钟过期)。本插件补齐 OAuth 生命周期:

- **设备码登录流**(与官方 Codex CLI 相同),refresh token 存入 Harness 凭据库,web 服务热加载;
- **自动续期**:启动时 + 每 30 秒检查,用 refresh token 换新 access token;
- **额度查询**:通过 `chatgpt.com/backend-api/wham/usage` 读取订阅计划与限流窗口余量。

## ❓ 常见问题

- **要求订阅**:Codex 需要 ChatGPT Plus / Pro / Team / Enterprise 账号(免费版额度极少或不可用)。
- **遇到 usage limit**:ChatGPT 有速率/用量限制,错误信息会提示多久后再试。
- **登录失效**:refresh token 被撤销(改密码、登出等)后 `/codex-status` 显示未登录,重新登录即可。
- **余量徽标不见了**:设置 → General → "在主页面显示用量" 取消勾选了;或未登录/额度接口不可用。
- **配置**:`$DSH_HOME/settings.yaml` 的 `codex-auth:` 节可调 clientId、凭据引用、刷新间隔等。

## 📦 文件

- `lib/codex.js` — OAuth 协议核心(设备码流 + 刷新 + WHAM 额度查询)
- `lib/index.js` — 后端插件(token 保活、`/api/codex.*` 端点、命令)
- `lib/client.js` — 前端插件(设置页登录卡片、右下角余量徽标)
- `bin/codex-login.mjs` / `bin/codex-status.mjs` / `bin/codex-logout.mjs` — CLI

## 🤝 支持与贡献

- 遇到问题 → [Issues](https://github.com/nzfern/dsh-codex-auth/issues)
- 想法与讨论 → [Discussions](https://github.com/nzfern/dsh-codex-auth/discussions)
- 喜欢就点个 ⭐,让更多人能用上 Codex 额度!
