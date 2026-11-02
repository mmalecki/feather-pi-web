import { type Api, type ImageContent, type Model, Type, type Usage } from '@earendil-works/pi-ai';
import { convertToPng, defineTool, type ExtensionContext, formatDimensionNote, resizeImage } from '@earendil-works/pi-coding-agent';
import { htmlToMarkdown } from './utils/html.ts';

export interface WebFetchOptions {
  /** Whether the page is summarized when the model doesn't say. */
  compact: boolean;
  /** `provider/model` to compact with. Defaults to the session's model. */
  compactModel: string | undefined;
  compactPrompt: string;
  /** Page text beyond this many characters is dropped (before compaction). */
  maxChars: number;
  maxBytes: number;
  /** Whether images are scaled down to the model's limits. Asked per fetch, so settings can change mid-session. */
  autoResizeImages: () => boolean;
  timeoutMs: number;
  userAgent: string;
}

export const defaultWebFetchOptions: WebFetchOptions = {
  compact: false,
  compactModel: undefined,
  compactPrompt:
    'Compact the following web page into a summary for another agent. ' +
    'Keep facts, numbers, prices, names, dates and useful links verbatim. ' +
    'Drop navigation, ads and boilerplate. If a focus is given, keep only what is relevant to it ' +
    'and say so if the page does not cover it. Reply with the summary only.',
  maxChars: 50_000,
  maxBytes: 5 * 1024 * 1024,
  autoResizeImages: () => true,
  timeoutMs: 30_000,
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
};

export interface WebFetchDetails {
  url: string;
  title: string | undefined;
  /** `provider/model` that compacted the page, if one did. */
  compactedBy: string | undefined;
  /** MIME type of the attached image, if the URL was one. */
  image: string | undefined;
}

const MARKDOWN_TYPES = /^(text\/(markdown|x-markdown|plain|csv)|application\/(json|xml|[\w.+-]+\+(json|xml)))\b/;
const HTML_TYPES = /^(text\/html|application\/xhtml\+xml)\b/;
// SVG is markup, not pixels.
const IMAGE_TYPES = /^image\/(?!svg)/;
/** What models take inline; anything else is converted to PNG first. */
const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function webFetchTool(overrides: Partial<WebFetchOptions> = {}) {
  const options = { ...defaultWebFetchOptions, ...overrides };

  return defineTool({
    name: 'webfetch',
    label: 'Web Fetch',
    description: 'Fetch a web page and return its content as markdown. Images (jpg, png, gif, webp, bmp) are returned as attachments.',
    promptSnippet: 'Fetch a web page as markdown, or an image',
    parameters: Type.Object({
      url: Type.String({ description: 'http(s) URL' }),
      focus: Type.Optional(Type.String({ description: 'What to look for on the page' })),
      compact: Type.Optional(Type.Boolean({ description: 'Summarize the page instead of returning it whole', default: options.compact })),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const url = parseUrl(params.url);
      const fetchSignal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs), ...(signal ? [signal] : [])]);

      const response = await fetch(url, {
        signal: fetchSignal,
        redirect: 'follow',
        headers: {
          'user-agent': options.userAgent,
          // Prefer servers that can hand us markdown directly.
          accept: 'text/markdown;q=1.0, text/plain;q=0.9, text/html;q=0.8, application/xhtml+xml;q=0.8, image/*;q=0.5, */*;q=0.1',
          'accept-language': 'en-US,en;q=0.9',
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);

      const finalUrl = response.url || url.href;
      const type = response.headers.get('content-type')?.toLowerCase() ?? '';
      const bytes = await readBody(response, options.maxBytes);

      // Servers mislabel images often enough that unnamed binary is worth a look.
      const imageType = IMAGE_TYPES.test(type) ? baseType(type) : !type || baseType(type) === 'application/octet-stream' ? sniffImage(bytes) : undefined;
      if (imageType) {
        const { image, notes } = await processImage(bytes, imageType, ctx, options.autoResizeImages());
        if (ctx.model && !ctx.model.input.includes('image')) {
          notes.push('[Current model does not support images. The image will be omitted from this request.]');
        }
        return {
          content: [{ type: 'text', text: [`URL: ${finalUrl}`, '', `Image [${image?.mimeType ?? imageType}]`, ...notes].join('\n') }, ...(image ? [image] : [])],
          details: { url: finalUrl, title: undefined, compactedBy: undefined, image: image?.mimeType } satisfies WebFetchDetails,
        };
      }

      const body = decoder(type).decode(bytes);

      let title: string | undefined;
      let text: string;
      if (HTML_TYPES.test(type) || (!type && /^\s*</.test(body))) {
        ({ title, markdown: text } = htmlToMarkdown(body, finalUrl));
      } else if (MARKDOWN_TYPES.test(type) || !type) {
        text = body.trim();
      } else {
        throw new Error(`Unsupported content type "${type}" at ${url}`);
      }

      if (text.length > options.maxChars) {
        text = `${text.slice(0, options.maxChars)}\n\n[Truncated: ${text.length - options.maxChars} more characters]`;
      }

      let usage: Usage | undefined;
      let compactedBy: string | undefined;
      const model = (params.compact ?? options.compact) ? compactModel(ctx, options.compactModel) : undefined;
      if (!text) text = '[Page has no readable content]';
      else if (model) {
        ({ text, usage } = await compact(ctx, model, {
          prompt: options.compactPrompt,
          content: title ? `# ${title}\n\n${text}` : text,
          focus: params.focus,
          signal,
        }));
        compactedBy = `${model.provider}/${model.id}`;
      }

      const header = [title && `# ${title}`, `URL: ${finalUrl}`].filter(Boolean).join('\n');
      return {
        content: [{ type: 'text', text: `${header}\n\n${text}` }],
        details: { url: finalUrl, title, compactedBy, image: undefined } satisfies WebFetchDetails,
        ...(usage ? { usage } : {}),
      };
    },
  });
}

/** The configured compaction model, else the session's; none when the session has no model yet. */
function compactModel(ctx: ExtensionContext, ref: string | undefined): Model<Api> | undefined {
  if (!ref) return ctx.model;
  const slash = ref.indexOf('/');
  const model = slash > 0 ? ctx.modelRegistry.find(ref.slice(0, slash), ref.slice(slash + 1)) : undefined;
  if (!model) throw new Error(`Compaction model "${ref}" not found; expected provider/model`);
  return model;
}

interface CompactOptions {
  prompt: string;
  content: string;
  /** What the calling agent cares about, if it said. */
  focus: string | undefined;
  signal: AbortSignal | undefined;
}

/** Shrinks the page with a single inference call, without thinking: shrinking text needs none. */
async function compact(ctx: ExtensionContext, model: Model<Api>, { prompt, content, focus, signal }: CompactOptions): Promise<{ text: string; usage: Usage }> {
  const result = await ctx.modelRegistry
    .streamSimple(
      model,
      {
        systemPrompt: prompt,
        messages: [{ role: 'user', content: focus ? `${content}\n\n---\nFocus: ${focus}` : content, timestamp: Date.now() }],
      },
      { signal, cacheRetention: 'none' },
    )
    .result();
  if (result.stopReason === 'error' || result.stopReason === 'aborted') {
    throw new Error(`Compaction failed: ${result.errorMessage ?? result.stopReason}`);
  }
  const text = result.content
    .flatMap((c) => (c.type === 'text' ? [c.text] : []))
    .join('')
    .trim();
  if (!text) throw new Error('Compaction returned no content');
  return { text, usage: result.usage };
}

function parseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http(s) URLs are supported: ${raw}`);
  }
  return url;
}

async function readBody(response: Response, maxBytes: number): Promise<Buffer> {
  const length = Number(response.headers.get('content-length'));
  if (length > maxBytes) throw new Error(`Response too large (${length} bytes, limit ${maxBytes})`);

  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength;
    if (size > maxBytes) {
      await response.body?.cancel();
      throw new Error(`Response too large (over ${maxBytes} bytes)`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function decoder(type: string): TextDecoder {
  const charset = /charset="?([\w-]+)/.exec(type)?.[1];
  try {
    return new TextDecoder(charset);
  } catch {
    return new TextDecoder();
  }
}

function baseType(type: string): string {
  const base = type.replace(/;.*/s, '').trim();
  return base === 'image/jpg' ? 'image/jpeg' : base;
}

function sniffImage(bytes: Buffer): string | undefined {
  const at = (offset: number, magic: string) => bytes.toString('latin1', offset, offset + magic.length) === magic;
  if (at(0, '\xff\xd8\xff')) return 'image/jpeg';
  if (at(0, '\x89PNG\r\n\x1a\n')) return 'image/png';
  if (at(0, 'GIF87a') || at(0, 'GIF89a')) return 'image/gif';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
  return undefined;
}

/**
 * Prepares an image the way pi's read tool does: converted to a type models take inline and scaled
 * to the model's limits. No image when that fails; the notes say why, or how it was changed.
 */
async function processImage(bytes: Buffer, mimeType: string, ctx: ExtensionContext, autoResize: boolean): Promise<{ image: ImageContent | undefined; notes: string[] }> {
  const notes: string[] = [];
  let image: ImageContent = { type: 'image', data: bytes.toString('base64'), mimeType };

  if (!INLINE_IMAGE_TYPES.has(mimeType)) {
    const png = await convertToPng(image.data, mimeType);
    if (!png) return { image: undefined, notes: ['[Image omitted: could not be converted to a supported inline image format.]'] };
    image = { type: 'image', ...png };
    notes.push(`[Image converted from ${mimeType} to ${png.mimeType}.]`);
  }

  if (autoResize) {
    const resized = await resizeImage(Buffer.from(image.data, 'base64'), image.mimeType, ctx.model?.inputLimits?.images?.resize);
    if (!resized) return { image: undefined, notes: ['[Image omitted: could not be resized below the inline image size limit.]'] };
    image = { type: 'image', data: resized.data, mimeType: resized.mimeType };
    const note = formatDimensionNote(resized);
    if (note) notes.push(note);
  }

  return { image, notes };
}
