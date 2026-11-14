export default function VerifiedBadge({ className = '' }) {
  return (
    <span
      role="img"
      aria-label="Verified account"
      title="Verified account"
      className={`inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#2D8A57] text-[10px] font-bold leading-none text-white ring-2 ring-white ${className}`}
    >
      ✓
    </span>
  );
}
