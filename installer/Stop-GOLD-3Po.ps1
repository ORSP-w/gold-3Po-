$ErrorActionPreference = "SilentlyContinue"
$root = $PSScriptRoot
$marker = "--gold3po-install-dir=$root"
$node = Join-Path $root "runtime\node.exe"

$processes = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'"
foreach ($process in $processes) {
    if ($process.ExecutablePath -eq $node -and $process.CommandLine -and $process.CommandLine.IndexOf($marker, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        Stop-Process -Id $process.ProcessId -Force
    }
}
