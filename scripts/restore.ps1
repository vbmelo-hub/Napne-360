[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BackupDirectory,

    [switch]$ConfirmRestore
)

$ErrorActionPreference = 'Stop'
if (-not $ConfirmRestore) {
    throw 'A restauração substitui dados atuais. Execute novamente com -ConfirmRestore após validar o backup e interromper o acesso dos usuários.'
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$backupDirectoryPath = (Resolve-Path $BackupDirectory).Path
$mysqlPath = Join-Path $backupDirectoryPath 'mysql.sql'
$mongoPath = Join-Path $backupDirectoryPath 'mongo.archive.gz'
$uploadsPath = Join-Path $backupDirectoryPath 'uploads.zip'
$manifestPath = Join-Path $backupDirectoryPath 'manifest.json'

foreach ($requiredPath in @($mysqlPath, $mongoPath, $uploadsPath, $manifestPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Arquivo obrigatório ausente: $requiredPath"
    }
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
foreach ($entry in $manifest.files) {
    $candidate = Join-Path $backupDirectoryPath $entry.name
    $actual = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $entry.sha256) {
        throw "Integridade inválida para '$($entry.name)'."
    }
}

Push-Location $repositoryRoot
try {
    docker compose up -d --wait mysql mongo backend
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível preparar os serviços para restauração.' }

    Get-Content -LiteralPath $mysqlPath -Raw -Encoding utf8 |
        docker compose exec -T mysql sh -c 'exec mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao restaurar o MySQL.' }

    $mongoContainerPath = '/tmp/napne360-mongo.archive.gz'
    docker compose cp $mongoPath "mongo:$mongoContainerPath"
    docker compose exec -T mongo mongorestore '--nsInclude=napne360_documents.*' --archive=$mongoContainerPath --gzip --drop
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao restaurar o MongoDB.' }
    docker compose exec -T mongo rm -f $mongoContainerPath

    $temporaryUploads = Join-Path ([System.IO.Path]::GetTempPath()) ("napne360-uploads-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $temporaryUploads | Out-Null
    try {
        Expand-Archive -LiteralPath $uploadsPath -DestinationPath $temporaryUploads -Force
        docker compose exec -T backend sh -c 'find /data/uploads -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'
        docker compose cp "$temporaryUploads/." 'backend:/data/uploads/'
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao restaurar os anexos.' }
    }
    finally {
        if (Test-Path -LiteralPath $temporaryUploads) {
            Remove-Item -LiteralPath $temporaryUploads -Recurse -Force
        }
    }

    docker compose restart backend
    docker compose up -d --wait backend
    if ($LASTEXITCODE -ne 0) { throw 'Os dados foram restaurados, mas o backend não voltou ao estado saudável.' }
    Write-Host 'Restauração concluída. Valide o health check e execute um teste funcional antes de reabrir o acesso.'
}
finally {
    Pop-Location
}
