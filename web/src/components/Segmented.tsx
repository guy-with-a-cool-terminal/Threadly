export function Segmented<T extends string>({
  options,
  value,
  onChange,
  small,
  label,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (next: T) => void;
  small?: boolean;
  label: string;
}) {
  return (
    <div className={`segmented ${small ? "segmented-sm" : ""}`} role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? "segmented-active" : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && <span className="segmented-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
