# NAPNE 360 — Refatoração 03

Base da branch `refatoracao-03` em `d410efd` (`refatoracao-02`).

| Requisito | Alteração |
|---|---|
| R03-GLOBAL-V01 e V03 | Barras locais e remotas compartilham layout responsivo e ações verdes. A busca remota cancela consultas antigas, os critérios avançados podem ser aplicados em conjunto e cada critério pode ser removido. O contador fica separado das ações. |
| R03-GLOBAL-V02 | Acessos foi dividido em perfis autorizados, redefinição de senha e controle de acesso. O modal Registrar matrícula organiza busca, resultados, paginação e ação de matrícula. |
| R03-ADMIN-V01 | A listagem de vínculos identifica matrícula do estudante e profissional vinculado. A projeção do administrador técnico conserva o escopo de dados anterior. |
| R03-NAPNE-V01 | Anexos têm ícone de largura fixa, nome alinhado à esquerda e ações que se reorganizam em telas estreitas. |
| R03-GLOBAL-F01 | Períodos, componentes, turmas e autores usam opções derivadas das listagens e dos históricos autorizados. Quando o histórico possui ID do autor, o filtro distingue homônimos. Os eventos antigos que só registraram nome continuam consultáveis pelo texto gravado. |
| R03-NAPNE-F01 | O NAPNE pode alterar a situação acadêmica com data, motivo e observações. A V105 adiciona o histórico e os campos que distinguem o arquivamento da situação acadêmica. Dependências impeditivas são informadas sem encerramento automático. |
| R03-NAPNE-F02 | Estudo de caso reúne triagem, acolhimento, investigação, orientações e plano de ação. Acompanhamento reúne devolutivas, tutoria, intervenções NAPNE e registros de recusa ou nova solicitação. Orientações e plano de ação ficam disponíveis aos colaboradores autorizados por meio dos mesmos registros. |

## Regras e referências institucionais

| Fonte consultada | Aplicação no NAPNE 360 |
|---|---|
| Manual do NAPNE, Portaria IFAC nº 16/2021, itens 4.2–4.7, p. 3 e Anexo II | A Central mantém o dossiê e organiza triagem, acolhimento e investigação em Estudo de caso. Os registros de investigação incluem campos existentes para entrevistas e análise documental. |
| Manual, itens 4.8–4.10, p. 3 e Anexo III | Orientações pedagógicas usam o registro versionado existente. A interface oferece aos demais perfis a consulta ou colaboração já autorizada. |
| Manual, itens 5.1–5.7, pp. 3–4 e Anexo IV | Plano de ação usa os campos e o histórico existentes de ações, responsabilidades, resultados e pactuação. A refatoração não cria uma assinatura digital institucional. |
| Manual, itens 5.8 e seguintes | Recusa e nova solicitação de apoio permanecem no acompanhamento e conservam seus tipos e históricos. |
| Resolução nº 18/2019/CONSU/IFAC, art. 5º, IV–V. Portaria IFAC nº 76/2025, art. 13, IV e art. 14, I–III | A interface separa o planejamento do trabalho contínuo articulado. Devolutivas, tutoria e intervenções reutilizam as permissões dos perfis existentes. |

A separação das abas, o tipo `NAPNE_FOLLOW_UP` e os motivos de situação são decisões de produto. O vínculo de um registro a `napne_case` é opcional. A organização reutiliza `care_records`, IDs de casos e registros, anexos, revisões, etapas configuradas e outbox. As permissões do PEI permanecem as da Refatoração 02.

O arquivamento novo guarda a situação acadêmica anterior. Para desarquivar um cadastro legado cujo estado anterior é desconhecido, o NAPNE precisa informar o estado conferido e a justificativa. Um estudante matriculado pode ter o estudo de caso encerrado sem alterar sua situação acadêmica. Uma política institucional para encerrar formalmente o acompanhamento contínuo, mantendo a matrícula, ainda precisa ser definida.

## Reset opcional da base fictícia local

Antes de qualquer reset, confira com `docker compose ls`, `docker compose --project-name <projeto> config --profiles` e `docker volume ls --filter label=com.docker.compose.project=<projeto>` se o projeto, o perfil e os volumes pertencem ao ambiente descartável pretendido. Se houver dados ou anexos a preservar, faça [backup com scripts/backup.ps1](backup-and-restore.md).

Somente em um ambiente local exclusivamente fictício e com confirmação explícita, `docker compose --project-name <projeto> down -v` exclui **todos os dados e anexos** nos volumes do projeto, incluindo `mysql-data`, `mongo-data` e `uploads`. Em seguida, `docker compose --project-name <projeto> up -d --build --wait` recria os volumes, aplica as migrations e carrega o seed se estiver habilitado. Use o mesmo perfil nos dois comandos, quando houver. Produção e ambientes compartilhados ficam fora desse procedimento.

## Validação focalizada

- **R03-GLOBAL-V01/V02/V03, R03-ADMIN-V01 e R03-NAPNE-V01.** Chromium a 1440 e 390 px com respostas fictícias. Foram verificadas barras nos dois estados, filtros combinados, teclado, foco, paginação, Acessos, Registrar matrícula e anexos. O pacote local `napne-r03-evidencias.zip` reúne 63 capturas, incluindo duas do fluxo real de situação.
- **R03-GLOBAL-F01.** Oito testes Angular de ofertas e atribuições passaram na reexecução direcionada. O teste Java da linha do tempo cobre autoria histórica, permissão e homônimos. A jornada combinada abrangente ficou fora do aceite abreviado.
- **R03-NAPNE-F01 e F02.** As duas jornadas Playwright passaram contra a API e os bancos isolados. Em MySQL 8, o Flyway aplicou V105 sobre a V104 povoada. A consulta preservou IDs de caso e registro, autoria, versão e revisão anterior no MongoDB. O cadastro arquivado legado manteve o estado anterior desconhecido e exigiu confirmação explícita no desarquivamento.
- **Regressão.** Build Angular e lint passaram. A rodada dirigida da Central, Estudantes e Casos passou em 44 testes. Na rodada integrada anterior aos últimos ajustes, 399 de 411 testes Java e 138 de 140 testes Angular passaram. Os testes afetados foram corrigidos e reexecutados de forma focalizada, com 67/67 Java em PEI e linha do tempo e 8/8 Angular em ofertas e atribuições. O aceite abreviado dispensou nova rodada integral.
