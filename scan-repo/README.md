# LDT Scan Agent

Local Windows tray app that exposes scanner control over `http://localhost:7878`.
Designed to be called from any LDT web app (Kurtz Inventory, SCW Dashboard, etc).

## Architecture

```
[ Web app (React) ]  →  POST localhost:7878/scan  →  [ This agent ]
                                                            ↓
                                                       WIA / COM
                                                            ↓
                                                    [ Physical scanner ]
```

The agent only binds to `127.0.0.1`. It is not reachable from the network.

## Endpoints

| Method | Path           | Purpose                                                |
|--------|----------------|--------------------------------------------------------|
| GET    | /version       | Agent version + machine hostname                       |
| GET    | /scanners      | List all WIA scanners on this PC                       |
| GET    | /config        | Current config (default scanner, source, dpi)          |
| POST   | /config        | Save config                                            |
| POST   | /scan          | Trigger a scan; returns base64 JPEG pages              |
| GET    | /diagnostics   | Agent status + last 100 log lines (for troubleshooting)|

`/scan` and `/scanners` will return **HTTP 409 `scanner_busy`** if another
WIA call is already in flight. Clients should retry after a short delay.

## Requirements

- Windows 10 or 11
- .NET 8 SDK to build (https://dotnet.microsoft.com/download)
- A WIA-compatible scanner (most modern multifunction printers qualify)

## Build & Run

```powershell
cd LdtScanAgent
dotnet restore
dotnet build
dotnet run
```

A tray icon will appear. Right-click for menu options.

## Test it

After the tray icon shows, in PowerShell:

```powershell
# Should return version info
curl http://localhost:7878/version

# Should list your scanners
curl http://localhost:7878/scanners

# Save a config (replace scanner ID with a real one from /scanners)
$body = @{
  defaultScanner = @{ id = "PASTE_SCANNER_ID"; displayName = "My Scanner" }
  defaultSource = "Flatbed"
  defaultDpi = 300
  defaultColorMode = "Color"
} | ConvertTo-Json

Invoke-RestMethod -Uri http://localhost:7878/config -Method POST -Body $body -ContentType "application/json"

# Trigger a scan (uses defaults)
Invoke-RestMethod -Uri http://localhost:7878/scan -Method POST -ContentType "application/json" -Body "{}"
```

## File locations

- Config: `%APPDATA%\LDT\scan-agent\config.json`
- Logs:   `%APPDATA%\LDT\scan-agent\logs\agent-YYYY-MM-DD.log`

The tray menu has shortcuts to both folders + the test page + `/diagnostics`.

## Recommended Windows Defender exclusion

Real-time AV scanning the WIA binary slows scans significantly. After install:

```powershell
Add-MpPreference -ExclusionPath "C:\Program Files\LdtScanAgent"
# (or wherever the .exe lives)
```

## Troubleshooting

1. Right-click tray icon → **Open Diagnostics** to see version, uptime, busy
   state, last error, and the last 100 log lines.
2. **Open Log File** for the full day's log.
3. If scans intermittently fail, unplug + replug the scanner USB to clear
   a stuck WIA session lock (then a single restart of this agent — tray →
   Quit, then relaunch — clears any stale RCWs on our side).

## Architecture notes (v0.2)

- All WIA / COM calls run on a single dedicated **STA thread** (the
  `StaScannerExecutor`). Calling WIA from MTA / thread-pool threads — which
  is what raw Kestrel hands you — is the textbook cause of intermittent
  `RPC_E_WRONG_THREAD` and "device busy" failures. Don't refactor this away.
- Every dynamic COM object is explicitly released in `finally` blocks
  (`Marshal.ReleaseComObject`) because RCW garbage collection is
  non-deterministic and a late release holds the scanner's session lock.
- A `SemaphoreSlim(1,1)` gates the executor; concurrent requests get a
  fast-fail HTTP 409 instead of stacking up on the scanner.
- A named Mutex (`Global\LdtScanAgent_v1_singleton`) prevents two copies of
  the agent from racing for port 7878.

## Known limitations (v0.2)

- WIA only (no TWAIN). Covers most consumer/SOHO scanners.
- No icon yet (uses generic Windows icon).
- No installer yet — manual `dotnet publish` + copy to client PC.
- No update mechanism.
- Scan response is a single base64 JSON blob; large ADF jobs (5+ pages
  at 300 DPI color) can be 30+ MB and slow over the loopback. Planned:
  stream pages, or upload directly to Supabase Storage from the agent.
