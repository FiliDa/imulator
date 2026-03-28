Param(
  [string]$BaseUrl = 'http://localhost:9999',
  [string]$OutDir = 'results-200-external'
)

Write-Host "Running 200 external-style API tests against $BaseUrl ..."

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

function Wait-Polite([int]$minMs = 1000) {
  $rand = New-Object System.Random
  Start-Sleep -Milliseconds ($minMs + $rand.Next(0,300))
}

function Post-Json([string]$url, $obj) {
  $json = $obj | ConvertTo-Json -Depth 8
  return Invoke-RestMethod -Method Post -Uri $url -ContentType 'application/json' -Body $json
}

function Post-Multipart([string]$url, $form) {
  return Invoke-RestMethod -Method Post -Uri $url -Form $form
}

# Health check
try { $health = Invoke-RestMethod -Method Get -Uri "$BaseUrl/health" } catch { throw "Server not reachable: $BaseUrl" }

Ensure-Dir $OutDir
Set-Content -Path (Join-Path $OutDir 'run.log') -Value "started" -Encoding UTF8

$imgDir = 'tests/skrin_test'
$images = Get-ChildItem -File $imgDir | Where-Object { $_.Extension -match '\.(jpg|jpeg|png)$' }
if ($images.Count -lt 1) { throw "No images in $imgDir" }

$cases = @()
$start = Get-Date
$rand = New-Object System.Random

# Генераторы различающихся сценариев (рус.)
$adviceTexts = @(
  'Мне нужна поддержка: как успокоиться и не ссориться?',
  'Она обиделась на мой поздний ответ — как сгладить?',
  'Хочу честно обсудить ревность без обвинений — помоги сформулировать.',
  'Как мягко попросить больше внимания, не звуча требовательно?',
  'Как ответить девушке, если она переживает из‑за бывшей?',
  'Как поддержать её на старте отношений — что написать?',
  'Как показать искренность и уважение её границ?'
)

$fraudTexts = @(
  'Похоже на мошенника: просит перевести деньги — на что обратить внимание?',
  'Странные фото и давит на жалость — как проверить подлинность?',
  'Просит личные данные и ссылку — как безопасно ответить?',
  'Слишком быстро зовёт в мессенджер и просит донат — что делать?',
  'Как понять, фейк ли профиль по диалогу и фото?'
)

$replyToGirlTexts = @(
  'Что ответить девушке, если она пишет, что устала и растеряна?',
  'Как ответить, если она боится обмана и хочет ясности?',
  'Как мягко поддержать её, если она сомневается во мне?',
  'Как предложить диалог без давления и дать чувство безопасности?',
  'Как извиниться и восстановить доверие после резких слов?'
)

$contexts = @(
  'первые сообщения, важно тепло и уважение',
  'обсуждение границ и ожиданий',
  'проверка на риски и признаки фейка',
  'ответ без манипуляций и давления',
  'поддержка и эмпатия, по шагам'
)

$outNdjson = Join-Path $OutDir 'cases.ndjson'
Remove-Item -ErrorAction SilentlyContinue $outNdjson

function Append-CaseNdjson($obj) {
  $line = ($obj | ConvertTo-Json -Depth 8)
  Add-Content -Path $outNdjson -Value $line
}

# Распределение: 80 текст, 60 text-image (multipart), 60 image (multipart)
$needText = 80; $needTI = 60; $needImg = 60

# 80 текстовых (plain=false → JSON ответ)
for ($i=1; $i -le $needText; $i++) {
  $pool = @($adviceTexts + $fraudTexts + $replyToGirlTexts)
  $text = $pool[$rand.Next(0,$pool.Count)] + " |ext#$i"
  $ctx = $contexts[$rand.Next(0,$contexts.Count)] + " |extctx#$i"
  try {
    $resp = Post-Json "$BaseUrl/api/v1/analyze/text?plain=false" @{ text = $text; context = $ctx }
    $case = [PSCustomObject]@{ route='text'; input=@{text=$text; context=$ctx}; output=$resp; ok=$true }
    $cases += $case; Append-CaseNdjson $case
  } catch {
    $case = [PSCustomObject]@{ route='text'; input=@{text=$text; context=$ctx}; error=($_.Exception.Message); ok=$false }
    $cases += $case; Append-CaseNdjson $case
  }
  Wait-Polite 1000
}

# 60 text-image (multipart) — прикладываю 1 файл
for ($i=1; $i -le $needTI; $i++) {
  $img = $images[$i % $images.Count]
  $text = ($replyToGirlTexts + $adviceTexts)[$rand.Next(0,($replyToGirlTexts.Count+$adviceTexts.Count))] + " |extTI#$i"
  $ctx = $contexts[$rand.Next(0,$contexts.Count)] + " |extctxTI#$i"
  $form = @{ text = $text; context = $ctx; images = $img }
  try {
    $resp = Post-Multipart "$BaseUrl/api/v1/analyze/text-image?plain=false" $form
    $case = [PSCustomObject]@{ route='text-image'; input=@{text=$text; context=$ctx; image=$img.Name}; output=$resp; ok=$true }
    $cases += $case; Append-CaseNdjson $case
  } catch {
    $case = [PSCustomObject]@{ route='text-image'; input=@{text=$text; context=$ctx; image=$img.Name}; error=($_.Exception.Message); ok=$false }
    $cases += $case; Append-CaseNdjson $case
  }
  Wait-Polite 1000
}

# 60 image-only (multipart)
for ($i=1; $i -le $needImg; $i++) {
  $img = $images[$i % $images.Count]
  $ctx = ($fraudTexts + $contexts)[$rand.Next(0,($fraudTexts.Count+$contexts.Count))] + " |extIMG#$i"
  $form = @{ context = $ctx; images = $img }
  try {
    $resp = Post-Multipart "$BaseUrl/api/v1/analyze/image?plain=false" $form
    $case = [PSCustomObject]@{ route='image'; input=@{context=$ctx; image=$img.Name}; output=$resp; ok=$true }
    $cases += $case; Append-CaseNdjson $case
  } catch {
    $case = [PSCustomObject]@{ route='image'; input=@{context=$ctx; image=$img.Name}; error=($_.Exception.Message); ok=$false }
    $cases += $case; Append-CaseNdjson $case
  }
  Wait-Polite 1000
}

$end = Get-Date
$okCount = ($cases | Where-Object { $_.ok }).Count
$errCount = $cases.Count - $okCount
$summary = [PSCustomObject]@{
  baseUrl = $BaseUrl; total = $cases.Count; ok = $okCount; errors = $errCount;
  routes = @{ text=$needText; text_image=$needTI; image=$needImg };
  startedAt = $start; finishedAt = $end; durationSec = [int]((New-TimeSpan -Start $start -End $end).TotalSeconds)
}

$cases | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $OutDir 'cases.json') -Encoding UTF8
$summary | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $OutDir 'summary.json') -Encoding UTF8
"OK: $($summary | ConvertTo-Json -Depth 4)" | Set-Content -Path (Join-Path $OutDir 'run.log')
Set-Content -Path (Join-Path $OutDir 'probe.txt') -Value 'ok' -Encoding UTF8

Write-Host "Done. Results in $OutDir" -ForegroundColor Green