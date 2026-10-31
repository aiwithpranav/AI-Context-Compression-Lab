# ADR-0001: API keys live on a local server, never in the browser

**Status:** Accepted · 2026-10-31

## Context
The LLM features need paid or quota-limited API keys. The project started as a static page with no backend. A key placed in browser code, or typed into a page, can be read by any script on that page and by anyone with the page source. YouTube captions and office-file parsing also cannot be done from a browser (CORS, Node-only libraries).

## Decision
Add a small Node server. It holds the keys (environment / `.env`), calls the providers, fetches captions and parses uploads. The browser only talks to this server. The server binds to loopback and checks Host, Origin and Content-Type (see SECURITY.md).

## Consequences
+ Keys never reach the browser; one place to add validation, limits and error handling.
+ Enables captions, document parsing and exact local tokenization.
− Features need `npm start`; opening `index.html` directly only gives the offline engine.
− The server is a new attack surface and has no authentication, so it must stay local.

## Alternatives considered
- *Bring-your-own key in the browser* — simplest, but exposes the key to the page and to extensions; rejected.
- *Hosted backend* — needs auth, rate limiting and billing controls; out of scope for v1.0.
