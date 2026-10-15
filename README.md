# pi-opencode-zen

OpenCode Zen provider extension for pi and Pi-Bolt.

## Install

### Option 1: From GitHub (Branch `fix/pi-compat-import`)

To install the latest tested branch directly:

```bash
# Clone the repository
git clone -b fix/pi-compat-import https://github.com/danprat/pi-opencode-zen.git

# Install into pi or Pi-Bolt
pi install ./pi-opencode-zen
# or
pi-bolt install ./pi-opencode-zen
```

Or install directly from the git repository:

```bash
pi install git:github.com/danprat/pi-opencode-zen
# or
pi-bolt install git:github.com/danprat/pi-opencode-zen
```

### Option 2: From npm (Official Release)

```bash
pi install npm:@ravshansbox/pi-opencode-zen
# or
pi-bolt install npm:@ravshansbox/pi-opencode-zen
```

### Option 3: Compile into Pi-Bolt Binary (Ahead-of-Time / AOT)

To compile this extension directly into the Pi-Bolt executable for instant startup and native machine code execution (as detailed in [PLUGINS.md](https://github.com/opensec-git/Pi-Bolt/blob/pi-bolt/docs/PLUGINS.md)):

```bash
scripts/build-pi.sh --plugins /path/to/pi-opencode-zen/plugins.ts --out out/pi-bolt-plugins
```

## Usage

Pi and Pi-Bolt load the provider from `./index.ts` and register an `opencode-zen` provider that exposes OpenCode Zen models.

### Zero-Configuration Default (`public` mode)

New users can start using OpenCode Zen immediately without configuring an API key. If no key is set in `OPENCODE_API_KEY` or `~/.pi/agent/auth.json`, the extension automatically defaults to `public` mode, instantly exposing the current active free-tier models (such as `big-pickle`, `muse-spark-1.3-contributor-free`, etc.).

### Features

- **Automatic `public` mode fallback**: zero setup required for new users to use free-tier models immediately.
- **Desktop client identity**: generates authentic timestamp-encoded session (`ses_...`) and request (`msg_...`) headers matching the OpenCode desktop application format to prevent `403 FreeTierError`.
- **Reasoning-aware token budgeting**: applies an additive token budget (`max(requested, 1024) + 4096`) for reasoning models, ensuring chain-of-thought tokens do not consume the visible answer headroom on short requests.
- **Dynamic model discovery**: checks the live OpenCode Zen API and `models.dev` dynamically on launch, ensuring newly added free models (e.g., `mimo-v2.6-flash-free`, `nemotron-3.5-lightning-free`, `cat-jam-free`, `muse-spark-1.3-contributor-free`, `big-pickle`, etc.) are discovered automatically.
- **Model alias normalisation**: supports common shorthand aliases (`mimo`, `nemotron-3.5`, `muse-spark-1.3`, `cat-jam`, `longcat`, etc.).
- **Resilient offline cache**: persists discovered models to `~/.pi/agent/cache/opencode-zen-models.json` with a bounded timeout, ensuring Pi-Bolt starts reliably even when offline.
- **Pi-Bolt AOT optimisations**: monomorphic object shapes, module-level constant hoisting, and streamlined ID generation for maximum runtime performance.
- **Gate tools**: automatically provides the required desktop compatibility tools (`read`, `write`, `edit`, `bash`, `glob`, `grep`) to satisfy the OpenCode anti-abuse validation check.
- **Vercel Edge relay proxy**: route requests via a high-performance Vercel Edge relay (based on the 9router architecture) with dynamic on/off toggles, real-time statusline indicators, circuit breaker protection, and seamless automatic direct fallback.

### Model Filtering and Protocol Routing

This extension mirrors OpenCode CLI behaviour as closely as possible:

- it fetches live visible model IDs dynamically from the OpenCode API (`https://opencode.ai/inference/v1/models`)
- it synchronises model specifications (context window, token limits, modalities) from `models.dev`
- it filters out models with `status === "deprecated"`
- in anonymous/public mode (`key = "public"`), it automatically admits all free-tier and zero-cost models
- it dynamically routes model families to their supported protocols:
  - `openai-responses` for GPT and Meta Muse Spark series
  - `anthropic-messages` for Claude series
  - `google-generative-ai` for Gemini series
  - `openai-completions` for standard models

Live model visibility source:

```bash
curl -H 'Authorization: Bearer public' https://opencode.ai/inference/v1/models
```

OpenCode metadata source:

```bash
curl https://models.dev/api.json
```

## Configuration

To use your own OpenCode Zen API key instead of the public default:

### Environment variable

```bash
export OPENCODE_API_KEY=your-real-key
```

### pi auth storage / `/login`

You can log in interactively via `/login opencode-zen` in the TUI, or store the key in `~/.pi/agent/auth.json`:

```json
{
  "opencode-zen": {
    "type": "api_key",
    "key": "your-real-key"
  }
}
```

### Command-line argument

```bash
pi-bolt --provider opencode-zen --model claude-sonnet-4-6 --api-key your-real-key -p "hello"
```

## Vercel Edge Relay Proxy

This extension includes a built-in serverless edge proxy relay inspired by [9router's proxy pool architecture](https://github.com/decolua/9router/blob/master/src/app/api/proxy-pools/vercel-deploy/route.js), designed to bypass IP restrictions and regional blocks.

### Key Capabilities

- **Seamless automatic fallback**: if your Vercel relay times out, crashes, or returns HTTP 502/503/504 errors, requests automatically fall back to direct connection instantly without failing or interrupting the current conversation.
- **Circuit breaker cooldown**: after 2 consecutive relay failures, the proxy trips into a 60-second cooldown period, preventing latency delays on subsequent requests.
- **Statusline indicator**: persistent real-time status in the footer status bar:
  - `⚡ Proxy: ON` (Relay active and healthy)
  - `⚠️ Proxy: Direct (Fallback)` (Temporarily falling back to direct connection)
  - `🌐 Proxy: OFF` (Proxy disabled)
  - `⚠️ Proxy: No URL` (Enabled without a configured relay URL)
- **Strict proxy mode (`strictProxy`)**: for users in restricted regions who must prevent leaking their real IP, strict mode can be toggled on to forbid direct fallback.
- **One-click Vercel deployment**: deploy an Edge relay function to your own Vercel account directly from Pi using `/zen-proxy deploy <vercel-token>`.

### Interactive Commands & Menu

Simply type `/zen` (or `/zen-proxy`) in interactive mode to open the user-friendly management menu, which shows your current relay state, configuration, and one-click actions:

| Command                   | Description                                                           |
| ------------------------- | --------------------------------------------------------------------- |
| `/zen`                    | Open the interactive proxy manager menu (TUI mode)                    |
| `/zen on`                 | Enable the Vercel relay proxy                                         |
| `/zen off`                | Disable the Vercel relay proxy (use direct connection)                |
| `/zen toggle`             | Quick toggle between enabled and disabled states                      |
| `/zen set <url>`          | Set your Vercel relay URL (e.g. `https://my-relay.vercel.app`)        |
| `/zen status`             | Show proxy state, circuit breaker status, and test relay connectivity |
| `/zen fallback [on\|off]` | Enable or disable seamless fallback to direct connection              |
| `/zen strict [on\|off]`   | Toggle strict mode (disallow direct fallback)                         |
| `/zen deploy [token]`     | Automatically deploy a private edge relay to Vercel                   |

_(Note: `/zen-proxy` is available as a full alias for `/zen`)_

### Environment Variables & Persistence

Proxy settings are persisted across sessions in `~/.pi/agent/opencode-zen-proxy.json`. You can also configure them via environment variables:

```bash
# Set default relay URL
export OPENCODE_VERCEL_PROXY_URL=https://my-relay.vercel.app

# Enable or disable by default
export OPENCODE_VERCEL_PROXY_ENABLED=true

# Enable strict mode (prevent direct fallback)
export OPENCODE_VERCEL_PROXY_STRICT=false
```

## Development

```bash
bun install
bun run check
```
