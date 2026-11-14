/** Small take-a-number ticket used as the brand mark. */
export function TicketMark({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="2" y="7" width="28" height="18" rx="3" fill="var(--amber)" />
      <circle cx="2" cy="16" r="3" fill="var(--ink)" />
      <circle cx="30" cy="16" r="3" fill="var(--ink)" />
      <path d="M21 9v14" stroke="var(--ink)" strokeWidth="1.5" strokeDasharray="2 2" />
    </svg>
  );
}

/** A token code rendered as a ticket stub. */
export function TicketStub({ code, tone = 'paper', size = 'md' }) {
  return (
    <span className={`stub stub-${tone} stub-${size}`}>
      <span className="stub-code">{code}</span>
    </span>
  );
}
