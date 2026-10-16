# pi-opencode-zen

OpenCode Zen provider extension for pi.

## Install

```bash
pi install npm:@ravshansbox/pi-opencode-zen
```

## Usage

Pi loads the provider from `./index.ts` and registers an `opencode-zen` provider that exposes OpenCode Zen models.

The extension:

- falls back to OpenCode's anonymous `public` key when no real key is configured
- adds OpenCode request headers on every `opencode-zen` provider request:
  - `User-Agent` in the OpenCode CLI format
  - `x-opencode-project`
- routes each model to the protocol the OpenCode CLI uses for it:
  - `@ai-sdk/anthropic` → Anthropic Messages
  - `@ai-sdk/google` → Google Generative AI
  - `@ai-sdk/mistral` → Mistral Conversations
  - `@ai-sdk/openai` → OpenAI Responses
  - anything else → OpenAI Completions

Pi itself adds `x-opencode-session` and `x-opencode-client` for requests to `opencode.ai`.

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
public key and shows only the free models. The Zen gateway may still reject those free models
for an anonymous client, in which case a real key is required.

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
