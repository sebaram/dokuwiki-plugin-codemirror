# Local compatibility checks

`npm test` checks DokuWiki tokens, quoted formatting, CamelCase links, plugin
delimiters, protected text and embedded code without a browser or wiki.

`npm run test:browser` needs a **disposable loopback-only** DokuWiki instance
with Fastwiki, ProseMirror and AI Assistant enabled, two mock AI profiles and
`codesyntax`/`camelcase` enabled. It writes only the synthetic `codemirror_test`
page. Do not point it at a real wiki. Requests to non-loopback hosts are blocked.

The existing fixture is `/tmp/aiassist-extension-mirror/wiki`, served on
`http://127.0.0.1:18960`, with the fake API on port 18961. Its provisioner,
router and fake provider are in the adjacent `dokuwiki-ai-assistant` repository
under `tests/hosting/extension-mirror` and `tests/integration`. No production
credentials or `testing-wiki.env` are used.

Build and copy the plugin's release files (including `dist`) to
`lib/plugins/codemirror`, enable CodeMirror, and install the companion
AI Assistant `editor.js` adapter for the save-and-continue check. Then run:

```sh
npx playwright install chromium
CODEMIRROR_TEST_URL=http://127.0.0.1:18960 npm run test:browser
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

`npm run test:sections` creates a new timestamped disposable page and exercises
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
