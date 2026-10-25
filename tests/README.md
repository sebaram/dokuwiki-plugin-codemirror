# Local compatibility checks

`npm run test:review` tests actual CodeMirror inline decorations, partial/all
acceptance, rejection, native Undo, UTF-16 offsets and stale editor teardown.
The adjacent AI Assistant repository's `tests/integration/editor-chat.browser.cjs`
and `editor-chat-lifecycle.browser.cjs` test the new chat, MCP and Save boundaries.
They use a separate `/tmp/editor-chat-wiki` fixture, not the saved-profile wiki.

For the older comparison-card compatibility check below, set
`CODEMIRROR_TEST_LEGACY_CHAT=1` when using AI Assistant 0.1.0. That check blocks
only the new chat module; the dedicated chat tests exercise the current UI.

`npm test` checks DokuWiki tokens, quoted formatting, CamelCase links, plugin
delimiters, protected text and embedded code without a browser or wiki.

`npm run test:browser` needs a **disposable loopback-only** DokuWiki instance
with Fastwiki, ProseMirror and AI Assistant enabled, two mock AI profiles and
`codesyntax`/`camelcase` enabled. It writes only the synthetic `codemirror_test`
page (with a fresh timestamp by default). Do not point it at a real wiki.
Requests to non-loopback hosts are blocked.

The current mock fixture is `/tmp/editor-chat-wiki`, served on
`http://127.0.0.1:18962`, with the fake API on port 18963. Provision it using
the adjacent `dokuwiki-ai-assistant` repository's
`tests/hosting/editor-chat/README.md`. The older extension mirror on port
18960 now contains the separately authorized live profile and must not be
used for automatic regression tests.

Build and copy the plugin's release files (including `dist`) to
`lib/plugins/codemirror`, enable CodeMirror, and install the companion
AI Assistant `editor.js` adapter for the save-and-continue check. Then run:

```sh
npx playwright install chromium
CODEMIRROR_TEST_URL=http://127.0.0.1:18962 CODEMIRROR_TEST_LEGACY_CHAT=1 npm run test:browser
```

Defaults are the fixture's fake administrator `admin` / `local-test-password`.
The read-only source check also uses `reader` / `local-reader-password`.
Override with `CODEMIRROR_TEST_USER` / `CODEMIRROR_TEST_PASSWORD`. Browser output
defaults to `/tmp/codemirror-browser`; override with `CODEMIRROR_TEST_OUTPUT`.
`CHROMIUM_EXECUTABLE` selects an existing compatible browser installation.
`CODEMIRROR_TEST_PAGE` selects the main browser test's disposable page ID,
so an interactive user's test page does not need to be overwritten.

The test covers actual rendered colors, language loading, toolbar/link-wizard
insertion, native extension APIs, undo, AI review/apply/stale-edit protection,
ProseMirror switching, preview, native save, Fastwiki AJAX lifecycle, settings,
save-and-continue position restoration, mobile layout and read-only source.
It records extension states and fails on uncaught browser errors.

The older `npm run test:sections` requires the original extension-mirror mock
provider and comparison-card UI. Reprovision a disposable mock wiki and set
`CODEMIRROR_TEST_URL` and `CODEMIRROR_TEST_ROOT` explicitly before using it.
The current `editor-chat-lifecycle.browser.cjs` covers the new section chat.
The older section test creates a new timestamped disposable page and exercises
actual keyboard editing, exact highlighted code and native clipboard copying,
AI-selected-text Apply/undo, Fastwiki inline section
edit/preview/cancel, AI refinement within a section, reviewed Apply/undo/redo,
section save/reopen and read-only cited wiki chat. It verifies the complete
saved UTF-8 page against the expected source so neighboring sections must
remain identical. The mock provider's ten-second request limit is respected.

The section test caught Wiki-Style Script discarding Fastwiki's form handlers
and native clipboard handlers, as well as Copy labels entering highlighted
code. The editor supplies a delegated section fallback, restores native Copy
controls, and keeps button text out of the syntax highlighter. The test
verifies exactly one AJAX request per section click, without a full-page
navigation. To test an explicitly
approved HTTPS Cloudflare test tunnel, set `CODEMIRROR_ALLOW_PUBLIC_TEST=1`
and supply that tunnel with `CODEMIRROR_TEST_URL`; ordinary runs use loopback.

## Extension limits

The mirror has 61 installed plugins. The test configuration enables 57,
including CodeMirror and Struct Template. The three unconfigured alternate
authentication providers (`authad`, `authldap`, `authpdo`) remain disabled;
the wiki uses `authplain`.

Enabling the installed Markdowku version (2021-12-04) reproducibly breaks the
whole wiki with HTTP 500 under Mort: its `interpretSyntax($match, &$type)`
override conflicts with `interpretSyntax(string $match): array`, and its
`dokuwiki\Parsing\Handler\Quote` parent no longer exists. It remains disabled.
This needs a separate Markdowku migration; changing CodeMirror cannot repair it.

Passing these checks establishes editor coexistence, not every feature of
every extension. Tests use PHP 8.3.6 CLI, not the reference PHP 8.5/Apache
runtime. Real model behavior and paid provider calls are not tested.
