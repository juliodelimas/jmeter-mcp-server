# jmeter-mcp-server

Servidor MCP (stdio) para construir, manter, executar e ler relatórios de
testes do [Apache JMeter](https://jmeter.apache.org/) sem precisar abrir a
interface gráfica.

O plano de teste é modelado como uma árvore JSON (armazenada localmente) e só
é convertido para um `.jmx` de verdade na hora de rodar — o `.jmx` gerado
segue o mesmo formato que o JMeter usa, então pode ser aberto normalmente na
GUI se você quiser conferir visualmente.

## Tools disponíveis

**Autoria** (cada uma retorna o `id` do nó criado, usado como `parentId` da próxima):
- `create_test_plan` — cria um novo plano, retorna `planId` e o id do nó raiz
- `add_thread_group` — grupo de threads (usuários virtuais)
- `add_http_sampler` — requisição HTTP (sample request)
- `add_json_extractor` — post-processor JSON Extractor
- `add_header_manager` — HTTP Header Manager
- `add_response_assertion` — Response Assertion
- `add_aggregate_report_listener` — listener Aggregate Report
- `add_summary_report_listener` — listener Summary Report

**Inspeção:**
- `list_test_plans` — lista os planos existentes
- `get_test_plan` — retorna a árvore completa de um plano (útil para achar `parentId`s)

**Execução e relatórios** (assíncrono):
- `execute_test_plan` — gera o `.jmx` e roda o JMeter em modo não-GUI em background; retorna um `executionId` na hora
- `get_execution_status` — status da execução (`running`/`completed`/`failed`) + tail do log
- `stop_execution` — mata o processo do JMeter em andamento
- `get_execution_report` — lê o `.jtl` gerado pelos listeners Aggregate/Summary e devolve estatísticas agregadas por request e no total (contagem, erro%, avg/min/max/mediana/p90/p95/p99, throughput, KB/s)

## Pré-requisitos

- Node.js 18+
- JMeter instalado localmente, com a variável de ambiente `JMETER_HOME`
  apontando para a pasta que contém `bin/jmeter` (ex.: via Homebrew,
  `brew install jmeter` deixa em `/opt/homebrew/opt/jmeter/libexec`)

## Build

```bash
npm install
npm run build
```

Isso gera `dist/index.js`, o entrypoint do servidor.

Variáveis de ambiente:
- `JMETER_HOME` (obrigatória) — instalação do JMeter
- `JMETER_MCP_WORKSPACE` (opcional) — onde salvar planos e execuções; padrão `./jmeter-workspace` no diretório de onde o servidor for iniciado

## Adicionando esse MCP no Claude Code

### Via npx (recomendado, publicado no npm)

Sem precisar clonar nem buildar nada — o `npx` baixa e roda a versão publicada
na hora:

```bash
claude mcp add jmeter \
  -e JMETER_HOME=/opt/homebrew/opt/jmeter/libexec \
  -- npx -y jmeter-mcp-server
```

Ajuste o caminho do `JMETER_HOME` para onde o JMeter estiver instalado na sua
máquina. Opcionalmente, defina também `JMETER_MCP_WORKSPACE` com `-e` se
quiser que os planos fiquem em outro lugar.

Por padrão o escopo é `local` (só neste diretório de projeto). Para deixar
disponível em qualquer projeto, use `-s user`:

```bash
claude mcp add jmeter -s user \
  -e JMETER_HOME=/opt/homebrew/opt/jmeter/libexec \
  -- npx -y jmeter-mcp-server
```

Confira que o servidor foi registrado e está respondendo com:

```bash
claude mcp list
```

### Via clone local (desenvolvimento)

Se você está mexendo no código deste repositório em vez de usar a versão
publicada, aponte direto para o `dist/index.js` depois do build:

```bash
claude mcp add jmeter \
  -e JMETER_HOME=/opt/homebrew/opt/jmeter/libexec \
  -- node /Users/juliodelimas/projects/jmeter-mcp-server/dist/index.js
```

### Claude Desktop

Se preferir usar no Claude Desktop, adicione em
`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jmeter": {
      "command": "npx",
      "args": ["-y", "jmeter-mcp-server"],
      "env": {
        "JMETER_HOME": "/opt/homebrew/opt/jmeter/libexec"
      }
    }
  }
}
```

## Escopo da v1

Fora do escopo por enquanto (fica pra próxima leva): editar/remover elementos
já criados, importar um `.jmx` externo, gerar o dashboard HTML (`-e -o`),
outros tipos de sampler/assertion/extractor, CSV Data Set Config, execução
distribuída.
