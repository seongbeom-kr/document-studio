export interface SearchToken {
  context: string;
  generation: number;
  selection?: number;
}

/** Search input and async completions share an identity, independent of document revision. */
export class SearchSession {
  private context = "";
  private generation = 0;
  private selection = 0;
  updateContext(context: string): void {
    if (context === this.context) return;
    this.context = context;
    this.invalidate();
  }
  invalidate(): void {
    this.generation++;
    this.selection++;
  }
  beginSearch(): SearchToken {
    this.invalidate();
    return { context: this.context, generation: this.generation };
  }
  beginSelection(): SearchToken {
    return {
      context: this.context,
      generation: this.generation,
      selection: ++this.selection,
    };
  }
  current(token: SearchToken): boolean {
    return (
      token.context === this.context &&
      token.generation === this.generation &&
      (token.selection === undefined || token.selection === this.selection)
    );
  }
}
