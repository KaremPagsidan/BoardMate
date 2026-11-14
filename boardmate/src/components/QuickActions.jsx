export default function QuickActions({ variant = 'owner', children }) {
  return <div className={variant === 'renter'
    ? 'boardmate-quick-actions boardmate-renter-actions grid grid-cols-6 gap-2'
    : 'boardmate-quick-actions grid grid-cols-2 gap-2'}>{children}</div>;
}
