param(
  [string]$BaseUrl = "http://localhost:3000"
)

$tests = @(
  @{ name = "Infidelity suspicion"; text = "He suddenly hides his phone and changed passcode; is he cheating?"; context = "We reconciled after past cheating; I saw messages at 2am he denies; trust is fragile; his story changes and he avoids specifics." },
  @{ name = "Long-distance communication conflict"; text = "We are in a long-distance relationship and argue about how often to communicate."; context = "I want daily calls; partner prefers twice weekly due to work stress. We need a realistic compromise and boundaries." },
  @{ name = "Sexual preferences mismatch"; text = "I want to explore BDSM; my partner is hesitant. How to discuss safely and respectfully?"; context = "We disagree on kinks; consent boundaries unclear; safety and mutual respect are my priority; I worry they minimize concerns." }
)

$nl = [Environment]::NewLine
$resultsDir = "tests"
$resultsPath = Join-Path $resultsDir "test-results-en.txt"

if (-not (Test-Path $resultsDir)) { New-Item -ItemType Directory -Force -Path $resultsDir | Out-Null }
Set-Content -Path $resultsPath -Value ("English Response Tests " + (Get-Date).ToString('s') + $nl)

foreach ($t in $tests) {
  $payload = @{ text = $t.text; context = $t.context } | ConvertTo-Json -Compress
  try {
    # Use Invoke-WebRequest to always get raw Content as string
    $resp = Invoke-WebRequest -Uri "$BaseUrl/api/v1/analyze/text?plain=true" -Method Post -ContentType "application/json" -Body $payload -UseBasicParsing
    $content = $resp.Content
    Add-Content -Path $resultsPath -Value ("=== " + $t.name + " ===" + $nl + "Request:" + $nl + "text=" + $t.text + $nl + "context=" + $t.context + $nl + "Response:" + $nl + $content + $nl)
  } catch {
    Add-Content -Path $resultsPath -Value ("=== " + $t.name + " ===" + $nl + "ERROR: " + $_.Exception.Message + $nl)
  }
}

Write-Host ("Saved results to " + $resultsPath)