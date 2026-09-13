# Pitch Bid — offline archive of the live Supabase data.
#
# Reads every table the public/anon key is allowed to read and writes each one to
# BOTH .json (exact, for restoring) and .csv (openable in Excel) under a
# timestamped folder. Read-only: this script never writes to the database.
#
# Usage:   powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1
# Output:  OneDrive\Documents\personal\cricket\pitch-bid-backups\<timestamp>\

$ErrorActionPreference = 'Stop'

$repo = Split-Path $PSScriptRoot -Parent
$dest = Join-Path $env:OneDrive "Documents\personal\cricket\pitch-bid-backups"
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
$out = Join-Path $dest $stamp
New-Item -ItemType Directory -Force -Path $out | Out-Null

# Read Supabase connection details from the repo's .env
$envmap = @{}
Get-Content (Join-Path $repo '.env') | ForEach-Object {
  if ($_ -match '^([^=]+)="?([^"]*?)"?$') { $envmap[$matches[1]] = $matches[2] }
}
$url = $envmap['VITE_SUPABASE_URL']
$key = $envmap['VITE_SUPABASE_PUBLISHABLE_KEY']
if (-not $url -or -not $key) { throw "Could not read Supabase URL/key from .env" }

$headers = @{ apikey = $key; Authorization = "Bearer $key" }
$tables = @('players','teams','auctions','auction_teams','auction_players','bids','user_roles','team_members')

$summary = @()
foreach ($t in $tables) {
  try {
    # Page through in case a table grows beyond one request.
    # A typed List is used rather than @() += because PowerShell 5.1 can wrap a
    # plain array in a PSObject envelope, which corrupts both .Count and the JSON.
    # Invoke-WebRequest + ConvertFrom-Json is used instead of Invoke-RestMethod:
    # in a script, Invoke-RestMethod hands back the whole JSON array as ONE item,
    # so every table silently archived as a single nested row.
    $all = New-Object System.Collections.Generic.List[object]
    $offset = 0; $page = 1000
    while ($true) {
      $resp = Invoke-WebRequest -Uri "$url/rest/v1/$t`?select=*&limit=$page&offset=$offset" `
                                -Headers $headers -UseBasicParsing -TimeoutSec 60
      # NOTE: no @() around this. ConvertFrom-Json emits the whole array as a single
      # pipeline item, so @() would box it into an array-of-array and the archive
      # would contain one nested row instead of hundreds.
      $batch = $resp.Content | ConvertFrom-Json
      $n = 0
      foreach ($row in $batch) { [void]$all.Add($row); $n++ }
      if ($n -lt $page) { break }
      $offset += $page
    }
    $rows = $all.Count
    ConvertTo-Json -InputObject $all.ToArray() -Depth 10 |
      Out-File (Join-Path $out "$t.json") -Encoding utf8
    if ($rows -gt 0) {
      $all.ToArray() | Export-Csv (Join-Path $out "$t.csv") -NoTypeInformation -Encoding utf8
    }
    $summary += [pscustomobject]@{ table = $t; rows = $rows; status = 'ok' }
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    $summary += [pscustomobject]@{ table = $t; rows = 0; status = "skipped (HTTP $code)" }
  }
}

# A small manifest so a future reader knows what this folder is
[pscustomobject]@{
  taken_at        = (Get-Date).ToString('u')
  supabase_url    = $url
  supabase_project = $envmap['VITE_SUPABASE_PROJECT_ID']
  note            = 'Read via the public anon key, so only publicly-readable tables are included. profiles (personal data) is intentionally excluded.'
  tables          = $summary
} | ConvertTo-Json -Depth 5 | Out-File (Join-Path $out 'manifest.json') -Encoding utf8

$summary | Format-Table -AutoSize
Write-Host ""
Write-Host "Archive written to: $out"
