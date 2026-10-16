import { useState } from "react";
import { X } from "lucide-react";
import { daysUntil, formatDate } from "../lib/format";

const DISMISS_KEY = "threadly-renewal-dismissed-on";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function dismissedToday(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === today();
  } catch {
    return false;
  }
}

// Quiet reminder for the mailbox owner: shown within a week of renewal and
// after it lapses, hidden for the rest of the day once dismissed.
export function RenewalNotice({ paidThrough, feeKes }: { paidThrough: string | null; feeKes: number }) {
  const [hidden, setHidden] = useState(dismissedToday);
  if (!paidThrough || hidden) return null;

  const days = daysUntil(new Date(paidThrough));
  if (days > 7) return null;

  const expired = days < 0;
  const when = formatDate(paidThrough);
  const message = expired
    ? `Your subscription expired on ${when}. Please renew (KES ${feeKes}) to keep your mailbox running. Contact your administrator to pay.`
    : days === 0
      ? `Your subscription renews today. The fee is KES ${feeKes}. Contact your administrator to pay.`
      : `Your subscription renews on ${when}, in ${days} ${days === 1 ? "day" : "days"}. The fee is KES ${feeKes}. Contact your administrator to pay.`;

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, today());
    } catch {
      // Dismissal just won't persist.
    }
    setHidden(true);
  }

  return (
    <div className={`renewal-notice ${expired ? "renewal-notice-expired" : ""}`} role="status">
      <p>{message}</p>
      <button type="button" className="icon-button" title="Dismiss for today" aria-label="Dismiss for today" onClick={dismiss}>
        <X size={16} />
      </button>
    </div>
  );
}
