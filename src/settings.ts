export interface ClosedTabEntry {
	timestamp: number;
	fileName: string;
	inactiveTimeMinutes: number;
	filePath?: string;
}

export interface AutoCloseTabsSettings {
	enabled: boolean;
	inactiveTimeoutMinutes: number;
	checkIntervalSeconds: number;
	logHistory: boolean;
	logToFile: boolean;
	logFilePath: string;
	maxHistoryEntries: number;
}

export const DEFAULT_SETTINGS: AutoCloseTabsSettings = {
	enabled: true,
	inactiveTimeoutMinutes: 1440, // 24 hours
	checkIntervalSeconds: 60,
	logHistory: true,
	logToFile: false,
	logFilePath: "system/auto-close-tabs-history.md",
	maxHistoryEntries: 1000,
};

