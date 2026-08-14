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

	/** Cancel an in-flight login (plugin dispose). */
	dispose() {
		this.active = undefined;
	}
}

/** Format helpers the client-facing status can reuse. */
export { formatTime };
