// Shared brand mark - an envelope glyph plus the "Barua" wordmark. Used in
// the header, the login screen, and the missing-config screen so the app
// reads as one product instead of ad hoc page titles.
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "brand brand-compact" : "brand"}>
      <svg
        className="brand-mark"
        width={compact ? 22 : 30}
        height={compact ? 22 : 30}
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
      >
        <rect x="2" y="6" width="28" height="20" rx="4" fill="var(--accent)" />
        <path
          d="M4 9l12 9 12-9"
          stroke="var(--surface)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
      <span className="brand-word">Threadly</span>
    </span>
  );
}
