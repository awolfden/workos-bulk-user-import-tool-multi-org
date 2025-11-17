export function parseBooleanLike(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  const str = String(value).trim().toLowerCase();
  if (str === "") return undefined;
  if (["true", "1", "yes", "y"].includes(str)) return true;
  if (["false", "0", "no", "n"].includes(str)) return false;
  return undefined;
}

export function isBlank(val: unknown): boolean {
  if (val === undefined || val === null) return true;
  if (typeof val === "string" && val.trim() === "") return true;
  return false;
}

