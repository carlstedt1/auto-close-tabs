# Auto Close Tabs

Automatically close inactive tabs after a configurable period. Keep your workspace clean by treating unpinned tabs as "fleeting", inspired by the Fleeting Tabs feature in the Arc browser.

**Current version: 1.0.0**

## ✨ Features

- **Auto-close inactive tabs**: Automatically closes tabs that haven't been touched for a set time (default: 1 day).
- **Pinned tabs are safe**: Pinned tabs are never closed, making them "permanent."
- **Configurable timeout**: Set your own inactivity threshold (e.g., 5 minutes or 2 hours).
- **History logging**: Keep a log of all closed tabs to review what was cleaned up.
  - View history in a modal.
  - Export history to the developer console.
  - Optionally write history to a markdown file in your vault (e.g., `system/auto-close-tabs-history.md`).

## 💡 Inspiration

This plugin was inspired by the **Fleeting Tabs** feature in the [Arc browser](https://arc.net/). 

I tend to open tabs very freely, which leads to a cluttered workspace full of files I'm no longer using. I wanted a way to be deliberate about what stays open:
- If I want to keep a file, I **pin** it.
- If I don't pin it, it's **fleeting** and will disappear when I'm done with it.

This plugin brings that "fleeting" workflow to Obsidian, helping you keep your digital garden tidy automatically.

## 🚀 Installation

1. Open **Settings** → **Community plugins** in Obsidian.
2. Search for **Auto Close Tabs**.
3. Click **Install** and then **Enable**.

Alternatively, for manual installation:
1. Copy `main.js`, `manifest.json`, and `styles.css` into `Vault/.obsidian/plugins/auto-close-tabs/`.
2. Reload Obsidian and enable the plugin.

## 🧭 Usage

1. **Pin important tabs**: Right-click a tab and select "Pin" (or use a hotkey) to keep it safe.
2. **Let it run**: Work as usual. Tabs you leave unpinned will automatically close after they've been inactive for the configured time.
3. **Review history**:
   - Use the command palette (`Cmd/Ctrl + P`) and search for **"Auto Close Tabs: View closed tabs history"**.
   - Or check the log file if you've enabled file logging.

## ⚙️ Settings

| Setting | Default | Description |
| :--- | :--- | :--- |
| **Enable auto-close** | On | Toggle the entire plugin on or off. |
| **Inactive timeout** | 1440 min (1 day) | How many minutes a tab must be inactive before closing. |
| **Check interval** | 60 sec | How often the plugin checks for inactive tabs. |
| **Enable history logging** | On | Track closed tabs in an internal log. |
| **Max history entries** | 1000 | Limit how many entries are kept in history. |
| **Write to file** | Off | Also append closed tab logs to a specific markdown file. |
| **Log file path** | `system/...` | The path to the log file (if "Write to file" is on). |

## 🪲 Troubleshooting

- **"My tab closed while I was reading it!"**  
  The plugin tracks *activity* (clicking, typing, scrolling). If you stare at a static page for longer than your timeout (e.g., 30 mins), it might close. Consider increasing your timeout or pinning reference material.
- **"It's closing sidebars!"**  
  Version 1.0.0+ explicitly ignores sidebar panels (like File Explorer or Search) and only closes actual editor tabs in the main workspace.

## 🤝 Contributing

Contributions are welcome! Please see [AGENTS.md](./AGENTS.md) for developer notes and build instructions.
