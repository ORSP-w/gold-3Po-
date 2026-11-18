param()

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js 22 or newer is required. Install Node.js LTS and run this script again."
}

$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 22) {
    throw "Node.js 22 or newer is required. Current version: $(node --version)"
}

if (-not (Test-Path ".env")) {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $token = ([BitConverter]::ToString($bytes)).Replace("-", "").ToLowerInvariant()

    $config = Get-Content ".env.example" -Raw
    $placeholder = "replace-with-a-long-random-secret"
    if (-not $config.Contains($placeholder)) {
        throw "The token placeholder in .env.example was not found. Create .env manually."
    }
    $config = $config.Replace($placeholder, $token)
    Set-Content -Path ".env" -Value $config -Encoding ASCII
    Write-Host "Created .env with a new random ingestion token."
}

Write-Host ""
Write-Host "Starting GOLD-3Po Market Lab..."
Write-Host "Open http://127.0.0.1:8787 in your browser."
Write-Host "Keep this PowerShell window open while using the app."
Write-Host "Press Ctrl+C to stop the local server."
Write-Host ""

npm start
