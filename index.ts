import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { webFetchTool } from './tools/webfetch.ts';
import { webSearchTool } from './tools/websearch.ts';

export * from './tools/webfetch.ts';
export * from './tools/websearch.ts';

/**
 * webfetch, and websearch when PARALLEL_API_KEY is set. WEBFETCH_COMPACT_MODEL picks the
 * `provider/model` that summarizes fetched pages when asked to (the session's model by default).
 * WEBFETCH_MAX_RAW_CHARS caps pages fetched as raw source.
 * Fetched images follow pi's `images.autoResize` setting, like the read tool's.
 */
export default function (pi: ExtensionAPI) {
  const maxRawChars = positiveInteger('WEBFETCH_MAX_RAW_CHARS');
  pi.registerTool(
    webFetchTool({
      compactModel: process.env.WEBFETCH_COMPACT_MODEL || undefined,
      // An undefined override would replace the default, leaving raw pages uncapped.
      ...(maxRawChars ? { maxRawChars } : {}),
      autoResizeImages: () => pi.getSettings().images?.autoResize ?? true,
    }),
  );
  if (process.env.PARALLEL_API_KEY) pi.registerTool(webSearchTool());
}

/** A count from the environment; undefined when unset. Anything else is a mistake worth hearing about. */
function positiveInteger(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return value;
}
