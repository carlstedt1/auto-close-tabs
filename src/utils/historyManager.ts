import { App, Modal, Notice, Plugin, normalizePath, TFile, TFolder } from "obsidian";
import type { AutoCloseTabsSettings, ClosedTabEntry } from "../settings";
import { DEFAULT_SETTINGS } from "../settings";

interface PluginWithSettings extends Plugin {
	settings: AutoCloseTabsSettings;
	loadData(): Promise<{ closedTabsHistory?: ClosedTabEntry[] } | null>;
	saveData(data: Record<string, unknown>): Promise<void>;
}

export class HistoryManager {
	private plugin: PluginWithSettings;
	private history: ClosedTabEntry[] = [];

	constructor(plugin: PluginWithSettings) {
		this.plugin = plugin;
	}

	async loadHistory(): Promise<void> {
		const data = await this.plugin.loadData();
		if (data?.closedTabsHistory && Array.isArray(data.closedTabsHistory)) {
			this.history = data.closedTabsHistory;
			console.debug(`[AutoCloseTabs] Loaded ${this.history.length} history entries`);
		}
	}

	async saveHistory(): Promise<void> {
		const settings = this.plugin.settings;
		if (!settings.logHistory) {
			return;
		}

		// Trim history if it exceeds max entries
		if (this.history.length > settings.maxHistoryEntries) {
			this.history = this.history.slice(-settings.maxHistoryEntries);
		}

		const existingData = (await this.plugin.loadData()) ?? {};

		await this.plugin.saveData({
			...existingData,
			closedTabsHistory: this.history,
		});
	}

	async addEntry(entry: ClosedTabEntry): Promise<void> {
		const settings = this.plugin.settings;
		if (!settings.logHistory) {
			return;
		}

		this.history.push(entry);

		// Trim if needed
		if (this.history.length > settings.maxHistoryEntries) {
			this.history = this.history.slice(-settings.maxHistoryEntries);
		}

		await this.saveHistory();

		// Optionally write to file
		if (settings.logToFile) {
			await this.writeToFile(entry);
		}
	}

	private async writeToFile(entry: ClosedTabEntry): Promise<void> {
		try {
			const settings = this.plugin.settings;
			const filePath = normalizePath(settings.logFilePath || DEFAULT_SETTINGS.logFilePath);
			const existing = this.plugin.app.vault.getAbstractFileByPath(filePath);
			let file = existing instanceof TFile ? existing : null;

			const timestamp = new Date(entry.timestamp).toLocaleString();
			const line = `- \`${timestamp}\` - **${entry.fileName}** (inactive for ${entry.inactiveTimeMinutes.toFixed(1)} minutes)${entry.filePath ? ` - \`${entry.filePath}\`` : ""}\n`;

			if (file) {
				// Append to existing file
				await this.plugin.app.vault.append(file, line);
			} else {
				// Check if parent folder exists, create it if it doesn't
				const pathParts = filePath.split("/");
				if (pathParts.length > 1) {
					const folderPath = pathParts.slice(0, -1).join("/");
					const folder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
					if (!folder || !(folder instanceof TFolder)) {
						// Folder doesn't exist, create it
						try {
							await this.plugin.app.vault.createFolder(folderPath);
							console.debug(`[AutoCloseTabs] Created folder: ${folderPath}`);
						} catch (folderError: unknown) {
							// If folder creation fails (e.g., already exists), continue
							if (!(folderError instanceof Error) || !folderError.message.includes("already exists")) {
								console.error("[AutoCloseTabs] Error creating folder:", folderError);
							}
						}
					}
				}

				// Create new file with header
				const content = `# Auto-Close Tabs Log\n\nThis file logs tabs that have been automatically closed by the Auto Close Tabs plugin.\n\n---\n\n${line}`;
				try {
					file = await this.plugin.app.vault.create(filePath, content);
					console.debug(`[AutoCloseTabs] Created log file: ${filePath}`);
				} catch (createError: unknown) {
					// If file already exists (race condition), try to append instead
					if (createError instanceof Error && createError.message.includes("already exists")) {
						const existingFile = this.plugin.app.vault.getAbstractFileByPath(filePath);
						if (existingFile instanceof TFile) {
							file = existingFile;
							await this.plugin.app.vault.append(file, line);
						}
					} else {
						throw createError;
					}
				}
			}
		} catch (error) {
			console.error("[AutoCloseTabs] Error writing to log file:", error);
		}
	}

	getHistory(): ClosedTabEntry[] {
		return [...this.history].reverse(); // Return most recent first
	}

	clearHistory(): void {
		this.history = [];
	}

	exportHistory(): string {
		if (this.history.length === 0) {
			return "No closed tabs history.";
		}

		let output = "# Auto-Close Tabs History\n\n";
		output += `Total entries: ${this.history.length}\n\n`;
		output += "---\n\n";

		// Group by date
		const grouped: Record<string, ClosedTabEntry[]> = {};
		for (const entry of [...this.history].reverse()) {
			const date = new Date(entry.timestamp).toLocaleDateString();
			if (!grouped[date]) {
				grouped[date] = [];
			}
			grouped[date].push(entry);
		}

		// Sort dates (most recent first)
		const dates = Object.keys(grouped).sort((a, b) => {
			return new Date(b).getTime() - new Date(a).getTime();
		});

		for (const date of dates) {
			output += `## ${date}\n\n`;
			for (const entry of grouped[date]) {
				const time = new Date(entry.timestamp).toLocaleTimeString();
				output += `- \`${time}\` - **${entry.fileName}** (inactive for ${entry.inactiveTimeMinutes.toFixed(1)} minutes)${entry.filePath ? ` - \`${entry.filePath}\`` : ""}\n`;
			}
			output += "\n";
		}

		return output;
	}

	showHistoryModal(): void {
		class ConfirmClearHistoryModal extends Modal {
			private onConfirm: () => Promise<void>;

			constructor(app: App, onConfirm: () => Promise<void>) {
				super(app);
				this.onConfirm = onConfirm;
			}

			onOpen(): void {
				const { contentEl } = this;
				contentEl.empty();

				contentEl.createEl("h3", { text: "Clear history?" }).addClass("act-history-title");
				contentEl.createEl("p", { text: "This will remove all saved closed tab entries." }).addClass("act-history-muted");

				const buttons = contentEl.createDiv({ cls: "act-history-button-row" });
				const cancelBtn = buttons.createEl("button", { text: "Cancel" });
				cancelBtn.onclick = () => this.close();

				const confirmBtn = buttons.createEl("button", { text: "Clear history", cls: "mod-warning" });
				confirmBtn.onclick = async () => {
					await this.onConfirm();
					this.close();
				};
			}

			onClose(): void {
				this.contentEl.empty();
			}
		}

		class HistoryModal extends Modal {
			private historyManager: HistoryManager;

			constructor(app: App, historyManager: HistoryManager) {
				super(app);
				this.historyManager = historyManager;
			}

			onOpen() {
				const { contentEl } = this;
				contentEl.empty();
				
				contentEl.createEl("h2", { text: "Auto-close tabs history" }).addClass("act-history-title");

				const history = this.historyManager.getHistory();
				if (history.length === 0) {
					contentEl.createEl("p", { text: "No closed tabs history yet." }).addClass("act-history-empty");
					return;
				}

				const countEl = contentEl.createEl("p", {
					text: `Total entries: ${history.length}`,
				});
				countEl.addClass("act-history-count");

				const container = contentEl.createDiv({ cls: "act-history-scroll" });

				// Group by date
				const grouped: Record<string, ClosedTabEntry[]> = {};
				for (const entry of history) {
					const date = new Date(entry.timestamp).toLocaleDateString();
					if (!grouped[date]) {
						grouped[date] = [];
					}
					grouped[date].push(entry);
				}

				// Sort dates (most recent first)
				const dates = Object.keys(grouped).sort((a, b) => {
					return new Date(b).getTime() - new Date(a).getTime();
				});

				for (const date of dates) {
					const dateHeader = container.createEl("h3", { text: date });
					dateHeader.addClass("act-history-date");

					const list = container.createEl("ul");
					list.addClass("act-history-list");
					
					for (const entry of grouped[date]) {
						const time = new Date(entry.timestamp).toLocaleTimeString();
						const item = list.createEl("li");
						item.addClass("act-history-item");
						
						const timeSpan = item.createSpan({ text: `${time} - ` });
						timeSpan.addClass("act-history-muted");
						
						const fileNameEl = item.createEl("strong", { text: entry.fileName });
						fileNameEl.addClass("act-history-file");
						
						const inactiveSpan = item.createSpan({
							text: ` (inactive for ${entry.inactiveTimeMinutes.toFixed(1)} minutes)`,
						});
						inactiveSpan.addClass("act-history-muted");
						
						if (entry.filePath) {
							const pathEl = item.createEl("code", { text: ` - ${entry.filePath}` });
							pathEl.addClass("act-history-path");
						}
					}
				}

				// Add clear button
				const buttonContainer = contentEl.createDiv({ cls: "act-history-button-row" });
				
				const clearButton = buttonContainer.createEl("button", {
					text: "Clear history",
					cls: "mod-warning",
				});
				clearButton.onclick = () => {
					const confirmModal = new ConfirmClearHistoryModal(this.app, async () => {
						this.historyManager.clearHistory();
						await this.historyManager.saveHistory();
						new Notice("History cleared");
						this.close();
					});
					confirmModal.open();
				};
			}

			onClose() {
				const { contentEl } = this;
				contentEl.empty();
			}
		}

		try {
			const modal = new HistoryModal(this.plugin.app, this);
			modal.open();
			console.debug("[AutoCloseTabs] History modal opened");
		} catch (error) {
			console.error("[AutoCloseTabs] Error opening history modal:", error);
			new Notice("Error opening history modal. Check console for details.");
		}
	}
}
