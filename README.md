# pi-opencode-zen

OpenCode Zen provider extension for pi.

## Install

```bash
pi install npm:@ravshansbox/pi-opencode-zen
```

Add `-l` to install it in project settings.

## Usage

Pi loads the provider from `./index.ts` and registers an `opencode-zen` provider that exposes OpenCode Zen models.

The extension:

- falls back to OpenCode's anonymous `public` key when no real key is configured
- adds OpenCode request headers on every `opencode-zen` provider request:
  - `User-Agent` in the OpenCode CLI format
  - `x-opencode-project`
  - `x-opencode-session` — an OpenCode-format `ses_...` identifier, overriding the id pi sends
- routes each model to the protocol the OpenCode CLI uses for it:
  - `@ai-sdk/anthropic` → Anthropic Messages
  - `@ai-sdk/google` → Google Generative AI
  - `@ai-sdk/mistral` → Mistral Conversations
  - `@ai-sdk/openai` → OpenAI Responses
  - anything else → OpenAI Completions

The Zen gateway only serves free models to requests that look like they come from OpenCode, and it
checks `x-opencode-session`: it must be an OpenCode `ses_...` identifier, not the UUID pi sends by
default. The extension generates one, so free models work. pi adds `x-opencode-client` itself.

### Model filtering

This extension mirrors OpenCode CLI behaviour as closely as possible:

- it fetches the OpenCode provider catalogue from `https://models.opencode.ai/api.json`
- it filters out models with `status === "deprecated"`
- it filters out models that do not support text input and output
- in anonymous/public mode it keeps only models that have no paid pricing tier

OpenCode catalogue source:

```bash
curl https://models.opencode.ai/api.json
```

## Configuration

Get an API key from OpenCode Zen, then configure pi in one of these ways.

### Environment variable

```bash
export OPENCODE_API_KEY=your-real-key
```

Without a key, or with `OPENCODE_API_KEY=public`, the extension uses OpenCode's anonymous
public key and shows only the free models. The free models work because the extension sends the
OpenCode client headers above; if OpenCode changes that check, an anonymous client may be rejected
and a real key will be required.

### pi auth storage

Store the key in `~/.pi/agent/auth.json` under the `opencode-zen` provider name:

```json
{
  "opencode-zen": {
    "type": "api_key",
    "key": "your-real-key"
  }
}
```

Use `"key": "public"` for anonymous mode.

## Development

```bash
npm install
npm run check
```
