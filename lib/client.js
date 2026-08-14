/**
 * dsh-codex-auth — browser client half.
 *
 * Hand-written `window.__ModuleLoader__.load` bundle (the same format the
 * tsdown-built client plugins ship): the factory's `require` resolves through
 * the browser module loader's registry, so `@deepseek-ai/*` and `react`
 * resolve without a build step. The component uses `React.createElement`
 * instead of JSX for the same reason.
 *
 * The plugin registers a "ChatGPT (Codex) 登录" button component into a UI
 * slot; clicking it drives the host's `/api/codex.*` endpoints (device-code
 * flow), showing the verification URL + code and the live login state.
 *
 * @module dsh-codex-auth/client
 */
window.__ModuleLoader__.load({
	id: "dsh-codex-auth",
	factory: (require) => {
		const { useState, useEffect, useCallback } = require("react");

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

		/**
		 * The login button card: status line, login/logout action, and the
		 * device-code panel while a login is in progress.
		 */
		function CodexLoginCard() {
			const [state, setState] = useState({ loading: true, loggedIn: false, loginInProgress: false });
			const [code, setCode] = useState(undefined); // { verificationUri, userCode, expiresInSeconds }
			const [busy, setBusy] = useState(false);

			const refresh = useCallback(async () => {
				try {
					const result = await callCodex("codex.status");
					if (result.ok) setState((prev) => ({ ...prev, ...result.value, loading: false }));
					else setState((prev) => ({ ...prev, loading: false, error: result.error?.message }));
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
						setState((prev) => ({ ...prev, loginInProgress: true }));
						refresh();
					} else {
						setState((prev) => ({ ...prev, error: result.error?.message }));
					}
				} catch (error) {
					setState((prev) => ({ ...prev, error: String(error) }));
				} finally {
					setBusy(false);
				}
			}, [refresh]);

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

			if (state.loading) return React.createElement("span", { style: { color: "#888" } }, "Codex: 检查登录状态…");

			const row = (children) => React.createElement("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } }, children);
			const button = (label, onClick, disabled, primary) => React.createElement("button", {
				onClick,
				disabled: disabled ?? busy,
				style: primary
					? { background: "#10a37f", color: "#fff", border: "none", borderRadius: "6px", padding: "6px 14px", cursor: "pointer", fontWeight: 600 }
					: { background: "transparent", border: "1px solid #ccc", borderRadius: "6px", padding: "6px 14px", cursor: "pointer", color: "#333" }
			}, label);

			const statusText = state.loggedIn
				? `已登录${state.accountId ? ` (${state.accountId.slice(0, 8)}…)` : ""}`
				: "未登录";

			return React.createElement("div", { style: { border: "1px solid #e2e2e2", borderRadius: "10px", padding: "12px 14px", fontFamily: "system-ui, sans-serif", fontSize: "14px", lineHeight: 1.6 } },
				React.createElement("div", { style: { fontWeight: 700, marginBottom: "6px" } }, "ChatGPT · Codex 额度"),
				row(
					React.createElement("span", null, `状态: ${statusText}`),
					state.loggedIn
						? button("退出登录", logout, false, false)
						: button("用 ChatGPT 登录", startLogin, state.loginInProgress, true)
				),
				state.loginInProgress && code
					? React.createElement("div", { style: { marginTop: "10px", background: "#f6f8fa", borderRadius: "8px", padding: "10px", border: "1px dashed #ccc" } },
						React.createElement("div", { style: { fontWeight: 600 } }, "请在浏览器中完成授权:"),
						React.createElement("div", null,
							"打开 ",
							React.createElement("a", { href: code.verificationUri, target: "_blank", rel: "noreferrer" }, code.verificationUri),
							" 并输入代码"
						),
						React.createElement("div", { style: { fontFamily: "monospace", fontSize: "20px", letterSpacing: "2px", fontWeight: 700, margin: "6px 0" } }, code.userCode),
						React.createElement("div", { style: { color: "#888", fontSize: "12px" } }, "等待授权中(约 15 分钟内有效)…")
					)
					: null,
				state.error
					? React.createElement("div", { style: { color: "#d33", marginTop: "6px", fontSize: "13px" } }, String(state.error))
					: null,
				state.loginInProgress && state.status === "done"
					? React.createElement("div", { style: { color: "#10a37f", marginTop: "6px", fontWeight: 600 } }, "登录成功!现在可以在模型选择器中选用 Codex 模型。")
					: null
			);
		}

		const name = "codex-auth-client";
		const inject = [];

		function apply(ctx) {
			ctx.slots.register({ name: "codex-auth-button", owner: "root" }, CodexLoginCard);
		}

		return { name, inject, apply };
	}
});
