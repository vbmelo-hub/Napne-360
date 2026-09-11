# ADR 0002 — Atualização do Angular por segurança

Data: 10/09/2026. Status: adotada, com autorização explícita do usuário.

O plano inicial previa Angular 19. A consulta ao registro npm identificou sete dependências de produção afetadas por vulnerabilidades altas, incluindo problemas de sanitização e formatação de datas; não havia correção oferecida na linha 19.

Foi executada a migração oficial `ng update @angular/core@20 @angular/cli@20 --allow-dirty`. A aplicação passou para Angular 20.3.31, CLI/build 20.3.37 e TypeScript 5.9.3. A consulta `npm audit --omit=dev` retornou zero vulnerabilidades após a migração. Não houve necessidade de avançar outras versões principais para resolver esses achados.

Java 21, Maven e o desenho do backend foram preservados. A migração requer repetir build, testes unitários e E2E. Dependências de desenvolvimento e backend têm análise própria; um resultado limpo de produção Angular não certifica o sistema inteiro.
