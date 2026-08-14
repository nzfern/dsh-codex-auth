/**
 * Codex login service — device-code login lifecycle for the web UI.
 *
 * The host plugin exposes three endpoints on the shared `/api` channel
 * (`codex.login`, `codex.status`, `codex.logout`) so the client plugin's
 * login button can drive the same OAuth flow as the CLI, without the client
 * ever touching a secret: the service returns a verification URL + code, runs
 * the device-code poll in the background, and stores the resulting tokens
 * through the harness credential seam.
 *
 * @module dsh-codex-auth/login-service
 */
import {
	DEVICE_VERIFICATION_URI,
	DEVICE_TIMEOUT_SECONDS,
	accessTokenExpiry,
	accountIdOf,
	exchangeDeviceCode,
	formatTime,
	pollDeviceCode,
	requestDeviceCode
} from "./codex.js";

/** One in-flight or settled login attempt, keyed to the running process. */
export class CodexLoginService {
	constructor(store, options) {
		this.store = store;
		this.options = options; // () => ({ clientId, deviceTimeoutSeconds })
		this.active = undefined; // { device, status, timer, startedAt }
	}

	/**
	 * Start a device-code login. Returns the verification facts immediately;
	 * the poll runs in the background and stores tokens on success.
	 */
	async start() {
		if (this.active !== undefined) {
			return {
				ok: false,
				error: { code: "login-in-progress", message: "已有登录流程正在进行中,请先完成或等待其超时。" }
			};
		}
		const { clientId, deviceTimeoutSeconds } = this.options();
		const device = await requestDeviceCode(clientId);
		const record = {
			device,
			status: "waiting",
			startedAt: Date.now(),
			error: undefined
		};
		this.active = record;
		void this.poll(record);
		return {
			ok: true,
			value: {
				verificationUri: DEVICE_VERIFICATION_URI,
				userCode: device.userCode,
				intervalSeconds: device.intervalSeconds,
				expiresInSeconds: deviceTimeoutSeconds
			}
		};
	}

	/** Poll one device record to completion, then publish the outcome. */
	async poll(record) {
		const { clientId, deviceTimeoutSeconds } = this.options();
		try {
			const deviceResult = await pollDeviceCode(record.device, {
				timeoutSeconds: deviceTimeoutSeconds,
				onStatus: (line) => {
					record.statusLine = line;
				}
			});
			const tokens = await exchangeDeviceCode(deviceResult, clientId);
			await this.store.storeLogin(tokens);
			record.status = "done";
			record.accountId = accountIdOf(tokens.access_token);
			record.accessExpiresAt = accessTokenExpiry(tokens.access_token);
		} catch (error) {
			record.status = "error";
			record.error = error?.message ?? String(error);
		} finally {
			this.active = undefined;
		}
	}

	/** Snapshot for the status endpoint; never includes secrets. */
	async status() {
		const access = await this.store.accessToken();
		const refresh = await this.store.refreshToken();
		const loggedIn = refresh !== undefined || access !== undefined;
		const inProgress = this.active !== undefined;
		const value = {
			loggedIn,
			loginInProgress: inProgress
		};
		if (this.active !== undefined) {
			value.userCode = this.active.device.userCode;
			value.verificationUri = DEVICE_VERIFICATION_URI;
			value.status = this.active.status;
			value.statusLine = this.active.statusLine;
		}
		if (access !== undefined) {
			value.accountId = accountIdOf(access);
			value.accessTokenExpiresAt = accessTokenExpiry(access);
		}
		if (this.active?.status === "error") value.error = this.active.error;
		return { ok: true, value };
	}

	/** Clear the stored tokens; an in-flight login keeps running. */
	async logout() {
		await this.store.clearLogin();
		return { ok: true, value: {} };
	}

	/**
	 * Query the ChatGPT WHAM usage endpoint for the current subscription's
	 * Codex quota windows. Soft-fails: any problem reports `available: false`
	 * with a reason instead of rejecting, so the UI can keep showing the login
	 * state even when the usage endpoint is unreachable or changed.
	 */
	async usage() {
		const access = await this.store.accessToken();
		if (access === undefined) {
			return { ok: true, value: { available: false, reason: "not-logged-in" } };
		}
		const accountId = accountIdOf(access);
		const headers = {
			authorization: `Bearer ${access}`,
			accept: "application/json"
		};
		if (accountId !== undefined) headers["chatgpt-account-id"] = accountId;
		try {
			const response = await fetch("https://chatgpt.com/backend-api/wham/usage", { method: "GET", headers });
			if (!response.ok) {
				return { ok: true, value: { available: false, reason: `HTTP ${response.status}` } };
			}
			const json = await response.json();
			const window = (raw) => {
				if (raw === undefined || typeof raw !== "object" || raw === null) return undefined;
				if (typeof raw.used_percent !== "number") return undefined;
				const out = { usedPercent: Math.max(0, Math.min(100, raw.used_percent)) };
				if (typeof raw.limit_window_seconds === "number") out.windowMinutes = Math.round(raw.limit_window_seconds / 60);
				if (typeof raw.reset_at === "number" && Number.isFinite(raw.reset_at)) out.resetsAt = Math.round(raw.reset_at * 1000);
				return out;
			};
			const primary = window(json?.rate_limit?.primary_window);
			const secondary = window(json?.rate_limit?.secondary_window);
			if (primary === undefined && secondary === undefined) {
				return { ok: true, value: { available: false, reason: "no-rate-limit-windows" } };
			}
			return {
				ok: true,
				value: {
					available: true,
					...(typeof json?.plan_type === "string" ? { planType: json.plan_type } : {}),
					...(primary !== undefined ? { primary } : {}),
					...(secondary !== undefined ? { secondary } : {})
				}
			};
		} catch (error) {
			return { ok: true, value: { available: false, reason: error?.message ?? String(error) } };
		}
	}

	/** Cancel an in-flight login (plugin dispose). */
	dispose() {
		this.active = undefined;
	}
}

/** Format helpers the client-facing status can reuse. */
export { formatTime };
