# Backup e restauração

O NAPNE 360 usa três fontes que devem pertencer ao mesmo ponto lógico de recuperação: MySQL, MongoDB e o volume de anexos. Faça o procedimento em janela de manutenção ou com a aplicação sem escrita para evitar um conjunto inconsistente.

## Criar backup

Com `mysql`, `mongo` e `backend` em execução, na raiz do repositório:

```powershell
.\scripts\backup.ps1
```

O resultado é gravado em `backups/<data-hora>/`, fora do Git, com:

- `mysql.sql`: identidades, vínculos, estudantes, casos e auditoria;
- `mongo.archive.gz`: dossiês, atendimentos, PEIs, linha do tempo e metadados documentais;
- `uploads.zip`: binários dos anexos;
- `manifest.json`: tamanhos e SHA-256 para verificação antes da restauração.

Copie o conjunto para armazenamento institucional criptografado, com controle de acesso, retenção e cópia externa definidos pela instituição. O script não envia dados para terceiros.

## Restaurar

A restauração substitui dados atuais. Interrompa o acesso dos usuários, preserve um backup do estado corrente e use explicitamente:

```powershell
.\scripts\restore.ps1 -BackupDirectory .\backups\20260911-120000 -ConfirmRestore
```

O script valida os hashes, restaura MySQL e MongoDB, substitui o conteúdo do volume de anexos e reinicia o backend. A flag obrigatória evita restauração acidental.

## Exercício de recuperação

Em ambiente isolado e descartável:

1. crie um backup e copie-o para fora do diretório do projeto;
2. suba um projeto Compose separado com volumes vazios;
3. restaure o conjunto;
4. confirme `/actuator/health`, login, estudante fictício, dossiê, linha do tempo, PEI e download de um anexo de teste;
5. registre data, duração, responsável, falhas e hashes do manifesto.

O RPO e o RTO não são definidos pelo software; devem ser aprovados pelo IFAC conforme criticidade, capacidade operacional e política documental.
