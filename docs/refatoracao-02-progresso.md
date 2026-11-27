# NAPNE 360 — Refatoração 02

Base local `refatoracao-01` no commit `b5803e8ab439a5e02ad86b688b5d8c08efc1912e`. Escopo definido em `NAPNE360_refatoracao_02.md`.

| Requisito | Resultado |
|---|---|
| R02-V01 e R02-PERFIS-V01 | A Central do Estudante e a tela de PEI apresentam instruções conforme as ações disponíveis e o estado dos registros. As mensagens de consulta do PEI usam as ações retornadas pela API. |
| R02-V02 e R02-F02 | As barras de busca e filtros ficam junto às listagens. Critérios estruturados são combinados antes da paginação. Usuários, estudantes, vínculos, ofertas, atribuições, matrículas, histórico de casos e linha do tempo aplicam critérios no servidor. |
| R02-F01 e R02-PERFIS-F01 | Campos obrigatórios selecionam uma opção única elegível. Escolhas opcionais conservam a alternativa geral. Tipos exibidos em contas com mais de um perfil combinam as opções de cada perfil. |
| R02-F03 e R02-ADMIN-F02 | Seletores pesquisáveis vinculam o ID da opção a formulários reativos. Profissionais elegíveis são consultados por campus e perfil, com limite por resposta, cancelamento de buscas anteriores e preservação de seleções válidas. O formulário de vínculo manual mantém a pesquisa dentro do campo Profissional. |
| R02-ADMIN-F01 | Edição de componente no modal do curso com ementa, identificação, carga horária e código validado. A migração V104 acrescenta a versão usada para detectar conflitos entre formulários. O arquivamento e a reativação verificam os vínculos existentes. |
| R02-PROF-F01 | A confirmação de criação abre o editor com o ID retornado. O rascunho fica acessível pela lista caso haja alterações pendentes em outra aba ou a navegação falhe. |

## Permissões observadas

O backend exige vínculo aplicável para consultar o PEI. Monitor/Tutor e Gestão sem um perfil adicional autorizado consultam o acompanhamento, enquanto o PEI permanece indisponível. COTEP e Coordenação de curso consultam PEIs conforme o vínculo existente. A refatoração preserva as regras de autorização, revisão e versionamento.

## Validação

As jornadas Playwright da refatoração exercitam a edição e os estados de um componente em um curso com 50 componentes, filtros de acompanhamento e linha do tempo com dados fictícios, e seletores de profissionais com 120 opções simuladas. A migração V104 foi executada em MySQL de demonstração sobre o schema da refatoração anterior.

## Complementos de 2026-11-27

| Requisito | Entrega |
|---|---|
| R02-V01 e R02-PERFIS-V01 | Textos da Central, do dossiê e do PEI acompanham as ações disponíveis e o estado do registro. |
| R02-V02 e R02-F02 | As barras recolhíveis de vínculos, ofertas, atribuições e matrículas mostram os valores dos filtros aplicados e permitem remover cada filtro. O histórico de vínculos inclui campi arquivados. O histórico docente pode ser filtrado por contas inativas e por contas cujo perfil Professor foi removido. |
| R02-F01 e R02-PERFIS-F01 | Campus, curso, oferta e tipos de registro são preenchidos automaticamente quando a escolha é obrigatória e há uma única opção elegível. A criação de PEI omite ofertas cujo componente e período já têm trabalho em andamento ou vigente. |
| R02-F03 e R02-ADMIN-F02 | Matrículas e candidatos profissionais têm busca remota, paginação, revalidação por ID e dependência do escopo. Cursos, componentes e responsáveis usam seleção pesquisável nos formulários e filtros revisados. Vínculos técnicos identificam o estudante pela matrícula. |
| R02-ADMIN-F01 | A edição e as mudanças de estado do componente preservam filtros, página, foco e posição da listagem. O cadastro de componente usa a busca de cursos ativos. |
| R02-PROF-F01 | O editor abre com o ID devolvido pela criação. Em caso de falha de navegação ou alterações pendentes, a listagem oferece acesso ao rascunho criado e retira a opção já ocupada do formulário. |

### Autorizações observadas por perfil

- Administrador técnico consulta estrutura, usuários, vínculos por matrícula e histórico docente.
- Professor com oferta elegível pode criar o rascunho. O estado e as ações devolvidas pela API determinam a apresentação do editor.
- NAPNE consulta os PEIs e tem ações de revisão quando o registro permite.
- COTEP e Coordenação de curso consultam os PEIs conforme o vínculo aplicável.
- Monitor/Tutor e Gestão em perfil exclusivo veem a aba PEI com orientação condicionada às permissões, mas a consulta de PEI pelo backend exige um dos perfis autorizados e o vínculo correspondente.

### Validação integrada

A V104 foi aplicada pelo Flyway no MySQL isolado do aceite. A suíte Java executou 397 testes, incluindo as integrações com MongoDB, sem falhas, erros ou testes pulados. O Angular passou em 134 testes, build de produção e lint.

As 35 jornadas Playwright foram aprovadas entre a execução integrada e as reexecuções dirigidas. A rodada integrada teve 32 aprovações imediatas. As jornadas de Tutor, configuração de etapas paginadas e filtro histórico docente passaram também em reexecuções isoladas. A regressão cobre a edição em cursos com 50 componentes, 120 profissionais simulados, 36 matrículas fictícias, filtros de acompanhamento e linha do tempo, criação e edição do PEI e proteção dos dados cadastrais.

A revisão visual inspecionou a administração, os formulários de vínculo e atribuição, o modal de componentes, estudantes, casos, acompanhamentos, PEIs, documentos e linha do tempo. A linha do tempo foi conferida a 390 px. Os painéis locais de evidência e a síntese dos testes estão em `frontend/test-results/r02-local/aceite`.
