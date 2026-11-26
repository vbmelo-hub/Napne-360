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
$backupDirectoryPath = (Resolve-Path -LiteralPath $BackupDirectory).ProviderPath
$artifactNames = @('mysql.sql', 'mongo.archive.gz', 'uploads.zip')
$manifestPath = Join-Path $backupDirectoryPath 'manifest.json'

foreach ($name in ($artifactNames + 'manifest.json')) {
    $path = Join-Path $backupDirectoryPath $name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Arquivo obrigatório ausente: $path"
    }
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
if (($manifest.formatVersion -isnot [int] -and $manifest.formatVersion -isnot [long]) -or $manifest.formatVersion -ne 1) {
    throw 'Versão do manifesto de backup incompatível.'
}
if ($manifest.files -isnot [array] -or $manifest.files.Count -ne $artifactNames.Count) {
    throw 'O manifesto deve listar os três artefatos do backup uma vez cada.'
}
foreach ($name in $artifactNames) {
    $entries = @($manifest.files | Where-Object { $_.name -ceq $name })
    if ($entries.Count -ne 1) {
        throw "O manifesto deve listar '$name' uma vez."
    }
    $entry = $entries[0]
    $candidate = Join-Path $backupDirectoryPath $name
    $size = (Get-Item -LiteralPath $candidate).Length
    if (($entry.bytes -isnot [int] -and $entry.bytes -isnot [long]) -or $size -le 0 -or $size -ne $entry.bytes) {
        throw "Tamanho inválido para '$name'."
    }
    $actual = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash
    if ($entry.sha256 -isnot [string] -or $actual -ne $entry.sha256) {
        throw "Integridade inválida para '$name'."
    }
}

$mysqlPath = Join-Path $backupDirectoryPath 'mysql.sql'
$mongoPath = Join-Path $backupDirectoryPath 'mongo.archive.gz'
$uploadsPath = Join-Path $backupDirectoryPath 'uploads.zip'
$temporaryUploads = Join-Path ([System.IO.Path]::GetTempPath()) ("napne360-uploads-" + [guid]::NewGuid())
try {
    New-Item -ItemType Directory -Path $temporaryUploads | Out-Null
    try {
        Expand-Archive -LiteralPath $uploadsPath -DestinationPath $temporaryUploads
    }
    catch {
        throw "Arquivo de anexos inválido: $($_.Exception.Message)"
    }

    Push-Location $repositoryRoot
    try {
        docker compose stop backend
        if ($LASTEXITCODE -ne 0) { throw 'Não foi possível parar o backend para restauração.' }

        docker compose up -d --wait mysql mongo
        if ($LASTEXITCODE -ne 0) { throw 'Não foi possível preparar os bancos para restauração.' }

        docker compose up --no-start --no-deps backend
        if ($LASTEXITCODE -ne 0) { throw 'Não foi possível preparar o container do backend parado.' }

        $mysqlContainerPath = '/tmp/napne360-restore-' + [guid]::NewGuid() + '.sql'
        docker compose cp $mysqlPath "mysql:$mysqlContainerPath"
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao copiar o dump do MySQL para restauração.' }
        try {
            docker compose exec -T mysql sh -c 'exec mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" < "$1"' sh $mysqlContainerPath
            if ($LASTEXITCODE -ne 0) { throw 'Falha ao restaurar o MySQL.' }
        }
        finally {
            docker compose exec -T mysql rm -f $mysqlContainerPath
        }

        $mongoContainerPath = '/tmp/napne360-restore-' + [guid]::NewGuid() + '.archive.gz'
        docker compose cp $mongoPath "mongo:$mongoContainerPath"
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao copiar o arquivo do MongoDB para restauração.' }
        try {
            docker compose exec -T mongo mongorestore '--nsInclude=napne360_documents.*' --archive=$mongoContainerPath --gzip --drop
            if ($LASTEXITCODE -ne 0) { throw 'Falha ao restaurar o MongoDB.' }
        }
        finally {
            docker compose exec -T mongo rm -f $mongoContainerPath
        }

        docker compose run --rm --no-deps -T --entrypoint sh backend -c 'find /data/uploads -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao remover os anexos do destino.' }
        docker compose cp "$temporaryUploads/." 'backend:/data/uploads/'
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao restaurar os anexos.' }

        try {
            docker compose up -d --wait backend
            if ($LASTEXITCODE -ne 0) { throw 'Os dados foram restaurados, mas o backend não voltou ao estado saudável.' }
        }
        catch {
            docker compose stop backend
            if ($LASTEXITCODE -ne 0) { throw 'O backend não voltou ao estado saudável e não foi possível pará-lo.' }
            throw
        }
        Write-Host 'Restauração concluída. Valide o health check e execute um teste funcional antes de reabrir o acesso.'
    }
    finally {
        Pop-Location
    }
}
finally {
    if (Test-Path -LiteralPath $temporaryUploads) {
        Remove-Item -LiteralPath $temporaryUploads -Recurse -Force
    }
}
