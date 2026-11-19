import { Document, Scalar, visit } from "yaml";

/**
 * Render any value as YAML text (no surrounding ``` fences or frontmatter delimiters).
 * String values are double-quoted, or written as a literal block when they span lines.
 */
export function toYamlString(obj: unknown): string {
  const doc = new Document(obj);
  visit(doc, {
    Scalar(key, node) {
      if (key === "key" || typeof node.value !== "string") return;
      node.type = node.value.includes("\n")
        ? Scalar.BLOCK_LITERAL
        : Scalar.QUOTE_DOUBLE;
    },
  });
  return doc.toString({ lineWidth: 0 }).replace(/\n$/, "");
}

/** Render any value as pretty-printed JSON text. */
export function toJsonString(obj: unknown, indent = 2): string {
  return JSON.stringify(obj, null, indent);
}

/** Render any value as YAML frontmatter (`---` delimiters included). An empty object renders as empty frontmatter. */
export function toYamlFrontmatter(obj: unknown): string {
  const body = toYamlString(obj);
  if (body === "{}") return "---\n---\n";
  return `---\n${body}\n---\n`;
}
