import { css, createDelegate, type Component } from "dreamland/core";
import type { Frame } from "@mercuryworkshop/scramjet-controller";
import FlagEditor from "./components/FlagEditor";
import BrowserView from "./pages/BrowserView";
import RequestViewer from "./pages/RequestViewer";
import PlaygroundView from "./pages/Playground";
import SettingsView from "./pages/SettingsPage";
import { Omnibox, browserState } from "./pages/BrowserView";
import { requestsState } from "./pages/RequestViewer";
import { demoSettingsStore } from "./store";

const CORK7_URL = "https://cork7game.vercel.app/c7";

function isCork7(currentUrl: string) {
	try {
		const current = new URL(currentUrl);
		const target = new URL(CORK7_URL);
		return current.hostname === target.hostname && current.pathname.startsWith("/c7");
	} catch {
		return false;
	}
}

const App: Component<
	{},
	{},
	{
		activeTab: "browser" | "requests" | "playground" | "settings";
	}
> = function (cx) {
	this.activeTab ??= "browser";

	const openSite = (url: string) => {
		this.activeTab = "browser";
		browserState.url = url;
		demoSettingsStore.homeUrl = url;
		browserState.frame?.go(url);
	};

	return (
		<div>
			<div class="top-bar">
				<div class="tab-bar">
					<button
						class={use(this.activeTab).map(
							(tab) => `tab-button ${tab === "browser" ? "active" : ""}`
						)}
						on:click={() => {
							this.activeTab = "browser";
						}}
					>
						Browser
					</button>
					<div class="site-switcher" aria-label="Quick website switcher">
						<span class="site-switcher-label">OPEN</span>
						<button
							type="button"
							class={use(browserState.url).map(
								(url) => `tab-button site-button ${isCork7(url) ? "active" : ""}`
							)}
							on:click={() => openSite(CORK7_URL)}
						>
							Cork7
						</button>
					</div>
					<button
						class={use(this.activeTab).map(
							(tab) => `tab-button ${tab === "requests" ? "active" : ""}`
						)}
						on:click={() => {
							this.activeTab = "requests";
						}}
					>
						Requests{" "}
						{use(requestsState.requests).map((requests) =>
							requests.length ? `(${requests.length})` : ""
						)}
					</button>
					<button
						class={use(this.activeTab).map(
							(tab) => `tab-button ${tab === "playground" ? "active" : ""}`
						)}
						on:click={() => {
							this.activeTab = "playground";
						}}
					>
						Playground
					</button>
					<button
						class={use(this.activeTab).map(
							(tab) => `tab-button ${tab === "settings" ? "active" : ""}`
						)}
						on:click={() => {
							this.activeTab = "settings";
						}}
					>
						Settings
					</button>
					{use(this.activeTab)
						.map((tab) => tab === "browser")
						.andThen(<Omnibox />)}
				</div>
				<div class="top-actions">
					<FlagEditor inline={true} />
				</div>
			</div>
			<div
				class={use(this.activeTab).map(
					(tab) =>
						`tab-panel browser-panel ${tab === "browser" ? "active" : ""}`
				)}
			>
				<BrowserView
					active={use(this.activeTab).map((tab) => tab === "browser")}
				/>
			</div>
			<div
				class={use(this.activeTab).map(
					(tab) =>
						`tab-panel requests-panel ${tab === "requests" ? "active" : ""}`
				)}
			>
				<RequestViewer
					active={use(this.activeTab).map((tab) => tab === "requests")}
				/>
			</div>
			<div
				class={use(this.activeTab).map(
					(tab) =>
						`tab-panel playground-panel ${tab === "playground" ? "active" : ""}`
				)}
			>
				<PlaygroundView
					active={use(this.activeTab).map((tab) => tab === "playground")}
				/>
			</div>
			<div
				class={use(this.activeTab).map(
					(tab) =>
						`tab-panel settings-tab ${tab === "settings" ? "active" : ""}`
				)}
			>
				<SettingsView />
			</div>
		</div>
	);
};

App.style = css`
	@import url("https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20,400,0,0");

	:scope {
		width: 100vw;
		height: 100vh;
		display: flex;
		flex-direction: column;
		margin: 0;
		overflow: hidden;
		position: absolute;
		top: 0;
		left: 0;

		padding: 0;
		background: black;
		box-sizing: border-box;
	}
	.material-symbols-outlined {
		font-family: "Material Symbols Outlined";
		font-weight: normal;
		font-style: normal;
		font-size: 11px;
		line-height: 1;
		letter-spacing: normal;
		text-transform: none;
		display: inline-block;
		white-space: nowrap;
		word-wrap: normal;
		direction: ltr;
		-webkit-font-smoothing: antialiased;
	}
	.top-bar {
		display: flex;
		align-items: stretch;
		gap: 0;
		margin-bottom: 0;
		border-bottom: 1px solid #4a4a4a;
		background: #0f0f0f;
	}
	.tab-bar {
		display: flex;
		flex: 1;
		align-items: stretch;
		gap: 0;
		min-width: 0;
	}
	.tab-button {
		border: 1px solid transparent;
		border-bottom: 0;
		background: transparent;
		color: #a8a8a8;
		padding: 0.24em 0.62em;
		border-radius: 0;
		cursor: pointer;
		font-size: 0.84em;
		line-height: 1.2;
		min-height: 28px;
		margin: 0;
		white-space: nowrap;
		display: inline-flex;
		align-items: center;
	}
	.tab-button:hover {
		background: #181818;
		color: #d0d0d0;
	}
	.tab-button.active {
		background: #1f1f1f;
		color: #fff;
		border-color: #4a4a4a;
		margin-bottom: -1px;
	}
	.site-switcher {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 0 0.4em;
		margin: 3px 0.35em;
		border-left: 1px solid #303030;
		border-right: 1px solid #303030;
		flex: 0 0 auto;
	}
	.site-switcher-label {
		padding: 0 0.25em;
		color: #777;
		font-size: 0.62em;
		font-weight: 700;
		letter-spacing: 0.08em;
	}
	.tab-button.site-button {
		min-height: 23px;
		padding: 0.2em 0.55em;
		border: 1px solid transparent;
		border-radius: 3px;
		font-size: 0.78em;
	}
	.tab-button.site-button.active {
		margin: 0;
		border-color: #40546a;
		background: #192b3d;
		color: #d6e8fa;
	}
	.tab-button.site-button:hover {
		background: #202a34;
		color: #fff;
	}
	.top-actions {
		display: flex;
		align-items: center;
		margin-left: auto;
		padding: 0 0.35em;
		min-height: 28px;
	}
	.tab-panel {
		flex: 1;
		width: 100%;
		min-width: 0;
		min-height: 0;
		display: none;
	}
	.tab-panel.active {
		display: flex;
	}
	.requests-panel {
		flex-direction: column;
	}
	.playground-panel {
		width: 100%;
		min-width: 0;
		min-height: 0;
	}
	.settings-tab {
		width: 100%;
		min-width: 0;
		min-height: 0;
	}
`;
export default App;
