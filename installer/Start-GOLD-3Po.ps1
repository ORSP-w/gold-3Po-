$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$logs = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logs, (Join-Path $root "data") | Out-Null

function Show-Failure([string]$message) {
    if ($env:GOLD3PO_NO_BROWSER -eq "1") { return }
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show($message, "GOLD-3Po Market Lab", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    } catch {}
}

try {
    $node = Join-Path $root "runtime\node.exe"
    if (-not (Test-Path -LiteralPath $node)) { throw "Startup error. See the installation logs." }

    $envFile = Join-Path $root ".env"
    if (-not (Test-Path -LiteralPath $envFile)) {
        $example = Join-Path $root ".env.example"
        if (-not (Test-Path -LiteralPath $example)) { throw "Startup error. See the installation logs." }

        $bytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $token = ([BitConverter]::ToString($bytes)).Replace("-", "").ToLowerInvariant()

        $config = [IO.File]::ReadAllText($example)
        $placeholder = "replace-with-a-long-random-secret"
        if (-not $config.Contains($placeholder)) { throw "Startup error. See the installation logs." }
        $config = $config.Replace($placeholder, $token)
        [IO.File]::WriteAllText($envFile, $config, [Text.Encoding]::ASCII)
    }

    $url = "http://127.0.0.1:8787"
    $healthUrl = "$url/health"
    $marker = "--gold3po-install-dir=$root"

    $alreadyRunning = $false
    try {
        $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) { $alreadyRunning = $true }
    } catch {}

    if (-not $alreadyRunning) {
        $processes = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue
        $matched = @($processes | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($marker, [StringComparison]::OrdinalIgnoreCase) -ge 0 })

        if ($matched.Count -eq 0) {
            $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
            $stdout = Join-Path $logs "server-$stamp.log"
            $stderr = Join-Path $logs "server-$stamp-error.log"
            $arguments = '--env-file=.env server.js "' + $marker + '"'
            $started = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
        }

        $ready = $false
        for ($i = 0; $i -lt 30; $i++) {
            Start-Sleep -Milliseconds 500
            try {
                $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
                if ($response.StatusCode -eq 200) { $ready = $true; break }
            } catch {}
        }

        if (-not $ready) {
            $detail = "Startup error. See the installation logs."
            if ($started -and $started.HasExited) { $detail += [Environment]::NewLine + "Startup error. See the installation logs." }
            $detail += [Environment]::NewLine + "Startup error. See the installation logs."
            throw $detail
        }
    }

    if ($env:GOLD3PO_NO_BROWSER -ne "1") { Start-Process $url }
} catch {
    $message = $_.Exception.Message
    try {
        $errorLog = Join-Path $logs "startup-error.log"
        [IO.File]::AppendAllText($errorLog, "$(Get-Date -Format o) $message" + [Environment]::NewLine)
    } catch {}
    Show-Failure $message
    exit 1
}
