# Continuidade da refatoração do NAPNE 360

Branch local `refatoracao-01`, a partir de `desenvolvimento` em `5c227cd`. Escopo definido em `NAPNE360_prompt_continuidade.md`.

| Lote | Implementação e verificação |
| --- | --- |
| Infraestrutura de interface | Comparação com o conteúdo salvo no dossiê, cadastro do estudante, casos, acompanhamentos, PEI e edição administrativa. Mensagens de operações conhecidas seguem códigos de erro. Rótulos da linha do tempo em português e asteriscos junto ao texto da label. |
| Administração | Edição cadastral, CPF normalizado e reservado à consulta autorizada, busca por CPF/matrícula, preservação de autoria após mudança de e-mail, campi, arquivamento, reativação e bloqueio de acesso. |
| Estrutura acadêmica | Períodos semestrais gerados no início do ano e na inicialização. Ofertas, matrículas e atribuições preservam histórico e originam vínculos docentes da mesma oferta. Vínculos manuais legados sem evidência para migração permanecem identificáveis. |
| Equipe NAPNE | Navegação interna do dossiê, histórico em modal, edição e transferência de caso, filtros entre casos e acompanhamentos, salvamento de acompanhamento, upload e consulta das versões de documentos. |
| Professor e PEI | Lista docente derivada de relações acadêmicas válidas ou vínculos legados preservados. Novos PEIs usam oferta autorizada. A série histórica continua identificada por estudante, componente e código do período. |
| Sessões | Renovação em atividade do usuário, aviso e limites configuráveis. Logout e troca de senha validam a versão da conta no lock de atualização. Atualizar frontend e backend em conjunto. JWTs da versão anterior exigem novo login. |

## Migrações

- V100 acrescenta CPF e matrícula institucional e preserva endereços anteriores para referências de autoria. Contas preexistentes podem ser regularizadas sem gerar CPFs fictícios.
- V102 introduz ofertas, matrículas, atribuições e origem do vínculo. A geração de períodos reaproveita o catálogo preservando códigos históricos usados no MongoDB.
- V103 registra os dados anteriores e atualizados das edições de origem e resumo de casos.

## Escopo anterior

- Curso e modal de componentes existentes no HEAD local. Filtros e paginação reutilizados nos fluxos afetados. Cobertura integral das listagens antigas depende da regressão do lote anterior.
- O arquivamento conjunto de curso e componentes do lote anterior diverge da regra mais recente de arquivamento sem cascata. A integração acadêmica acrescenta validação de ofertas ativas.

## Decisões e lacunas

- Casos mantêm as etapas configuráveis. Caso arquivado é terminal. Pré-requisitos pedagógicos adicionais de encerramento e reativação dependem de definição institucional.
- A criação de novo PEI exige oferta válida. Revisões de séries preexistentes sem oferta continuam no fluxo histórico quando o vínculo autorizado permite. A atribuição de turma a essas séries depende de evidência institucional.
- O histórico de anexos mantém o conteúdo e os metadados registrados na versão. Alteração de metadados fora do envio de uma nova versão depende da regra de versionamento a ser adotada.
- CPF de contas legadas pode ficar em branco até regularização. A exigência no banco depende da conclusão dessa regularização.
- A classificação de eventos antigos da linha do tempo usa os dados de escopo disponíveis em cada evento histórico.

## Verificação da branch

- Maven com bancos MongoDB isolados passou 378 testes, sem falhas ou casos pulados.
- Angular passou 112 testes no Chrome Headless, build de produção e lint.
- Flyway aplicou dez migrações numa base MySQL 8 vazia e o backend iniciou com o MongoDB 7 de demonstração.
- Playwright verificou o fluxo integrado de caso, dossiê, acompanhamento, autorização, PEI e versionamento de anexos. Também passou a jornada de oferta, atribuição e matrícula no Chromium/Nginx, seguida da busca do estudante pelo professor. A jornada do Anexo I confirmou preenchimento, salvamento, reabertura e PDF.
- A verificação de upload pelo navegador aceitou PDF, PNG, JPEG e DOCX na prévia Angular e no Nginx. O estudante permaneceu na rota, os anexos apareceram após confirmação e os quatro eventos foram exibidos na linha do tempo. A prévia autenticada de imagem e a consulta de versões também passaram.
- Login e consulta de sessão passaram com os sete perfis fictícios na prévia. A suíte Playwright integral e a auditoria visual de cada formulário e perfil permanecem pendentes.
- Portal de desenvolvimento com recarga ao salvar em `http://127.0.0.1:14322/login`. API de demonstração na porta 9000. Nginx de verificação na porta 14321.

## Pendências

- Ampliar a cobertura dos avisos de descarte e das mensagens específicas nos formulários administrativos e pedagógicos restantes.
- Validar a migração com uma cópia anonimizada que represente o volume e os vínculos históricos da instituição.
