param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$OutputFile = "tests/test_txt_txt_5v1.json"
)

# Early probe to confirm script executes and has FS access
try { Set-Content -Path "tests/ps-top.txt" -Value "top" -Encoding utf8 } catch {}

# All questions and context in English as requested
$tests = @(
  # Specific sexual preferences (girlfriend)
  @{ text = "My girlfriend has specific sexual preferences (e.g., BDSM); how can we discuss safely and respectfully without pressure?"; context = "We disagree on sexual preferences; consent boundaries unclear; we want a safety plan and mutual respect." },
  # Cheating suspicion (boyfriend)
  @{ text = "My boyfriend suddenly hides his phone and changed the passcode; is he cheating?"; context = "We reconciled after past cheating; I saw messages around 2am he denies; trust is fragile; his story changes and he avoids specifics." },
  # Unwillingness to get a dog
  @{ text = "I want a dog; my boyfriend refuses. How can we negotiate fairly?"; context = "We live together; he worries about time, costs, and allergies; I feel strongly; we need a realistic compromise and boundaries." },
  # Desire to explore with another woman while staying with boyfriend
  @{ text = "I’m tempted to explore with another woman but keep my relationship with my boyfriend. How do we handle this ethically?"; context = "We value monogamy; I feel curiosity; we need an honest conversation about boundaries, consent, risks, and possible relationship structures." },
  # Sexual preferences make me anxious; how to express concerns and find shared ground
  @{ text = "She wants specific kinks that make me anxious; how do I express concerns without shaming and find shared ground?"; context = "Emotional safety first; agree on limits; consider gradual exploration, check-ins, safe words, and the option to stop without blame." }
)

$results = New-Object System.Collections.Generic.List[Object]

foreach ($t in $tests) {
  $payload = @{ text = $t.text; context = $t.context } | ConvertTo-Json -Compress
  try {
    # Получаем JSON-ответ (application/json), где { result: "..." }
    $resp = Invoke-RestMethod -Uri "$BaseUrl/api/v1/analyze/text" -Method Post -ContentType "application/json" -Body $payload
    $results.Add(@{
      route = "/api/v1/analyze/text"
      plain = $false
      text = $t.text
      context = $t.context
      statusCode = 200
      result = $resp.result
    })
  } catch {
    $results.Add(@{
      route = "/api/v1/analyze/text"
      plain = $false
      text = $t.text
      context = $t.context
      statusCode = 500
      error = $_.Exception.Message
    })
  }
}

$json = $results | ConvertTo-Json -Depth 5
$outDir = Split-Path -Parent $OutputFile
if ($outDir -and -not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
try { Set-Content -Path (Join-Path $outDir "ps-probe.txt") -Value "ok" -Encoding utf8 } catch {}
Set-Content -Path $OutputFile -Value $json -Encoding utf8
Write-Host ("Saved results to: " + $OutputFile)
Write-Host ("JSON length: " + $json.Length)