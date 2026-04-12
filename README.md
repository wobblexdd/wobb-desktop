# WOBB Desktop

Public Electron desktop client for WOBB.

## Contents

- Electron main process
- React renderer
- Desktop runtime checks

## Requirements

- Node.js 20+
- A local desktop engine payload under `bin/<platform>/`

Expected local payloads:

- Windows: `bin/win32/wobb-engine.exe`, `bin/win32/geoip.dat`, `bin/win32/geosite.dat`
- Linux/macOS: `bin/<platform>/wobb-engine`

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `configs/.env.example` to `configs/.env` and set `VITE_API_URL`.

3. Verify the local engine payload:

   ```bash
   npm run build:core-link
   ```

4. Start the desktop app in development:

   ```bash
   npm run dev
   ```
