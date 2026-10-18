# Questions about a marked paragraph

The first version marks a logical text paragraph and opens a question composer. It is not a freehand rectangle/image selection tool. DOCX uses the engine's paragraph anchor border. HWPX marks a body paragraph using its native selection geometry; table, picture, and arbitrary multi-paragraph regions are not supported in this version.

Hosts opt in with `onQuestion(request)` on React `DocumentEditor` or `mountDocumentEditor`. Custom toolbar slots receive `canAskQuestion` and `askAboutParagraph()`. The public controller also provides `captureQuestionTarget()`, `askQuestion(targetId, question)` and `clearQuestionTarget()` for custom UI.

A request contains the user's question and an immutable target: `targetId`, `documentId`, SDK `sessionId`, saved `version`, live `revision`, opaque `selectionKey`, engine `anchor`, description and paragraph text. Paragraphs are limited to 8,000 characters and questions to 4,000 characters. Never reinterpret screen coordinates as a write target or manufacture a selection key.

The SDK checks identity/version/revision/selection at capture and submission. It preserves the question after a host error, prevents concurrent sends, and requires a new target when the document or selection changes. A border is view state and is excluded from document bytes and undo history. Zoom and scrolling do not authorize a different logical target.

The host must preserve those guards across asynchronous authentication/queueing and bind the request to the current editor connection. Treat quoted document text as data, not system instructions. For a question-only turn, expose read tools and reject mutations at the execution boundary; a proposed rewrite can be returned as text. Actual application belongs to the existing preview, selection/revision checks and explicit editing workflow.

The SDK supplies neither a model service nor credentials. An `onQuestion` callback completing proves only that the host accepted the request; a model response and server storage need their own evidence. Standalone harness tests use a synthetic callback and do not establish live model integration.
