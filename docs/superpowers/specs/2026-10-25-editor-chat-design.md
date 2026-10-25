# Editor chat with inline review

Date: 2026-10-25
Repositories: `sebaram/dokuwiki-plugin-codemirror` and `sebaram/dokuwiki-ai-assistant`.
Status: approved by the user ("good proceed", 2026-10-25).

Builder check: a fresh read-only reviewer found no important decisions missing.
The user requested an interactive layout mockup; that separate throwaway mockup
demonstrates inline review, chat, and Save-only revision entries without calling
models or writing wiki pages. Its review/undo, explicit Save, independent chat
clearing, and narrow viewport interactions were checked in Chromium.

## Intent and agreed requirements

Provide a Cursor-style workflow for editing DokuWiki source: the editor shows
proposed changes and the adjacent chat carries the conversation. Preserve the
working modern DokuWiki, Fastwiki section editing, toolbar, syntax highlighting,
and native saving integrations.

The user chose inline changes in CodeMirror with a chat sidebar. They explicitly
rejected mixing AI chat with history and specified that history is kept only when
the user explicitly saves. Therefore:

- AI requests, answers, previews, Accept and Reject do not create wiki revisions
  or an additional checkpoint store.
- Explicit native Save, including the existing Ctrl/Cmd+S shortcut, continues to
  create DokuWiki revisions through its normal save pipeline.
- Ordinary CodeMirror Undo/Redo remains available for unsaved editing, including
  accepted AI edits. It is not presented as a chat transcript or saved revision.
- Chat is memory-only for the open editor. No chat database, localStorage,
  sessionStorage content cache, or cross-device conversation persistence.
- Saved revisions use DokuWiki's existing history and restore workflow. A Saved
  revisions link opens that workflow in another tab to preserve the open draft.

The user authorized testing with their saved GLM profile. The local profile named
`glm-5.3-flash` uses model `glm-5.3-flash-cloud`. Its existing secret stays in the
protected server configuration.

## Approaches considered

1. **Inline review and sidebar chat — selected by the user.** Use CodeMirror 5's
   existing decoration/widget APIs for proposals. This fits the current editor,
   keeps one source editing surface, and works on smaller desktop viewports.
2. **Side-by-side original/proposed editors and chat.** Explicit comparison, but
   three panes consume too much width and duplicate the editor surface. Not
   selected.

Keep CodeMirror 5 and the existing PHP/JavaScript stack. A CodeMirror 6 migration
would add scope without being required for the selected interaction.

## User experience

### Chat

A docked, resizable sidebar shares the editor area on desktop. On narrow screens
it becomes a full-width collapsible drawer. The editor stays readable when the
sidebar is closed. Reuse the existing AI toolbar entry and Ctrl/Cmd+K launcher.

The panel contains a model profile picker, a chronological conversation, a
selection/document scope indicator, a composer, a send/stop control and a tools
toggle. User and assistant messages remain in the conversation after an edit is
accepted or rejected. Chat contains explanations, questions, tool activity and
short edit summaries; it does not contain a second editable replacement buffer
or the main diff view.

Normal questions receive normal answers. When asked to edit, the assistant can
propose a replacement within the displayed scope. A selection supplies that
selection plus the existing bounded surrounding context. With no selection, the
scope visibly says Entire document. A refreshed scope is captured at submission;
there is no hidden reuse of an old selection. Provide a clear new-chat action.

Retain useful source citations for wiki and web retrieval. Render model and tool
content as text, with links produced only from validated source records.

### Inline review

Show additions in green and deletions in red with text labels as well as color.
Show changes at their document locations, with navigation between changed
regions and explicit Accept/Reject controls, including Accept all/Reject all.
The implementation can use marks and line widgets; proposals must not silently
replace the underlying textarea or become saved text before acceptance.

Keep normal editor scrolling and syntax highlighting. Clicking an edit summary
in chat focuses the corresponding changed region. Proposal text is literal wiki
source, never executable HTML. Empty/deletion-only edits are valid and must be
reviewable. Large replacements may use a bounded block comparison rather than
an expensive character diff.

Accepted changes affect only the proposed scope and enter native Undo/Redo.
Reject clears the proposal without changing source. A later manual edit, a
changed scope, or replacement of the editor invalidates an outdated proposal;
Accept must never overwrite newer text. After accepting one region, remaining
proposal offsets must still be correct. Only one active proposal set is allowed
per editor.

Saving submits only accepted/current source through DokuWiki. Pending visual
proposals are not included. Do not add automatic saves, AI checkpoints, or
conversation entries to saved revision history.

### Lifecycle and compatibility

Full-page editing and Fastwiki section editing use the same flow. Section edits
must leave the surrounding UTF-8 page source identical. Preview can preserve
the in-memory conversation for the same page and section while invalidating
proposal decorations attached to an obsolete editor. Cancel, navigating to a
different page/section, or closing the editor ends that editing conversation.
A normal Save reload may end the in-memory chat; only the wiki revision persists.

ProseMirror and the plain textarea keep a usable fallback review flow when
CodeMirror is absent. Maintain native toolbar interoperability, focus, keyboard
navigation, screen reader status announcements, and mobile controls. Fix the
known settings-menu body-listener cleanup while touching editor lifecycle.

## Backend and MCP tools

The current edit endpoint is a single replacement request and the current wiki
agent is read-only, single-question, and requires wiki citations. Add an editor
chat endpoint/service rather than weakening either existing contract. Reuse the
profile transport, ACL checks, CSRF validation, request limiter and wiki tools.

The editor chat accepts a bounded conversation and current source/scope snapshot.
Only supported user/assistant transcript fields are accepted from the browser;
client-provided system instructions, tool results, destinations and keys are not
trusted. The server owns its instructions and tool execution. A validated edit
proposal is returned as data for inline review, not written to a wiki page.

Preserve exact whitespace and Unicode. Validate proposed range and replacement
against the captured scope. Do not execute tool names or arguments supplied by
the model unless they match an enabled server-defined tool. Chat has explicit
message, context, output, model-turn, tool-count, response-byte and time limits;
the builder chooses bounds consistent with existing limits and tests them.

### MCP proposal (builder recommendation)

Add a server-side remote HTTP MCP client and an administrator-only connection
section in AI Assistant settings. Each connection has a label, endpoint,
optional bearer credential and an explicit enabled-tool allowlist. No shell
commands or stdio process launcher are introduced into the PHP web server.

Discover tools and let the administrator explicitly enable read-only search or
retrieval tools. Do not infer permission solely from a server's readOnlyHint.
Do not make write, messaging, purchase or arbitrary execution tools available
in this iteration. The protocol is reusable for other permitted read-only tools.

The chat Tools control shows what is enabled and lets the user disable external
retrieval. External search is opt-in for each editing conversation. Show tool
names, progress, success/failure and resulting source links. Send only the
arguments required for the selected tool; do not attach the whole wiki source
to search calls automatically. External tool output is untrusted evidence.

MCP endpoints and credentials come only from protected administrator settings,
never the browser or model. Apply connection validation, TLS verification,
timeouts, bounded JSON/SSE parsing, bounded tool discovery and results, response
ID/schema validation, and no credential-forwarding redirects. Keep MCP secrets
out of browser context, logs, errors, Git, archives and chat.

Support remote Streamable HTTP JSON and request-scoped SSE replies. Clearly
document the supported protocol versions and implement their handshake/session
rules rather than silently assuming all HTTP MCP servers behave alike. Test
the supported versions, pagination, invalid replies and server failures. Full
OAuth, sampling, elicitation, persistent subscriptions and local stdio servers
are not required for the initial read-only client; report unsupported features.

Use a deterministic local mock MCP server for regressions. For a real web-search
smoke test, the recommended initial endpoint is Exa's documented public hosted
MCP endpoint, using synthetic public queries. Keep it optional and do not turn
it on for unrelated wiki users or replace existing saved AI profiles.

References:

- MCP transport: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
- MCP tools: https://modelcontextprotocol.io/specification/2026-07-28/server/tools
- Hosted Exa MCP: https://exa.ai/docs/get-started/exa-mcp

## Change locations

- CodeMirror: review decoration/accept/reject bridge, sidebar sizing integration,
  lifecycle cleanup, styles, build input if a small new module is justified,
  browser regressions and compatibility documentation.
- AI Assistant: chat UI and endpoint, conversational/edit proposal orchestration,
  profile transport integration, MCP connection store/client/admin UI, English
  and Korean strings, packaging, documentation, PHP/JS and browser regressions.
- Local test wiki: install the resulting runtime files while preserving its
  saved profiles and account settings. Regression tests use separate disposable
  data and mocked providers. Live GLM checks use only synthetic test pages.

No changes to the upstream `albertgasset` repository or unrelated plugins. Git
work remains within the two `sebaram` repositories. No forced pushes or default
branch changes are required.

## Validation and completion

1. Run both repositories' unit tests, syntax checks, CodeMirror build and actual
   DokuWiki CSS compilation. Add focused tests for nontrivial new state/transport
   logic before implementation.
2. Browser-test multi-turn chat, current selection capture, inline additions,
   deletions and multiline edits, individual/all Accept/Reject, Undo/Redo, stale
   proposals, Save/reopen, separate saved revision history and memory-only chat.
3. Recheck Fastwiki section edit/preview/cancel/save with exact surrounding source,
   native toolbar/settings, ProseMirror switching, keyboard use and mobile layout.
4. Exercise ACL, CSRF, stale profile, untrusted transcript/tool output, MCP schema,
   auth redaction, limits and failure behavior using mocks. No paid API calls in
   the repeatable regression suite.
5. Run a small live smoke test with the existing GLM profile: ordinary conversation,
   a reviewed synthetic edit with Undo, and an opt-in MCP search. Inspect results
   and tool activity. Do not silently retry paid model calls or overwrite keys.
6. Review both diffs and verify release contents contain required runtime files
   and no configuration, credentials, private chat or test-wiki data. Deliver
   screenshots and a precise report of live and mock results and remaining limits.

## Decisions left to the builder

Module boundaries, visual spacing/colors, widget implementation, responsive
breakpoints, concrete bounded budgets, mock fixture details and supported MCP
version implementation may be chosen during planning, within the behavior above.
Do not expand into durable AI history, multi-file/wiki writes, a new editor
framework, unrestricted MCP tools or background autonomous editing.
