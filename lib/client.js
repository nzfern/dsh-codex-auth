/**
 * dsh-codex-auth — browser client half.
 *
 * Hand-written `window.__ModuleLoader__.load` bundle (the same format the
 * tsdown-built client plugins ship): the factory's `require` resolves through
 * the browser module loader's registry, so `react` resolves without a build
 * step. The component uses `React.createElement` instead of JSX for the same
 * reason.
 *
 * The plugin registers a "ChatGPT · Codex 额度" card as a General settings
 * row (`settings.general.item`), next to Language / Appearance / Composer
 * Enter. The card shows the login state inline and drives the host's
 * `/api/codex.*` endpoints (device-code flow): starting a login expands the
 * verification URL + code inline, refreshed every 2 seconds until it settles.
 *
 * @module dsh-codex-auth/client
 */
window.__ModuleLoader__.load({
	id: "dsh-codex-auth",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const { useState, useEffect, useCallback } = React;

		/** Call one host `/api/codex.*` endpoint (same RPC envelope the web shell uses). */
		async function callCodex(method, payload = {}) {
			const rpcId = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).toString();
			const response = await fetch(`/api/${method}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ type: "client-request", rpcId, method, payload })
			});
			const json = await response.json();
			return json.result;
		}

		// Shared button styles as injected CSS (theme-aware: every color comes
		// from dsw alias tokens, matching the official button chrome — including
		// dark-mode and hover states).
		const BUTTON_CSS = [
			".codex-btn{box-sizing:border-box;height:32px;font:inherit;cursor:pointer;border-radius:16px;justify-content:center;align-items:center;gap:4px;padding:0 14px;font-size:13px;line-height:20px;display:inline-flex}",
			".codex-btn:disabled{opacity:.6;cursor:default}",
			".codex-btn-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border:none}",
			".codex-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}",
			".codex-btn-secondary{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:transparent}",
			".codex-btn-secondary:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}",
			".codex-btn-danger{color:var(--dsw-alias-state-error-primary);background:transparent;border:1px solid var(--dsw-alias-border-l2)}",
			".codex-btn-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}"
		].join("\n");
		if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="dsh-codex-auth"]') === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-codex-auth";
			tag.dataset.pluginCss = "dsh-codex-auth";
			tag.textContent = BUTTON_CSS;
			document.head.appendChild(tag);
		}

		/**
		 * The General-settings row: label + status on the left, action button on
		 * the right; the device-code panel expands inline below when logging in.
		 */
		function CodexSettingsItem() {
			const [state, setState] = useState({ loading: true, loggedIn: false, loginInProgress: false });
			const [code, setCode] = useState(undefined); // { verificationUri, userCode, expiresInSeconds }
			const [busy, setBusy] = useState(false);

			const refresh = useCallback(async () => {
				try {
					const result = await callCodex("codex.status");
					if (result.ok) {
						setState((prev) => {
							const next = { ...prev, ...result.value, loading: false };
							if (result.value.loggedIn && prev.loginInProgress) next.loginInProgress = false;
							return next;
						});
					} else {
						setState((prev) => ({ ...prev, loading: false, error: result.error?.message }));
					}
				} catch (error) {
					setState((prev) => ({ ...prev, loading: false, error: String(error) }));
				}
			}, []);

			useEffect(() => {
				refresh();
				const timer = setInterval(refresh, 2000);
				return () => clearInterval(timer);
			}, [refresh]);

			const startLogin = useCallback(async () => {
				setBusy(true);
				try {
					const result = await callCodex("codex.login");
					if (result.ok) {
						setCode(result.value);
						setState((prev) => ({ ...prev, loginInProgress: true, error: undefined }));
					} else {
						setState((prev) => ({ ...prev, error: result.error?.message }));
					}
				} catch (error) {
					setState((prev) => ({ ...prev, error: String(error) }));
				} finally {
					setBusy(false);
				}
			}, []);

			const logout = useCallback(async () => {
				setBusy(true);
				try {
					await callCodex("codex.logout");
					setCode(undefined);
					refresh();
				} finally {
					setBusy(false);
				}
			}, [refresh]);

			const statusText = state.loading
				? "检查中…"
				: state.loggedIn
					? `已连接${state.accountId ? ` (${String(state.accountId).slice(0, 8)}…)` : ""}`
					: "未登录";

			return React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--dsw-alias-separator-primary, var(--dsw-alias-border-l1, #eee))", color: "var(--dsw-alias-label-primary, #333)" } },
				React.createElement("div", { style: { minWidth: "0" } },
					React.createElement("div", { style: { fontWeight: 600, fontSize: "14px", color: "var(--dsw-alias-label-primary, #333)" } }, "ChatGPT · Codex 额度"),
					React.createElement("div", { style: { color: "var(--dsw-alias-label-secondary, #888)", fontSize: "12px", marginTop: "2px" } },
						state.loggedIn
							? "已登录 ChatGPT,可用 Codex 额度运行 gpt-5.x 模型"
							: "用 ChatGPT 账号(Plus/Pro/Team/Enterprise)登录,使用 Codex 额度"
					)
				),
				React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "10px" } },
					React.createElement("span", { style: { color: state.loggedIn ? "var(--dsw-alias-state-success-primary, #10a37f)" : "var(--dsw-alias-label-secondary, #888)", fontSize: "12px", fontWeight: 600 } }, statusText),
					state.loggedIn
						? React.createElement("button", { onClick: logout, disabled: busy, className: "codex-btn codex-btn-danger", type: "button" }, "退出登录")
						: React.createElement("button", { onClick: startLogin, disabled: busy || state.loginInProgress, className: "codex-btn codex-btn-primary", type: "button" }, "用 ChatGPT 登录")
				),
				state.loginInProgress && code
					? React.createElement("div", { style: { width: "100%", background: "var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-hover, #f6f8fa))", border: "1px dashed var(--dsw-alias-border-l1, #ccc)", borderRadius: "8px", padding: "10px 12px", marginTop: "4px", color: "var(--dsw-alias-label-primary, #333)" } },
						React.createElement("div", { style: { fontWeight: 600, marginBottom: "4px" } }, "请在浏览器中完成授权:"),
						React.createElement("div", null,
							"打开 ",
							React.createElement("a", { href: code.verificationUri, target: "_blank", rel: "noreferrer", style: { color: "var(--dsw-alias-brand-primary, #0a7c5f)" } }, code.verificationUri),
							" 并输入代码"
						),
						React.createElement("div", { style: { fontFamily: "ui-monospace, monospace", fontSize: "20px", letterSpacing: "2px", fontWeight: 700, margin: "6px 0", color: "var(--dsw-alias-label-primary, #333)" } }, code.userCode),
						React.createElement("div", { style: { color: "var(--dsw-alias-label-secondary, #888)", fontSize: "12px" } }, "等待授权中(约 15 分钟内有效)…")
					)
					: null,
				state.loginInProgress && state.status === "done"
					? React.createElement("div", { style: { width: "100%", color: "var(--dsw-alias-state-success-primary, #10a37f)", fontWeight: 600, fontSize: "13px" } }, "登录成功!可在模型选择器中选用 Codex 模型。")
					: null,
				state.error
					? React.createElement("div", { style: { width: "100%", color: "var(--dsw-alias-state-error-primary, #d33)", fontSize: "12px" } }, String(state.error))
					: null
			);
		}

		const name = "codex-auth-client";
		const inject = ["slots"];

		function apply(ctx) {
			// General settings row; inject defers registration until
			// ui-settings-general declares the slot (load order is not
			// guaranteed).
			ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "codex-auth",
				order: 90
			}, CodexSettingsItem));
		}

		exports.name = name;
		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});
