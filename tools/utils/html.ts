import { gfm } from '@joplin/turndown-plugin-gfm';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';

export interface Extracted {
  title: string | undefined;
  markdown: string;
}

const REMOVE: TurndownService.Filter = ['script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed', 'svg', 'canvas', 'form', 'button', 'img', 'picture', 'video', 'audio'];

function createTurndown(baseUrl: string): TurndownService {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
  });
  turndown.use(gfm);
  // remove() only applies when no other rule matches, which built-in rules (e.g. images) do.
  turndown.addRule('drop', { filter: REMOVE, replacement: () => '' });
  // Markdown escaping only costs tokens; the reader is a model, not a renderer.
  turndown.escape = (text) => text;
  // <pre> without an inner <code> (e.g. GitHub) would otherwise lose its fences.
  turndown.addRule('bare-pre', {
    filter: (node) => node.nodeName === 'PRE' && node.firstChild?.nodeName !== 'CODE',
    replacement: (_content, node) => `\n\n\`\`\`\n${node.textContent?.replace(/\n$/, '')}\n\`\`\`\n\n`,
  });
  // Absolute URLs without titles; heading anchors and icon-only links are dropped.
  turndown.addRule('link', {
    filter: (node) => node.nodeName === 'A',
    replacement: (content, node) => {
      const text = content.trim();
      const href = node.getAttribute('href');
      if (!text) return '';
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return text;
      try {
        return `[${text}](${new URL(href, baseUrl).href})`;
      } catch {
        return text;
      }
    },
  });
  return turndown;
}

/** Reduces an HTML page to the markdown of its main content. */
export function htmlToMarkdown(html: string, url: string): Extracted {
  const { document } = parseHTML(html);
  const title = document.title?.trim() || undefined;

  // Readability mutates the document, so give it its own copy and keep ours for the fallback.
  const article = new Readability(parseHTML(html).document, { charThreshold: 200 }).parse();
  const content = article?.content ?? document.body?.innerHTML ?? html;

  const markdown = createTurndown(url)
    .turndown(content)
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { title: article?.title?.trim() || title, markdown };
}
