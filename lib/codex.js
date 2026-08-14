/**
 * OpenAI Codex (ChatGPT OAuth) protocol core.
 *
 * This module implements the two halves of using a ChatGPT (Plus/Pro/Team/
 * Enterprise) subscription through the Codex backend, mirroring the flow the
 * official Codex CLI and pi-ai's openai-codex provider use:
 *
 * 1. Login: device-code flow against auth.openai.com that yields a durable
 *    refresh token (and a first access token).
 * 2. Refresh: exchange the refresh token for a fresh short-lived access
 *    token, which is what the `chatgpt.com/backend-api` responses endpoint
 *    accepts as a bearer credential.
 *
 * Both the in-process plugin (commands, token keep-alive) and the standalone
 * CLI scripts share this module.
 *
 * @module dsh-codex-auth/codex
 */

/** Official Codex client application id (the one the Codex CLI registers). */
export const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

export const AUTH_BASE_URL = "https://auth.openai.com";
export const TOKEN_URL = `${AUTH_BASE_URL}/oauth/token`;
export const DEVICE_USER_CODE_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`;
export const DEVICE_TOKEN_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/token`;
/** Page the user must open to enter the device code. */
export const DEVICE_VERIFICATION_URI = `${AUTH_BASE_URL}/codex/device`;
/** Redirect URI the device flow hands back with its authorization code. */
export const DEVICE_REDIRECT_URI = `${AUTH_BASE_URL}/deviceauth/callback`;
/** Hard ceiling for how long a device code stays valid. */
export const DEVICE_TIMEOUT_SECONDS = 15 * 60;

/** JWT claim path carrying the ChatGPT account id. */
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

/** Decode a JWT payload without verifying its signature. */
export function decodeJwt(token) {
	if (typeof token !== "string") return null;
	const parts = token.split(".");
	if (parts.length !== 3) return null;
	try {
		const payload = parts[1] ?? "";
		const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
		const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
		return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
	} catch {
		return null;
	}
}

/** Milliseconds until a JWT access token expires; undefined when unreadable. */
export function accessTokenExpiry(token) {
	const payload = decodeJwt(token);
	const exp = payload?.exp;
	return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : undefined;
}

/** The ChatGPT account id embedded in an access token, when present. */
export function accountIdOf(token) {
	const payload = decodeJwt(token);
	const auth = payload?.[JWT_CLAIM_PATH];
	const id = auth?.chatgpt_account_id;
	return typeof id === "string" && id.length > 0 ? id : undefined;
}

/** Render a millisecond timestamp for humans. */
export function formatTime(ms) {
	if (ms === undefined) return "unknown";
	return new Date(ms).toLocaleString();
}

/** One device-code challenge from the auth server. */
export async function requestDeviceCode(clientId = CLIENT_ID) {
	const response = await fetch(DEVICE_USER_CODE_URL, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ client_id: clientId })
	});
	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`device code request failed (HTTP ${response.status}): ${text || response.statusText}`);
	}
	const json = await response.json();
	const intervalSeconds = typeof json?.interval === "string" ? Number(json.interval.trim()) : json?.interval;
	if (!json?.device_auth_id || !json?.user_code || !Number.isFinite(intervalSeconds) || intervalSeconds < 0) {
		throw new Error(`invalid device code response: ${JSON.stringify(json)}`);
	}
	return {
		deviceAuthId: json.device_auth_id,
		userCode: json.user_code,
		intervalSeconds
	};
}

/**
 * Poll the device-code authorization until the user approves or the flow
 * fails. `onStatus` receives human-readable progress lines; the signal can
 * cancel the wait.
 */
export async function pollDeviceCode(device, { signal, timeoutSeconds = DEVICE_TIMEOUT_SECONDS, onStatus } = {}) {
	const started = Date.now();
	const deadline = started + timeoutSeconds * 1000;
	let delayMs = Math.max(device.intervalSeconds * 1000, 1500);
	for (;;) {
		if (signal?.aborted) throw new Error("login cancelled");
		if (Date.now() >= deadline) throw new Error("device code expired; start a new login");
		await sleep(delayMs, signal);
		const response = await fetch(DEVICE_TOKEN_URL, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				device_auth_id: device.deviceAuthId,
				user_code: device.userCode
			})
		});
		if (response.ok) {
			const json = await response.json();
			if (!json?.authorization_code || !json?.code_verifier) {
				throw new Error(`invalid device auth response: ${JSON.stringify(json)}`);
			}
			return { authorizationCode: json.authorization_code, codeVerifier: json.code_verifier };
		}
		if (response.status === 403 || response.status === 404) {
			onStatus?.(`waiting for authorization (code ${device.userCode})…`);
			continue;
		}
		const text = await response.text().catch(() => "");
		let errorCode;
		try {
			errorCode = JSON.parse(text)?.error?.code ?? JSON.parse(text)?.error;
		} catch {
			errorCode = undefined;
		}
		if (errorCode === "deviceauth_authorization_pending") {
			onStatus?.(`waiting for authorization (code ${device.userCode})…`);
			continue;
		}
		if (errorCode === "slow_down") {
			delayMs = Math.min(delayMs * 2, 15000);
			continue;
		}
		throw new Error(`device auth failed (HTTP ${response.status}): ${text || response.statusText}`);
	}
}

/** Exchange a completed device flow for durable tokens. */
export async function exchangeDeviceCode(device, clientId = CLIENT_ID) {
	return readTokenResponse(await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: clientId,
			code: device.authorizationCode,
			code_verifier: device.codeVerifier,
			redirect_uri: DEVICE_REDIRECT_URI
		})
	}), "exchange");
}

/** Refresh a short-lived access token from the durable refresh token. */
export async function refreshTokens(refreshToken, clientId = CLIENT_ID) {
	return readTokenResponse(await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: clientId
		})
	}), "refresh");
}

async function readTokenResponse(response, operation) {
	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`token ${operation} failed (HTTP ${response.status}): ${text || response.statusText}`);
	}
	const json = await response.json();
	if (!json?.access_token || typeof json.expires_in !== "number") {
		throw new Error(`token ${operation} response missing fields: ${JSON.stringify(json)}`);
	}
	return {
		access_token: json.access_token,
		refresh_token: typeof json.refresh_token === "string" ? json.refresh_token : undefined,
		expires_in: json.expires_in,
		expiresAt: Date.now() + json.expires_in * 1000
	};
}

/** Whether a token-refresh failure means the login itself is dead. */
export function isInvalidGrant(error) {
	return typeof error?.message === "string" && /invalid_grant|invalid refresh|revoked|expired/i.test(error.message);
}

function sleep(ms, signal) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(new Error("login cancelled"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
