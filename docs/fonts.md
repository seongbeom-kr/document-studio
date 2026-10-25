# Self-hosted fonts

The core package includes the `document-studio-noto-2` font pack: Noto Sans KR and
Noto Serif KR, weights 400 and 700, plus an unmodified Noto Sans Symbols 2 regular
face for characters absent from the body fonts, including U+2981 and U+2219.
The Korean faces are official Google Fonts variable TTFs
instantiated without subsetting. The font pack retains Korean, Hanja and supported
symbols. It is not an exact replacement for Human, Hanyang or Hancom fonts.

Run `document-studio-font-assets public/editor-assets/fonts` after installing the
SDK. `document-studio-rhwp-assets public/editor-assets/rhwp` also copies this shared
pack to the sibling `fonts` folder. Keep the whole font folder, including its OFL,
copyright, manifest and fontconfig files. No font CDN or local-font permission is
required for the default pack.

```tsx
const engines = [
  docxEngine({ fontBaseUrl: "/editor-assets/fonts/" }),
  rhwpEngine({
    studioUrl: "/editor-assets/rhwp/index.html",
    fontBaseUrl: "/editor-assets/fonts/",
  }),
];
```

The defaults above work under a root deployment. Apps served at a subpath must
supply the corresponding public asset URLs. These are host-owned settings; names
read from a document are never used to construct network URLs. The SDK verifies
actual byte lengths and SHA-256 hashes before admitting fonts. Font failures are
shown in the editor footer and in `getState().fonts` / agent `getContext().fonts`.

The report distinguishes requested names, actual substitute families, source and
asset errors. A requested name is not proof of installation or a visible run.
Glyph coverage is explicitly `not-assessed` at runtime: the packaged fonts are
tested separately, but arbitrary document characters and proprietary symbol-font
encodings require additional checks. Dedicated monospace and emoji faces are not
part of this pack. The Unicode symbol fallback does not implement proprietary
Wingdings/Webdings encodings. Italic has no dedicated face in this pack.

From beta.5, HWP 5.x editing also uses the RHWP adapter and this same font pack.
Display fallback preserves the original HWP save format. Binary HWP admission and
verified, content-loss-checked export are separate from font loading. HWP 3.x and
protected/signed HWP documents are rejected. Mail merge still accepts DOCX/HWPX.

## Original fonts

Display substitution preserves the font references in the saved DOCX/HWPX.
DOCX hosts can pass an optional `fontResolver` to `docxEngine`; its supplied faces
take priority over the portable resolver. It uses the upstream `FontResolver`
contract. Provide only licensed bytes and keep the resolver identity stable.
RHWP retains its user-approved Local Font Access flow for original installed faces.
Permission denial falls back to the portable pack. Browser-local availability does
not install fonts on a server or grant redistribution/server rights.

## PDF workers

Copy `@document-studio/core/dist/fonts` into the image or a read-only volume. Verify
`manifest.json` and all hashes. Set `FONTCONFIG_FILE` to the supplied
`fontconfig.conf` for LibreOffice, and pass the pack directory to RHWP:

```sh
rhwp export-pdf document.hwpx -o document.pdf \
  --font-path /opt/document-studio/fonts \
  --fallback-serif 'Noto Serif KR' --fallback-sans 'Noto Sans KR'
```

Use the exact same pack bytes on both sides. Licensed original fonts may be added
separately. The fontconfig aliases accept the portable family after the original
family; they do not replace an original installed face. LibreOffice also has its
own substitution table: fontconfig aliases alone may select a different installed
face. Configure a per-conversion LibreOffice profile to replace missing original
families, while retaining genuinely installed originals. These font settings do not
guarantee identical layout across native, browser and LibreOffice renderers.
In particular the pinned RHWP 0.8.6 WASM does not expose the later
`setFontEnvironment` API, so this change does not claim native/WASM layout parity.

## Provenance and rebuilding

`manifest.json` records each official source commit/URL, original SHA-256, output
SHA-256, weight and coverage count. The initial static source instances had legacy
family names; the pack normalizes the family/style identity, preserving glyph
coverage. The reserved font name `Source` is not used.

Normal builds are offline for font preparation and require no Python. Maintainers
can reproduce the checked-in TTFs with `fonttools[woff]==4.60.1` and
`python scripts/rebuild-font-pack.py --output .build/rebuilt-fonts`.
The fonts remain OFL-1.1; the SDK remains Apache-2.0. These are separate licenses.
