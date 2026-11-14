export default function AppViewport({ children }) {
  return <div className="boardmate-viewport flex min-h-dvh w-full items-center justify-center bg-[#1E293B] p-0 sm:p-4 md:p-6">
    <div className="boardmate-app-shell relative flex min-h-0 w-full flex-col overflow-hidden bg-[#F8F6F0] font-sans text-gray-800">{children}</div>
  </div>;
}
