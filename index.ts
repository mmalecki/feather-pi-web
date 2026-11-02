import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { webFetchTool } from './tools/webfetch.ts';
import { webSearchTool } from './tools/websearch.ts';

export * from './tools/webfetch.ts';
export * from './tools/websearch.ts';

/**
 * webfetch, and websearch when PARALLEL_API_KEY is set. WEBFETCH_COMPACT_MODEL picks the
 * `provider/model` that summarizes fetched pages when asked to (the session's model by default).
 * Fetched images follow pi's `images.autoResize` setting, like the read tool's.
 */
export default function (pi: ExtensionAPI) {
  pi.registerTool(
    webFetchTool({
      compactModel: process.env.WEBFETCH_COMPACT_MODEL || undefined,
      autoResizeImages: () => pi.getSettings().images?.autoResize ?? true,
    }),
  );
  if (process.env.PARALLEL_API_KEY) pi.registerTool(webSearchTool());
}
