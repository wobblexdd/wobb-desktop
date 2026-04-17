# WOBB Desktop

Portfolio-ready Electron desktop client for self-hosted Xray / VLESS / REALITY usage.

WOBB Desktop is the Windows-first desktop companion to the WOBB self-hosted client flow. It manages local profiles, import and export, optional VPS bootstrap planning, and a desktop runtime path built around a local Xray-compatible engine payload.

## Portfolio Summary

WOBB Desktop demonstrates a practical desktop client architecture for self-hosted infrastructure:

- Electron shell with a React renderer
- local VLESS / REALITY profile management
- import, export, and validation workflows
- explicit runtime status and logs
- optional helper backend integration for bootstrap planning
- file-based handoff into a local desktop engine runtime

## Features

- Local profile CRUD with favorites and active profile selection
- VLESS / REALITY validation before connect
- Import from VLESS URI or supported JSON
- Export via copied URI or copied profile summary
- Bootstrap planner integration through the helper backend
- Status badges, logs, and runtime detail surfaces
- Clear separation between renderer, Electron bridge, and engine runtime

## Tech Stack

- Electron
- React 19
- Vite
- Tailwind CSS 4
- Local desktop engine payload under `bin/<platform>/`

## Repository Responsibility

This repository is responsible for:

- the desktop renderer and Electron shell
- local profile persistence and validation
- import / export UX on desktop
- local engine startup wiring and runtime status display

This repository is not responsible for:

- hosted accounts
- billing or subscriptions
- server monetization flows
- mandatory backend auth for basic client use

## Related Repositories

WOBB is split into focused repositories:

- `wobb-mobile`: Android client
- `wobb-desktop`: desktop client
- `wobb-backend`: optional helper service for validation and bootstrap planning

The backend is optional for local self-hosted use. The main client flow stays profile based and local.

## Folder Overview

```text
apps/desktop/          Electron main process and preload bridge
apps/web/              React desktop renderer
bin/<platform>/        Local engine payloads, not part of normal Git source
configs/               Local desktop environment config
scripts/               Desktop startup and local payload checks
```

## Setup

### Requirements

- Node.js 20+
- Local engine payload under `bin/<platform>/`

Expected local payloads:

- Windows: `bin/win32/wobb-engine.exe`, plus required data files such as `geoip.dat` and `geosite.dat`
- Linux/macOS: `bin/<platform>/wobb-engine`

### Install

```bash
npm install
```

### Optional helper backend config

Copy the template and set the helper URL only if you want bootstrap planning:

```bash
copy configs\.env.example configs\.env
```

Default example:

```text
VITE_API_URL=http://127.0.0.1:3000
```

### Verify the local engine payload

```bash
npm run build:core-link
```

## Local Run

```bash
npm run dev
```

## Architecture Overview

The desktop app is organized into three layers:

1. React renderer for profile UX, import/export, logs, and bootstrap planner views
2. Electron main process for runtime orchestration and local bridge APIs
3. Local engine payload under `bin/<platform>/` for actual runtime startup

The connect flow is local-first:

1. user selects or imports a profile
2. profile is validated in the renderer
3. Electron hands a generated config to the local engine runtime
4. status and logs flow back into the app UI

## What You Need To Actually Use It

To use WOBB Desktop as a real client, you need:

- your own VLESS / REALITY server profile
- a local desktop engine payload in `bin/<platform>/`
- optional helper backend only if you want bootstrap planning

## Current Limitations

- Final real-world runtime confirmation still needs manual verification with a real profile.
- Windows desktop runtime is currently oriented around `Proxy` mode for practical local testing.
- QR import is currently a clean entry point in product UX, not a full scanning implementation.
- Bootstrap is still a planning-oriented helper, not a complete remote automation system.
- The project is intentionally focused on VLESS / REALITY in this phase.

## Future Improvements

- Additional desktop runtime validation across platforms
- More guided engine setup documentation and payload packaging
- Full QR import flow where appropriate for desktop input devices
- Better packaged distribution story after runtime testing is finalized
- More formal screenshots and demo assets for portfolio presentation
