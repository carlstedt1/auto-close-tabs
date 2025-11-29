import { Plugin } from "obsidian";
import { AutoCloseTabsSettingTab } from "./settingsTab";
import { AutoCloseTabsSettings, DEFAULT_SETTINGS } from "./settings";
import { TabManager } from "./utils/tabManager";

export default class AutoCloseTabsPlugin extends Plugin {
	settings: AutoCloseTabsSettings;
	tabManager: TabManager;

	async onload(): Promise<void> {
		console.debug("[AutoCloseTabs] Plugin loading...");
		await this.loadSettings();
		console.debug("[AutoCloseTabs] Settings loaded:", this.settings);

		this.tabManager = new TabManager(this);
		await this.tabManager.historyManager.loadHistory();
		this.tabManager.start();

		this.addSettingTab(new AutoCloseTabsSettingTab(this.app, this));

		// Add command to manually check for inactive tabs (for testing)
		this.addCommand({
			id: "check-inactive-tabs",
			name: "Check for inactive tabs now",
			callback: async () => {
				await this.tabManager.manualCheck();
			},
		});

		// Add command to show tab status (for debugging)
		this.addCommand({
			id: "show-tab-status",
			name: "Show tab activity status",
			callback: () => {
				this.tabManager.showStatus();
			},
		});

		// Add command to view closed tabs history
		this.addCommand({
			id: "view-closed-tabs-history",
			name: "View closed tabs history",
			callback: () => {
				this.tabManager.historyManager.showHistoryModal();
			},
		});

		// Add command to export history to console
		this.addCommand({
			id: "export-history-console",
			name: "Export history to console",
			callback: () => {
				const history = this.tabManager.historyManager.exportHistory();
				console.debug(history);
			},
		});

		console.debug("[AutoCloseTabs] Plugin loaded successfully");
	}

	onunload(): void {
		this.tabManager.stop();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
