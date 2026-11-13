// Small helpers shared by the project model, libraries, and the YAML importer.

export function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export function recordValue(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

/** Returns `value` when it is a string (truncated to `max`), else `fallback`. */
export function textValue(value: unknown, fallback = "", max = 4_000) {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

/**
 * Reads a finite number from a number or numeric string and clamps it.
 * Anything else (null, "", booleans, objects) yields `fallback`.
 */
export function numberValue(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

export function listForCount(values: string[], count: number, fallback: string) {
  return Array.from({ length: count }, (_, index) => values[index] ?? fallback);
}
