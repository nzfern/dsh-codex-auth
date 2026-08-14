# dsh-codex-auth

用 **ChatGPT 账号(Plus / Pro / Team / Enterprise)的 Codex 额度**在 DeepSeek Harness 里跑模型的认证插件。

## 原理

Harness 自带的 `dsh-llm-pi-ai`(底层 pi-ai 库)已经内置了完整的 `openai-codex` provider:它把请求发到
`https://chatgpt.com/backend-api/codex/responses`,只需要一个 **ChatGPT 的 access token** 作为 Bearer 凭证。
但它不会登录、也不会续期 token(access token 约 10 分钟就过期)。

`dsh-codex-auth` 补齐 OAuth 生命周期:

- **登录**:设备码流(和官方 Codex CLI 相同),得到长期有效的 refresh token,存入 Harness 凭据库
  (`$DSH_HOME/.credentials.yaml`,web 服务热加载,无需重启);
- **续期**:启动时和每隔 30 秒检查 access token,临近过期就自动用 refresh token 换新的;
- 配套 `/codex-login`、`/codex-status`、`/codex-logout` 命令和独立 CLI 脚本。

## 安装

1. 把本目录(`dsh-codex-auth`)放到 profile 的插件目录,并注册为 bundle(见下文"接入 web profile");
2. 在 `$DSH_HOME/settings.yaml` 里激活 provider:

```yaml
llm-pi-ai:
  providers:
    openai-codex:
      apiKeyEnv: OPENAI_CODEX_ACCESS_TOKEN
```

3. 重启 `dsh web`。

## 登录

网页端:在输入框输入 `/codex-login`,按提示打开 `https://auth.openai.com/codex/device` 输入显示在结果里的代码,用你的 ChatGPT 账号授权。

或终端(推荐,能看到完整流程):

```powershell
node "$env:USERPROFILE\.dsh\profiles\web\node_modules\dsh-codex-auth\bin\codex-login.mjs"
```

完成后:

```powershell
node "$env:USERPROFILE\.dsh\profiles\web\node_modules\dsh-codex-auth\bin\codex-status.mjs"
```

## 使用

登录后刷新页面,在模型选择器里选 Codex 模型,例如:

- `gpt-5.4` / `gpt-5.4-mini`(支持图片输入)
- `gpt-5.5` / `gpt-5.6-luna` / `gpt-5.6-sol` / `gpt-5.6-terra`
- `gpt-5.3-codex-spark`

provider 显示为 **openai-codex**(ChatGPT)。模型列表由 pi-ai 目录提供,自动随依赖更新。

## 常见问题

- **要求订阅**:Codex 需要 ChatGPT Plus / Pro / Team / Enterprise 账号(免费版额度极少或不可用)。
- **遇到 usage limit**:ChatGPT 有速率/用量限制,错误信息会提示多久后再试。
- **登录失效**:如果 refresh token 被撤销(改密码、登出等),`/codex-status` 会显示未登录,重新 `/codex-login` 即可。
- **端口/环境**:CLI 脚本通过 `DSH_HOME`(默认 `~/.dsh`)定位凭据文件;web 进程内刷新走 Harness 凭据服务,两者读写同一个文件。

## 配置

插件配置见 `cordis.patch.yml` 的 `config`,或 `$DSH_HOME/settings.yaml` 的 `codex-auth:` 节:

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `clientId` | `app_EMoamEEZ73f0CkXaXp7hrann` | OpenAI OAuth 客户端 id(Codex CLI 官方 id) |
| `accessTokenRef` | `OPENAI_CODEX_ACCESS_TOKEN` | access token 的凭据引用 |
| `refreshTokenRef` | `OPENAI_CODEX_REFRESH_TOKEN` | refresh token 的凭据引用 |
| `refreshMarginMs` | `300000` | 提前多少毫秒刷新 access token |
| `refreshIntervalMs` | `30000` | 主动刷新检查间隔 |
| `deviceTimeoutSeconds` | `900` | 设备码有效期 |

## 文件

- `lib/codex.js` — OAuth 协议核心(设备码流 + 刷新),插件与 CLI 共用
- `lib/index.js` — Cordis 插件(token 保活 + `/codex-*` 命令 + settings 节)
- `bin/codex-login.mjs` / `bin/codex-status.mjs` / `bin/codex-logout.mjs` — 独立 CLI
