const allowed = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "ISC",
  "Zlib",
  "Unlicense",
  "CC0-1.0",
  "Unicode-DFS-2016",
  "Unicode-3.0",
  "BSL-1.0",
  "BlueOak-1.0.0",
]);
/** Every AND term must pass; an OR term may select a permissive option. Unknown terms fail closed. */
export function permittedLicense(expression) {
  const tokens =
    String(expression ?? "")
      .replace(
        /Apache-2\.0\s*\/\s*MIT|MIT\s*\/\s*Apache-2\.0/g,
        "Apache-2.0 OR MIT",
      )
      .replace(/Unlicense\s*\/\s*MIT/g, "Unlicense OR MIT")
      .match(/[\w.+-]+|[()]/g) ?? [];
  let index = 0;
  const atom = () => {
    if (tokens[index] === "(") {
      index++;
      const value = or();
      if (tokens[index++] !== ")") throw new Error("Unbalanced license");
      return value;
    }
    const name = tokens[index++];
    let valid = allowed.has(name);
    if (tokens[index] === "WITH") {
      index++;
      valid =
        valid && name === "Apache-2.0" && tokens[index++] === "LLVM-exception";
    }
    return valid;
  };
  const and = () => {
    let value = atom();
    while (tokens[index] === "AND") {
      index++;
      const right = atom();
      value = value && right;
    }
    return value;
  };
  const or = () => {
    let value = and();
    while (tokens[index] === "OR") {
      index++;
      const right = and();
      value = value || right;
    }
    return value;
  };
  try {
    const result = or();
    return result && index === tokens.length;
  } catch {
    return false;
  }
}
