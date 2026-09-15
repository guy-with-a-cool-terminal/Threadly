const PALETTE = ["#3f9268", "#4f7cff", "#c9633f", "#8a5fd6", "#3fa0c9", "#c9527a", "#9a8b3f", "#5f9e3f"];

export function initialsFor(label: string): string {
  const local = label.trim().split("@")[0];
  return local.slice(0, 2).toUpperCase() || "?";
}

export function colorFor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}
