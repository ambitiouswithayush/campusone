export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#0f6b66" />
      <circle cx="16" cy="16" r="7" fill="none" stroke="#fff" strokeWidth="2.5" />
      <circle cx="16" cy="16" r="2" fill="#fff" />
    </svg>
  );
}
