import { MarkdownView, Modal, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import type { AutoCloseTabsSettings } from "../settings";
import { HistoryManager } from "./historyManager";

interface PluginWithSettings extends Plugin {
	settings: AutoCloseTabsSettings;
}

export class TabManager {
	private plugin: PluginWithSettings;
	private leafActivityMap: WeakMap<WorkspaceLeaf, number> = new WeakMap();
	private checkInterval: number | null = null;
	public historyManager: HistoryManager;

	constructor(plugin: PluginWithSettings) {
		this.plugin = plugin;
		this.historyManager = new HistoryManager(plugin);
	}

	start(): void {
		console.debug("[AutoCloseTabs] Starting tab manager");
		this.initializeLeafTracking();
		this.registerActiveLeafChangeListener();
		this.startPeriodicCheck();
	}

	stop(): void {
		if (this.checkInterval !== null) {
			window.clearInterval(this.checkInterval);
			this.checkInterval = null;
		}
		// WeakMap doesn't need explicit clearing
	}

	private initializeLeafTracking(): void {
		const now = Date.now();
		let leafCount = 0;
		// Only track leaves in the main workspace area (root split), not sidebar panes
		this.plugin.app.workspace.iterateRootLeaves((leaf) => {
			if (!this.leafActivityMap.has(leaf)) {
				this.leafActivityMap.set(leaf, now);
				leafCount++;
			}
		});
		console.debug(`[AutoCloseTabs] Initialized tracking for ${leafCount} root leaves (main workspace tabs only)`);
	}

	private registerActiveLeafChangeListener(): void {
		// Track when active leaf changes (only for root leaves)
		this.plugin.registerEvent(
			this.plugin.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf && this.isRootLeaf(leaf)) {
					const viewState = leaf.getViewState();
					const fileName = this.getLeafName(leaf);
					this.leafActivityMap.set(leaf, Date.now());
					console.debug(`[AutoCloseTabs] Active root leaf changed: ${fileName} (pinned: ${viewState.pinned})`);
				}
			})
		);

		// Also track when files are opened (only for root leaves)
		this.plugin.registerEvent(
			this.plugin.app.workspace.on("file-open", (file) => {
				if (file) {
					const leaf = this.getActiveRootLeaf();
					if (leaf) {
						const viewState = leaf.getViewState();
						const fileName = this.getLeafName(leaf);
						this.leafActivityMap.set(leaf, Date.now());
						console.debug(`[AutoCloseTabs] File opened in root leaf: ${fileName} (pinned: ${viewState.pinned})`);
					}
				}
			})
		);
	}

	/**
	 * Check if a leaf is in the root split (main workspace area) and not in a sidebar
	 */
	private isRootLeaf(leaf: WorkspaceLeaf): boolean {
		try {
			const root = this.plugin.app.workspace.rootSplit;
			if (!root) return false;
			return leaf.getRoot() === root;
		} catch (e) {
			console.error("[AutoCloseTabs] Error checking if leaf is root:", e);
			return false;
		}
	}

	private getActiveRootLeaf(): WorkspaceLeaf | null {
		const leaf = this.plugin.app.workspace.getMostRecentLeaf();
		if (leaf && this.isRootLeaf(leaf)) {
			return leaf;
		}
		return null;
	}

	private getLeafFile(leaf?: WorkspaceLeaf | null): TFile | null {
		if (!leaf) {
			return null;
		}
		const view = leaf.view;
		if (view instanceof MarkdownView) {
			return view.file;
		}
		const fileCandidate = (view as { file?: unknown }).file;
		return fileCandidate instanceof TFile ? fileCandidate : null;
	}

	private getLeafName(leaf: WorkspaceLeaf): string {
		const viewState = leaf.getViewState();
		const file = this.getLeafFile(leaf);
		const display = leaf.getDisplayText();
		return file?.name || display || viewState.type || "unknown";
	}

	private startPeriodicCheck(): void {
		const settings = this.plugin.settings;
		if (!settings.enabled) {
			console.debug("[AutoCloseTabs] Plugin is disabled, not starting periodic check");
			return;
		}

		const checkIntervalMs = settings.checkIntervalSeconds * 1000;
		const inactiveTimeoutMs = settings.inactiveTimeoutMinutes * 60 * 1000;

		console.debug(
			`[AutoCloseTabs] Starting periodic check: interval=${checkIntervalMs}ms, timeout=${inactiveTimeoutMs}ms (${settings.inactiveTimeoutMinutes} min)`
		);

		const intervalId = window.setInterval(() => {
			this.checkAndCloseInactiveTabs(inactiveTimeoutMs).catch((err) => {
				console.error("[AutoCloseTabs] Error in periodic check:", err);
			});
		}, checkIntervalMs);

		this.checkInterval = this.plugin.registerInterval(intervalId);
		console.debug(`[AutoCloseTabs] Periodic check interval registered: ${this.checkInterval}`);
	}

	private async checkAndCloseInactiveTabs(inactiveTimeoutMs: number): Promise<void> {
		// Deprecated signature kept for interval compatibility; see manualCheck for Notice output
		await this.checkAndCloseInactiveTabsWithResult(inactiveTimeoutMs);
	}

	private async checkAndCloseInactiveTabsWithResult(inactiveTimeoutMs: number): Promise<
		Array<{ fileName: string; inactiveMinutes: number }>
	> {
		const settings = this.plugin.settings;
		if (!settings.enabled) {
			return [];
		}

		const now = Date.now();
		const activeLeaf = this.getActiveRootLeaf();
		const activeViewState = activeLeaf?.getViewState();
		const activeFile = this.getLeafFile(activeLeaf);
		const activeFileName = activeFile?.name || activeViewState?.type || "none";

		console.debug(`[AutoCloseTabs] Checking for inactive tabs (active: ${activeFileName})`);

		const leavesToClose: Array<{ leaf: WorkspaceLeaf; inactiveTime: number; fileName: string }> = [];
		let totalLeaves = 0;
		let pinnedCount = 0;
		let activeCount = 0;
		const closedTabs: Array<{ fileName: string; inactiveMinutes: number }> = [];

		// Only check leaves in the main workspace area (root split), not sidebar panes
		this.plugin.app.workspace.iterateRootLeaves((leaf) => {
			totalLeaves++;
			const viewState = leaf.getViewState();
			const fileName = this.getLeafName(leaf);

			// Skip pinned tabs
			if (viewState.pinned) {
				pinnedCount++;
				console.debug(`[AutoCloseTabs]   - Skipping pinned tab: ${fileName}`);
				return;
			}

			// Skip currently active leaf
			if (leaf === activeLeaf) {
				activeCount++;
				console.debug(`[AutoCloseTabs]   - Skipping active tab: ${fileName}`);
				return;
			}

			// Get last activity time, default to now if not tracked
			const lastActivity = this.leafActivityMap.get(leaf);
			if (!lastActivity) {
				console.debug(`[AutoCloseTabs]   - Warning: No activity record for ${fileName}, using current time`);
				this.leafActivityMap.set(leaf, now);
				return;
			}

			const inactiveTime = now - lastActivity;
			const inactiveMinutes = Math.floor(inactiveTime / 60000);
			const inactiveSeconds = Math.floor((inactiveTime % 60000) / 1000);

			console.debug(
				`[AutoCloseTabs]   - Tab: ${fileName}, inactive: ${inactiveMinutes}m ${inactiveSeconds}s (threshold: ${inactiveTimeoutMs / 60000} min)`
			);

			if (inactiveTime >= inactiveTimeoutMs) {
				leavesToClose.push({ leaf, inactiveTime, fileName });
			}
		});

		console.debug(
			`[AutoCloseTabs] Summary: ${totalLeaves} total, ${pinnedCount} pinned, ${activeCount} active, ${leavesToClose.length} to close`
		);

			// Close inactive tabs
		for (const { leaf, inactiveTime, fileName } of leavesToClose) {
			const inactiveMinutes = Math.floor(inactiveTime / 60000);
			const inactiveTimeMinutes = inactiveTime / 60000;
			console.debug(`[AutoCloseTabs] Closing inactive tab: ${fileName} (inactive for ${inactiveMinutes} minutes)`);
			
			// Log to history
			const file = this.getLeafFile(leaf);
			const filePath = file?.path;
			await this.historyManager.addEntry({
				timestamp: Date.now(),
				fileName: fileName,
				inactiveTimeMinutes: inactiveTimeMinutes,
				filePath: filePath,
			});

			closedTabs.push({ fileName, inactiveMinutes });
			leaf.detach();
		}

		if (leavesToClose.length > 0) {
			console.debug(`[AutoCloseTabs] Closed ${leavesToClose.length} inactive tab(s)`);
		}

		return closedTabs;
	}

	updateSettings(): void {
		console.debug("[AutoCloseTabs] Updating settings, restarting tab manager");
		this.stop();
		this.start();
	}

	async manualCheck(): Promise<void> {
		const settings = this.plugin.settings;
		if (!settings.enabled) {
			console.debug("[AutoCloseTabs] Plugin is disabled, cannot check");
			return;
		}
		const inactiveTimeoutMs = settings.inactiveTimeoutMinutes * 60 * 1000;
		console.debug("[AutoCloseTabs] Manual check triggered");
		const closed = await this.checkAndCloseInactiveTabsWithResult(inactiveTimeoutMs);
		if (closed.length === 0) {
			new Notice("Auto close tabs: No inactive tabs to close.");
			return;
		}
		const names = closed.map((c) => `${c.fileName} (${c.inactiveMinutes}m)`).join(", ");
		new Notice(`Auto close tabs: Closed ${closed.length} tab(s): ${names}`);
	}

	showStatus(): void {
		const now = Date.now();
		const activeLeaf = this.getActiveRootLeaf();
		const settings = this.plugin.settings;
		const inactiveTimeoutMs = settings.inactiveTimeoutMinutes * 60 * 1000;

		let totalLeaves = 0;
		const statusList: Array<{
			fileName: string;
			isActive: boolean;
			isPinned: boolean;
			lastActivity: number;
			inactiveTime: number;
			willClose: boolean;
		}> = [];

		// Only show status for root leaves (main workspace tabs)
		this.plugin.app.workspace.iterateRootLeaves((leaf) => {
			totalLeaves++;
			const viewState = leaf.getViewState();
			const fileName = this.getLeafName(leaf);
			const isActive = leaf === activeLeaf;
			const isPinned = viewState.pinned || false;
			const lastActivity = this.leafActivityMap.get(leaf) ?? now;
			const inactiveTime = now - lastActivity;
			const willClose = !isPinned && !isActive && inactiveTime >= inactiveTimeoutMs;

			statusList.push({
				fileName,
				isActive,
				isPinned,
				lastActivity,
				inactiveTime,
				willClose,
			});
		});

		// Sort: active first, then pinned, then by inactivity desc
		statusList.sort((a, b) => {
			if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
			if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
			return b.inactiveTime - a.inactiveTime;
		});

		this.showStatusModal(statusList, totalLeaves, settings.inactiveTimeoutMinutes);
	}

	private showStatusModal(
		statusList: Array<{
			fileName: string;
			isActive: boolean;
			isPinned: boolean;
			lastActivity: number;
			inactiveTime: number;
			willClose: boolean;
		}>,
		totalLeaves: number,
		timeoutMinutes: number
	): void {
		class StatusModal extends Modal {
			private readonly items: typeof statusList;
			private readonly total: number;
			private readonly timeout: number;

			constructor(plugin: PluginWithSettings, items: typeof statusList, total: number, timeout: number) {
				super(plugin.app);
				this.items = items;
				this.total = total;
				this.timeout = timeout;
			}

			onOpen(): void {
				const { contentEl } = this;
				contentEl.empty();
				contentEl.createEl("h2", { text: "Tab activity status" }).addClass("act-status-title");
				contentEl
					.createEl("p", { text: `Total tabs: ${this.total} • Timeout: ${this.timeout} min` })
					.addClass("act-status-count");

				const listContainer = contentEl.createDiv({ cls: "act-status-list" });
				for (const item of this.items) {
					const row = listContainer.createDiv({ cls: "act-status-row" });
					const name = row.createSpan({ text: item.fileName });
					name.addClass("act-status-file");

					const flags: string[] = [];
					if (item.isActive) flags.push("Active");
					if (item.isPinned) flags.push("Pinned");
					if (item.willClose) flags.push("Will close");
					const flagText = flags.length ? ` • ${flags.join(" / ")}` : "";

					const inactiveMinutes = Math.floor(item.inactiveTime / 60000);
					const inactiveSeconds = Math.floor((item.inactiveTime % 60000) / 1000);
					const last = new Date(item.lastActivity).toLocaleTimeString();

					row.createSpan({
						text: `${flagText ? flagText : ""} • Inactive ${inactiveMinutes}m ${inactiveSeconds}s (last ${last})`,
					}).addClass("act-status-meta");
				}

				const hint = contentEl.createEl("p", {
					text: "Only main workspace tabs are shown. Pinned and active tabs are never closed.",
				});
				hint.addClass("act-status-hint");
			}

			onClose(): void {
				this.contentEl.empty();
			}
		}

		new StatusModal(this.plugin, statusList, totalLeaves, timeoutMinutes).open();
	}
}
