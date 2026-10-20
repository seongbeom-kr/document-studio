# Questions about a selected passage

Select text inside one paragraph, then choose **선택 영역 질문**. The SDK preserves that exact range and places a compact question composer beside it. With a collapsed caret, it captures the whole paragraph instead. The composer follows scrolling and zoom, flips above a selection near the bottom, and stays within the visible host. The selected text is available in an expandable preview. Escape cancels and returns focus to the opener.

DOCX uses model text offsets and named highlights. HWPX uses body text offsets and native selection geometry. HWPX table/picture questions and ranges spanning multiple paragraphs remain unsupported; they produce an explicit selection instruction. This is logical text selection, not freehand image cropping. Coordinates never identify a write target.

Hosts opt in with `onQuestion(request)` on React `DocumentEditor` or `mountDocumentEditor`. Custom toolbar slots receive `canAskQuestion` and `askAboutParagraph()`. The public controller also provides `captureQuestionTarget()`, `askQuestion(targetId, question)` and `clearQuestionTarget()` for custom UI.

A request contains the user's question and an immutable target: `targetId`, `documentId`, SDK `sessionId`, saved `version`, live `revision`, opaque `selectionKey`, engine `anchor`, description and selected text. Selected text is limited to 8,000 characters and questions to 4,000 characters. A partial-range anchor includes engine paragraph identity and start/end offsets. Treat it as opaque: never manufacture a selection key or reconstruct writes from pixel positions. Custom engines can implement `EditorSession.getQuestionRects()` to return presentation-only rectangles in host viewport CSS pixels.

The SDK checks identity/version/revision/selection at capture and submission. It preserves the question after a host error, prevents concurrent sends, and requires a new target when the document or selection changes. A border is view state and is excluded from document bytes and undo history. Zoom and scrolling do not authorize a different logical target.

The host must preserve those guards across asynchronous authentication/queueing and bind the request to the current editor connection. Treat quoted document text as data, not system instructions. For a question-only turn, expose read tools and reject mutations at the execution boundary; a proposed rewrite can be returned as text. Actual application belongs to the existing preview, selection/revision checks and explicit editing workflow.

The SDK supplies neither a model service nor credentials. An `onQuestion` callback completing proves only that the host accepted the request; a model response and server storage need their own evidence. Standalone harness tests use a synthetic callback and do not establish live model integration.
