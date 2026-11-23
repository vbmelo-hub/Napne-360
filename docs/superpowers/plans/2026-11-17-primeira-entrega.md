# Primeira entrega NAPNE 360 — plano de implementação

Objetivo: entregar upload de até 10 MB pelo Nginx e retomada/edição de acompanhamentos com histórico e proteção contra edição desatualizada. Autorização: pedido explícito do usuário em 2026-11-17 para iniciar a implementação por partes e delegar a Antigravity e Codex.

Base: `13f7376cb18bdb8d0055b1a5bcbd4ace0b843417`, branch `codex/napne-primeira-entrega-20261117`, checkout externo ao cofre em `/tmp/napne-360-implementacao-20261117`.

Spec: matriz de aceite `docs/acceptance-matrix.md`, recorte CA10, CA12 e CA13. CA14 permanece parcial até D02: não inventar campos obrigatórios ou ciência/pactuação. RF15–RF19 excluídos.

## Restrições e coordenação

- Três frentes com arquivos exclusivos; somente o maestro executa operações Git de commit/integração.
- Nenhuma escrita no cofre, nenhum dado real, nenhuma alteração da main ou de branch compartilhada. Os agentes não publicam nem integram. Após os testes, o maestro preserva a entrega em branch dedicada e PR em rascunho; merge continua pendente.
- Não recriar autenticação, perfis ou arquitetura. Preservar o RBAC existente no servidor.
- Após duas tentativas sem nova evidência, registrar hipótese/erro e comunicar ao maestro; continuar outra verificação independente. Não repetir comando malsucedido sem mudança justificada.
- Os agentes não devem criar subagentes. Revisões são coordenadas pelo maestro após a entrega.
- Teste de regressão antes da alteração; rodar a suíte adequada e relatar comando, resultado e limitações. Ambiente indisponível deve ser identificado, não confundido com falha de produto.

## Contrato de registros

`GET /api/v1/students/{studentId}/records` continua fornecendo os registros autorizados, com `version` e `history` já persistidos. Frontend passa a tipar esses campos.

`PUT /api/v1/students/{studentId}/records/{id}` mantém `caseId`, `subjectId` e `type` imutáveis. Corpo passa a carregar `version: number | null`; atualização exige igualdade com a versão lida e devolve conflito HTTP 409 se ausente/desatualizada em um registro persistido. Criação continua aceitando payload existente, sem exigir versão.

Histórico mantém título, status, conteúdo, autor e data da versão anterior. Cada atualização bem-sucedida emite `CARE_RECORD_UPDATED` com `recordId`, `type` e `subjectId` quando presente, mesma classificação de visibilidade da criação e sem conteúdo sensível no evento.

Interface oferece editar ao NAPNE ou ao autor com perfil compatível, preserva campos e vínculos, permite cancelar e salvar DRAFT/ACTIVE segundo o comportamento existente, envia a versão, atualiza lista/linha do tempo e mantém as alterações locais se houver erro. Expõe versões para quem já pode ler o registro. Finalização apenas usa o estado ACTIVE existente; não representa aceite do CA14 nem inventa obrigatoriedade de campos.

## Tarefa 1 — backend de acompanhamento (Codex #2)

Arquivos exclusivos: `backend/src/main/java/br/edu/ifac/napne360/document/CareRecordService.java`; novo `backend/src/test/java/br/edu/ifac/napne360/document/CareRecordServiceTest.java`. Só ampliar essa lista se indispensável e comunicar antes.

- [ ] Testes que falham antes da implementação: atualização aceita com versão atual e histórico preservado; versão antiga/ausente recusa antes da mutação; outro autor e outro estudante recusados; vínculos imutáveis; evento de atualização com visibilidade/escopo corretos.
- [ ] Adicionar versão ao request e verificar antes de alterar o documento; preservar checks de autorização e `@Version` do Mongo.
- [ ] Acrescentar evento de atualização com os metadados acima, sem conteúdo.
- [ ] Executar testes direcionados e Maven verify; escrever relatório `/tmp/napne-360-backend-report.md`.

## Tarefa 2 — interface e regressão de acompanhamento (Antigravity)

Arquivos exclusivos: `frontend/src/app/core/models.ts`, `frontend/src/app/core/api.service.ts`, `frontend/src/app/pages/student-detail.component.ts`; novo `frontend/src/app/pages/student-detail.component.spec.ts` e/ou `frontend/e2e/care-records.spec.ts`. Preferir componentes/padrões existentes, sem reorganização ampla.

- [ ] Teste que mostra a falta de retomada e a jornada de criar rascunho, recarregar, editar e finalizar; incluir cancelamento, conflito/erro sem perda do formulário e ausência de edição para gestão/outro autor.
- [ ] Tipar `version` e `history`; adicionar `updateRecord(studentId, recordId, value)` consumindo o PUT existente.
- [ ] Implementar edição e consulta do histórico com controles acessíveis; preservar chaves extras do conteúdo e todos os vínculos do registro.
- [ ] Executar build, lint e testes; escrever relatório `/tmp/napne-360-frontend-report.md`.

## Tarefa 3 — upload pelo Nginx (Codex #3)

Arquivos exclusivos: `frontend/nginx.conf`, `backend/src/main/resources/application.properties`, novo script de teste em `scripts/` e alteração focada em `.github/workflows/ci.yml` se o teste for reproduzível em CI. Não alterar dependências.

- [ ] Reproduzir arquivo acima de 1 MB sendo rejeitado pelo Nginx com a configuração original; testar pela camada real do proxy, não por inspeção textual.
- [ ] Alinhar `client_max_body_size` e tamanho máximo da requisição multipart com a regra de arquivo de até 10 MiB já aplicada pelo backend. Usar 11m/11MB de envelope para acomodar multipart; manter limite por arquivo em 10MB.
- [ ] Demonstrar sucesso abaixo de 1 MB, acima de 1 MB e no limite de arquivo; arquivo acima de 10 MiB deve ser recusado pelo backend e envelope acima de 11 MiB recusado pelo proxy. Separar comprovação de proxy da comprovação ponta a ponta.
- [ ] Automatizar regressão viável, sem falso positivo de upstream 502; escrever relatório `/tmp/napne-360-upload-report.md`.

## Maestro — integração e revisão

- [ ] Preparar dependências e ambiente; coordenar portas e serviços sem colisão.
- [ ] Inspecionar todos os diffs, preservar fronteiras de autorização e ausência de dados reais.
- [ ] Obter revisão independente dos pacotes entregues, corrigir achados relevantes e rodar validações integradas adequadas.
- [ ] Registrar resultados técnicos em documentação do repositório e manter histórico das falhas/tentativas. Nenhuma nota do cofre será alterada sem pedido de registro.
- [ ] Entregar commits locais revisáveis e resultado factual, distinguindo o que foi testado do que permanece pendente.

## Foco de revisão

Versão obsoleta não sobrescreve; histórico não vaza entre perfis; conteúdo desconhecido não é apagado ao editar; formulário não perde dados em erro; multipart no limite não é rejeitado pelo envelope; não tratar mock de API como prova de integração real.

## Resultado da execução

- Tarefa1: concluída, revisão independente sem bloqueador; backend48 testes aprovados.
- Tarefa2: concluída após duas correções/re-review; frontend12 testes, build/lint aprovados; envio bloqueia campos via fieldset, sem disable/enable dos FormGroups.
- Tarefa3: limites iniciados por Codex#3, harness/integração concluídos pelo maestro, revisão Codex#2;7 verificações de proxy e1 testeAPIreal através do Nginx aprovados.
- Integração:13 E2E aprovados, incluindo3 jornadas reais de acompanhamento; conflitos de versão e histórico conferidos no Mongo.
- Decisões preservadas: D02/CA14 não implementados nesta parte; sem homologação institucional nem afirmação de aceite integral da matriz.
- Evidências e falhas intermediárias: `docs/verification/2026-11-17-primeira-entrega.md`.

## Limite de publicação da CI

GitHub recusou alteração de workflow pela credencial disponível, sem escopo workflow. Publicação em `codex/napne-acompanhamentos-upload` preserva o código funcional e a CI existente; nova etapa de Nginx fica proposta em `docs/ci-nginx-upload.patch`. Não se solicitou ampliação de credenciais nem se declarou essa etapa aplicada.
