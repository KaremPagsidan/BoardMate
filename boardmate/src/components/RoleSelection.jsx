export default function RoleSelection({ mode, onSelectRole, onNavigate }) {
  const isSignUp = mode === 'signup';

  return (
    <div className="flex flex-col items-center h-full justify-center space-y-5">
      <h2 className="text-xl font-bold text-[#2C3E35]">
        {isSignUp ? 'Sign Up' : 'Log In'}
      </h2>
      <p className="text-xs text-gray-500">
        {isSignUp ? 'Select your account type to get started' : 'Choose your login portal'}
      </p>

      <button 
        onClick={() => onSelectRole('RENTER')}
        className="w-full p-4 rounded-2xl bg-white border border-gray-200 flex items-center space-x-4 shadow-sm hover:border-[#76A786] transition"
      >
        <div className="w-12 h-12 rounded-full bg-[#76A786]/20 flex items-center justify-center text-xl">👤</div>
        <div className="text-left">
          <h3 className="font-bold text-[#2C3E35]">User / Renter</h3>
          <p className="text-[11px] text-gray-400">
            {isSignUp ? 'Looking for a boarding house or room' : 'Access your renter dashboard'}
          </p>
        </div>
      </button>

      <button 
        onClick={() => onSelectRole('LANDLORD')}
        className="w-full p-4 rounded-2xl bg-white border border-gray-200 flex items-center space-x-4 shadow-sm hover:border-[#76A786] transition"
      >
        <div className="w-12 h-12 rounded-full bg-[#76A786]/20 flex items-center justify-center text-xl">🏪</div>
        <div className="text-left">
          <h3 className="font-bold text-[#2C3E35]">Owner / Landlord</h3>
          <p className="text-[11px] text-gray-400">
            {isSignUp ? 'List and manage your property' : 'Access your property management'}
          </p>
        </div>
      </button>

      <button
        onClick={() => onSelectRole('ADMIN')}
        className="w-full p-4 rounded-2xl bg-white border border-gray-200 flex items-center space-x-4 shadow-sm hover:border-[#76A786]"
      >
        <div className="w-12 h-12 rounded-full bg-[#76A786]/20 flex items-center justify-center text-xl">🛡️</div>
        <div className="text-left">
          <h3 className="font-bold text-[#2C3E35]">Administrator / Admin</h3>
          <p className="text-[11px] text-gray-400">
            {isSignUp ? 'System administration' : 'Access admin portal'}
          </p>
        </div>
      </button>

      <p className="text-xs text-gray-500 pt-4">
        {isSignUp ? "Already have an account? " : "Don't have an account? "}
        <button 
          onClick={() => onNavigate(isSignUp ? 'role-login' : 'role-signup')} 
          className="text-[#76A786] font-bold"
        >
          {isSignUp ? 'Log in' : 'Sign up'}
        </button>
      </p>
    </div>
  );
}