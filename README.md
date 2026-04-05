# Dashora – ADHD Organizer

A client-side sticky-board organizer built for people with ADHD. Sections hold items with titles, descriptions, and links — all stored locally in your browser using SQLite (via [sql.js](https://github.com/sql-js/sql.js)) persisted to IndexedDB.

**No server. No accounts. Your data stays on your machine.**

## Features

- **Sections** — color-coded categories (Tasks, Regressions, Watch, etc.)
- **Items** — each item has a title, description, and optional link
- **Expand / Collapse** — click an item to see full details
- **Mark Done** — check off tasks; they move to a collapsible "Done" section
- **Drag & Drop** — reorder items and sections by dragging
- **Search** — `Ctrl+K` to search across all sections
- **Export / Import** — backup and restore your data as JSON
- **Dark theme** — easy on the eyes
- **Mobile friendly** — responsive sidebar

## Getting Started

1. Clone this repo
2. Open `index.html` in your browser — that's it!

```
git clone https://github.com/<your-username>/Dashora.git
cd Dashora
start index.html
```

No build step, no dependencies to install. Everything runs in the browser.

## Project Structure

```
Dashora/
├── index.html          # HTML shell
├── css/
│   └── style.css       # All styles
├── js/
│   ├── db.js           # SQLite init, schema, seed data, persistence
│   └── app.js          # Rendering, CRUD, drag-drop, search, export/import
└── README.md
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Focus search |
| `Escape` | Close modals |
| `Enter` | Submit modal forms |

## Data Storage

All data is stored in your browser's IndexedDB as a SQLite database. Clearing browser data will erase it — use **Export** to create backups.

## License

MIT
