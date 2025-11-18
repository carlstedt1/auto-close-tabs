import { App, Modal, Notice, normalizePath, TFile, TFolder } from "obsidian";
import type { AutoCloseTabsSettings, ClosedTabEntry } from "../settings";
import { DEFAULT_SETTINGS } from "../settings";

export class HistoryManager {
	private plugin: any; // PluginWithSettings
	private history: ClosedTabEntry[] = [];

	constructor(plugin: any) {
		this.plugin = plugin;
	}

	async loadHistory(): Promise<void> {
		const data = await this.plugin.loadData();
		if (data && data.closedTabsHistory) {
			this.history = data.closedTabsHistory;
			console.log(`[AutoCloseTabs] Loaded ${this.history.length} history entries`);
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

		await this.plugin.saveData({
			...await this.plugin.loadData(),
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
			let file = this.plugin.app.vault.getAbstractFileByPath(filePath) as TFile | null;

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
							console.log(`[AutoCloseTabs] Created folder: ${folderPath}`);
						} catch (folderError: any) {
							// If folder creation fails (e.g., already exists), continue
							if (!folderError.message?.includes("already exists")) {
								console.error("[AutoCloseTabs] Error creating folder:", folderError);
							}
						}
					}
				}

				// Create new file with header
				const content = `# Auto-Close Tabs Log\n\nThis file logs tabs that have been automatically closed by the Auto Close Tabs plugin.\n\n---\n\n${line}`;
				try {
					file = await this.plugin.app.vault.create(filePath, content);
					console.log(`[AutoCloseTabs] Created log file: ${filePath}`);
				} catch (createError: any) {
					// If file already exists (race condition), try to append instead
					if (createError.message?.includes("already exists")) {
						file = this.plugin.app.vault.getAbstractFileByPath(filePath) as TFile;
						if (file) {
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

	async exportHistory(): Promise<string> {
		if (this.history.length === 0) {
			return "No closed tabs history.";
		}

		let output = "# Auto-Close Tabs History\n\n";
		output += `Total entries: ${this.history.length}\n\n`;
		output += "---\n\n";

		// Group by date
		const grouped: Record<string, ClosedTabEntry[]> = {};
		for (const entry of this.history.reverse()) {
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
		class HistoryModal extends Modal {
			private historyManager: HistoryManager;

			constructor(app: App, historyManager: HistoryManager) {
				super(app);
				this.historyManager = historyManager;
			}

			onOpen() {
				const { contentEl } = this;
				contentEl.empty();
				
				const title = contentEl.createEl("h2", { text: "Auto-Close Tabs History" });
				title.style.marginBottom = "1em";

				const history = this.historyManager.getHistory();
				if (history.length === 0) {
					const emptyMsg = contentEl.createEl("p", { text: "No closed tabs history yet." });
					emptyMsg.style.textAlign = "center";
					emptyMsg.style.padding = "2em";
					emptyMsg.style.color = "var(--text-muted)";
					return;
				}

				const countEl = contentEl.createEl("p", {
					text: `Total entries: ${history.length}`,
				});
				countEl.style.marginBottom = "1em";
				countEl.style.fontWeight = "bold";

				const container = contentEl.createDiv();
				container.style.maxHeight = "60vh";
				container.style.overflowY = "auto";
				container.style.padding = "0.5em";
				container.style.border = "1px solid var(--background-modifier-border)";
				container.style.borderRadius = "4px";

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
					dateHeader.style.marginTop = "1em";
					dateHeader.style.marginBottom = "0.5em";
					dateHeader.style.fontSize = "1.1em";

					const list = container.createEl("ul");
					list.style.listStyle = "disc";
					list.style.paddingLeft = "1.5em";
					
					for (const entry of grouped[date]) {
						const time = new Date(entry.timestamp).toLocaleTimeString();
						const item = list.createEl("li");
						item.style.marginBottom = "0.5em";
						
						const timeSpan = item.createSpan({ text: `${time} - ` });
						timeSpan.style.color = "var(--text-muted)";
						
						const fileNameEl = item.createEl("strong", { text: entry.fileName });
						fileNameEl.style.color = "var(--text-normal)";
						
						const inactiveSpan = item.createSpan({
							text: ` (inactive for ${entry.inactiveTimeMinutes.toFixed(1)} minutes)`,
						});
						inactiveSpan.style.color = "var(--text-muted)";
						
						if (entry.filePath) {
							const pathEl = item.createEl("code", { text: ` - ${entry.filePath}` });
							pathEl.style.marginLeft = "0.5em";
							pathEl.style.fontSize = "0.9em";
						}
					}
				}

				// Add clear button
				const buttonContainer = contentEl.createDiv();
				buttonContainer.style.marginTop = "1em";
				buttonContainer.style.textAlign = "center";
				
				const clearButton = buttonContainer.createEl("button", {
					text: "Clear History",
					cls: "mod-warning",
				});
				clearButton.onclick = async () => {
					if (confirm("Are you sure you want to clear the history?")) {
						this.historyManager.clearHistory();
						await this.historyManager.saveHistory();
						new Notice("History cleared");
						this.close();
					}
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
			console.log("[AutoCloseTabs] History modal opened");
		} catch (error) {
			console.error("[AutoCloseTabs] Error opening history modal:", error);
			new Notice("Error opening history modal. Check console for details.");
		}
	}
}

