import { App, PluginSettingTab, Setting } from "obsidian";
import type AutoCloseTabsPlugin from "./main";
import { DEFAULT_SETTINGS } from "./settings";

export class AutoCloseTabsSettingTab extends PluginSettingTab {
	plugin: AutoCloseTabsPlugin;

	constructor(app: App, plugin: AutoCloseTabsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		// Auto Close Tabs section heading (larger)
		const mainHeading = new Setting(containerEl)
			.setName("Auto Close Tabs")
			.setHeading();
		mainHeading.settingEl.addClass("auto-close-tabs-main-heading");

		new Setting(containerEl)
			.setName("Enable auto-close")
			.setDesc("Automatically close inactive tabs after the specified timeout")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enabled)
					.onChange(async (value) => {
						this.plugin.settings.enabled = value;
						await this.plugin.saveSettings();
						this.plugin.tabManager.updateSettings();
					})
			);

		new Setting(containerEl)
			.setName("Inactive timeout (minutes)")
			.setDesc(
				"Close tabs that have been inactive for this many minutes"
			)
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.inactiveTimeoutMinutes))
					.setValue(String(this.plugin.settings.inactiveTimeoutMinutes))
					.onChange(async (value) => {
						const numValue = Number.parseInt(value, 10);
						if (!Number.isNaN(numValue) && numValue > 0) {
							this.plugin.settings.inactiveTimeoutMinutes = numValue;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName("Check interval (seconds)")
			.setDesc(
				"How often to check for inactive tabs (in seconds)"
			)
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.checkIntervalSeconds))
					.setValue(String(this.plugin.settings.checkIntervalSeconds))
					.onChange(async (value) => {
						const numValue = Number.parseInt(value, 10);
						if (!Number.isNaN(numValue) && numValue > 0) {
							this.plugin.settings.checkIntervalSeconds = numValue;
							await this.plugin.saveSettings();
							this.plugin.tabManager.updateSettings();
						}
					})
			);

		// History Logging section with proper heading
		new Setting(containerEl)
			.setName("History Logging")
			.setHeading();

		new Setting(containerEl)
			.setName("Enable history logging")
			.setDesc("Keep a history of closed tabs")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.logHistory)
					.onChange(async (value) => {
						this.plugin.settings.logHistory = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Max history entries")
			.setDesc("Maximum number of history entries to keep (oldest entries will be removed)")
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.maxHistoryEntries))
					.setValue(String(this.plugin.settings.maxHistoryEntries))
					.onChange(async (value) => {
						const numValue = Number.parseInt(value, 10);
						if (!Number.isNaN(numValue) && numValue > 0) {
							this.plugin.settings.maxHistoryEntries = numValue;
							await this.plugin.saveSettings();
						}
					})
			);

		// Store reference to the file path input so we can enable/disable it
		let logFilePathInput: HTMLInputElement | null = null;

		// Create write to file setting first (appears before log file path)
		new Setting(containerEl)
			.setName("Write to file")
			.setDesc("Also write history entries to a note file")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.logToFile);
				toggle.onChange(async (value) => {
					this.plugin.settings.logToFile = value;
					await this.plugin.saveSettings();
					// Update the file path input's disabled state
					if (logFilePathInput) {
						if (value) {
							logFilePathInput.removeAttribute("disabled");
						} else {
							logFilePathInput.setAttribute("disabled", "true");
						}
					}
				});
			});

		// Create file path setting second (appears after write to file)
		new Setting(containerEl)
			.setName("Log file path")
			.setDesc("Path to the log file (e.g., 'system/auto-close-tabs-history.md')")
			.addText((text) => {
				text
					.setPlaceholder(DEFAULT_SETTINGS.logFilePath)
					.setValue(this.plugin.settings.logFilePath || DEFAULT_SETTINGS.logFilePath)
					.setDisabled(!this.plugin.settings.logToFile)
					.onChange(async (value) => {
						this.plugin.settings.logFilePath = value || DEFAULT_SETTINGS.logFilePath;
						await this.plugin.saveSettings();
					});
				// Store reference to the input element for the toggle to use
				logFilePathInput = text.inputEl;
			});
	}
}

