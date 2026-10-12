export interface PropertyDraft<T extends object> {
  selection: string;
  base: T;
  edits: Partial<T>;
}
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
/** Selection changes reset pending values; external changes replace only the affected properties. */
export function reconcilePropertyDraft<T extends object>(
  draft: PropertyDraft<T>,
  current: T,
  selection: string,
): PropertyDraft<T> {
  if (draft.selection !== selection)
    return { selection, base: current, edits: {} };
  if (equal(draft.base, current)) return draft;
  const edits = Object.fromEntries(
    Object.entries(draft.edits).filter(([key]) =>
      equal(draft.base[key as keyof T], current[key as keyof T]),
    ),
  ) as Partial<T>;
  return { selection, base: current, edits };
}
