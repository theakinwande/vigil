# Vigil

A lightweight Windows screen time tracker that runs quietly in your system tray.

![Vigil](build/windows/icon.ico)

## Features

- **Active window tracking** — monitors which app you're using in real time
- **Hourly timeline** — see exactly how you spent each hour of your day
- **Daily summary** — total screen time, top app, and per-app breakdown with category badges
- **Weekly stats** — daily average, busiest day, top app, and per-category breakdown
- **Past week navigation** — browse back through previous weeks like iPhone Screen Time
- **Break reminders** — desktop notification after configurable idle-free work time
- **Idle detection** — automatically pauses tracking after 5 minutes of inactivity
- **Auto-categorization** — apps grouped into Development, Browser, Communication, Productivity, Entertainment, Design, and System
- **Launch at login** — starts silently with Windows, lives in the system tray
- **Local only** — all data stored in SQLite on your machine, no cloud, no telemetry

## Installation

1. Download `vigil-amd64-installer.exe` from [Releases](https://github.com/akinwande/vigil/releases/latest)
2. Run the installer
3. Vigil starts automatically and sits in your system tray

**Requirements:** Windows 10 or 11 (WebView2 is pre-installed on both)

## Usage

- **Show dashboard** — click the Vigil icon in the system tray
- **Pause tracking** — click the Tracking button in the top-right header
- **Reassign categories** — go to Settings → Categories
- **Set break reminder interval** — go to Settings → Break reminders

## Building from source

**Prerequisites**
- Go 1.22+
- Node.js 18+
- Wails CLI v2

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

**Build**
```bash
git clone https://github.com/akinwande/vigil.git
cd vigil
wails build
```

**Build installer**
```bash
wails build --nsis
```

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Go 1.22 |
| Desktop framework | Wails v2 |
| Database | SQLite via modernc.org/sqlite |
| Windows API | golang.org/x/sys/windows |
| System tray | fyne.io/systray |
| Frontend | Vanilla JS + Chart.js 4.4 |

## License

MIT