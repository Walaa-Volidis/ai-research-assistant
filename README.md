# ai-research-assistant

Generates a structured literature report for a thesis topic — relevant papers, key formulas
and current trends — grounded in real web search results rather than model recall.

Available as a CLI and as a small Flask web UI.

## Requirements

- Python 3.13+
- [uv](https://docs.astral.sh/uv/)
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)
- Node 20.19+ (or 22 LTS) — only for the Consensus paper search; see below

## Setup

```bash
uv sync
```

Create a `.env` file in the project root:

```
GOOGLE_API_KEY=your-key-here
```

`.env` is gitignored — never commit it.

Optionally set `GEMINI_MODEL` to override the default `gemini-2.5-flash`:

```
GEMINI_MODEL=gemini-2.5-flash-lite
```

Free-tier quota is **20 requests per day, per model**, and one report costs 2 requests — so
roughly 10 reports per day per model. When one model is exhausted, switching to another gives
a fresh allowance; `gemini-2.5-flash-lite` is the usual fallback, at some cost in quality
(it tends to drop `venue`). The quota resets daily, or enable billing to lift it.

## Usage

**Web UI**

```bash
uv run app.py
```

Then open <http://127.0.0.1:5000>, fill in the topic, research questions and optional time
frame, and generate. Results render as Papers / Formulas / Trends, with a Download JSON button.

**CLI**

```bash
uv run main.py
```

Prompts for the same three inputs and prints the report as JSON.

A report takes roughly 70 seconds — two model calls, the first of which runs several searches.

## Paper search: Consensus MCP

Research prefers the [Consensus](https://consensus.app) MCP server, which searches peer-reviewed
literature rather than the open web. It runs over stdio via `mcp-remote`, so it needs Node and a
**one-time browser login**:

```bash
npx -y mcp-remote@latest https://mcp.consensus.app/mcp
```

Authorise in the browser window that opens; the token is cached under `~/.mcp-auth` and later runs
are non-interactive. The server requires OAuth (`scope="search"`) — there is no API-key option.

If Consensus is unreachable or unauthorised, the run logs a warning and **falls back to
`google_search`**, so the app keeps working either way. Check the log line to know which path a
given report took.

## How it works

Two sequential Gemini calls:

1. **Research** — either a `create_agent` loop over the Consensus MCP tools, or, as fallback,
   `gemini-2.5-flash` with the built-in `google_search` tool. Returns free-form notes. Both
   prompts forbid citing anything a search did not actually return.
2. **Format** — the same model with no tools, converting those notes into the `Report` schema.

The split is not stylistic. Gemini rejects `google_search` combined with any structured output,
in both directions:

```
400 Built-in tools ({google_search}) and Function Calling cannot be combined in the same request.
400 Tool use with a response mime type: 'application/json' is unsupported
```

So search and schema have to happen in separate requests. Merging them back into one call —
or into a single `create_agent(..., response_format=Report)` — will fail with the above. This is
why the Consensus agent returns text and a second call applies the schema, rather than passing
`response_format` to `create_agent` directly.

URLs that Gemini actually retrieved are pulled from the response's grounding metadata and passed
into step 2, so the formatting call has real sources to copy instead of inventing plausible ones.

## Output schema

Defined as Pydantic models in [`main.py`](main.py):

| Model     | Fields                                                                      |
| --------- | --------------------------------------------------------------------------- |
| `Report`  | `topic`, `research_questions`, `time_frame`, `papers`, `formulas`, `trends` |
| `Paper`   | `title`, `authors`, `year`, `venue`, `url`, `relevance`                     |
| `Formula` | `name`, `latex`, `description`, `reference`                                 |
| `Trend`   | `title`, `description`, `references`                                        |

## Known limitations

- **Source quality varies between runs.** The `site:` scoping in the research prompt is an
  instruction, not a filter, so vendor blogs and SEO listicles occasionally get through. For
  anything citable, check each source. A deterministic fix would be a domain allowlist applied
  after parsing, or querying a scholarly API (arXiv, Semantic Scholar, OpenAlex) instead of web search.
- **`year` can be wrong.** It is sometimes coerced toward the requested time frame rather than
  read off the paper — one run returned `year: 2026` for a paper whose venue was `SAC'25`.
  Verify dates before citing.
- **Paper URLs are `vertexaisearch.cloud.google.com` redirects**, not direct links. They resolve,
  but they are opaque and probably expire.
- **Fewer papers than requested is expected behaviour**, not a bug. The prompt instructs the model
  to report only what it found rather than padding the list to hit a count.
- **`app.py` runs with `debug=True`** for autoreload. Remove it before exposing the app anywhere.
