#!/usr/bin/env node
/**
 * dsh-codex-status — show the stored ChatGPT Codex login state.
 *
 * Usage:
 *   node dsh-codex-auth/bin/codex-status.mjs
 *
 * @module dsh-codex-auth/bin/codex-status
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { accessTokenExpiry, accountIdOf, formatTime } from "../lib/codex.js";

const HOME = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".dsh");
const CREDENTIALS_PATH = resolve(HOME, ".credentials.yaml");
const ACCESS_TOKEN_REF = process.env.OPENAI_CODEX_ACCESS_TOKEN_REF ?? "OPENAI_CODEX_ACCESS_TOKEN";
const REFRESH_TOKEN_REF = process.env.OPENAI_CODEX_REFRESH_TOKEN_REF ?? "OPENAI_CODEX_REFRESH_TOKEN";

function readEntries(text) {
	const entries = new Map();
	for (const line of text.split(/\r?\n/)) {
		const match = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
		if (match !== null) entries.set(match[1], match[2].trim());
	}
	return entries;
}

function unquote(value) {
	if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
	if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
	return value;
}

async function main() {
	let text = "";
	try {
		text = await readFile(CREDENTIALS_PATH, "utf8");
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
	}
	const entries = readEntries(text);
	const access = unquote(entries.get(ACCESS_TOKEN_REF) ?? "");
	const refresh = unquote(entries.get(REFRESH_TOKEN_REF) ?? "");
	if (access.length === 0 && refresh.length === 0) {
		console.log("尚未登录 ChatGPT。运行 dsh-codex-auth/bin/codex-login.mjs 开始登录。");
		return;
	}
	const accountId = access.length > 0 ? accountIdOf(access) : undefined;
	const expiresAt = access.length > 0 ? accessTokenExpiry(access) : undefined;
	console.log("ChatGPT (Codex) 登录状态");
	console.log(`  账号: ${accountId ?? (refresh.length > 0 ? "已登录(等待刷新 access token)" : "未知")}`);
	console.log(`  refresh token: ${refresh.length > 0 ? "已保存" : "未保存"}`);
	console.log(`  access token: ${access.length > 0 ? "已保存" : "未保存"}`);
	console.log(`  access token 过期: ${formatTime(expiresAt)}`);
}

main().catch((error) => {
	console.error(`读取状态失败: ${error?.message ?? String(error)}`);
	process.exitCode = 1;
});
