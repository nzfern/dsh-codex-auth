/**
 * dsh-codex-auth — run the DeepSeek Harness on a ChatGPT (Plus/Pro/Team/
 * Enterprise) subscription through the Codex backend.
 *
 * The wire adapter for the `openai-codex` provider already ships inside the
 * harness (`dsh-llm-pi-ai` + pi-ai's openai-codex catalog provider), which
 * authenticates with a bearer access token against
 * `https://chatgpt.com/backend-api`. What it cannot do is obtain or keep that
 * token alive: its credential seam only resolves stored API keys.
 *
 * This plugin supplies the missing OAuth lifecycle:
 *
 * - a device-code login flow (exposed as `/codex-login` and the
 *   `dsh-codex-login` CLI) that stores a durable refresh token in the harness
 *   credential store;
 * - automatic access-token refresh: on boot and on a configurable interval,
 *   the stored access token is exchanged for a fresh one before it expires;
 * - `/codex-status` and `/codex-logout` for inspection and sign-out.
 *
 * Once logged in, configure the provider in `$DSH_HOME/settings.yaml`:
 *
 * ```yaml
 * llm-pi-ai:
 *   providers:
 *     openai-codex:
 *       apiKeyEnv: OPENAI_CODEX_ACCESS_TOKEN
 * ```
 *
 * and pick a Codex model (gpt-5.4, gpt-5.5, …) in the web model picker.
 *
 * @module dsh-codex-auth
 */
import z from "@deepseek-ai/schemastery";
import { LlmError } from "@deepseek-ai/dsh-llm";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import {
	CLIENT_ID,
	DEVICE_VERIFICATION_URI,
	DEVICE_TIMEOUT_SECONDS,
	accessTokenExpiry,
	accountIdOf,
	exchangeDeviceCode,
	formatTime,
	isInvalidGrant,
	pollDeviceCode,
	refreshTokens,
	requestDeviceCode
} from "./codex.js";
import { CodexLoginService } from "./login-service.js";

/** Plugin short name; also the settings namespace key. */
const name = "codex-auth";
const inject = ["llm", "timer"];
const NS = settingsNamespace("codex-auth");

/** The provider route this plugin keeps authenticated (pi-ai catalog id). */
const PROVIDER = "openai-codex";

const Config = z.object({
	clientId: z.string().default(CLIENT_ID),
	accessTokenRef: z.string().role("credential-ref").default("OPENAI_CODEX_ACCESS_TOKEN"),
	refreshTokenRef: z.string().role("credential-ref").default("OPENAI_CODEX_REFRESH_TOKEN"),
	refreshMarginMs: z.number().min(0).default(5 * 60 * 1000),
	refreshIntervalMs: z.number().min(1000).default(30 * 1000),
	deviceTimeoutSeconds: z.number().min(60).default(DEVICE_TIMEOUT_SECONDS)
});

/**
 * Credential access over the harness seam with an environment fallback,
 * mirroring how the shipped adapters resolve references. Writes go through
 * the managed credential store (hot-reloaded by the local provider), so a
 * token refresh reaches the very next provider request without a restart.
 */
class TokenStore {
	constructor(ctx, options) {
		this.ctx = ctx;
		this.options = options; // () => resolved config snapshot
		this.inFlight = undefined;
	}

	async read(ref) {
		const credentials = this.ctx.get("credentials");
		if (credentials !== undefined) {
			const hit = await credentials.resolve(credentialRef(ref));
			if (hit !== undefined && hit.value.length > 0) return hit.value;
		}
		const ambient = launchEnvironmentOf(this.ctx).get(ref);
		return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined;
	}

	async write(ref, value) {
		const credentials = this.ctx.get("credentials");
		if (credentials === undefined) return false;
		try {
			await credentials.set(credentialRef(ref), value);
			return true;
		} catch (error) {
			this.ctx.logger.warn(`codex-auth: could not store ${ref} (an exported environment value shadows writes): %s`, error?.message ?? String(error));
			return false;
		}
	}

	async unset(ref) {
		const credentials = this.ctx.get("credentials");
		if (credentials === undefined) return;
		try {
			await credentials.unset(credentialRef(ref));
		} catch (error) {
			this.ctx.logger.warn(`codex-auth: could not remove ${ref}: %s`, error?.message ?? String(error));
		}
	}

	async accessToken() {
		return this.read(this.options().accessTokenRef);
	}

	async refreshToken() {
		return this.read(this.options().refreshTokenRef);
	}

	fresh(token) {
		const expiresAt = accessTokenExpiry(token);
		return expiresAt !== undefined && expiresAt - Date.now() > this.options().refreshMarginMs;
	}

	/**
	 * Ensure a fresh access token is stored, refreshing from the refresh token
	 * when the stored one is missing or about to expire. Returns the fresh
	 * token, or `undefined` when no login exists (quiet — not an error at the
	 * keep-alive layer). Concurrent callers share one refresh.
	 */
	async ensureFresh() {
		const access = await this.accessToken();
		if (access !== undefined && this.fresh(access)) return access;
		if (this.inFlight !== undefined) return this.inFlight;
		this.inFlight = this.doRefresh();
		try {
			return await this.inFlight;
		} finally {
			this.inFlight = undefined;
		}
	}

	async doRefresh() {
		const refresh = await this.refreshToken();
		if (refresh === undefined) return undefined;
		try {
			const tokens = await refreshTokens(refresh, this.options().clientId);
			await this.write(this.options().accessTokenRef, tokens.access_token);
			if (tokens.refresh_token !== undefined) await this.write(this.options().refreshTokenRef, tokens.refresh_token);
			this.ctx.logger.info("codex-auth: access token refreshed (expires %s)", formatTime(tokens.expiresAt));
			return tokens.access_token;
		} catch (error) {
			if (isInvalidGrant(error)) {
				await this.unset(this.options().accessTokenRef);
				await this.unset(this.options().refreshTokenRef);
				this.ctx.logger.warn("codex-auth: ChatGPT login was revoked or expired; re-run /codex-login");
			}
			throw new LlmError(
				`codex-auth: ChatGPT login could not be refreshed (${error?.message ?? String(error)}); re-run /codex-login`,
				"AUTH",
				{ cause: error }
			);
		}
	}

	/** Persist a completed login's tokens. */
	async storeLogin(tokens) {
		await this.write(this.options().accessTokenRef, tokens.access_token);
		if (tokens.refresh_token !== undefined) await this.write(this.options().refreshTokenRef, tokens.refresh_token);
	}

	async clearLogin() {
		await this.unset(this.options().accessTokenRef);
		await this.unset(this.options().refreshTokenRef);
	}
}

/**
 * One in-flight device-code login shared by command handlers, so a second
 * `/codex-login` cannot start while the first is waiting for authorization.
 */
function createLoginManager() {
	let active = false;
	return {
		start() {
			if (active) {
				return {
					ok: false,
					result: { kind: "error", text: "已有登录流程正在进行中;完成或等待其超时后再试。" }
				};
			}
			active = true;
			return { ok: true };
		},
		finish() {
			active = false;
		},
		get inProgress() {
			return active;
		}
	};
}

function apply(ctx, config) {
	let current = () => config;
	let lastRaw;
	let lastGood;
	const options = () => {
		const raw = current();
		if (raw === lastRaw && lastGood !== undefined) return lastGood;
		const next = {
			clientId: raw.clientId ?? CLIENT_ID,
			accessTokenRef: raw.accessTokenRef ?? "OPENAI_CODEX_ACCESS_TOKEN",
			refreshTokenRef: raw.refreshTokenRef ?? "OPENAI_CODEX_REFRESH_TOKEN",
			refreshMarginMs: raw.refreshMarginMs ?? 5 * 60 * 1000,
			refreshIntervalMs: raw.refreshIntervalMs ?? 30 * 1000,
			deviceTimeoutSeconds: raw.deviceTimeoutSeconds ?? DEVICE_TIMEOUT_SECONDS
		};
		lastRaw = raw;
		lastGood = next;
		return next;
	};
	options();

	const store = new TokenStore(ctx, options);
	const loginManager = createLoginManager();
	const loginService = new CodexLoginService(store, options);

	// Web UI channel: expose login/status/logout on the shared /api route so
	// the client plugin's button can drive the device-code flow. Loopback-only.
	// The connection service mounts later in the web tree, so wait for it via
	// inject rather than reading ctx.get("connection") at apply time.
	ctx.inject(["connection"], (sctx) => {
		sctx.connection.rpc.intercept("/api", (endpoint) => endpoint === "codex.login" || endpoint === "codex.status" || endpoint === "codex.logout", (endpoint, _payload, _signal) => {
			switch (endpoint) {
				case "codex.login": return loginService.start();
				case "codex.status": return loginService.status();
				case "codex.logout": return loginService.logout();
				default: return Promise.resolve({ ok: false, error: { code: "method-not-found", message: `unknown codex endpoint ${endpoint}` } });
			}
		}, { authority: "loopback" });
	});

	/** Best-effort keep-alive; failures are logged, never thrown upward. */
	const keepAlive = () => {
		void store.ensureFresh().catch((error) => {
			ctx.logger.warn("codex-auth: token refresh failed: %s", error?.message ?? String(error));
		});
	};

	// Refresh immediately at boot when the stored token is stale, then keep it
	// fresh on an interval. The `llm/stream` waterfall is deliberately NOT
	// used for refresh: its chain is synchronous (the agent loop consumes the
	// stream with `for await`), so an async listener would break dispatch.
	// Both timers are fiber-scoped and dispose with the plugin.
	keepAlive();
	let stopInterval = ctx.setInterval(keepAlive, options().refreshIntervalMs);

	// Configurable settings section (web Models/settings surfaces can adjust
	// the references and margins; a changed interval re-arms the timer).
	installSettingsSection(ctx, NS, Config, config, {
		setSource: (source) => {
			current = source;
		},
		onChange: () => {
			stopInterval();
			stopInterval = ctx.setInterval(keepAlive, options().refreshIntervalMs);
			keepAlive();
		}
	});

	const commands = ctx.get("commands");
	if (commands === undefined) {
		ctx.logger.warn("codex-auth: commands service unavailable; only the dsh-codex-login CLI can authenticate");
	} else {
		commands.register({
			name: "codex-login",
			description: "Log in with a ChatGPT account to use the Codex quota",
			handler: async (invocation) => {
				const started = loginManager.start();
				if (!started.ok) return started.result;
				try {
					const device = await requestDeviceCode(options().clientId);
					const timeoutSeconds = options().deviceTimeoutSeconds;
					void pollDeviceCode(device, {
						signal: invocation.signal,
						timeoutSeconds
					}).then(async (deviceResult) => {
						const tokens = await exchangeDeviceCode(deviceResult, options().clientId);
						await store.storeLogin(tokens);
						const accountId = accountIdOf(tokens.access_token);
						ctx.logger.info("codex-auth: logged in as %s", accountId ?? "unknown account");
					}).catch((error) => {
						if (invocation.signal.aborted) return;
						ctx.logger.warn("codex-auth: login failed: %s", error?.message ?? String(error));
					}).finally(() => {
						loginManager.finish();
					});
					return {
						kind: "success",
						text: [
							"ChatGPT (Codex) 登录",
							"",
							`1. 打开: ${DEVICE_VERIFICATION_URI}`,
							`2. 输入代码: ${device.userCode}`,
							"3. 用你的 ChatGPT 账号登录并授权",
							"",
							"后台正在等待授权(约 15 分钟内有效),完成后可用 /codex-status 确认。"
						].join("\n")
					};
				} catch (error) {
					loginManager.finish();
					return { kind: "error", text: `登录失败: ${error?.message ?? String(error)}` };
				}
			}
		});

		commands.register({
			name: "codex-status",
			description: "Show the ChatGPT Codex login state",
			handler: async () => {
				const access = await store.accessToken();
				const refresh = await store.refreshToken();
				if (refresh === undefined && access === undefined) {
					return {
						kind: "success",
						text: "尚未登录 ChatGPT。运行 /codex-login(或 dsh-codex-login)开始登录。"
					};
				}
				const accountId = access === undefined ? undefined : accountIdOf(access);
				const expiresAt = access === undefined ? undefined : accessTokenExpiry(access);
				const lines = [
					"ChatGPT (Codex) 登录状态",
					`账号: ${accountId ?? (refresh !== undefined ? "已登录(等待刷新 access token)" : "未知")}`,
					`refresh token: ${refresh !== undefined ? "已保存" : "未保存"}`,
					`access token: ${access !== undefined ? "已保存" : "未保存"}`,
					`access token 过期: ${formatTime(expiresAt)}`
				];
				if (loginManager.inProgress) lines.push("状态: 正在等待授权…");
				return { kind: "success", text: lines.join("\n") };
			}
		});

		commands.register({
			name: "codex-logout",
			description: "Sign out of ChatGPT and clear the stored Codex tokens",
			handler: async () => {
				await store.clearLogin();
				return { kind: "success", text: "已退出登录,Codex tokens 已清除。" };
			}
		});
	}
}

export { Config, PROVIDER, apply, inject, name };
