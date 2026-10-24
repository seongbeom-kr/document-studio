export const fontDirectory: string;
export function verifyFontAssets(
  directory?: string,
): Promise<{ id: string; faces: unknown[] }>;
export function prepareFontConfig(): Promise<void>;
