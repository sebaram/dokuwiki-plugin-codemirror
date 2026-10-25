# Editor Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide conversation beside CodeMirror, inline review of suggested edits, native Save-only revisions, and optional remote MCP search.

**Architecture:** CodeMirror owns review annotations and native undo transactions. AI Assistant owns ephemeral chat, bounded server-side model/tool orchestration, and administrator-managed MCP connections. Existing single-shot editing and read-only wiki-agent endpoints remain compatible.

**Tech Stack:** CodeMirror 5, browser JavaScript/CSS, PHP 7.4-compatible code, existing cURL transport, Node assertions, Playwright, disposable DokuWiki Mort/PHP 8.3.

**Spec:** `docs/superpowers/specs/2026-10-25-editor-chat-design.md`.

## Global Constraints

- AI requests, answers, previews, Accept and Reject do not create wiki revisions or an additional checkpoint store.
- Ordinary CodeMirror Undo/Redo remains available for unsaved editing, including accepted AI edits.
- Chat is memory-only for the open editor.
- Keep CodeMirror 5 and the existing PHP/JavaScript stack.
- Only one active proposal set is allowed per editor.
- No changes to the upstream `albertgasset` repository or unrelated plugins.
- Credentials stay in protected server settings; regression tests use mocks. The saved GLM profile is only for synthetic live smoke checks.

## Review Focus

- UTF-16 editor offsets with Korean, emoji, CRLF and multiline changes must preserve unrelated source (Task 1).
- Partial acceptance followed by manual edits or Undo must invalidate stale remaining proposals without overwriting text (Task 1).
- Empty source/deletion-only proposals and ordinary questions must work without forced retrieval or accidental saves (Tasks 2, 4).
- MCP endpoints returning malformed JSON/SSE, unsafe URLs, changed schemas or reflected secrets must fail closed (Task 3).
- Fastwiki replaces forms without replacing the document: chat must attach once, clear at the correct boundary and never target an old section (Tasks 4, 5).

---

### Task 1: Inline CodeMirror review

**Files:** Create `review.js`, `tests/review.cjs`, `tests/review.browser.cjs`; modify `Gruntfile.js`, `package.json`, `init.js`, `styles.less`.

**Interfaces:** `CodeMirrorAIReview.plan(snapshot, from, to, parts)` validates diff parts and produces ordered `{from,to,removed,added,status}` regions. `CodeMirrorAIReview.show(textarea, {snapshot,from,to,parts,onState})` returns `{accept(index),reject(index),acceptAll(),rejectAll(),focus(index),destroy()}`. `onState({pending,accepted,rejected,stale})` updates chat summaries. Diff parts are existing AI Assistant `{type:'equal'|'insert'|'delete',text}` values. Export pure planning helpers to Node as well.

- [ ] Write `tests/review.cjs` with literal multi-region, Unicode/emoji, insertion, deletion, empty and invalid reconstruction expectations. Add a real-CodeMirror browser test for Accept/Reject, partial acceptance offset changes, Undo and stale edits.
- [ ] Run `node tests/review.cjs` and `node tests/review.browser.cjs`; observe missing review behavior before implementing.
- [ ] Implement bounded marks/widgets and controls; proposals do not modify the textarea. Group Accept all as one native undo action; individual acceptance preserves prior undo. Destroy overlays on stale source or `codemirror:destroy`; fix menu handler cleanup with a namespaced listener and guarded collapse timer.
- [ ] Include `review.js` in the build and test scripts. Run `npm run build && npm test && node tests/review.browser.cjs`.
- [ ] Commit the spec, plan and tested review implementation.

### Task 2: Bounded conversational editor backend

**Files (AI Assistant):** Create `EditorChat.php`, `tests/php/editor-chat.php`; modify `ApiClient.php`, `action.php`, `tests/php/run.php`, `lang/en/lang.php`, `lang/ko/lang.php`.

**Interfaces:** `EditorChat::run(array $profile, array $input, string $pageId, ?WikiTools $wiki=null, ?ApiClient $api=null, ?McpTools $mcp=null): array` returns `{answer,proposal?:{replacement,summary},sources,trace,model_calls,tool_calls}` or a safe error. Input has `message`, `history` (user/assistant content only), `selected_text`, `before_text`, `after_text`, `external_tools` boolean. The server exclusively owns system/tool messages and tool execution. `action.php` dispatches `call=aiassist_chat` through `processChatRequest` with existing ACL/CSRF/profile-revision/limiter checks. Extend `ApiClient::agentTurn` with an optional final argument-byte limit, preserving the existing 8192 default.

- [ ] Add PHP tests for plain multi-turn conversation, proposal-only tool calls including empty/deletion results, exact whitespace, forged transcript roles, stale profile, unauthorized/CSRF inputs, malformed proposals, duplicate tool IDs, bounds and no wiki writes.
- [ ] Run the PHP suite and observe new behavior fail.
- [ ] Implement 6 model turns / 8 tools / 120-second budget, at most 12 historical messages and 32000 historical characters, 2000-character commands, 100000-character selection/replacement ceiling, existing bounded context. Reuse wiki tools; return edit proposals as data and permit normal answers without mandatory wiki retrieval. Reject unknown/forged citations when used. Do not persist chat or source snapshots.
- [ ] Run all PHP/JS suites and syntax checks; commit backend changes.

### Task 3: Read-only MCP connections and tools

**Files (AI Assistant):** Create `McpStore.php`, `McpClient.php`, `McpTools.php`, `McpAdmin.php`, `tests/php/mcp.php`, `tests/integration/fake-mcp.py`; modify `admin.php`, `action.php`, `tests/php/bootstrap.php`, `tests/php/run.php`, language files and `tools/build-release.py`.

**Interfaces:** `McpStore(path)::read()/save(input, revision)/delete(id, revision)` manages protected, atomic, locked connection records. Connections contain `{id,name,url,token,tools}`; enabled tools carry server-discovered names and input schemas. `McpClient(connection)::listTools()/callTool(name, arguments)` implements remote HTTP JSON/SSE with a protected `request` HTTP boundary for tests. `McpTools::definitions()/execute(name, jsonArguments)/sources()/trace()` exposes only explicitly configured tools with stable namespaced model names. `McpAdmin::handle()/html()` integrates a separate admin form without intercepting API profile operations.

- [ ] Add failing tests for private atomic storage and stale updates, same-endpoint credential reuse, admin-only config, malformed/redirected/oversized MCP replies, session initialization, JSON and SSE, pagination, unknown tools, schema validation, unsupported features and secret redaction. Mock only HTTP boundaries; exercise the real client/store/router.
- [ ] Implement remote Streamable HTTP, explicitly supported protocol versions and bounded compatibility handling. Cap discovery at 100 tools/5 pages, replies at 1 MiB, each call at 20 seconds and remaining chat budget, arguments at 8192 bytes, result text at 16000 characters. No redirect following, browser-provided URLs, stdio, OAuth, sampling or execution tools. Admin explicitly chooses read-only tools; reject unsupported schema constructs instead of claiming to validate them.
- [ ] Add admin discovery/save/delete UI, optional bearer credential, explicit tool allowlist, protected file permissions and safe errors. No model request is used for discovery. A newly configured connection is not enabled automatically in an editing conversation.
- [ ] Add a deterministic local mock MCP server. Run complete PHP/JS suites, PHP lint, and native cURL client checks against the mock; commit.

### Task 4: Chat sidebar and inline proposal integration

**Files (AI Assistant):** Create `chat.js`, `tests/js/chat.test.cjs`, `tests/integration/editor-chat.browser.cjs`; modify `script.js`, `action.php`, `style.css`, language files, `tools/build-release.py`. Modify CodeMirror styling/lifecycle only where required.

**Interfaces:** `window.AIAssistChat.open(textarea)` reads the existing form bootstrap, captures current scope per send, and owns only in-memory transcript/request/pending-review state. It consumes Task 1's API and `diffAIAssistText`; submits Task 2's endpoint. A new textarea for the same page/section can reattach conversation after Preview, while a different scope or Cancel ends it. Non-CodeMirror editors retain a usable existing review fallback.

- [ ] Add failing state tests for bounded user/assistant history and source citation URLs, and browser tests for chat/questions/edits, current scope, inline review, partial/all acceptance/rejection, Undo/Redo, invalidation, Save-only revisions, native fallback, keyboard and 390px layout.
- [ ] Implement the approved sidebar/composer/model picker, clear-chat action, resizable desktop layout, collapsed mobile drawer, opt-in tools toggle and visible activity/sources. Keep chat content as escaped text. Include a separate Saved revisions link to native history in another tab. Do not create an AI history UI or storage.
- [ ] Add send/stop and request deadlines. Do not let late replies target changed/closed editors. A new request can replace only pending visual proposals; accepted source remains the current base. Preserve exact user/model text and keep legacy entry points/tests working.
- [ ] Install runtime files in a separate mock wiki (not the user's saved-profile fixture). Run complete suites and browser regression; commit.

### Task 5: Integrated verification, live GLM and packaging

**Files:** Both READMEs, install/changelog/test documentation, release metadata if needed, CodeMirror companion patch if its target changes, browser regression/report files and package allowlists.

- [ ] Extend deterministic tests for Fastwiki full/section edit, exact neighboring UTF-8 content, Preview/Cancel/reopen, ProseMirror, toolbar, settings, Save/reopen and separate native revisions; run them with mock AI/MCP.
- [ ] Build CodeMirror archive and AI Assistant ZIP, check runtime allowlists and absence of secrets/data. Install these into the approved local test wiki while preserving its existing GLM profile and account configuration.
- [ ] Make small, sequential synthetic GLM checks: multi-turn question, inline proposal/Accept/Undo, opt-in MCP search. Use the saved profile through native UI/endpoints; never print its key or silently retry provider calls. Record exactly which live behaviors work.
- [ ] Capture desktop/mobile screenshots. Run both complete suites, builds, lint and diff checks; check uncaught browser errors and clean Git state.
- [ ] Perform one fresh whole-branch review across both repositories, fix Critical/Important findings with a failing regression followed by a passing suite, document remaining limits, and commit final changes. Integration targets remain the user's `sebaram` CodeMirror `master` and AI Assistant `main`; no upstream writes.

## Execution

Native execution in this session, authorized by the user's "good proceed" after
design approval. No further planning approval round is required. Track concrete
results and any deviations in this plan's git-ignored execution ledger.
