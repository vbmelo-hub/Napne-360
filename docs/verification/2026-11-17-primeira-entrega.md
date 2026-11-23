# Primeira entrega — acompanhamento e upload — 2026-11-17

Base: `main` em `13f7376cb18bdb8d0055b1a5bcbd4ace0b843417`. Alterações verificadas na branch local `codex/napne-primeira-entrega-20261117` e preparadas para publicação em `codex/napne-acompanhamentos-upload`, com código funcional idêntico. Dados exclusivamente fictícios, com matrículas `TEST-...`, em bases/volumes Docker separados.

Recorte: upload pelo proxy e retomada/edição/histórico de acompanhamentos. Os requisitos completos e a ordem de implementação estão em [acceptance-matrix.md](../acceptance-matrix.md); decisões institucionais continuam explícitas. Finalizado usa o estado ACTIVE já existente, sem inventar campos obrigatórios, ciência ou pactuação.

## Implementação

- PUT de acompanhamento recebe a versão lida; ausente/nula/divergente retorna 409 antes de alterar o documento. Criação sem versão continua compatível. `@Version` Mongo permanece responsável pelo incremento e por conflitos concorrentes no save.
- Edição conserva caso/componente/tipo/criador e campos adicionais do conteúdo. O histórico expõe valores anteriores autorizados, autoria, data e situação.
- Eventos de atualização contêm somente recordId/type/subjectId opcional, com a mesma classificação da criação. Não incluem texto do acompanhamento.
- Predicado de edição suporta autores com perfis combinados sem herdar a precedência da lista de criação. Gestão isolada não edita; NAPNE conserva a autorização do servidor.
- Envelope multipart de 11 MiB em Nginx/Spring; arquivo de até 10 MiB mantido no servlet e no storage.

## Execuções registradas

| Camada | Procedimento | Resultado |
| --- | --- | --- |
| Backend RED | `./mvnw -B -Dtest=CareRecordServiceTest test`, antes da alteração do serviço | 28 casos, 16 falhas funcionais esperadas, zero erros. Versão antiga/ausente era aceita com mutação e o evento de update não existia. |
| Backend GREEN | Mesmo teste após a alteração | 28/28 aprovados. |
| Backend completo | `./mvnw -B verify` | 48 testes, zero falhas/erros/skipped; JAR gerado. Contexto usa H2 e o monitor Mongo de teste registra conexão recusada em 27018; essa camada não prova integração Mongo. |
| Frontend, primeira rodada corrigida | `CHROME_BIN=/tmp/napne-chrome-headless npm test -- --browsers=ChromeHeadless` | 11 testes aprovados; havia achado residual de campos editáveis durante envio, submetido a nova correção. |
| Frontend final | Mesmo comando Angular após o ajuste residual | 12/12 aprovados; comportamento DOM de envio e erro verificado. |
| Build/lint | `npm run build`, `npm run lint` | Aprovados no conjunto com correções de autorização/histórico. |
| Dependências | `npm audit --omit=dev --audit-level=high` | Zero achados na árvore de produção. `npm ci` registrou 48 achados no conjunto completo; não representa auditoria de backend, imagens ou segurança integral. |
| E2E integrado completo | `npm run e2e -- --config=/tmp/napne-playwright.config.cjs` | 13 cenários aprovados em 1.1 min, incluindo os nove existentes, três jornadas novas de acompanhamento e um teste de limite de arquivo. |
| Proxy original | Script com a configuração anterior, esperando encaminhar 2 MiB | 512 KiB chegou íntegro; 2 MiB recebeu 413 em vez de 200, reproduzindo a regressão. |
| Proxy corrigido | `python3 -I -O scripts/test_upload_nginx.py --nginx /tmp/napne-nginx/usr/sbin/nginx` | Sete verificações aprovadas: corpo íntegro/assinatura do receptor, limiares de exatamente 11 MiB e 11 MiB + 1. Verificações não dependem de assert Python. |
| API real pelo Nginx | `npm run e2e -- --config=/tmp/napne-proxy-playwright.config.cjs upload-limits.spec.ts` | Um teste aprovado: arquivos de 512 KiB, 2 MiB e 10 MiB salvos e baixados com bytes iguais; 10 MiB + 1 recusado pela API; envelope acima de 11 MiB recusado pelo proxy; somente três anexos criados. |

As jornadas novas usam controles reais do navegador para criar rascunho, recarregar, editar, cancelar, finalizar e abrir histórico como NAPNE, professor e tutor. Depois conferem versão/histórico persistidos no Mongo, evento de edição e recusa HTTP 409 com versão antiga pela API. Essa última verificação é uma requisição de API, não uma jornada visual de conflito.

## Revisão e falhas encontradas

Codex #2 implementou backend; Antigravity implementou frontend; Codex #3 iniciou upload e revisou backend; maestro concluiu upload, ensaios e integração; Codex #2 revisou interface e upload independentemente. Relatórios completos foram produzidos em `/tmp` durante a execução, com vereditos e limitações.

A revisão encontrou bloqueio indevido de autores com múltiplos perfis, histórico exibindo somente notas e possibilidade de perder edição durante save pendente. A primeira correção resolveu os dois primeiros e bloqueou troca de registro; a revisão seguinte exigiu também bloquear digitação nos campos do mesmo registro durante o envio. A comprovação final desse ajuste será registrada abaixo, após sua execução.

Uma observação de revisão sobre ausência de teste POST no backend foi refutada: `CareRecordServiceTest` usa `mvc.perform(post(...))`, remove version/status e verifica 200/DRAFT/defaults/histórico vazio.

A primeira execução E2E falhou em um login ainda pendente e em dois seletores de rótulo exato para selects que incluíam texto de opções. O teste passou a aguardar a resposta de autenticação e a selecionar por papel/nome acessível. Execuções seguintes dos quatro casos novos e dos 13 cenários completos passaram; a falha do seletor não foi tratada como defeito da aplicação.

## Ambiente e reprodução

Java 21.0.13 (Temurin), Node 24.21.0, npm 11.19.0, Chromium 151 e Nginx 1.28.3 nativo. MySQL 8 e MongoDB 7 em containers isolados pelo projeto Compose `napne360_20261117`; API Java na porta 9000. Frontend dev na porta 14200 e proxy de integração na porta 14201. CI continua usando Node 22 e Chrome do runner; essa matriz não foi reproduzida integralmente localmente.

Configurações temporárias do Playwright mudam apenas navegador, portas, diretório de saída e servidor local. Para ambiente usual descrito no README, as mesmas specs rodam com `npm run e2e`. O teste de proxy pode ser repetido com Python 3 e Nginx nativo: `python3 -I scripts/test_upload_nginx.py --nginx /caminho/absoluto/nginx`.

Docker WSL/interop estava indisponível no sandbox e o daemon Desktop estava parado. A execução autorizada iniciou o Desktop; dependências de teste foram preparadas em `/tmp`. Bind de portas e downloads exigiram permissão ampliada. Primeiro harness Nginx falhou em diretório temporário FastCGI do pacote Ubuntu, ajustado para diretório descartável antes da prova funcional. Esses incidentes de ambiente não foram apresentados como defeitos do produto.

## Limites preservados

- A imagem frontend Docker `nginx:1.27-alpine` não foi construída/exercitada. O ensaio real usa Nginx 1.28.3 com o server block candidato, alterando apenas listen/upstream/root para o ambiente local.
- A credencial disponível foi recusada pelo GitHub ao tentar publicar alteração de workflow por ausência do escopo `workflow`. O workflow permanece inalterado nesta publicação; a etapa de Nginx está proposta em `docs/ci-nginx-upload.patch`. A CI existente descobre os novos E2E automaticamente. O script de proxy foi executado localmente, não pela CI desta publicação.
- Concorrência real do PEI, falhas parciais entre bancos/eventos/auditoria, recuperação de uploads órfãos e homologação WCAG permanecem fora desta entrega.
- O motivo obrigatório de revisão, campos de finalização por tipo e ciência/pactuação não foram implementados nesta parte. CA12/CA14 completos e homologação institucional não são declarados aceitos por esta verificação.
- Há avisos preexistentes de chaves com ponto nos FormRecords do dossiê e avisos de execução do navegador/Mockito; não foram suprimidos nem declarados resolvidos.

## Conferência final do salvamento pendente

O ajuste final usa somente `<fieldset [disabled]="actionBusy()">`; não há disable/enable dos FormGroups. Isso bloqueia a interação durante o envio sem habilitar indevidamente Tipo/Componente em caso de erro. Os testes usam `matches(':disabled')` para avaliar o bloqueio herdado do fieldset, não a propriedade individual do input.

Após essa implementação: suíte Angular **12/12** aprovada; build de produção e lint aprovados; a suíte integrada completa passou novamente em **13/13**, em 1.2 min. O teste de erro com Subject confirma reabilitação e preservação do texto; o de envio pendente confirma os controles bloqueados e a recusa de troca de registro. A re-review independente encerrou F3 e a asserção residual, sem bloqueadores restantes no delta desta entrega.

Uma execução intermediária teve 1 falha/11 sucessos porque a asserção de erro ainda consultava `input.disabled` em vez de `:disabled`. A propriedade individual não mede a herança do fieldset; corrigiu-se o teste sem acrescentar mutações aos FormGroups. O resultado final foi conferido no código corrigido, preservando o registro desse fracasso.
