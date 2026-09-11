[CmdletBinding()]
param(
    [string]$OutputRoot = (Join-Path $PSScriptRoot '..\backups')
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDirectory = Join-Path $OutputRoot $timestamp
$backupDirectory = [System.IO.Path]::GetFullPath($backupDirectory)
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null

Push-Location $repositoryRoot
try {
    $services = docker compose ps --services --filter status=running
    foreach ($required in @('mysql', 'mongo', 'backend')) {
        if ($services -notcontains $required) {
            throw "O serviço '$required' precisa estar em execução antes do backup."
        }
    }

    $mysqlPath = Join-Path $backupDirectory 'mysql.sql'
    $mysqlContainerPath = '/tmp/napne360-mysql.sql'
    docker compose exec -T mysql sh -c 'mysqldump --single-transaction --no-tablespaces --routines --triggers -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" > /tmp/napne360-mysql.sql'
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar o dump do MySQL.' }
    docker compose cp "mysql:$mysqlContainerPath" $mysqlPath
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao copiar o dump do MySQL.' }
    docker compose exec -T mysql rm -f $mysqlContainerPath

    $mongoContainerPath = '/tmp/napne360-mongo.archive.gz'
    docker compose exec -T mongo sh -c "mongodump --db napne360_documents --archive=$mongoContainerPath --gzip"
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar o dump do MongoDB.' }
    docker compose cp "mongo:$mongoContainerPath" (Join-Path $backupDirectory 'mongo.archive.gz')
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao copiar o dump do MongoDB.' }
    docker compose exec -T mongo rm -f $mongoContainerPath

    $uploadsDirectory = Join-Path $backupDirectory 'uploads'
    New-Item -ItemType Directory -Path $uploadsDirectory -Force | Out-Null
    docker compose cp 'backend:/data/uploads/.' $uploadsDirectory
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao copiar os anexos.' }
    $uploadsArchive = Join-Path $backupDirectory 'uploads.zip'
    [System.IO.Compression.ZipFile]::CreateFromDirectory($uploadsDirectory, $uploadsArchive)
    Remove-Item -LiteralPath $uploadsDirectory -Recurse -Force

    foreach ($requiredPath in @($mysqlPath, (Join-Path $backupDirectory 'mongo.archive.gz'), $uploadsArchive)) {
        if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
            throw "Artefato de backup não foi criado: $requiredPath"
        }
    }

    $files = Get-ChildItem -LiteralPath $backupDirectory -File | ForEach-Object {
        [ordered]@{
            name = $_.Name
            bytes = $_.Length
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
    [ordered]@{
        createdAt = (Get-Date).ToUniversalTime().ToString('o')
        formatVersion = 1
        files = @($files)
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $backupDirectory 'manifest.json') -Encoding utf8

    Write-Host "Backup concluído em: $backupDirectory"
}
finally {
    Pop-Location
}
