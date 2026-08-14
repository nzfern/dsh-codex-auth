#!/usr/bin/env node
/**
 * dsh-codex-logout — remove the stored ChatGPT Codex tokens.
 *
 * Usage:
 *   node dsh-codex-auth/bin/codex-logout.mjs
 *
 * @module dsh-codex-auth/bin/codex-logout
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const HOME = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".dsh");
const CREDENTIALS_PATH = resolve(HOME, ".credentials.yaml");
const ACCESS_TOKEN_REF = process.env.OPENAI_CODEX_ACCESS_TOKEN_REF ?? "OPENAI_CODEX_ACCESS_TOKEN";
const REFRESH_TOKEN_REF = process.env.OPENAI_CODEX_REFRESH_TOKEN_REF ?? "OPENAI_CODEX_REFRESH_TOKEN";

async function main() {
	let text = "";
	try {
		text = await readFile(CREDENTIALS_PATH, "utf8");
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
	}
	const refs = new Set([ACCESS_TOKEN_REF, REFRESH_TOKEN_REF]);
	const lines = text.split(/\r?\n/).filter((line) => {
		const match = /^([A-Za-z_][A-Za-z0-9_]*):\s*/.exec(line);
		return match === null || !refs.has(match[1]);
	});
	await writeFile(CREDENTIALS_PATH, lines.join("\n") + "\n", { encoding: "utf8", mode: 0o600 });
	console.log("已退出登录,ChatGPT Codex tokens 已清除。");
}

main().catch((error) => {
	console.error(`退出登录失败: ${error?.message ?? String(error)}`);
	process.exitCode = 1;
});
