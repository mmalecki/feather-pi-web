# feather-pi-web
Lean web search and web fetch tools for [pi](https://pi.dev), aimed at smaller models. Ported from
[featherloop](https://github.com/mmalecki/featherloop).

* `webfetch` - fetches a page, reduces it to the markdown of its main content, and has a model summarize it
  (with an optional `focus`) before it reaches the agent's context
* `websearch` - searches through [Parallel](https://parallel.ai)'s Search API, which returns markdown excerpts per result

## Installation
```sh
pi install git:github.com/mmalecki/feather-pi-web
```

Or try it for one run with `pi -e /path/to/feather-pi-web`.

## Configuration
* `PARALLEL_API_KEY` - enables `websearch`
* `WEBFETCH_COMPACT_MODEL` - the `provider/model` that summarizes fetched pages, e.g. a small local one.
  Defaults to the session's model; `off` returns pages whole (up to 50k characters).

Summarizing runs without thinking, and its token usage counts towards the session's.
