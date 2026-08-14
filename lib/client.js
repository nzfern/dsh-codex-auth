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

		/** localStorage key controlling the main-page usage badge. */
		const USAGE_VISIBILITY_KEY = "dsh-codex-usage-visible";

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
			const [usageVisible, setUsageVisible] = useState(() => localStorage.getItem(USAGE_VISIBILITY_KEY) !== "0");

			const toggleUsageVisible = useCallback(() => {
				setUsageVisible((prev) => {
					const next = !prev;
					localStorage.setItem(USAGE_VISIBILITY_KEY, next ? "1" : "0");
					window.dispatchEvent(new CustomEvent("dsh-codex-usage-visibility"));
					return next;
				});
			}, []);

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

			// Usage quota (WHAM endpoint): refreshed on a slow cadence and when
			// the login state settles.
			const [usage, setUsage] = useState(undefined);
			const fetchUsage = useCallback(async () => {
				try {
					const result = await callCodex("codex.usage");
					if (result.ok) setUsage(result.value);
				} catch {
					// keep the last known usage; the card still works without it
				}
			}, []);
			useEffect(() => {
				fetchUsage();
				const timer = setInterval(fetchUsage, 60000);
				return () => clearInterval(timer);
			}, [fetchUsage]);

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
					setUsage(undefined);
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

			// Render one WHAM window as a labelled progress bar.
			const renderWindow = (w, label) => {
				if (w === undefined) return null;
				const pct = Math.round(w.usedPercent);
				const barColor = pct >= 95 ? "var(--dsw-alias-state-error-primary, #d33)" : pct >= 80 ? "var(--dsw-alias-state-warn-primary, #d9822b)" : "var(--dsw-alias-state-success-primary, #10a37f)";
				const resets = w.resetsAt ? new Date(w.resetsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : undefined;
				return React.createElement("div", { style: { marginTop: "6px" } },
					React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--dsw-alias-label-secondary, #888)", marginBottom: "3px" } },
						React.createElement("span", null, label),
						React.createElement("span", null, `${pct}%${resets ? ` · ${resets} 重置` : ""}`)
					),
					React.createElement("div", { style: { height: "6px", background: "var(--dsw-alias-bg-layer-1, #eef1f4)", borderRadius: "3px", overflow: "hidden" } },
						React.createElement("div", { style: { width: `${Math.min(100, Math.max(0, w.usedPercent))}%`, height: "100%", background: barColor, borderRadius: "3px" } })
					)
				);
			};

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
				state.loggedIn && usage !== undefined && usage.available
					? React.createElement("div", { style: { width: "100%", marginTop: "2px" } },
						React.createElement("div", { style: { fontSize: "12px", fontWeight: 600, color: "var(--dsw-alias-label-primary, #333)" } },
							`Codex 额度${usage.planType ? ` · ${String(usage.planType)} 计划` : ""}`),
						renderWindow(usage.primary, "快速窗口"),
						renderWindow(usage.secondary, "每日窗口")
					)
					: null,
				state.loggedIn && usage !== undefined && !usage.available
					? React.createElement("div", { style: { width: "100%", marginTop: "2px", fontSize: "11px", color: "var(--dsw-alias-label-secondary, #888)" } },
						`额度信息暂不可用${usage.reason ? ` (${String(usage.reason)})` : ""}`)
					: null,
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
					: null,
				React.createElement("label", { style: { width: "100%", display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px", color: "var(--dsw-alias-label-primary, #333)", marginTop: "2px" } },
					React.createElement("input", { type: "checkbox", checked: usageVisible, onChange: toggleUsageVisible, style: { accentColor: "var(--dsw-alias-button-primary-fill, #10a37f)", cursor: "pointer" } }),
					"在主页面显示用量"
				)
			);
		}

		/**
		 * The main-page usage badge: a small fixed pill in the bottom-right that
		 * shows the current quota percentage; click it to expand window details.
		 * Hidden when the settings toggle is off, when logged out, or when the
		 * usage endpoint is unavailable.
		 */
		function CodexUsageBadge() {
			const [usage, setUsage] = useState(undefined);
			const [open, setOpen] = useState(false);
			const [visible, setVisible] = useState(() => localStorage.getItem(USAGE_VISIBILITY_KEY) !== "0");

			useEffect(() => {
				const onVisibility = () => setVisible(localStorage.getItem(USAGE_VISIBILITY_KEY) !== "0");
				window.addEventListener("dsh-codex-usage-visibility", onVisibility);
				window.addEventListener("storage", onVisibility);
				return () => {
					window.removeEventListener("dsh-codex-usage-visibility", onVisibility);
					window.removeEventListener("storage", onVisibility);
				};
			}, []);

			const fetchUsage = useCallback(async () => {
				try {
					const result = await callCodex("codex.usage");
					if (result.ok) setUsage(result.value);
				} catch {
					// keep the last known usage
				}
			}, []);
			useEffect(() => {
				if (!visible) return;
				fetchUsage();
				const timer = setInterval(fetchUsage, 60000);
				return () => clearInterval(timer);
			}, [visible, fetchUsage]);

			if (!visible || usage === undefined || !usage.available) return null;

			const primary = usage.primary;
			const secondary = usage.secondary;
			const pct = Math.round(primary?.usedPercent ?? secondary?.usedPercent ?? 0);
			const color = pct >= 95 ? "var(--dsw-alias-state-error-primary, #d33)" : pct >= 80 ? "var(--dsw-alias-state-warn-primary, #d9822b)" : "var(--dsw-alias-state-success-primary, #10a37f)";

			return React.createElement("div", { style: { position: "fixed", right: "16px", bottom: "16px", zIndex: 40, fontFamily: "system-ui, sans-serif" } },
				open
					? React.createElement("div", { style: { position: "fixed", right: "16px", bottom: "56px", zIndex: 50, width: "260px", maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 80px)", overflowY: "auto", background: "var(--dsw-alias-bg-base, #fff)", border: "1px solid var(--dsw-alias-border-l1, #e2e2e2)", borderRadius: "10px", padding: "12px 14px", boxShadow: "0 6px 24px rgba(0,0,0,0.14)", fontSize: "12px", lineHeight: 1.6, color: "var(--dsw-alias-label-primary, #333)" } },
						React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" } },
							React.createElement("span", { style: { fontWeight: 700 } }, `Codex 额度${usage.planType ? ` · ${String(usage.planType)}` : ""}`),
							React.createElement("button", { onClick: () => setOpen(false), type: "button", style: { border: "none", background: "transparent", cursor: "pointer", color: "var(--dsw-alias-label-secondary, #888)", fontSize: "14px", padding: "0 2px" } }, "×")
						),
						renderWindow(primary, "快速窗口"),
						renderWindow(secondary, "每日窗口")
					)
					: null,
				React.createElement("button", {
					onClick: () => setOpen((o) => !o),
					type: "button",
					title: "Codex 用量(点击展开)",
					style: {
						display: "flex", alignItems: "center", gap: "6px", cursor: "pointer",
						border: "1px solid var(--dsw-alias-border-l1, #e2e2e2)",
						background: "var(--dsw-alias-bg-base, #fff)", color: "var(--dsw-alias-label-primary, #333)",
						borderRadius: "999px", padding: "6px 12px", boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
						font: "600 12px system-ui, sans-serif"
					}
				},
					React.createElement("span", { style: { width: "8px", height: "8px", borderRadius: "50%", background: color, display: "inline-block" } }),
					React.createElement("span", null, `Codex ${pct}%`)
				)
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
			// Main-page usage badge (shell overlay layer).
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "codex-auth-usage"
			}, CodexUsageBadge));
		}

		exports.name = name;
		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});
