# Interactive first-run setup for Windows PowerShell: asks for the few values that have no safe
# default and writes .env, so that `docker compose up` works straight afterwards.
#
#   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
#   ... -Defaults    no questions: generate the secrets, keep every default
#   ... -Force       overwrite an existing .env instead of leaving it alone
#
# The Git Bash twin is scripts/setup.sh; the two write the same file.

[CmdletBinding()]
param(
  [switch]$Defaults,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

# Works both as scripts\setup.ps1 in a checkout and as a standalone setup.ps1 downloaded next to
# docker-compose.pull.yml from a release: run wherever .env.example actually is.
Set-Location $PSScriptRoot
if (-not (Test-Path '.env.example')) { Set-Location '..' }

if (-not (Test-Path '.env.example')) {
  Write-Error 'setup: .env.example is missing - run this from a Mockbench checkout.'
}

if ((Test-Path '.env') -and (-not $Force)) {
  Write-Output 'setup: .env already exists, leaving it untouched.'
  Write-Output '       Re-run with -Force to replace it, or edit .env by hand.'
  exit 0
}

if (Test-Path '.env') {
  # Postgres reads POSTGRES_PASSWORD only when it initialises its volume, so a new password in .env
  # does not reach a database that already exists: the api would then fail to authenticate.
  Write-Output 'setup: -Force replaces .env, including the database password.'
  Write-Output '       An existing database keeps its old password, so if you have already started'
  Write-Output '       Mockbench, either keep POSTGRES_PASSWORD as it is or remove the volume with'
  Write-Output "       'docker compose down -v' (which deletes your projects)."
  Write-Output ''
}

# A secret goes into .env, which Docker Compose parses: '$' would start an interpolation and '#' a
# comment, so keep typed values to characters that survive that file format intact.
$safe = '^[A-Za-z0-9_.:@+-]+$'

function New-Secret {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Get-ExampleDefault([string]$key) {
  $line = Select-String -Path '.env.example' -Pattern "^$key=" | Select-Object -First 1
  if ($null -eq $line) { return '' }
  return $line.Line.Substring($key.Length + 1)
}

function Test-PortBusy([int]$port) {
  try {
    $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop
    return ($null -ne $c)
  } catch { return $false }
}

function Read-Secret([string]$prompt) {
  while ($true) {
    Write-Host $prompt
    $secure = Read-Host '  [Enter] generates a strong random value' -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }

    if ([string]::IsNullOrEmpty($value)) { return (New-Secret) }
    if ($value.Length -lt 16) {
      Write-Host "  Too short ($($value.Length) characters, need at least 16). Try again."
      continue
    }
    if ($value -notmatch $safe) {
      Write-Host '  Use only letters, digits and _ . : @ + - (a $ or # breaks the .env file).'
      continue
    }
    return $value
  }
}

$portDefault = Get-ExampleDefault 'PORT'
if ([string]::IsNullOrEmpty($portDefault)) { $portDefault = '8080' }
$portValue = $portDefault

if ($Defaults -or ([System.Console]::IsInputRedirected)) {
  $sessionValue = New-Secret
  $pgValue = New-Secret
  if (Test-PortBusy ([int]$portValue)) {
    Write-Output "setup: warning - port $portValue is already in use on this machine."
    Write-Output '       Edit PORT in .env before starting, or stop whatever is using it.'
  }
} else {
  Write-Host ''
  Write-Host 'Mockbench setup - three questions, then you are done.'
  Write-Host ''

  # 1. port
  while ($true) {
    Write-Host 'Host port for the UI, the control API and the mocks.'
    $reply = Read-Host "  [Enter] keeps $portDefault"
    if ([string]::IsNullOrWhiteSpace($reply)) { $reply = $portDefault }
    $n = 0
    if (-not [int]::TryParse($reply, [ref]$n) -or $n -lt 1 -or $n -gt 65535) {
      Write-Host '  Not a port number (1-65535). Try again.'
      continue
    }
    if (Test-PortBusy $n) {
      $yes = Read-Host "  Port $n looks busy. Use it anyway? [y/N]"
      if ($yes -notmatch '^[Yy]') { continue }
    }
    $portValue = "$n"
    break
  }
  Write-Host ''

  # 2. session secret
  $sessionValue = Read-Secret 'Session secret. It keys the hash of session tokens; changing it later signs everyone out.'

  # 3. database password
  $pgValue = Read-Secret 'Database password. Postgres is not published outside the compose network.'
}

$out = foreach ($line in (Get-Content '.env.example')) {
  if ($line -match '^PORT=') { "PORT=$portValue" }
  elseif ($line -match '^SESSION_SECRET=') { "SESSION_SECRET=$sessionValue" }
  elseif ($line -match '^POSTGRES_PASSWORD=') { "POSTGRES_PASSWORD=$pgValue" }
  else { $line }
}

# UTF-8 with no BOM: a BOM would become part of the first variable's name and Compose would not see it.
[System.IO.File]::WriteAllLines(
  (Join-Path (Get-Location) '.env'),
  [string[]]$out,
  (New-Object System.Text.UTF8Encoding $false)
)

Write-Host ''
Write-Host "Wrote .env (port $portValue, generated or entered secrets, not printed here)."
Write-Host ''
Write-Host 'Start Mockbench:'
Write-Host '  docker compose up'
Write-Host ''
Write-Host "Then open http://localhost:$portValue and register - the first account owns the workspace."
