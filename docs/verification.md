# Registro de verificação

## CA06 — gravação e concorrência do dossiê

Em 2026-11-24, a branch `codex/napne-ca06-dossie`, a partir de `2442fcd`, foi validada com 235 testes de backend e a jornada `dossier-concurrency.spec.ts` em MySQL 8 e MongoDB 7 isolados, com dados fictícios.

O PUT mantém a exigência de versão atual e agora exige as oito seções como objetos. Uma seção ausente ou nula retorna HTTP 400 sem alterar conteúdo, versão, histórico, linha do tempo ou auditoria. Um objeto vazio é aceito. O teste de contrato reproduziu antes da correção a aceitação indevida das 16 combinações de omissão e valor nulo.

No navegador, dois NAPNEs do mesmo campus carregaram a mesma versão. O primeiro salvamento retornou 200. A segunda sessão recebeu 409 e manteve o texto digitado. Após recarregar, o conteúdo vencedor permaneceu e o histórico exibiu uma única revisão, com autoria, data e comparação. Um PUT sem uma das seções foi recusado, e as três consultas de dossiê, histórico e linha do tempo permaneceram iguais.

## CA08 — vínculo entre acompanhamentos e casos

Em 2026-11-23, a branch local `codex/napne-ca08-vinculos`, a partir de `3b386b5`, foi validada com JDK 21, Angular 20, MySQL 8, MongoDB 7 e dados fictícios. `mvn verify` aprovou 217 testes. A suíte Angular aprovou 51 testes, e lint e build de produção passaram. A suíte Playwright completa aprovou 20 cenários.

A jornada nova exercitou registro sem caso mesmo com um caso ativo, escolha entre dois casos ativos do mesmo estudante, recusa de caso incompatível ou perfil sem permissão, proteção do vínculo para outros perfis e edição após arquivamento. Um teste Java com duas transações em H2 confirmou que a criação aguarda um encerramento concorrente e devolve HTTP 400 sem gravar o registro, o evento ou a auditoria. A prova concorrente usou doubles para os efeitos externos ao banco relacional.

## Verificações anteriores

Registro da primeira entrega de acompanhamento/upload em 2026-11-17: [evidências e limites](verification/2026-11-17-primeira-entrega.md). A [matriz de aceite priorizada](acceptance-matrix.md) preserva os diagnósticos iniciais; não é uma declaração de homologação integral.

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

## Retomada — 2026-11-05: E2E de login

Base: branch `desenvolvimento`, commit `29721f844b5967a7c9aaf2582d6f421d4a284f63`, de 11/09/2026. A [CI desse commit](https://github.com/vbmelo-hub/Napne-360/actions/runs/34659824700) aprovou oito cenários E2E e falhou no teste de login: `getByLabel('Senha')` encontrava tanto o campo quanto o botão “Mostrar senha”. Esse resultado é posterior ao registro de verificação acima.

A falha foi reproduzida localmente antes da alteração. O teste agora identifica o campo pelo rótulo exato e verifica a navegação do formulário por Tab, a habilitação do envio após preenchimento e o uso de Espaço/Enter para mostrar e ocultar a senha, preservando seu valor e o foco.

| Verificação nesta retomada | Resultado |
| --- | --- |
| `npm ci` com o lockfile existente | Dependências instaladas |
| `npm run build` | Bundle de produção gerado |
| `npm run lint` | Aprovado |
| `npx --no-install eslint e2e/login.spec.ts` | Aprovado |
| `npm test -- --browsers=ChromeHeadless` | 1 teste Angular aprovado |
| Playwright: `login.spec.ts` antes da alteração | Falha por seletor ambíguo reproduzida |
| Playwright: `login.spec.ts` após a alteração | 1 cenário aprovado, incluindo navegação por teclado |

Ambiente local: Node 24.21.0 e Chromium 151. O E2E usou uma configuração temporária externa ao repositório para selecionar o Chromium instalado e servir o frontend na porta 14200. O teste unitário usou o mesmo navegador por `CHROME_BIN`. O login foi verificado sem enviar credenciais à API.

O backend e os outros oito cenários E2E, que exigem API, MySQL e MongoDB, não foram reexecutados nesta retomada. A correção local ainda precisa de uma nova execução da CI para confirmar a suíte integrada completa. Esta verificação do formulário não representa homologação formal de acessibilidade.

## Correção da auditoria de produção — 2026-11-05

Base local: `f5be20f6bc353a4562b79ae9dad3676bdc0fda71`, branch `codex/retomada-login-e2e`. A [CI desse commit](https://github.com/vbmelo-hub/Napne-360/actions/runs/42132803307) aprovou backend Maven, build, lint e o teste Angular, mas falhou em `npm audit --omit=dev --audit-level=high`. Os bancos, a API e os nove E2E foram pulados nessa execução. A auditoria local reproduziu cinco pacotes afetados (quatro moderados e um alto), associados a três advisories; os demais pacotes aparecem por dependência de `@angular/common`/`@angular/platform-browser`.

Versões corrigidas confirmadas nos advisories oficiais do Angular e disponibilidade/peers de 20.3.34 consultados no registro npm:

| Advisory | Problema | Primeira correção na linha 20 |
| --- | --- | --- |
| [GHSA-jfgx-762w-99vr](https://github.com/angular/angular/security/advisories/GHSA-jfgx-762w-99vr) | Vazamento de token XSRF por divergência na interpretação de URLs em `@angular/common` | 20.3.34 |
| [GHSA-ff3f-86qr-9cv3](https://github.com/angular/angular/security/advisories/GHSA-ff3f-86qr-9cv3) | DoS por parâmetros numéricos de URL no Router com SSR | 20.3.32 |
| [GHSA-62vg-58rm-qff7](https://github.com/angular/angular/security/advisories/GHSA-62vg-58rm-qff7) | DoS por outlets vazios não correspondentes no Router com SSR | 20.3.33 |

Os dois advisories do Router exigem SSR; este frontend usa renderização no navegador e distribuição estática. A atualização corrige a árvore auditada mesmo assim. Para o aviso XSRF, o npm/GitHub Advisory Database classifica a severidade como moderada e o advisory do mantenedor como alta; as faixas corrigidas coincidem.

Foi escolhida 20.3.34, a menor versão que reúne as três correções. `common`, `compiler`, `core`, `forms`, `platform-browser`, `platform-browser-dynamic`, `router` e `compiler-cli` foram alinhados de 20.3.31 para 20.3.34. O manifesto eleva o mínimo para `^20.3.34`; o lockfile resolve os oito em 20.3.34. CLI e build-angular permanecem em 20.3.37; TypeScript 5.9.3 satisfaz o peer `>=5.8 <6.0` de compiler-cli. A comparação dos lockfiles confirmou que nenhuma outra entrada de pacote mudou.

A tentativa direta de atualização retornou `ERESOLVE` por peers exatos ainda presos a 20.3.31. A resolução foi feita em diretório temporário, preservando o lockfile de base e removendo apenas as oito entradas antigas antes de solicitar explicitamente 20.3.34. O resultado foi conferido antes de copiar o lockfile e executar `npm ci` no projeto. Não foram usados `--force`, `--legacy-peer-deps`, overrides ou migração major; o limiar e o comando de auditoria da CI foram preservados.

| Verificação após a atualização | Resultado |
| --- | --- |
| `npm ci --cache /tmp/napne-360-npm-cache` | 1.076 pacotes instalados a partir do lockfile corrigido |
| `npm ls` dos oito pacotes Angular atualizados, com `--depth=0` | Todos em 20.3.34, sem erro de peers |
| `npm audit --omit=dev --audit-level=high --cache /tmp/napne-360-npm-cache --json` | 0 vulnerabilidades, código de saída 0 |
| `npm run build` | Bundle de produção gerado; total inicial 320,81 kB |
| `npm run lint` | Todos os arquivos aprovados |
| `CHROME_BIN=/tmp/napne-360-browsers/chromium-1234/chrome-linux64/chrome npm test -- --browsers=ChromeHeadless` | 1 teste Angular aprovado |
| `PLAYWRIGHT_BROWSERS_PATH=/tmp/napne-360-browsers npm run e2e -- --config=/tmp/napne-360-local-playwright.config.ts login.spec.ts` | 1 E2E aprovado, incluindo teclado e mostrar/ocultar senha |

Ambiente desta correção: Node 24.21.0, npm 11.19.0 e Chromium 151.0.7922.34, com os mesmos caminhos temporários de navegador/configuração usados na retomada. O login usa dados fictícios e não envia o formulário à API. A CI usa Node 22, portanto não foi reproduzida integralmente a matriz do runner.

Limitações confirmadas: a CLI Docker não está integrada nesta distribuição WSL e o `docker.exe` do Windows não conseguiu conectar ao pipe `dockerDesktopLinuxEngine`. Assim, os outros oito E2E que dependem de API/MySQL/MongoDB não foram executados neste bloco; o backend não foi reexecutado localmente. A aprovação anterior do backend na CI é evidência do commit de base, não de uma nova execução deste commit. O `npm ci` ainda reportou 53 achados na auditoria completa (1 baixo, 35 moderados, 12 altos e 5 críticos), fora da árvore de produção auditada; a correção deste bloco não os elimina. Esses resultados atualizam as observações históricas de segurança acima, que descreviam a árvore de setembro. O novo commit fica local, pendente de revisão independente e publicação antes de nova CI integrada.
