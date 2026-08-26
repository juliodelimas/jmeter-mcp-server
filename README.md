# jmeter-mcp-server

A stdio [MCP](https://modelcontextprotocol.io/) server for building,
maintaining, running, and reading reports for [Apache JMeter](https://jmeter.apache.org/)
test plans — without opening the GUI.

Point an MCP-capable client (Claude Code, Claude Desktop, etc.) at this
server and it can compose a test plan element by element, kick off a real
non-GUI JMeter run in the background, and read back aggregated latency/error
stats, all through typed tool calls instead of clicking through JMeter's
tree view.

## Why an MCP server for this, specifically

An LLM can already write a `.jmx` file from scratch — it's just XML. The
problem is that JMeter's `.jmx` format is a `hashTree` structure with a lot
of fragile, easy-to-get-subtly-wrong detail: exact `guiclass`/`testclass`
pairs per element, property names that don't always match the GUI label
(`ThreadGroup.num_threads` is a `stringProp`, not an `intProp`; assertion
match types are an integer *bitmask*), and strict parent/child pairing
between every element and its sibling `<hashTree>`. None of that is
self-checking — a slightly wrong bitmask still produces valid, loadable XML
that just quietly does the wrong thing (an assertion that never fires, a
listener with no output). Re-deriving all of that from memory on every
request means re-risking the same mistakes every time.

This server encodes that knowledge exactly once, in a serializer that's been
exercised against a real JMeter install, and exposes it as typed tools. The
concrete benefits that come out of that:

- **Correctness through a fixed, tested code path.** Every `add_http_sampler`
  call goes through the same verified serializer, instead of an LLM
  regenerating XML from memory each time with a chance of drift or a subtly
  wrong property.
- **Cheap incremental edits.** A test plan is stored as a small JSON tree
  with stable node ids. Adding one more assertion is a single tool call
  referencing a `parentId` — not reading and rewriting an entire `.jmx` file
  to figure out where to splice in a change. In a quick side-by-side on a
  6-element plan, the JSON tree came out to ~280 tokens versus ~1,580 tokens
  for the equivalent `.jmx` XML (which repeats `guiclass`/`testclass` pairs
  and a full `saveConfig` block per listener) — and that gap only widens as
  a plan grows, since editing the JSON tree costs *one small tool call*
  regardless of how large the overall plan already is.
- **Aggregated results, not raw samples.** `get_execution_report` parses the
  JTL output and returns computed stats (count, error %, avg/min/max/median,
  p90/p95/p99, throughput, KB/s) — not a dump of every sample row for the
  client to average by hand.
- **A real async execution model.** `execute_test_plan` starts JMeter in
  the background and returns immediately with an `executionId`;
  `get_execution_status` / `get_execution_report` poll it. Long-running load
  tests don't block anything waiting for a single request/response.

The generated `.jmx` follows the same format JMeter itself writes, so it can
still be opened in the real JMeter GUI at any point if you want to eyeball
it visually or hand it off to someone who prefers the UI.

## How a test plan is represented

Each plan is stored as a JSON tree (`{id, type, props, children[]}`) rather
than as XML text. All authoring tools mutate this tree by appending a child
under a given `parentId`, and the tree is only serialized into a real `.jmx`
file at execution time. This is what makes incremental edits cheap and keeps
the fiddly XML schema knowledge in one place (`src/jmx/serializer.ts`)
instead of spread across every tool.

## Tools

**Authoring** (each returns the new node's `id`, used as `parentId` for
whatever you attach under it next):

| Tool | Adds |
|---|---|
| `create_test_plan` | Root `TestPlan` node — returns `planId` and the root node id |
| `add_thread_group` | Thread Group (virtual users) |
| `add_http_sampler` | HTTP Request sampler |
| `add_json_extractor` | JSON Extractor post-processor |
| `add_header_manager` | HTTP Header Manager |
| `add_response_assertion` | Response Assertion |
| `add_aggregate_report_listener` | Aggregate Report listener |
| `add_summary_report_listener` | Summary Report listener |

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
HTML dashboard report (`-e -o`), other sampler/assertion/extractor types,
CSV Data Set Config, distributed execution.

## License

MIT
