# jmeter-mcp-server

[![npm version](https://img.shields.io/npm/v/jmeter-mcp-server.svg)](https://www.npmjs.com/package/jmeter-mcp-server)
[![CI](https://github.com/juliodelimas/jmeter-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/juliodelimas/jmeter-mcp-server/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/node/v/jmeter-mcp-server.svg)](https://www.npmjs.com/package/jmeter-mcp-server)
[![TypeScript](https://img.shields.io/badge/TypeScript-5%2B-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/npm/l/jmeter-mcp-server.svg)](LICENSE)

Give an LLM real, deterministic control over [Apache JMeter](https://jmeter.apache.org/) — build test plans, run real load tests, and read back real results, without ever hand-writing `.jmx` XML or opening the GUI.

```
"Load test my API: 20 users hitting POST /orders for 2 minutes,
 5% think time, fail anything over 800ms"
```

...turns into a running JMeter test and a real report, through typed tool calls an MCP client (Claude Code, Claude Desktop, etc.) makes directly.

## Why not just ask an LLM to write the `.jmx` itself?

It can — a `.jmx` is just XML, and any capable model has seen plenty of JMeter test plans. The problem is *how* it fails: JMeter's format is a `hashTree` with dozens of fragile, easy-to-misremember details — exact `guiclass`/`testclass` pairs, property names that don't match their GUI label (`ThreadGroup.num_threads` is a `stringProp`, not an `intProp`), integer *bitmasks* for assertion match types, strict parent/child pairing with sibling `<hashTree>` tags. None of it is self-checking. A wrong value still produces valid, loadable XML that just quietly does the wrong thing.

That's not hypothetical — it happened building this project. An early version of the If Controller generated a property called `useExpression` set to `true`, which reads like "yes, evaluate my condition." The real JMeter source does the opposite: `useExpression=true` means *don't* evaluate it as an expression — just check if the string is literally `"true"`. Every non-trivial condition silently, permanently failed. No error, no warning — the child sampler just never ran. It only surfaced by actually executing the generated plan against real JMeter and noticing a sample count of zero.

That's the whole case for this server in one story: an LLM regenerating XML from memory re-risks that exact mistake on every single request. This server encodes the correct shape **once**, in a serializer checked against real JMeter source and bundled examples, exercised by [97 automated tests](#testing) including real JMeter runs — and exposes it as typed tools instead. Concretely:

- **Correctness through one tested code path**, not regenerated-from-memory XML every time.
- **Cheap incremental edits.** Plans are a small JSON tree with stable node ids — adding an assertion is one tool call with a `parentId`, not rewriting a whole `.jmx` file.
- **Aggregated results, not raw samples.** `get_execution_report` returns computed stats (error %, avg/median/p90/p95/p99, throughput) — not thousands of sample rows to average by hand.
- **Real async execution.** `execute_test_plan` returns immediately with an `executionId`; long-running load tests never block anything.

The generated `.jmx` is standard JMeter output — open it in the real GUI any time.

## Example

```
You:    Build a load test: 10 users for 30s hitting GET https://api.example.com/health,
        fail anything that takes over 500ms, then run it and tell me the p95.

Claude: [create_test_plan, add_thread_group, add_http_sampler, add_duration_assertion,
         add_aggregate_report_listener, execute_test_plan, get_execution_status, get_execution_report]

        Ran 300 requests over 30s, 0 failures. p95 latency: 214ms, avg: 187ms, throughput: 10.1 req/s.
```

Every step above is a real typed MCP tool call — see [Tools](#tools) for the full set (30+ elements: samplers, controllers, timers, extractors, assertions, listeners) and [Example workflow](#example-workflow) for the raw call sequence.

## Quick start

```bash
claude mcp add jmeter \
  -e JMETER_HOME=/opt/homebrew/opt/jmeter/libexec \
  -- npx -y jmeter-mcp-server
```

That's it — no cloning, no build. Adjust `JMETER_HOME` to your JMeter install (see [Prerequisites](#prerequisites)). Full setup details, Claude Desktop config, and local-dev instructions are in [Adding this server to Claude Code](#adding-this-server-to-claude-code).

## How a test plan is represented

Each plan is a JSON tree (`{id, type, props, children[]}`), not XML text. Authoring tools append a child under a given `parentId`; the tree is only serialized to a real `.jmx` file at execution time. This is what makes incremental edits cheap and keeps all the fiddly XML schema knowledge in one place (`src/jmx/serializer.ts`) instead of spread across every tool.

## Tools

**Authoring** (each returns the new node's `id`, used as `parentId` for
whatever you attach under it next) — grouped the same way JMeter's own
right-click **Add** menu groups them, so if you already know the GUI, you
already know where to look:

| Tool | Adds |
|---|---|
| `create_test_plan` | Root `TestPlan` node — returns `planId` and the root node id |

**Threads (Users):**

| Tool | Adds |
|---|---|
| `add_thread_group` | Thread Group (virtual users) |
| `add_setup_thread_group` | setUp Thread Group (runs once before all Thread Groups) |
| `add_teardown_thread_group` | tearDown Thread Group (runs once after all Thread Groups) |

**Sampler:**

| Tool | Adds |
|---|---|
| `add_http_sampler` | HTTP Request sampler |
| `add_jdbc_request` | JDBC Request sampler |
| `add_jsr223_sampler` | JSR223 Sampler (Groovy/BeanShell/JS/JEXL script as the sample) |
| `add_ftp_request` | FTP Request sampler |
| `add_tcp_sampler` | TCP Sampler |

**Logic Controller:**

| Tool | Adds |
|---|---|
| `add_transaction_controller` | Transaction Controller (groups child samplers into one named transaction) |
| `add_loop_controller` | Loop Controller (repeats child samplers) |
| `add_if_controller` | If Controller (conditionally runs child samplers) |
| `add_while_controller` | While Controller (repeats children while a condition holds) |
| `add_random_controller` | Random Controller (runs one random child per pass) |
| `add_interleave_controller` | Interleave Controller (alternates through children) |

**Config Element:**

| Tool | Adds |
|---|---|
| `add_csv_data_set` | CSV Data Set Config (parameterization from a file) |
| `add_user_defined_variables` | User Defined Variables |
| `add_jdbc_connection_configuration` | JDBC Connection Configuration (pooled datasource) |
| `add_http_request_defaults` | HTTP Request Defaults |
| `add_cookie_manager` | HTTP Cookie Manager |
| `add_header_manager` | HTTP Header Manager |

**Timer:**

| Tool | Adds |
|---|---|
| `add_constant_timer` | Constant Timer (pacing/think-time) |
| `add_uniform_random_timer` | Uniform Random Timer (randomized pacing) |
| `add_constant_throughput_timer` | Constant Throughput Timer (target rate pacing) |

**Pre Processors:**

| Tool | Adds |
|---|---|
| `add_jsr223_preprocessor` | JSR223 PreProcessor |
| `add_user_parameters` | User Parameters (per-thread variable value sets) |

**Post Processors:**

| Tool | Adds |
|---|---|
| `add_json_extractor` | JSON Extractor post-processor |
| `add_regex_extractor` | Regular Expression Extractor post-processor |
| `add_xpath_extractor` | XPath Extractor post-processor |
| `add_jsr223_postprocessor` | JSR223 PostProcessor |

**Assertions:**

| Tool | Adds |
|---|---|
| `add_response_assertion` | Response Assertion |
| `add_json_assertion` | JSON Assertion (JSONPath validation) |
| `add_duration_assertion` | Duration Assertion (response-time SLA) |
| `add_size_assertion` | Size Assertion (response byte-size check) |

**Listener:**

| Tool | Adds |
|---|---|
| `add_aggregate_report_listener` | Aggregate Report listener |
| `add_summary_report_listener` | Summary Report listener |
| `add_view_results_tree_listener` | View Results Tree listener (full request/response capture for debugging) |
| `add_backend_listener` | Backend Listener (streams live metrics to InfluxDB/Graphite/etc.) |

**Inspection:**

| Tool | Purpose |
|---|---|
| `list_test_plans` | List every plan in the workspace |
| `get_test_plan` | Full element tree of a plan, including every node's `id` |

**Execution & reporting** (async — a run happens in the background):

| Tool | Purpose |
|---|---|
| `execute_test_plan` | Serialize to `.jmx` and run JMeter in non-GUI mode; returns `{ executionId }` immediately |
| `get_execution_status` | `running` / `completed` / `failed`, plus a tail of the JMeter log |
| `stop_execution` | Send `SIGTERM` to a running JMeter process |
| `get_execution_report` | Aggregated stats (per label + overall) parsed from the run's JTL output |

## Example workflow

```
create_test_plan            → { planId, rootNodeId }
add_thread_group             (parentId: rootNodeId)  → { nodeId: threadGroupId }
add_http_sampler              (parentId: threadGroupId) → { nodeId: samplerId }
add_response_assertion        (parentId: samplerId)
add_aggregate_report_listener (parentId: threadGroupId)
execute_test_plan             (planId) → { executionId }
get_execution_status           (executionId)   ← poll until "completed"
get_execution_report            (executionId) → aggregated latency/error stats
```

## Testing

97 automated tests, no framework beyond Node's built-in test runner:

```bash
npm test               # 86 tests: XML-shape unit tests + every tool called over the real MCP
                        # protocol (stdio, the same way Claude Code/Desktop talk to it) - no
                        # JMeter install needed, fully hermetic
npm run test:integration  # 11 tests: real JMeter runs - the If Controller story above, While
                        # Controller loop counts, timer pacing, extractors, assertions, etc.
                        # (needs JMETER_HOME)
npm run test:all
```

`npm test` spawns the actual built server (`dist/index.js`) via `StdioClientTransport` and drives it exactly as a real client would — not just calling internal functions — so a broken tool schema or a malformed response shows up as a real protocol error, not a passing unit test.

Both suites run on every push and pull request via [GitHub Actions](.github/workflows/ci.yml) — the integration job installs a real JMeter binary on the runner, so it's exercising the same code path as a local run, not a mock.

## Prerequisites

- Node.js 18+
- JMeter installed locally, with the `JMETER_HOME` environment variable
  pointing at the installation directory (the one containing `bin/jmeter`).
  On macOS via Homebrew, `brew install jmeter` puts it at
  `/opt/homebrew/opt/jmeter/libexec`.

## Adding this server to Claude Code

### Via npx (recommended — published on npm)

No cloning or building required; `npx` fetches and runs the published
version on the fly:

```bash
claude mcp add jmeter \
  -e JMETER_HOME=/opt/homebrew/opt/jmeter/libexec \
  -- npx -y jmeter-mcp-server
```

Adjust the `JMETER_HOME` path to wherever JMeter is installed on your
machine. Optionally set `JMETER_MCP_WORKSPACE` too (see below) if you want
plans and executions stored somewhere other than the default.

The default scope is `local` (this project directory only). To make it
available across every project, add `-s user`:

```bash
claude mcp add jmeter -s user \
  -e JMETER_HOME=/opt/homebrew/opt/jmeter/libexec \
  -- npx -y jmeter-mcp-server
```

Confirm it registered and is responding:

```bash
claude mcp list
```

### From a local clone (development)

If you're working on this repository's code instead of using the published
package, point at the built `dist/index.js` directly:

```bash
npm install
npm run build
claude mcp add jmeter \
  -e JMETER_HOME=/opt/homebrew/opt/jmeter/libexec \
  -- node /absolute/path/to/jmeter-mcp-server/dist/index.js
```

### Claude Desktop

Add this to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

Note: unlike a terminal-launched app, Claude Desktop does **not** inherit
environment variables exported in your shell profile (`.zshrc`, etc.) — only
true system-wide ones. Always set `JMETER_HOME` explicitly in the `env`
block above rather than relying on it already being "set on your machine".

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `JMETER_HOME` | Yes | JMeter installation directory (must contain `bin/jmeter`) |
| `JMETER_MCP_WORKSPACE` | No | Where plans and executions are stored. Defaults to `./jmeter-workspace` relative to wherever the server process starts |

## Workspace layout

```
<workspace>/
  plans/<planId>/plan.json           # JSON tree — source of truth for a plan
  executions/<executionId>/
    generated.jmx                    # serialized at execute_test_plan time
    aggregate-report.jtl             # output of the Aggregate Report listener, if present
    summary-report.jtl               # output of the Summary Report listener, if present
    jmeter.log
    meta.json                        # execution status, pid, timestamps, exit code
```

## v1 scope

Not yet supported (candidates for a future release): editing/removing
existing elements, importing an externally authored `.jmx`, generating the
HTML dashboard report (`-e -o`), parent-type validation on `add_*` tools
(nothing stops attaching an element under a semantically wrong parent),
distributed execution.

Note on `add_csv_data_set`: the `filename` must be an absolute path.
`execute_test_plan` runs JMeter from a fresh per-execution directory, so a
relative path (which JMeter's GUI would resolve against the `.jmx` file's
own location) won't resolve there. An absolute path baked into a plan is
also machine-specific — it won't travel if you share `plan.json` with
someone on a different machine.

Note on `add_jdbc_request`/`add_jdbc_connection_configuration`,
`add_ftp_request`, and `add_backend_listener`: these generate correct,
JMeter-loadable XML, but exercising them for real needs infrastructure this
project doesn't provide (a database, an FTP server, an InfluxDB/Graphite
instance) — they were verified structurally, not against a real backend.

Note on `add_view_results_tree_listener`'s `captureFullData` option: it has
no effect right now. `execute_test_plan` always runs JMeter with
`-Jjmeter.save.saveservice.output_format=csv`, and JMeter's CSV writer never
emits response body/header columns no matter what the `SampleSaveConfiguration`
flags say — only its XML output format can carry full response bodies. The
option is wired up correctly in the generated `.jmx` (verified: the flags
really do flip in the XML) for the day this server supports XML-format runs,
but until then it's a no-op — confirmed by running a real capture and
checking the resulting JTL has no `responseData`/`samplerData`/
`requestHeaders`/`responseHeaders` columns regardless of the setting.

Note on `add_tcp_sampler`: `server`/`port`/`request` are live-verified. The
numeric fields (`connectTimeoutMs`, `timeoutMs`) are rendered as
`stringProp` following this project's general convention for sampler
numeric fields, but that specific choice for `TCPSampler` wasn't confirmed
against a real JMeter-GUI-saved example (none was available to check
against) — flagging in case a real save turns out to expect `intProp`.

## License

MIT
