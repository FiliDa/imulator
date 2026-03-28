Param(
  [switch]$ForceInstall,   # force npm install
  [switch]$InstallSqlite   # try optional sqlite3 (--no-save)
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Write-Info($msg) { Write-Host "[mainstart] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[ok] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[warn] $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "[err] $msg" -ForegroundColor Red }

# Check Node.js and npm
$node = Get-Command node -ErrorAction SilentlyContinue
$npm  = Get-Command npm  -ErrorAction SilentlyContinue
if (-not $node -or -not $npm) {
  Write-Err "Node.js/npm not found. Install Node.js 18+ and retry."
  Write-Host "Download: https://nodejs.org/" -ForegroundColor DarkGray
  exit 1
}

# Prepare .env if missing (default PORT=3000)
if (-not (Test-Path ".env")) {
  Write-Warn ".env not found — creating from .env.example or minimal."
  if (Test-Path ".env.example") {
    Copy-Item ".env.example" ".env"
  } else {
    $envLines = @(
      'PORT=3000',
      'ADMIN_TOKEN=',
      'OPERATOR_TOKEN=',
      'OPENAI_API_KEY=',
      'LLM_MODEL=gpt-4o-mini',
      'CORS_ORIGIN=*'
    )
    Set-Content -Path '.env' -Value $envLines -Encoding utf8
  }
  Write-Ok ".env is ready."
}

# If PORT not set in .env — add PORT=3000
try {
  $envLines = Get-Content ".env"
  if (-not ($envLines -match '^PORT\s*=')) {
    Write-Info "PORT missing — adding PORT=3000 to .env"
    "PORT=3000" | Add-Content ".env"
  }
} catch {}

# Install dependencies
$needInstall = $ForceInstall -or -not (Test-Path "node_modules")
if ($needInstall) {
  Write-Info "Installing dependencies (npm install)…"
  & npm.cmd install
  Write-Ok "Dependencies installed."
} else {
  Write-Info "node_modules found — skipping install. Use -ForceInstall to force."
}

# Optional: sqlite3 for extended DB — no-save (not added to package.json)
$hasSqlite = Test-Path "node_modules/sqlite3"
if ($InstallSqlite -and -not $hasSqlite) {
  Write-Info "Trying to install optional sqlite3 — no-save"
  & npm.cmd install sqlite3 --no-save
  if (Test-Path "node_modules/sqlite3") { Write-Ok "sqlite3 installed." } else { Write-Warn "sqlite3 not installed — build tools may be required." }
}

# Resolve port
function Get-EnvPort {
  try {
    $envText = Get-Content ".env" -ErrorAction SilentlyContinue
    $line = $envText | Where-Object { $_ -match '^PORT\s*=' }
    if ($line) { return [int](($line -split '=',2)[1].Trim()) }
  } catch {}
  return 3000
}

$port = Get-EnvPort
Write-Info "Starting server on port $port… (Ctrl+C to stop)"
Write-Host ""

# Start Node in background and probe /health and /docs
function Start-Node {
  $proc = Start-Process -FilePath "node" -ArgumentList "src/server.js" -NoNewWindow -PassThru
  Write-Info "Node PID: $($proc.Id)"
  return $proc
}

function Probe-Endpoints($p) {
  $base = "http://127.0.0.1:$p"
  $ok = $false
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    try {
      $h = Invoke-RestMethod -Method Get -Uri "$base/health" -TimeoutSec 2
      if ($h.status -eq 'ok') { $ok = $true; break }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  if ($ok) {
    try {
      $healthObj = Invoke-RestMethod -Method Get -Uri "$base/health"
      $healthJson = $healthObj | ConvertTo-Json -Depth 3
      Write-Ok "Health OK: $healthJson"
    } catch {
      Write-Ok "Health OK"
    }
  } else {
    Write-Warn "Health did not respond within 30s — check logs."
  }
  try {
    $resp = Invoke-WebRequest -Uri "$base/docs" -UseBasicParsing -TimeoutSec 5
    Write-Ok "/docs available: HTTP $($resp.StatusCode)"
  } catch {
    Write-Warn "/docs not available: $($_.Exception.Message)"
  }
  foreach ($asset in @('swagger-ui.css','swagger-ui-bundle.js','favicon-32x32.png')) {
    try {
      $a = Invoke-WebRequest -Method Head -Uri "$base/docs/$asset" -TimeoutSec 5
      Write-Ok "/docs/${asset}: HTTP $($a.StatusCode)"
    } catch {
      Write-Warn "Asset $asset not reachable over HTTP: $($_.Exception.Message). If browser enforces HTTPS — clear HSTS/enforced HTTPS."
    }
  }
  Write-Info "Open: http://localhost:$p/docs (or http://<your_ip>:$p/docs)"
}

$nodeProc = Start-Node
Probe-Endpoints -p $port

# Keep-alive: restart on exit and re-probe
while ($true) {
  try {
    Wait-Process -Id $nodeProc.Id
    $exitCode = $nodeProc.ExitCode
    if ($exitCode -eq 0) {
      Write-Warn "Server exited with code 0. Restarting in 2s…"
    } else {
      Write-Err "Server exited with code $exitCode. Restarting in 2s…"
    }
    Start-Sleep -Seconds 2
    $nodeProc = Start-Node
    Probe-Endpoints -p $port
  } catch {
    Write-Err "Process control error: $($_.Exception.Message)"
    Start-Sleep -Seconds 5
  }
}