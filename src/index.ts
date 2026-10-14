import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { webFetchTool } from './webfetch.ts';
import { webSearchTool } from './websearch.ts';

export * from './webfetch.ts';
export * from './websearch.ts';

/**
 * webfetch, and websearch when PARALLEL_API_KEY is set. WEBFETCH_COMPACT_MODEL picks the
 * `provider/model` that summarizes fetched pages (the session's model by default), or `off`.
 */
export default function (pi: ExtensionAPI) {
  const compactModel = process.env.WEBFETCH_COMPACT_MODEL || undefined;
  pi.registerTool(webFetchTool(compactModel === 'off' ? { compact: false } : { compactModel }));
  if (process.env.PARALLEL_API_KEY) pi.registerTool(webSearchTool());
}
