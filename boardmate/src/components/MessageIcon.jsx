export default function MessageIcon({ className = '' }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M16 4C8.82 4 3 8.93 3 15c0 3.28 1.7 6.22 4.4 8.17L6 28l6.16-2.37c1.22.36 2.5.54 3.84.54 7.18 0 13-4.92 13-11S23.18 4 16 4Z" />
      <circle cx="10" cy="15" r="1" fill="currentColor" />
      <circle cx="16" cy="15" r="1" fill="currentColor" />
      <circle cx="22" cy="15" r="1" fill="currentColor" />
    </svg>
  );
}
