import { attr, elements, type Element } from "../xml";
import { digestV3 } from "./contract";
import type { TemplateStyleV3 } from "./types";

/** Namespace-qualified source properties, including references to protected style sheets. */
export function styleProperties(node?: Element): Record<string, string> {
  if (!node) return {};
  const result: Record<string, string> = {};
  const visit = (at: Element, path: string) => {
    result[path] = "";
    for (const a of Array.from(at.attributes))
      if (a.namespaceURI !== "http://www.w3.org/2000/xmlns/")
        result[`${path}/@{${a.namespaceURI ?? ""}}${a.localName}`] = a.value;
    elements(at).forEach((child, index) =>
      visit(
        child,
        `${path}/${index}:{${child.namespaceURI ?? ""}}${child.localName}`,
      ),
    );
  };
  visit(node, `{${node.namespaceURI ?? ""}}${node.localName}`);
  return result;
}
export function createStyleRegistryV3() {
  const styles = new Map<string, TemplateStyleV3>();
  return {
    styles,
    async add(
      kind: TemplateStyleV3["kind"],
      node: Element,
      properties?: Element,
    ) {
      const values = styleProperties(properties);
      for (const name of [
        "paraPrIDRef",
        "styleIDRef",
        "charPrIDRef",
        "borderFillIDRef",
      ])
        if (attr(node, name) !== undefined)
          values[`@${name}`] = attr(node, name)!;
      const digest = await digestV3({ kind, properties: values });
      const id = `style_${digest.slice(7, 31)}`;
      styles.set(id, { id, kind, digest, properties: values });
      return id;
    },
  };
}
