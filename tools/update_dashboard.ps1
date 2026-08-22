param(
  [Parameter(Mandatory = $true)]
  [string]$Database,
  [string]$MasterUpdater = ""
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot

if ($MasterUpdater) {
  & $MasterUpdater
}

python (Join-Path $PSScriptRoot "export_dashboard.py") --database $Database
if ($LASTEXITCODE -ne 0) { throw "Falló la exportación del tablero." }

npm run test:data
if ($LASTEXITCODE -ne 0) { throw "Fallaron las pruebas de datos." }

npm run test:static
if ($LASTEXITCODE -ne 0) { throw "Fallaron los controles estáticos." }

Write-Host "Datos actualizados y controles superados. Revise git diff antes de publicar." -ForegroundColor Green

