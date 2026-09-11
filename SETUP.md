# Configuração do ambiente

## Requisitos

Java 21, Node 22 atualizado (ou 24.15), npm e Docker Compose. O Maven é obtido pelo Wrapper do repositório; não é necessário instalar Gradle.

Mantenha o trabalho na branch dedicada. Não altere `main` durante a implementação.

## Bancos e aplicação local

Na raiz:

```sh
docker compose up -d --wait mysql mongo
```

Em um terminal no diretório `backend`:

```sh
./mvnw clean verify
./mvnw spring-boot:run
```

No Windows, use `mvnw.cmd`. Se o sistema tiver Java antigo como padrão, ajuste `JAVA_HOME` e o PATH do terminal para Java 21. Não redefina diretórios pessoais para contornar a configuração.

Em outro terminal, no diretório `frontend`:

```sh
npm ci
npm start
```

Abra http://localhost:4200. O proxy local encaminha `/api` para http://localhost:9000.

## Containers completos

```sh
docker compose up -d --build --wait
docker compose ps
docker compose logs backend
```

Pare a API/frontend locais antes de usar as mesmas portas em containers. As portas dos bancos ficam vinculadas a 127.0.0.1. O Compose completo e o Dev Container usam volumes separados; não execute os dois conjuntos nas mesmas portas ao mesmo tempo.

## Variáveis

`.env.example` documenta as variáveis. O perfil `dev` usa credenciais fictícias locais; o perfil `prod` exige segredos externos e desativa seed/OpenAPI. Nunca utilize as credenciais públicas de demonstração em produção.

- `DB_URL`, `DB_USERNAME`, `DB_PASSWORD`: MySQL.
- `MONGODB_URI`: banco documental.
- `JWT_SECRET`: chave de assinatura com pelo menos 32 bytes.
- `STORAGE_ROOT`: diretório de binários.
- `CORS_ALLOWED_ORIGINS`: origens explícitas da interface.
- `SPRING_PROFILES_ACTIVE`: `dev`, `test` ou `prod`.

Em desenvolvimento com processos locais, cada terminal precisa receber suas variáveis; um arquivo `.env` não é carregado automaticamente pelo Spring fora do Compose.

## Testes

```sh
# backend
./mvnw clean verify

# frontend
npm run build
npm test -- --browsers=ChromeHeadless
npm run e2e
npm audit --omit=dev
```

O teste de contexto usa H2 e não depende de MongoDB ativo. Os testes E2E usam MySQL e MongoDB reais e o seed fictício. Não execute E2E contra bancos institucionais.

## Dev Container

Abra no VS Code com a extensão Dev Containers e escolha “Reopen in Container”. A configuração instala Java 21, Node 22 e CLI Angular 20. Os serviços internos usam os nomes `mysql` e `mongo`; as variáveis correspondentes já estão no Compose do Dev Container.

## Reinicialização sem apagar dados

`docker compose down` encerra os serviços preservando volumes. `docker compose up -d` retoma o ambiente. O seed repõe itens ausentes sem substituir dossiês existentes.

Para uma demonstração vazia, prefira um novo projeto Compose com portas livres e volumes novos. Não remova volumes ou registros do ambiente existente sem confirmar que são descartáveis e que não contêm dados a preservar.

## Backup e restauração

Com os serviços ativos, gere um conjunto coordenado com:

```powershell
.\scripts\backup.ps1
```

A restauração exige a opção explícita `-ConfirmRestore`. Consulte [docs/backup-and-restore.md](docs/backup-and-restore.md) antes de executar o procedimento.
