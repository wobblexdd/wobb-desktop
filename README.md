# WOBB Desktop

Electron desktop client for a self-hosted Xray / VLESS / REALITY workflow.

WOBB Desktop is the public desktop repository in the WOBB split project. It manages local profiles, import and export, optional VPS bootstrap planning, and a desktop runtime path built around a local engine payload. It is intentionally not a hosted VPN dashboard or SaaS client.

## Release Summary

This repo is intended to publish:

- source code and docs for the desktop self-hosted client
- packaged desktop artifacts built with `electron-builder`
- GitHub release binaries for local self-hosted use

## Features

- local VLESS / REALITY profile CRUD
- import from VLESS URI or supported JSON
- export via copied URI or copied summary
- optional helper-backed bootstrap planning
- explicit runtime status, logs, and profile detail views
- local engine handoff through Electron main process

## Tech Stack

- Electron
- React 19
- Vite
- Tailwind CSS 4
- Local engine payload under `bin/<platform>/`

## Repository Responsibility

This repo is responsible for:

- Electron shell and preload bridge
- desktop renderer and local profile UX
- local engine startup wiring
- desktop packaging and public release documentation

This repo is not responsible for:

- hosted accounts
- subscriptions or billing
- public server inventory
- mandatory backend auth for normal client use

## Related Repositories

- `wobb-mobile`: Android client
- `wobb-desktop`: Electron desktop client
- `wobb-backend`: optional helper service for validation and bootstrap planning

The backend is optional for local self-hosted use. The main client flow stays profile-based and local.

## Folder Overview

```text
apps/desktop/          Electron main process and preload bridge
apps/web/              React renderer
bin/<platform>/        Local engine payloads, kept out of Git
configs/               Local desktop env templates
scripts/               Startup checks and release helpers
```

## Requirements

- Node.js 20+
- local engine payload under `bin/<platform>/`

Expected payloads:

- Windows: `bin/win32/wobb-engine.exe`
- Linux/macOS: `bin/<platform>/wobb-engine`

## Setup

Install dependencies:

```bash
npm install
```

Optional helper backend config for bootstrap planning:

```bash
copy configs\.env.example configs\.env
```

Default example:

```text
VITE_API_URL=http://127.0.0.1:3000
```

Verify the local engine payload before dev or packaging:

```bash
npm run build:core-link
```

## Local Development

```bash
npm run dev
```

## Release Build Commands

### Preflight

```bash
npm run release:check
```

This verifies the local engine payload and builds the renderer. Packaging commands also clear the previous `release/` directory first so GitHub release artifacts stay clean.

### Unpacked app for verification

```bash
npm run release:dir
```

Output directory:

```text
release/
```

### Windows portable release

```bash
npm run release:win
```

Expected artifact:

```text
release/wobb-desktop-portable-<version>-x64.exe
```

### Windows installer release

```bash
npm run release:win:installer
```

Expected artifact:

```text
release/wobb-desktop-setup-<version>-x64.exe
```

Packaging is configured for unsigned public artifacts; OS-level signing still has to be handled manually if you need signed distribution.

## Packaging Notes

`electron-builder` is configured in `package.json` to:

- package the built renderer from `dist/apps/web/`
- include Electron main/preload files
- copy the local runtime payload from `bin/` into packaged app resources
- emit release artifacts under `release/`

The local engine payload is still required at package time and is intentionally not committed to the public repo.

## Architecture Overview

The desktop app is organized into three layers:

1. React renderer for profile UX, import/export, logs, and bootstrap planner views
2. Electron main process for runtime orchestration and local bridge APIs
3. Local engine payload under `bin/<platform>/` for runtime startup

The connect flow is local-first:

1. user selects or imports a profile
2. profile is validated in the renderer
3. Electron hands a generated config to the local engine runtime
4. status and logs flow back into the app UI

## What You Need To Actually Use It

- your own VLESS / REALITY server profile
- a local desktop engine payload in `bin/<platform>/`
- optional helper backend only if you want bootstrap planning

## Current Limitations

- Final real-world runtime confirmation still needs manual verification with a real profile.
- Windows desktop runtime is currently oriented around `Proxy` mode for practical local testing.
- QR import is currently a clean entry point in product UX, not a full scanning implementation.
- Bootstrap is still a planning-oriented helper, not a complete remote automation system.
- Packaging quality still depends on a valid local engine payload being present.
- Desktop release artifacts are not code-signed in this repo by default.
- A custom app icon is not configured yet, so packaged builds currently fall back to the default Electron icon.
- The project is intentionally focused on VLESS / REALITY in this phase.

## Future Improvements

- stronger cross-platform runtime validation
- a more formal release matrix and screenshot set for GitHub releases
- tighter engine payload packaging guidance for each platform
- signed and versioned desktop releases once packaging is exercised more broadly
- optional CI packaging workflow after runtime validation is finalized
