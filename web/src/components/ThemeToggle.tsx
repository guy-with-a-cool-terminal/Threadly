import { useTheme, type Theme } from "../lib/useTheme";

const OPTIONS: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="theme-toggle" role="group" aria-label="Theme">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === theme ? "theme-toggle-active" : undefined}
          aria-pressed={option.value === theme}
          onClick={() => setTheme(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
