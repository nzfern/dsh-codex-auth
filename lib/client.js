/**
 * dsh-codex-auth — browser client half.
 *
 * Hand-written `window.__ModuleLoader__.load` bundle (the same format the
 * tsdown-built client plugins ship): the factory's `require` resolves through
 * the browser module loader's registry, so `react` resolves without a build
 * step. The component uses `React.createElement` instead of JSX for the same
 * reason.
 *
 * The plugin registers a "Codex" button into the `sidebar.footer.action` slot
 * (the sidebar footer's action list). Clicking it drives the host's
 * `/api/codex.*` endpoints (device-code flow): the button opens a small panel
 * showing the verification URL + code and the live login state, refreshed
 * every 2 seconds until the login settles.
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
		const { useState, useEffect, useCallback, useRef } = React;

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

		/** The sidebar footer button + device-code panel. `wide` = sidebar expanded. */
		function CodexSidebarButton({ wide }) {
			const [state, setState] = useState({ loading: true, loggedIn: false, loginInProgress: false });
			const [code, setCode] = useState(undefined); // { verificationUri, userCode, expiresInSeconds }
			const [panelOpen, setPanelOpen] = useState(false);
			const [busy, setBusy] = useState(false);
			const panelRef = useRef(null);

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

			// Close the panel when clicking outside it.
			useEffect(() => {
				if (!panelOpen) return;
				const onDocClick = (event) => {
					if (panelRef.current && !panelRef.current.contains(event.target)) setPanelOpen(false);
				};
				document.addEventListener("mousedown", onDocClick);
				return () => document.removeEventListener("mousedown", onDocClick);
			}, [panelOpen]);

			const togglePanel = useCallback(() => {
				if (state.loggedIn || state.loginInProgress || code !== undefined) {
					setPanelOpen((open) => !open);
					return;
				}
				startLogin();
			}, [state.loggedIn, state.loginInProgress, code]);

			const startLogin = useCallback(async () => {
				setBusy(true);
				try {
					const result = await callCodex("codex.login");
					if (result.ok) {
						setCode(result.value);
						setState((prev) => ({ ...prev, loginInProgress: true, error: undefined }));
						setPanelOpen(true);
					} else {
						setState((prev) => ({ ...prev, error: result.error?.message }));
						setPanelOpen(true);
					}
				} catch (error) {
					setState((prev) => ({ ...prev, error: String(error) }));
					setPanelOpen(true);
				} finally {
					setBusy(false);
				}
			}, []);

			const logout = useCallback(async () => {
				setBusy(true);
				try {
					await callCodex("codex.logout");
					setCode(undefined);
					setPanelOpen(false);
					refresh();
				} finally {
					setBusy(false);
				}
			}, [refresh]);

			const buttonStyle = {
				display: "flex", alignItems: "center", gap: "6px",
				width: "100%", border: "1px solid var(--dsw-alias-border-l1, #e2e2e2)",
				borderRadius: "8px", padding: "6px 10px", cursor: "pointer",
				background: "transparent", color: "var(--dsw-alias-text-primary, #333)",
				font: "13px system-ui, sans-serif", justifyContent: wide ? "flex-start" : "center"
			};
			const label = state.loggedIn ? "✓ Codex" : (state.loginInProgress ? "Codex 授权中…" : "Codex 登录");
			const glyph = state.loggedIn ? "✓" : "⚡";

			return React.createElement("div", { style: { position: "relative" }, ref: panelRef },
				React.createElement("button", {
					onClick: togglePanel,
					disabled: busy,
					style: buttonStyle,
					title: "ChatGPT · Codex 额度登录状态"
				},
					React.createElement("span", null, glyph),
					wide ? React.createElement("span", null, label) : null
				),
				panelOpen
					? React.createElement("div", {
						style: {
							position: "absolute", bottom: "110%", right: "0", zIndex: 40,
							background: "var(--dsw-alias-bg-base, #fff)", border: "1px solid var(--dsw-alias-border-l1, #e2e2e2)",
							borderRadius: "10px", padding: "12px 14px", boxShadow: "0 6px 24px rgba(0,0,0,0.14)",
							font: "13px system-ui, sans-serif", lineHeight: 1.6, width: "280px"
						}
					},
						React.createElement("div", { style: { fontWeight: 700, marginBottom: "6px" } },
							state.loggedIn ? "ChatGPT Codex 已连接" : "ChatGPT · Codex 登录"),
						state.loggedIn
							? React.createElement("div", null,
								React.createElement("div", { style: { color: "#555" } }, `账号: ${state.accountId ? String(state.accountId).slice(0, 8) + "…" : "已登录"}`),
								React.createElement("div", { style: { marginTop: "8px", display: "flex", gap: "8px" } },
									React.createElement("button", { onClick: () => setPanelOpen(false), style: { border: "1px solid #ccc", background: "transparent", borderRadius: "6px", padding: "4px 10px", cursor: "pointer", color: "#555", fontSize: "13px" } }, "关闭"),
									React.createElement("button", { onClick: logout, disabled: busy, style: { border: "1px solid #d33", background: "transparent", borderRadius: "6px", padding: "4px 10px", cursor: "pointer", color: "#d33", fontSize: "13px" } }, "退出登录")
								)
							)
							: code !== undefined
								? React.createElement("div", null,
									React.createElement("div", { style: { fontWeight: 600 } }, "请在浏览器中完成授权:"),
									React.createElement("div", null,
										"打开 ",
										React.createElement("a", { href: code.verificationUri, target: "_blank", rel: "noreferrer" }, code.verificationUri),
										" 并输入代码"
									),
									React.createElement("div", { style: { fontFamily: "ui-monospace, monospace", fontSize: "20px", letterSpacing: "2px", fontWeight: 700, margin: "6px 0" } }, code.userCode),
									React.createElement("div", { style: { color: "#888", fontSize: "12px" } }, "等待授权中(约 15 分钟内有效)…")
								)
								: React.createElement("div", null,
									React.createElement("div", { style: { color: "#555" } }, "使用你的 ChatGPT 账号(Plus/Pro/Team/Enterprise)登录,即可通过 Codex 额度使用 gpt-5.x 模型。"),
									React.createElement("div", { style: { marginTop: "8px" } },
										React.createElement("button", { onClick: startLogin, disabled: busy, style: { background: "#10a37f", color: "#fff", border: "none", borderRadius: "6px", padding: "6px 14px", cursor: "pointer", fontWeight: 600, fontSize: "13px" } }, "用 ChatGPT 登录")
									)
								),
						state.error
							? React.createElement("div", { style: { color: "#d33", marginTop: "6px", fontSize: "12px" } }, String(state.error))
							: null,
						state.loginInProgress && state.status === "done"
							? React.createElement("div", { style: { color: "#10a37f", marginTop: "6px", fontWeight: 600 } }, "登录成功!可在模型选择器中选用 Codex 模型。")
							: null
					)
					: null
			);
		}

		const name = "codex-auth-client";
		const inject = ["slots"];

		function apply(ctx) {
			// Sidebar footer action list; inject defers registration until the
			// sidebar declares the slot (load order is not guaranteed).
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "codex-auth"
			}, CodexSidebarButton));
		}

		exports.name = name;
		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});
