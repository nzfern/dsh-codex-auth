#!/usr/bin/env node
/**
 * dsh-codex-login — device-code login for the OpenAI Codex (ChatGPT) quota.
 *
 * Runs the same OAuth flow as the official Codex CLI: it prints a code and a
 * verification URL, waits for you to authorize with your ChatGPT account in a
 * browser, then stores the refresh token in the Harness credential store
 * (`$DSH_HOME/.credentials.yaml`), which the running `dsh web` instance
 * hot-reloads. From then on the dsh-codex-auth plugin keeps the access token
 * fresh automatically.
 *
 * Usage:
 *   node dsh-codex-auth/bin/codex-login.mjs
 *
 * @module dsh-codex-auth/bin/codex-login
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	DEVICE_VERIFICATION_URI,
	accountIdOf,
	exchangeDeviceCode,
	pollDeviceCode,
	requestDeviceCode
} from "../lib/codex.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".dsh");
const CREDENTIALS_PATH = resolve(HOME, ".credentials.yaml");
const ACCESS_TOKEN_REF = process.env.OPENAI_CODEX_ACCESS_TOKEN_REF ?? "OPENAI_CODEX_ACCESS_TOKEN";
const REFRESH_TOKEN_REF = process.env.OPENAI_CODEX_REFRESH_TOKEN_REF ?? "OPENAI_CODEX_REFRESH_TOKEN";

/** Read the strict `REF: value` document into entries with line indexes. */
function readEntries(text) {
	const lines = text.split(/\r?\n/);
	const entries = new Map();
	for (let i = 0; i < lines.length; i++) {
		const match = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(lines[i]);
		if (match !== null) entries.set(match[1], { index: i, raw: match[2] });
	}
	return { lines, entries };
}

function unquote(raw) {
	const value = raw.trim();
	if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
	if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
	return value;
}

function renderLine(value) {
	return `${value.replace(/'/g, "''")}`;
}

/** Merge updates into the document, preserving every untouched line. */
function applyUpdates(text, updates) {
	const { lines, entries } = readEntries(text);
	for (const [ref, value] of Object.entries(updates)) {
		const line = `${ref}: '${renderLine(value)}'`;
		const existing = entries.get(ref);
		if (existing !== undefined) lines[existing.index] = line;
		else lines.push(line);
	}
	return lines.join("\n") + "\n";
}

async function readCredentials() {
	try {
		return await readFile(CREDENTIALS_PATH, "utf8");
	} catch (error) {
		if (error?.code === "ENOENT") return "";
		throw error;
	}
}

async function writeCredentials(text) {
	await mkdir(dirname(CREDENTIALS_PATH), { recursive: true });
	await writeFile(CREDENTIALS_PATH, text, { encoding: "utf8", mode: 0o600 });
}

async function main() {
	const device = await requestDeviceCode();
	console.log("");
	console.log("ChatGPT (Codex) 登录 — 用你的 ChatGPT 账号登录后即可用 Codex 额度");
	console.log("");
	console.log(`  1. 打开: ${DEVICE_VERIFICATION_URI}`);
	console.log(`  2. 输入代码: ${device.userCode}`);
	console.log("  3. 登录并授权(代码约 15 分钟内有效)");
	console.log("");

	const deviceResult = await pollDeviceCode(device, {
		onStatus: (line) => console.log(line)
	});
	const tokens = await exchangeDeviceCode(deviceResult);
	const text = await readCredentials();
	await writeCredentials(applyUpdates(text, {
		[ACCESS_TOKEN_REF]: tokens.access_token,
		...(tokens.refresh_token !== undefined ? { [REFRESH_TOKEN_REF]: tokens.refresh_token } : {})
	}));

	const accountId = accountIdOf(tokens.access_token);
	console.log("");
	console.log(`登录成功!账号: ${accountId ?? "unknown"}`);
	console.log(`tokens 已保存到 ${CREDENTIALS_PATH}`);
	console.log("dsh-codex-auth 插件会自动刷新 access token;现在可以在模型选择器中选用 Codex 模型了。");
}

main().catch((error) => {
	console.error(`登录失败: ${error?.message ?? String(error)}`);
	process.exitCode = 1;
});
