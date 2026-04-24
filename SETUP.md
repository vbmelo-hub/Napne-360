# Configuração do Ambiente de Desenvolvimento

Este guia explica como configurar o ambiente de desenvolvimento utilizando Dev Container com Docker.

> [!IMPORTANT]
> O uso do Dev Container é opcional. Você pode configurar o ambiente instalando todas as ferramentas localmente, caso prefira o método tradicional.

## Exemplo de estrutura do projeto

```console
Napne-360/
├── .devcontainer/    # Configuração Docker
├── backend/          # Spring Boot (porta 9000)
└── frontend/         # Angular (porta 4200)
```

> [!WARNING]
> Os containers por padrão utilizam as seguintes portas:
>
> - **4200**: Angular (frontend)
> - **9000**: Spring Boot (backend)
> - **8080**: phpMyAdmin
> - **3306**: MySQL
>
> Se houver serviços locais rodando nessas portas, haverá conflito. Recomenda-se uma das seguintes ações:
>
> 1. Parar os serviços locais antes de iniciar os containers
> 2. Modificar as portas no arquivo `.devcontainer/docker-compose.yml`

## Instalação do Docker

- Windows: <https://docs.docker.com/desktop/setup/install/windows-install>
- Linux: <https://docs.docker.com/desktop/setup/install/linux>
- Mac: <https://docs.docker.com/desktop/setup/install/mac-install>
- Para verificar se o Docker está corretamente instalado e configurado, digite no terminal:

    ```console
    docker info
    ```

## Clonando o Repositório no VS Code

1. Instale a extensão [**Dev Containers**](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) no VS Code
2. Pressione `Ctrl+Shift+P`
3. Selecione **Dev Containers: Clone Repository in Container Volume**
4. Cole a URL do repositório
5. Aguarde a criação do container e abertura do workspace

> [!TIP]
> Se modificar as configurações em `.devcontainer/`, reconstrua o container:
>
> 1. Pressione `Ctrl+Shift+P`
> 2. Selecione **Dev Containers: Rebuild Container**