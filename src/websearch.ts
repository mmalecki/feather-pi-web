import { Type } from '@earendil-works/pi-ai';
import { defineTool } from '@earendil-works/pi-coding-agent';
import Parallel from 'parallel-web';
import type { SearchParams, SearchResult } from 'parallel-web/resources/top-level';

export interface WebSearchOptions {
  /** Defaults to the `PARALLEL_API_KEY` environment variable. */
  token: string | undefined;
  client: Parallel | undefined;
  mode: SearchParams['mode'];
  maxResults: number;
  /** Excerpt budget across all results. */
  maxCharsTotal: number;
  maxCharsPerResult: number | undefined;
}

export const defaultWebSearchOptions: WebSearchOptions = {
  token: undefined,
  client: undefined,
  mode: undefined,
  maxResults: 5,
  maxCharsTotal: 10_000,
  maxCharsPerResult: undefined,
};

type Query = { queries: string[]; objective?: string };

/** Web search through Parallel's Search API, which already returns markdown excerpts. */
export function webSearchTool(overrides: Partial<WebSearchOptions> = {}) {
  const { token, client: given, mode, maxResults, maxCharsTotal, maxCharsPerResult } = { ...defaultWebSearchOptions, ...overrides };
  const client = given ?? new Parallel(token ? { apiKey: token } : {});
  // Parallel asks for the session id to be passed along on follow-up calls of the same task.
  let sessionId: string | undefined;

  return defineTool({
    name: 'websearch',
    label: 'Web Search',
    description: 'Search the web. Returns relevant excerpts per result.',
    promptSnippet: 'Search the web',
    promptGuidelines: ['Use websearch to find sources and webfetch to read the most promising pages. Cite URLs.'],
    parameters: Type.Object({
      queries: Type.Array(Type.String(), { description: '2-3 short keyword queries' }),
      objective: Type.Optional(Type.String({ description: 'What you are trying to find out' })),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
    // Small models often send a single query, or the array as a JSON string. Validation follows.
    prepareArguments(args) {
      const input = args as { queries?: unknown };
      if (typeof input?.queries !== 'string') return input as Query;
      const raw = input.queries;
      let queries: unknown = [raw];
      if (raw.trim().startsWith('[')) {
        try {
          queries = JSON.parse(raw);
        } catch {}
      }
      return { ...input, queries } as Query;
    },

    async execute(_toolCallId, { queries, objective }, signal) {
      const result = await client.search(
        {
          search_queries: queries,
          objective: objective ?? null,
          mode: mode ?? null,
          max_chars_total: maxCharsTotal,
          session_id: sessionId ?? null,
          advanced_settings: {
            max_results: maxResults,
            ...(maxCharsPerResult ? { excerpt_settings: { max_chars_per_result: maxCharsPerResult } } : {}),
          },
        },
        { signal },
      );
      sessionId = result.session_id;
      return {
        content: [{ type: 'text', text: format(result) }],
        details: { sessionId, urls: result.results.map((r) => r.url) },
      };
    },
  });
}

function format({ results }: SearchResult): string {
  if (!results.length) return 'No results.';
  return results
    .map((r, i) => {
      const head = `## ${i + 1}. ${r.title ?? r.url}\n${r.url}${r.publish_date ? ` (${r.publish_date})` : ''}`;
      return [head, ...r.excerpts.map((e) => e.trim())].join('\n\n');
    })
    .join('\n\n');
}
