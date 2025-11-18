import { Plugin, WorkspaceLeaf } from "obsidian";
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
		console.log("[AutoCloseTabs] Starting tab manager");
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
		console.log(`[AutoCloseTabs] Initialized tracking for ${leafCount} root leaves (main workspace tabs only)`);
	}

	private registerActiveLeafChangeListener(): void {
		// Track when active leaf changes (only for root leaves)
		this.plugin.registerEvent(
			this.plugin.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf && this.isRootLeaf(leaf)) {
					const viewState = leaf.getViewState();
					const file = (leaf.view as any)?.file;
					const fileName = file?.name || viewState.type;
					this.leafActivityMap.set(leaf, Date.now());
					console.log(`[AutoCloseTabs] Active root leaf changed: ${fileName} (pinned: ${viewState.pinned})`);
				}
			})
		);

		// Also track when files are opened (only for root leaves)
		this.plugin.registerEvent(
			this.plugin.app.workspace.on("file-open", (file) => {
				if (file && this.plugin.app.workspace.activeLeaf) {
					const leaf = this.plugin.app.workspace.activeLeaf;
					if (this.isRootLeaf(leaf)) {
						const viewState = leaf.getViewState();
						const fileName = file.name;
						this.leafActivityMap.set(leaf, Date.now());
						console.log(`[AutoCloseTabs] File opened in root leaf: ${fileName} (pinned: ${viewState.pinned})`);
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

			// Check if the leaf's container is in the root split
			const container = leaf.getContainer();
			if (!container) return false;

			// Walk up the parent chain to see if we're under rootSplit
			let current: any = container;
			while (current) {
				if (current === root) {
					return true;
				}
				// Check if we've hit a sidebar split - if so, this is not a root leaf
				if (current === this.plugin.app.workspace.leftSplit || current === this.plugin.app.workspace.rightSplit) {
					return false;
				}
				current = current.parent;
			}
			return false;
		} catch (e) {
			console.error("[AutoCloseTabs] Error checking if leaf is root:", e);
			return false;
		}
	}

	private startPeriodicCheck(): void {
		const settings = this.plugin.settings;
		if (!settings.enabled) {
			console.log("[AutoCloseTabs] Plugin is disabled, not starting periodic check");
			return;
		}

		const checkIntervalMs = settings.checkIntervalSeconds * 1000;
		const inactiveTimeoutMs = settings.inactiveTimeoutMinutes * 60 * 1000;

		console.log(
			`[AutoCloseTabs] Starting periodic check: interval=${checkIntervalMs}ms, timeout=${inactiveTimeoutMs}ms (${settings.inactiveTimeoutMinutes} min)`
		);

		const intervalId = window.setInterval(() => {
			this.checkAndCloseInactiveTabs(inactiveTimeoutMs).catch((err) => {
				console.error("[AutoCloseTabs] Error in periodic check:", err);
			});
		}, checkIntervalMs);

		this.checkInterval = this.plugin.registerInterval(intervalId);
		console.log(`[AutoCloseTabs] Periodic check interval registered: ${this.checkInterval}`);
	}

	private async checkAndCloseInactiveTabs(inactiveTimeoutMs: number): Promise<void> {
		const settings = this.plugin.settings;
		if (!settings.enabled) {
			return;
		}

		const now = Date.now();
		const activeLeaf = this.plugin.app.workspace.activeLeaf;
		const activeViewState = activeLeaf?.getViewState();
		const activeFile = (activeLeaf?.view as any)?.file;
		const activeFileName = activeFile?.name || activeViewState?.type || "none";

		console.log(`[AutoCloseTabs] Checking for inactive tabs (active: ${activeFileName})`);

		const leavesToClose: Array<{ leaf: WorkspaceLeaf; inactiveTime: number; fileName: string }> = [];
		let totalLeaves = 0;
		let pinnedCount = 0;
		let activeCount = 0;

		// Only check leaves in the main workspace area (root split), not sidebar panes
		this.plugin.app.workspace.iterateRootLeaves((leaf) => {
			totalLeaves++;
			const viewState = leaf.getViewState();
			const file = (leaf.view as any)?.file;
			const fileName = file?.name || viewState.type || "unknown";

			// Skip pinned tabs
			if (viewState.pinned) {
				pinnedCount++;
				console.log(`[AutoCloseTabs]   - Skipping pinned tab: ${fileName}`);
				return;
			}

			// Skip currently active leaf
			if (leaf === activeLeaf) {
				activeCount++;
				console.log(`[AutoCloseTabs]   - Skipping active tab: ${fileName}`);
				return;
			}

			// Get last activity time, default to now if not tracked
			const lastActivity = this.leafActivityMap.get(leaf);
			if (!lastActivity) {
				console.log(`[AutoCloseTabs]   - Warning: No activity record for ${fileName}, using current time`);
				this.leafActivityMap.set(leaf, now);
				return;
			}

			const inactiveTime = now - lastActivity;
			const inactiveMinutes = Math.floor(inactiveTime / 60000);
			const inactiveSeconds = Math.floor((inactiveTime % 60000) / 1000);

			console.log(
				`[AutoCloseTabs]   - Tab: ${fileName}, inactive: ${inactiveMinutes}m ${inactiveSeconds}s (threshold: ${inactiveTimeoutMs / 60000} min)`
			);

			if (inactiveTime >= inactiveTimeoutMs) {
				leavesToClose.push({ leaf, inactiveTime, fileName });
			}
		});

		console.log(
			`[AutoCloseTabs] Summary: ${totalLeaves} total, ${pinnedCount} pinned, ${activeCount} active, ${leavesToClose.length} to close`
		);

		// Close inactive tabs
		for (const { leaf, inactiveTime, fileName } of leavesToClose) {
			const inactiveMinutes = Math.floor(inactiveTime / 60000);
			const inactiveTimeMinutes = inactiveTime / 60000;
			console.log(`[AutoCloseTabs] Closing inactive tab: ${fileName} (inactive for ${inactiveMinutes} minutes)`);
			
			// Log to history
			const file = (leaf.view as any)?.file;
			const filePath = file?.path;
			await this.historyManager.addEntry({
				timestamp: Date.now(),
				fileName: fileName,
				inactiveTimeMinutes: inactiveTimeMinutes,
				filePath: filePath,
			});

			leaf.detach();
		}

		if (leavesToClose.length > 0) {
			console.log(`[AutoCloseTabs] Closed ${leavesToClose.length} inactive tab(s)`);
		}
	}

	updateSettings(): void {
		console.log("[AutoCloseTabs] Updating settings, restarting tab manager");
		this.stop();
		this.start();
	}

	async manualCheck(): Promise<void> {
		const settings = this.plugin.settings;
		if (!settings.enabled) {
			console.log("[AutoCloseTabs] Plugin is disabled, cannot check");
			return;
		}
		const inactiveTimeoutMs = settings.inactiveTimeoutMinutes * 60 * 1000;
		console.log("[AutoCloseTabs] Manual check triggered");
		await this.checkAndCloseInactiveTabs(inactiveTimeoutMs);
	}

	showStatus(): void {
		const now = Date.now();
		const activeLeaf = this.plugin.app.workspace.activeLeaf;
		const settings = this.plugin.settings;
		const inactiveTimeoutMs = settings.inactiveTimeoutMinutes * 60 * 1000;

		console.log("=== [AutoCloseTabs] Tab Status ===");
		console.log(`Settings: enabled=${settings.enabled}, timeout=${settings.inactiveTimeoutMinutes} min, check interval=${settings.checkIntervalSeconds} s`);
		console.log(`Current time: ${new Date(now).toLocaleTimeString()}`);

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
			const file = (leaf.view as any)?.file;
			const fileName = file?.name || viewState.type || "unknown";
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

		console.log(`Total leaves: ${totalLeaves}`);
		for (const status of statusList) {
			const inactiveMinutes = Math.floor(status.inactiveTime / 60000);
			const inactiveSeconds = Math.floor((status.inactiveTime % 60000) / 1000);
			const lastActivityDate = new Date(status.lastActivity).toLocaleTimeString();
			const flags = [
				status.isActive ? "ACTIVE" : "",
				status.isPinned ? "PINNED" : "",
				status.willClose ? "WILL_CLOSE" : "",
			]
				.filter(Boolean)
				.join(", ");

			console.log(
				`  - ${status.fileName}: inactive ${inactiveMinutes}m ${inactiveSeconds}s (last: ${lastActivityDate}) ${flags ? `[${flags}]` : ""}`
			);
		}
		console.log("=== End Status ===");
	}
}

