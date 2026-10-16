export const RHWP_LIFECYCLE_PATCH: Readonly<{
  engineVersion: string;
  sourceFile: string;
  inputSha256: string;
  change: string;
}>;
export function patchRhwpLifecycle(code: string): string;
export function rhwpLifecyclePatch(): {
  name: string;
  transform(code: string, id: string): { code: string; map: null } | undefined;
  generateBundle(): void;
};
