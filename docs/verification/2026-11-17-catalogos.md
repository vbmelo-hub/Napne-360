# Categorias do dossiê e períodos do PEI — 2026-11-17

Base: `674174391e20949521c5242738971c2431a9d671`, branch local `codex/napne-catalogos-20261117`. Incremento de CA11 e do recorte de categorias/períodos de CA21, sem declarar CA21 inteiro aceito. D03 foi confirmada pelo usuário nesta retomada em 2026-11-17. Não houve merge, implantação ou homologação institucional por este registro.

## Contrato e decisão D03

Novas associações usam itens ativos do catálogo administrativo. Categoria é opcional; período é obrigatório para novo PEI. O dossiê guarda `educationalNeeds.categoryId` e o nome registrado em `category`. PEI novo guarda `academicTermId`, o código estável em `academicTerm` e o nome registrado em `academicTermLabel`. O servidor determina os nomes registrados. Código e tipo do catálogo não podem mudar após a criação; nome/descrição/situação continuam editáveis.

O campo singular de categoria preserva a estrutura que já existia e constitui um recorte técnico escolhido pelo maestro para este incremento. Não representa decisão institucional de limitar as necessidades de um estudante a uma categoria; seleção múltipla permanece fora do recorte.

Renomeação e inativação não reescrevem os nomes históricos. O mesmo ID histórico pode continuar no dossiê que já o contém; novo vínculo inativo é recusado. Omissão de `categoryId` conserva a referência anterior; `null` remove referência e nome. Revisão do mesmo PEI herda os campos do período, mesmo inativo. O POST antigo com `academicTerm` exige correspondência exata com código ativo cadastrado. Nenhum cadastro nem associação de legado é inferido por nome.

Os seletores mostram nomes e deixam itens inativos fora das novas seleções. Legado sem ID mantém seu texto e pode ser revisado sem inventar associação. Categoria continua na projeção restrita do dossiê; ADMIN não ganha acesso ao conteúdo do estudante.

## Jornadas preparadas

`frontend/e2e/catalogs.spec.ts` prepara três cenários: criar/renomear/inativar pela administração e consumir pelos seletores; validar IDs/códigos/inatividade/omissão/remoção na API sem persistência indevida; reabrir categoria e PEI legados sem associação automática. `workflow-api.spec.ts` cria seu período fictício pela API administrativa antes de testar o cliente antigo por código.

Todos os estudantes dessas jornadas têm matrícula `TEST-CATALOG-...` ou `TEST-...`, com dados fictícios. A fixture histórica é necessária porque a API atual recusa texto livre novo. Ela transforma somente o dossiê e um PEI de um estudante `TEST-CATALOG-...` recém-criado pelo próprio teste. O helper usa argumentos separados, sem shell, e confere correspondência de exatamente um documento em cada coleção. Os demais passos usam API e interface reais.

No ambiente padrão/CI, o helper encontra Mongo por `docker compose ps -q mongo`. Para outro executável/projeto Compose, configurar `NAPNE_E2E_DOCKER` e `NAPNE_E2E_COMPOSE_PROJECT`. Não há IDs fixos de catálogo nem dependência de seus seeds. Contas/curso/componente fictícios usam o seed de desenvolvimento já exigido pelas jornadas existentes.

## Evidências

Preparação: `npm run e2e -- --config=/tmp/napne-catalogos-playwright.config.cjs --list` identificou **16 testes em 6 arquivos**, incluindo os três novos; código de saída 0. Listagem não executa nem comprova os cenários.

Verificações finais executadas pelos implementadores e conferidas nos relatórios/logs da mesma árvore:

| Camada | Comando | Resultado |
| --- | --- | --- |
| Backend focado | `./mvnw -o -B -Dtest=DossierCatalogTest,PeiCatalogTest,ReferenceControllerTest test` | 46/46 aprovados. RED inicial: 36 falhas funcionais em 40 casos; RED adicional de coerção: duas falhas em 46 casos. |
| Backend completo | `./mvnw -o -B verify` | 94 testes, zero falhas/erros/skipped; `BUILD SUCCESS` e JAR novo. Testes de serviço usam mocks e o contexto completo usa H2; a prova de SQL/Mongo reais está nas jornadas E2E abaixo. |
| Frontend completo final | `CHROME_BIN=/tmp/napne-chrome-headless npm test -- --browsers=ChromeHeadless` | 30/30 aprovados, após incluir a correção de busca. Avisos preexistentes de chaves com ponto nos FormRecords continuam presentes. |
| Busca, regressão DOM | Mesmo comando Angular com `--include='src/app/pages/students.component.spec.ts'` | RED 2/2 falharam antes da correção; GREEN 2/2 após. Os casos disparam submit DOM com/sem submitter; não simulam uma tecla Enter física. |
| Frontend produção/lint | `npm run build`, `npm run lint` | Ambos exit 0 na árvore com a busca corrigida. |
| E2E, compilação estática | `npx --no-install tsc --noEmit --strict --skipLibCheck --module nodenext --target es2022 --types node e2e/catalog-fixtures.ts e2e/catalogs.spec.ts e2e/profiles.spec.ts e2e/workflow-api.spec.ts` | Exit 0. |

Execução real com API nova, MySQL e Mongo isolados, frontend do worktree e Chromium cacheado:

| Execução | Comando | Resultado observado |
| --- | --- | --- |
| Primeira rodada completa | `npm run e2e -- --config=/tmp/napne-catalogos-playwright.config.cjs` | Exit 1, **13 aprovados e 3 falhas**, 2.5 min. |
| Repetição dos arquivos afetados | `npm run e2e -- --config=/tmp/napne-catalogos-rerun-playwright.config.cjs catalogs.spec.ts profiles.spec.ts` | Exit 1, **8 aprovados e 2 falhas**, 2.8 min. Legado completo e validações API aprovados; jornada administrativa e perfil NAPNE ainda falharam. |
| Rodada final dos arquivos afetados | `npm run e2e -- --config=/tmp/napne-catalogos-final-playwright.config.cjs catalogs.spec.ts profiles.spec.ts` | Exit 0, **10/10 aprovados**, 59.9 s. Os três cenários de catálogos e os sete de perfis passaram. |

Na primeira rodada, o helper esperou o título NAPNE na página correta de ADMIN, e o seletor de categoria usou o rótulo plural anterior à versão final. O terceiro caso assumia que o seed Alex estaria na primeira página mesmo após mais de 20 estudantes fictícios acumulados. Na repetição, o helper não encerrava a sessão antes de trocar de perfil; a aplicação corretamente redirecionava o usuário já autenticado ao início. Esses ajustes são no harness, sem alteração do produto.

A tentativa de usar a busca de estudantes no E2E mostrou um defeito preexistente: submissão nativa de `/estudantes?` e chamadas de API com `query=` vazio. O implementador do frontend corrigiu o evento de envio para impedir a recarga e executar a busca. A rodada final passou usando a busca pela interface, sem contornar o defeito por paginação nem alterar os dados seed. A troca de perfil do harness limpa somente `sessionStorage` da página de teste e recarrega o login; não usa logout, que revoga também as sessões de API da mesma conta.

Os logs completos são `/tmp/napne-360-catalogos-e2e.log`, `/tmp/napne-360-catalogos-e2e-rerun.log` e `/tmp/napne-360-catalogos-e2e-final.log`. Artefatos de falha foram preservados em diretórios separados, sem publicação de traces contendo autenticação. A evidência consolidada cobre **16 cenários com êxito**: seis inalterados passaram na primeira rodada e dez afetados passaram na rodada final. **Não houve uma rodada única de 16/16.** Os seis inalterados são as três jornadas de acompanhamento, a tela de login, o limite de upload e o fluxo completo por API.

Na rodada final, a administração criou, renomeou e inativou categoria/período pela interface. Formulários de outro estudante mostraram os nomes novos enquanto ativos; depois da inativação, os IDs desapareceram das novas opções. O dossiê original reabriu e foi salvo com ID/nome registrados; o PEI conservou código/ID/nome e sua revisão herdou os três campos. A API recusou a categoria inativa em outro dossiê novo com 400, sem documento/histórico gravados; desconhecidos, tipo errado e novo texto livre também foram recusados. Omissão preservou categoria; `null` removeu; snapshot adulterado não substituiu o nome determinado pelo servidor.

A fixture histórica direta no Mongo respondeu e as leituras seguintes da API/interface confirmaram categoria sem ID, notas e chave extra preservadas. A remoção explícita funcionou; a revisão do PEI conservou o código legado sem inventar ID/nome, e as duas revisões reapareceram após recarregar. A consulta administrativa retornou 200 com o mesmo token que recebeu 403 ao pedir o dossiê; professor vinculado recebeu `educationalNeeds: {}`. Assim, a prova de acesso negado usa ADMIN autenticado válido.

A API iniciou do JAR novo `backend/target/napne360-backend-0.0.1-SNAPSHOT.jar`, SHA-256 `638c2143332e7894ffe2cbe37f4066fa348b4ae0eea38c98a7d98d56194d22e2`, após confirmar a porta 9000 livre. `GET /actuator/health` retornou `UP`. Java 21.0.13 e Node 24.21.0; projeto Compose `napne360_20261117`, MySQL 8 e Mongo 7 com volumes de teste preservados. Os E2Es usam portas 9000/14200, sem repetir os ensaios de proxy/Nginx da primeira entrega. A matriz CI com Node 22 não foi reproduzida localmente.

Os comandos E2E locais usaram `NAPNE_E2E_DOCKER` com o executável do Docker Desktop e `NAPNE_E2E_COMPOSE_PROJECT=napne360_20261117`. As configurações temporárias apontam explicitamente `testDir`/`cwd` para o worktree deste incremento e alteram somente navegador, portas e destinos dos artefatos. O modo padrão/CI continua sendo `npm run e2e` com `docker compose` disponível. A execução local precisou de permissão ampliada para bind de portas, navegador e interop WSL; a recusa inicial de socket no sandbox não foi contada como teste funcional.

## Limites

Este recorte não completa administração de contas/perfis/vínculos/campus/cursos/componentes/modelos de CA21, concorrência real do PEI, tratamento de falhas parciais entre bancos/eventos/auditoria, implantação nem homologação WCAG. Aceite técnico local não substitui validação pelo NAPNE/IFAC. As restrições de upload/proxy e da matriz CI descritas na [primeira entrega](2026-11-17-primeira-entrega.md) continuam separadas deste incremento.
