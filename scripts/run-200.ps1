Param(
  [string]$BaseUrl = 'http://localhost:9999',
  [string]$OutDir = 'results-200'
)

Write-Host "Running 200 API tests against $BaseUrl ..."

function Ensure-Dir([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { New-Item -ItemType Directory -Force -Path $path | Out-Null }
}

function Get-Mime([string]$ext) {
  switch ($ext.ToLower()) {
    '.jpg' { 'image/jpeg' }
    '.jpeg' { 'image/jpeg' }
    '.png' { 'image/png' }
    default { 'application/octet-stream' }
  }
}

function Get-DataUrl([string]$path) {
  $bytes = [System.IO.File]::ReadAllBytes($path)
  $b64 = [System.Convert]::ToBase64String($bytes)
  $mime = Get-Mime ([System.IO.Path]::GetExtension($path))
  return "data:$mime;base64,$b64"
}

function Post-Json([string]$url, $obj) {
  $json = $obj | ConvertTo-Json -Depth 8
  return Invoke-RestMethod -Method Post -Uri $url -ContentType 'application/json' -Body $json
}

# Health check
try {
  $health = Invoke-RestMethod -Method Get -Uri "$BaseUrl/health"
} catch {
  throw "Server not reachable: $BaseUrl"
}

Ensure-Dir $OutDir
Set-Content -Path (Join-Path $OutDir 'run.log') -Value "started" -Encoding UTF8

$imgDir = 'tests/skrin_test'
$images = Get-ChildItem -File $imgDir | Where-Object { $_.Extension -match '\.(jpg|jpeg|png)$' }
if ($images.Count -lt 1) { throw "No images in $imgDir" }

$cases = @()
$rand = New-Object System.Random
$start = Get-Date

$texts = @(
  'Safety tips for dating chat.',
  'Analyze the dialog and list fraud indicators.',
  'Identify risks and suggest verification steps.',
  'Create a short checklist for safe messaging.',
  'How to spot fake profiles and avoid losing money?',
  'Advice to increase chances of honest partner.',
  'Signs of phishing links in dating context.',
  'Check text for manipulation and pressure.'
)

$contexts = @('profile review','dialog review','risk check','short summary','safety advice')

for ($i=1; $i -le 100; $i++) {
  $text = $texts[$rand.Next(0,$texts.Count)] + " #$i"
  try {
    $resp = Post-Json "$BaseUrl/api/v1/analyze/text?plain=true" @{ text = $text; context = 'plain' }
    $cases += [PSCustomObject]@{ route='text'; input=@{text=$text}; output=$resp; ok=$true }
  } catch {
    $cases += [PSCustomObject]@{ route='text'; input=@{text=$text}; error=($_.Exception.Message); ok=$false }
  }
  Start-Sleep -Milliseconds (1000 + $rand.Next(0,300))
}

for ($i=1; $i -le 50; $i++) {
  $img = $images[$i % $images.Count]
  $dataUrl = Get-DataUrl $img.FullName
  $ctx = $contexts[$rand.Next(0,$contexts.Count)] + " #$i"
  $payload = @{ text = 'Analyze the screenshot'; images = @($dataUrl); context = $ctx }
  try {
    $resp = Post-Json "$BaseUrl/api/v1/analyze/text-image?plain=true" $payload
    $cases += [PSCustomObject]@{ route='text-image'; input=@{context=$ctx; image=$img.Name}; output=$resp; ok=$true }
  } catch {
    $cases += [PSCustomObject]@{ route='text-image'; input=@{context=$ctx; image=$img.Name}; error=($_.Exception.Message); ok=$false }
  }
  Start-Sleep -Milliseconds (1000 + $rand.Next(0,300))
}

for ($i=1; $i -le 50; $i++) {
  $img = $images[$i % $images.Count]
  $dataUrl = Get-DataUrl $img.FullName
  $ctx = $contexts[$rand.Next(0,$contexts.Count)] + " #$i"
  $payload = @{ images = @($dataUrl); context = $ctx }
  try {
    $resp = Post-Json "$BaseUrl/api/v1/analyze/image?plain=true" $payload
    $cases += [PSCustomObject]@{ route='image'; input=@{context=$ctx; image=$img.Name}; output=$resp; ok=$true }
  } catch {
    $cases += [PSCustomObject]@{ route='image'; input=@{context=$ctx; image=$img.Name}; error=($_.Exception.Message); ok=$false }
  }
  Start-Sleep -Milliseconds (1000 + $rand.Next(0,300))
}

$end = Get-Date
$okCount = ($cases | Where-Object { $_.ok }).Count
$errCount = $cases.Count - $okCount
$summary = [PSCustomObject]@{
  total = $cases.Count; ok = $okCount; errors = $errCount;
  startedAt = $start; finishedAt = $end; durationSec = [int]((New-TimeSpan -Start $start -End $end).TotalSeconds)
}

$cases | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $OutDir 'cases.json') -Encoding UTF8
$summary | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $OutDir 'summary.json') -Encoding UTF8
"OK: $($summary | ConvertTo-Json -Depth 4)" | Set-Content -Path (Join-Path $OutDir 'run.log')

Write-Host "Done. Results in $OutDir" -ForegroundColor Green