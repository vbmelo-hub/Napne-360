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
