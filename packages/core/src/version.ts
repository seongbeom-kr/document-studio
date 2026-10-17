import manifest from "../package.json" with { type: "json" };
/** Version of the installed core package, supplied by its build metadata. */
export const DOCUMENT_STUDIO_VERSION: string = manifest.version;
