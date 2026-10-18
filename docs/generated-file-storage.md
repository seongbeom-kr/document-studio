# Generated file storage

`generatedStorage` is an optional host adapter, separate from the original document's `storage`. React and `mountDocumentEditor` accept the same option. No workspace, authentication or backend URL is built into the SDK.

The host supplies a stable adapter object with `id`, a user-facing `label`, and `save({ operationId, documentId, sessionId, file, digest, signal })`. It returns `{ id, path, digest, version, warning? }` **after** storing that exact file. Keep the adapter stable while a save is running. Bind its identity to the authenticated owner, destination and document.

Requirements for the host:

- Authorize each save against the current owner, document and destination. Never trust a model-provided path or token.
- Deduplicate by batch operation ID, generated file ID, digest and destination. A retry after a lost response must return the original receipt, not create another file.
- Never overwrite an existing unrelated file. Use an explicit collision policy or a stable unique name.
- Verify the bytes and return the real saved version/path. A network request, download request or in-memory write is not a durable receipt.
- Honor the signal where possible. A timeout does not prove a write was cancelled. Preserve server idempotency records so the same file can be reconciled on retry.
- Report post-save synchronization warnings separately from host storage failure. `warning` is visible in the result card and public result; it does not undo an already committed file.

`controller.saveMailMergeResults(batchOperationId)` and the UI use the same operation. The agent bridge exposes `saveMailMergeResults({ documentId, expectedSessionId, batchOperationId })`. It returns `complete`, `remaining`, `stored` and an optional error. A partial result preserves successful receipts and pending bytes. Retrying processes pending files only; it does not regenerate the batch. Original document edits and its save status remain separate.

Storage waits default to 60 seconds. An adapter can set `timeoutMs` between 1,000 and 120,000 milliseconds. Unsupported storage, changed ownership/session, malformed receipts and timeouts retain unconfirmed outputs. Closing and document replacement remain guarded while copies are pending or saving. An external storage operation can finish after timeout; retry must reconcile using the same identity.

`previewMailMergeDocument(previewId, row = 0)` renders one immutable preview row into an `EditorDocument` without generating a batch or acknowledging storage. The common UI opens it in a read-only editor fitted to the available width. Previewing one row does not guarantee that every generated page fits or that native Word/Hancom pagination is identical.
