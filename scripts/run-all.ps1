Param(
  [string]$BaseUrl = "http://localhost:9999"
)

$ErrorActionPreference = 'Stop'
Write-Host "Starting Cheater Buster API and running screenshot tests..."

# Ensure Node is available
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js is not installed or not in PATH. Install Node 18+ and retry."
  exit 1
}

# Optional: warn if OPENAI_API_KEY missing
$hasEnv = Test-Path ".env"
if ($hasEnv) {
  $envContent = Get-Content ".env"
  $hasKey = $envContent | Where-Object { $_ -match '^OPENAI_API_KEY\s*=\s*.+' }
  if (-not $hasKey) {
    Write-Warning "OPENAI_API_KEY is not set in .env - API may return 503 (llm_not_configured)."
  }
} else {
  Write-Warning ".env not found - ensure environment variables are configured."
}

# Start server
Write-Host "Launching server..."
$serverProc = Start-Process -FilePath "node" -ArgumentList "src/server.js" -PassThru -NoNewWindow
Start-Sleep -Seconds 1

# Wait for health
$maxWait = 60
$ok = $false
for ($i=0; $i -lt $maxWait; $i++) {
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/health" -TimeoutSec 5
    if ($resp.StatusCode -eq 200) { $ok = $true; break }
  } catch {}
  Start-Sleep -Seconds 1
}
if (-not $ok) {
  Write-Error "Server did not become healthy within $maxWait seconds."
  try { Stop-Process -Id $serverProc.Id -Force } catch {}
  exit 1
}
Write-Host "Server is healthy at $BaseUrl. Running generator..."

# Run generator over screenshots (plain text answers only)
$env:TEST_BASE_URL = $BaseUrl
# Reset previous output to ensure fresh compact EN-only answers
if (Test-Path "tests/testallPerks1v.out.json") {
  try { Remove-Item -Path "tests/testallPerks1v.out.json" -Force } catch {}
}
node "scripts/testallPerks1v.js"
$genExit = $LASTEXITCODE

# Stop server
Write-Host "Stopping server..."
try { Stop-Process -Id $serverProc.Id -Force } catch {}

# Summarize results
if (Test-Path "tests/testallPerks1v.out.json") {
  $json = Get-Content "tests/testallPerks1v.out.json" -Raw | ConvertFrom-Json
  $count = $json.cases.Count
  $routes = $json.cases | Group-Object route | ForEach-Object { """$($_.Name)"": $($_.Count)" }
  Write-Host "Results: cases=$count; per route: $(($routes -join ', '))"
} else {
  Write-Warning "tests/testallPerks1v.out.json not found; generator may have failed."
}

exit $genExit