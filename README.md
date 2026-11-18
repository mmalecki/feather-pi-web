# feather-pi-web
Lean web search and web fetch tools for [pi](https://pi.dev), aimed at smaller models.

* `webfetch` - fetches a page and reduces it to the markdown of its main content (up to 50k characters). With
  `compact`, a model summarizes it (with an optional `focus`) before it reaches the agent's context.
  With `raw`, the page source comes back as fetched instead (up to 150k characters, or a quarter of the
  model's context window if that is less), for when the markdown is missing something.
  Images come back as attachments, converted and scaled the way pi's `read` tool does it (following the
  `images.autoResize` setting)
* `websearch` - searches through [Parallel](https://parallel.ai)'s Search API, which returns markdown excerpts per result

## Installation
```sh
pi install git:github.com/mmalecki/feather-pi-web
```

Or try it for one run with `pi -e /path/to/feather-pi-web`.

## Configuration
* `PARALLEL_API_KEY` - enables `websearch`
* `WEBFETCH_COMPACT_MODEL` - the `provider/model` that summarizes fetched pages, e.g. a small local one.
  Defaults to the session's model.
* `WEBFETCH_MAX_RAW_CHARS` - the most characters of page source a `raw` fetch returns, whatever the model's
  context window. Defaults to 150000, or a quarter of the context window if that is less.

Summarizing runs without thinking, and its token usage counts towards the session's.
