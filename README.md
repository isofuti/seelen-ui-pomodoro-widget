# Pomodoro Tracker Widget & Plugin for Seelen UI

A beautiful, glassmorphic Pomodoro productivity tracker widget and taskbar plugin built specifically for the **Seelen UI** desktop environment.

![Preview](public/favicon.svg)

## Features

- **Top Bar Integration**: Adds a custom Pomodoro button (with icon) to the Seelen UI top bar. Clicking it opens the popup widget positioned directly below the button.
- **Timer & Controls**: Circular progress ring showing time remaining, with buttons to Start/Pause, Reset, and Skip sessions.
- **Workday Progress Grid**: Displays visual indicators (dots) for completed and remaining pomodoros for the day (supports up to 10 pomodoros).
- **In-Widget Controls**: Instantly increase or decrease daily target pomodoros. Changes are written directly to Seelen UI's settings config on disk.
- **Notifications & Sound**: Triggers OS push notifications upon completion of sessions and plays a synthesized bell sound (Web Audio API) even if system notifications are silenced.
- **State Persistence**: Automatically tracks completed pomodoros for the current date using `localStorage` (resets on date change).

---

## Installation & Running Locally

### 1. Prerequisites
- **Seelen UI** installed and running on Windows 10/11.
- **Node.js** (version 18+) and **npm** installed on your system.

### 2. Setup and Build
Clone or copy this repository to your computer, open a terminal in the folder, and run:
```bash
# Install dependencies
npm install

# Build the project
npm run build
```
Vite will compile the code and copy all resource manifests to the `./dist/` directory.

### 3. Load into Seelen UI
Run the following command in your terminal to register and load the widget on the fly (Seelen UI must be running):
```bash
slu resource load widget ./dist
```
- Open **Seelen UI Settings** -> **Widgets** to verify that "Pomodoro Tracker" is present and active.
- The Pomodoro button should appear on your top bar. Click it to open the tracker!

---

## Distributing / Sharing the Plugin

To share this widget with other users, you can bundle it into a single self-contained file.

1. In the project folder, run the bundler command:
   ```bash
   slu resource bundle widget ./dist
   ```
2. This creates a file named `dist.yaml` in the parent directory.
3. Rename it to `seelen-pomodoro.yaml`.
4. Anyone else running Seelen UI can install it instantly by opening:
   **Seelen UI Settings** -> **Resources** -> **Install from file** and selecting `seelen-pomodoro.yaml`.
   *(Or by running: `slu resource load widget ./seelen-pomodoro.yaml`)*

---

## Tech Stack
- **Bundler**: Vite
- **API**: `@seelen-ui/lib` (Tauri API integrations)
- **UI**: Vanilla HTML, CSS, and JS (Vibrant glassmorphic theme using CSS variables and SVG progress rings).
