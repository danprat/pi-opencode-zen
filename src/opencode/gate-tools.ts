/**
 * OpenCode desktop anti-abuse gate tools definitions and context injection.
 */

import { Type } from '@earendil-works/pi-ai';
import type { Tool, TranscriptContext } from '@earendil-works/pi-ai/compat';

export const GATE_TOOLS: readonly Tool[] = Object.freeze([
  {
    name: 'read',
    description:
      'Read the contents of a file or directory. Supports text files, images, and PDFs. Images and PDFs are presented directly to the model. Each text line is prefixed by its 1-based line number as <line>: <content>. The prefix is for reference and is not part of the file content. Directory entries are returned one per line. Use offset and limit to read large files or directories in sections. Prefer one larger read over many small slices, and use grep to find specific content in large files.',
    parameters: Type.Object(
      {
        path: Type.String({ description: 'File or directory to read' }),
        offset: Type.Optional(
          Type.Integer({
            minimum: 0,
            description: 'The line or directory entry to start reading from (1-based)',
          }),
        ),
        limit: Type.Optional(
          Type.Integer({
            minimum: 0,
            description:
              'The maximum number of lines or directory entries to read (defaults to and capped at 2000)',
          }),
        ),
      },
      { additionalProperties: false },
    ),
  },
  {
    name: 'shell',
    description:
      'Execute a shell command and return its output. Commands run on Linux using bash. Quote file paths containing spaces or special characters. Prefer dedicated tools over shell commands when possible. When output is large, the full result is saved to a file and a truncated preview is returned. Rely on automatic truncation unless filtering the output is more useful. Commands accept an optional timeout, background commands have no timeout by default. Background commands return immediately, and you will be notified when they complete. DO NOT poll for completion.',
    parameters: Type.Object(
      {
        command: Type.String({ description: 'Shell command string to execute' }),
        workdir: Type.Optional(
          Type.String({
            description:
              'Working directory to execute the command in. Defaults to the current working directory. When possible, avoid changing directories in the command and set the working directory here instead.',
          }),
        ),
        timeout: Type.Optional(
          Type.Integer({
            minimum: 0,
            description:
              'Timeout in milliseconds. Set to 0 to disable the timeout. Defaults to 120000 for foreground commands. Background commands have no timeout by default.',
          }),
        ),
        background: Type.Optional(
          Type.Boolean({
            description:
              "Run the command in the background and return immediately (useful for dev servers and long-running builds). You do not need to use '&' at the end of the command when using this parameter. You will be notified when it completes. DO NOT poll for completion.",
          }),
        ),
      },
      { additionalProperties: false },
    ),
  },
  {
    name: 'write',
    description: 'Write file',
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
  },
  {
    name: 'edit',
    description: 'Edit file',
    parameters: Type.Object({
      path: Type.String(),
      edits: Type.Array(
        Type.Object({
          oldText: Type.String(),
          newText: Type.String(),
        }),
      ),
    }),
  },
  {
    name: 'bash',
    description: 'Execute bash command',
    parameters: Type.Object({ command: Type.String() }),
  },
  {
    name: 'glob',
    description: 'Find files matching pattern',
    parameters: Type.Object({ pattern: Type.String() }),
  },
  {
    name: 'grep',
    description: 'Search files for pattern',
    parameters: Type.Object({ pattern: Type.String() }),
  },
]);

export function ensureOpencodeGateTools(context: TranscriptContext): TranscriptContext {
  const messages = [...context.messages];
  const first = messages[0];

  if (first && first.role === 'system') {
    const existing = first.toolsAdded;
    if (!existing || existing.length === 0) {
      messages[0] = { ...first, toolsAdded: GATE_TOOLS as Tool[] };
      return { ...context, messages };
    }
    // Retain existing tools while ensuring exact gate definitions for read and shell
    const tools = existing.map((t) => {
      const gateMatch = GATE_TOOLS.find((g) => g.name === t.name);
      return gateMatch ?? t;
    });
    const existingNames = new Set(tools.map((t) => t.name));
    const missing = GATE_TOOLS.filter((t) => !existingNames.has(t.name));
    messages[0] = { ...first, toolsAdded: [...tools, ...missing] };
  } else {
    messages.unshift({
      role: 'system',
      content: '',
      toolsAdded: GATE_TOOLS as Tool[],
      timestamp: 0,
    });
  }

  return { ...context, messages };
}
