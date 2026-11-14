export default function SidebarDrawer({
  onClose,
  onProfile,
  onSettings,
  onHistory,
  onNotifications,
  onReport,
  onLogout,
  notificationCount,
}) {
  const items = [
    { label: 'Profile Settings', icon: 'fa-regular fa-user', onClick: onProfile },
    { label: 'Settings & Privacy', icon: 'fa-solid fa-gear', onClick: onSettings },
    { label: 'History', icon: 'fa-solid fa-clock-rotate-left', onClick: onHistory },
    { label: 'Notifications', icon: 'fa-regular fa-bell', onClick: onNotifications, notificationCount },
    { label: 'Report a problem', icon: 'fa-solid fa-exclamation', onClick: onReport, alert: true },
  ];

  return (
    <div className="absolute inset-0 z-50 flex bg-black/40">
      <nav className="relative z-50 flex h-full w-[110px] flex-col justify-between border-r border-gray-300 bg-[#FAF6EE] p-4 shadow-xl animate-in slide-in-from-left" aria-label="Account navigation">
        <div className="mt-8 space-y-6 text-center text-xs font-semibold text-gray-700">
          <button type="button" onClick={onClose} aria-label="Close navigation menu" className="absolute right-3 top-3 text-gray-500">×</button>
          {items.map(item => (
            <button
              key={item.label}
              type="button"
              onClick={item.onClick}
              className="relative flex w-full flex-col items-center gap-1.5 transition duration-200 hover:scale-105 hover:text-[#76A77E]"
            >
              <span className={`relative flex h-10 w-10 items-center justify-center rounded-full border border-gray-400 text-lg ${item.alert ? 'border-black bg-black text-white' : ''}`}>
                <i className={item.icon}></i>
                {item.notificationCount > 0 && (
                  <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                    {item.notificationCount > 9 ? '9+' : item.notificationCount}
                  </span>
                )}
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onLogout}
          className="mb-6 flex flex-col items-center gap-1 text-xs font-bold text-gray-800 transition duration-200 hover:scale-105 hover:text-red-600"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-400 bg-gray-200 text-lg">
            <i className="fa-solid fa-right-from-bracket"></i>
          </span>
          <span>Log Out</span>
        </button>
      </nav>
      <button type="button" className="flex-1" aria-label="Close navigation menu" onClick={onClose}></button>
    </div>
  );
}
