import { colorFor, initialsFor } from "../lib/avatar";

export function Avatar({ label }: { label: string }) {
  return (
    <span className="avatar" style={{ background: colorFor(label) }}>
      {initialsFor(label)}
    </span>
  );
}
