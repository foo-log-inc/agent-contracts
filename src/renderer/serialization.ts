function toYamlLines(obj: unknown, indent: number): string[] {
  const pad = "  ".repeat(indent);
  if (obj === null || obj === undefined) return [`${pad}null`];
  if (typeof obj === "boolean" || typeof obj === "number")
    return [`${pad}${obj}`];
  if (typeof obj === "string") {
    if (obj.includes("\n")) {
      const lines = [`${pad}|`];
      for (const line of obj.split("\n")) {
        lines.push(line === "" ? "" : `${pad}  ${line}`);
      }
      return lines;
    }
    return [`${pad}${JSON.stringify(obj)}`];
  }
  if (Array.isArray(obj)) {
    const lines: string[] = [];
    for (const item of obj) {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        const entries = Object.entries(item as Record<string, unknown>);
        if (entries.length > 0) {
          const [firstKey, firstVal] = entries[0];
          const firstValLines = toYamlLines(firstVal, 0);
          if (firstValLines.length === 1 && !firstValLines[0].includes("\n")) {
            lines.push(`${pad}- ${firstKey}: ${firstValLines[0].trim()}`);
          } else {
            lines.push(`${pad}- ${firstKey}:`);
            lines.push(...toYamlLines(firstVal, indent + 2));
          }
          for (let i = 1; i < entries.length; i++) {
            const [k, v] = entries[i];
            const vLines = toYamlLines(v, indent + 2);
            if (vLines.length === 1) {
              lines.push(`${pad}  ${k}: ${vLines[0].trim()}`);
            } else {
              lines.push(`${pad}  ${k}:`);
              lines.push(...vLines);
            }
          }
        } else {
          lines.push(`${pad}- {}`);
        }
      } else {
        const valLines = toYamlLines(item, 0);
        lines.push(`${pad}- ${valLines[0].trim()}`);
      }
    }
    return lines;
  }
  if (typeof obj === "object") {
    const lines: string[] = [];
    for (const [key, value] of Object.entries(
      obj as Record<string, unknown>,
    )) {
      const valLines = toYamlLines(value, indent + 1);
      if (valLines.length === 1 && !valLines[0].includes("|")) {
        lines.push(`${pad}${key}: ${valLines[0].trim()}`);
      } else {
        lines.push(`${pad}${key}:`);
        lines.push(...valLines);
      }
    }
    return lines;
  }
  return [`${pad}${String(obj)}`];
}

/** Render any value as YAML text (no surrounding ``` fences or frontmatter delimiters). */
export function toYamlString(obj: unknown): string {
  return toYamlLines(obj, 0).join("\n");
}

/** Render any value as pretty-printed JSON text. */
export function toJsonString(obj: unknown, indent = 2): string {
  return JSON.stringify(obj, null, indent);
}

/** Render any value as YAML frontmatter (`---` delimiters included). */
export function toYamlFrontmatter(obj: unknown): string {
  const body = toYamlString(obj);
  if (!body) return "---\n---\n";
  return `---\n${body}\n---\n`;
}
