# Registro de verificação

Verificação executada em 11/09/2026 na branch `codex/implementacao-completa-napne-360`, usando dados exclusivamente fictícios.

| Verificação | Resultado |
| --- | --- |
| `backend/mvnw.cmd -B -ntp clean verify` | 20 testes, 0 falhas; JAR gerado |
| `npm run lint` | Todos os arquivos aprovados |
| `npm run build` | Bundle de produção gerado |
| `npm test -- --watch=false` | 1 teste Angular, aprovado |
| `npm audit --omit=dev` | 0 vulnerabilidades de produção |
| `docker compose up -d --build --wait` | MySQL, MongoDB, backend e frontend saudáveis |
| Flyway em MySQL real | V1, V2 e V3 validadas; V3 aplicada sem intervenção |
| `npm run e2e` | 9 cenários aprovados após subida e novamente após restauração |
| `scripts/backup.ps1` | Dumps de MySQL/Mongo, anexos e manifesto SHA-256 gerados |
| `scripts/restore.ps1 ... -ConfirmRestore` | 73 documentos Mongo, índices, MySQL e anexos restaurados; health e E2E aprovados |

O E2E cobre login/logout e navegação dos sete perfis, proteção do administrador técnico, criação de estudante/caso, dossiê versionado, registros estruturados, vínculo docente, PEI com revisão humana, negações por perfil, upload/download/versionamento de PDF e eventos documentais na linha do tempo.

## Observações de segurança

- A auditoria completa do npm indica oito achados moderados somente na árvore de desenvolvimento, ligados ao `webpack-dev-server` e dependências transitivas, sem correção disponível para a linha Angular usada. A imagem publicada contém apenas arquivos estáticos no Nginx e não inclui essas ferramentas.
- Não foram encontrados achados em dependências npm de produção.
- Os avisos de descoberta de repositórios do Spring Data durante testes decorrem do uso simultâneo de JPA e MongoDB; os repositórios foram classificados corretamente e os contextos iniciaram.
