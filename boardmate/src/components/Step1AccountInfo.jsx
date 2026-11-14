import BoardMateHouseIcon from './BoardMateHouseIcon';

export default function Step1AccountInfo({ role, formData, onChange, onNext }) {
  return (
    <div className="space-y-3">
      {/* Header Logo */}
      <div className="w-full flex items-center justify-center gap-2 mb-2">
        <BoardMateHouseIcon className="h-8 w-8 text-[#76A77E]" />
        <span className="text-xl font-serif font-bold text-[#1E2923]">
          Board<span className="text-[#76A77E]">Mate</span>
        </span>
      </div>
      <div>
        <label className="text-[11px] font-semibold text-gray-600 block mb-0.5">Full Name</label>
        <input type="text" name="fullName" placeholder="Enter your Full Name" value={formData.fullName} onChange={onChange} className="w-full px-3 py-2.5 text-xs rounded-xl bg-white border border-gray-300 focus:outline-none focus:border-[#76A786]" />
      </div>

      <div>
        <label className="text-[11px] font-semibold text-gray-600 block mb-0.5">Email Address</label>
        <input type="email" name="email" placeholder="Enter your Email Address" value={formData.email} onChange={onChange} className="w-full px-3 py-2.5 text-xs rounded-xl bg-white border border-gray-300 focus:outline-none focus:border-[#76A786]" />
      </div>

      <div>
        <label className="text-[11px] font-semibold text-gray-600 block mb-0.5">Phone Number</label>
        <input type="text" name="phone" placeholder="09xx xxx xxxx" value={formData.phone} onChange={onChange} className="w-full px-3 py-2.5 text-xs rounded-xl bg-white border border-gray-300 focus:outline-none focus:border-[#76A786]" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[11px] font-semibold text-gray-600 block mb-0.5">Password</label>
          <input type="password" name="password" placeholder="Create Password" value={formData.password} onChange={onChange} className="w-full px-3 py-2.5 text-xs rounded-xl bg-white border border-gray-300 focus:outline-none focus:border-[#76A786]" />
        </div>
        <div>
          <label className="text-[11px] font-semibold text-gray-600 block mb-0.5">Confirm Password</label>
          <input type="password" name="confirmPassword" placeholder="Confirm Password" value={formData.confirmPassword} onChange={onChange} className="w-full px-3 py-2.5 text-xs rounded-xl bg-white border border-gray-300 focus:outline-none focus:border-[#76A786]" />
        </div>
      </div>

      {role === 'LANDLORD' && (
        <>
          <div>
            <label className="text-[11px] font-semibold text-gray-600 block mb-0.5">Business / Owner Name</label>
            <input type="text" name="businessName" placeholder="Enter Business Name" value={formData.businessName} onChange={onChange} className="w-full px-3 py-2.5 text-xs rounded-xl bg-white border border-gray-300 focus:outline-none focus:border-[#76A786]" />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-gray-600 block mb-0.5">Address</label>
            <input type="text" name="address" placeholder="Enter Complete Address" value={formData.address} onChange={onChange} className="w-full px-3 py-2.5 text-xs rounded-xl bg-white border border-gray-300 focus:outline-none focus:border-[#76A786]" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-semibold text-gray-600 block mb-0.5">Government ID No.</label>
              <input type="text" name="govtIdNumber" placeholder="Enter ID Number" value={formData.govtIdNumber} onChange={onChange} className="w-full px-3 py-2.5 text-xs rounded-xl bg-white border border-gray-300 focus:outline-none focus:border-[#76A786]" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-gray-600 block mb-0.5">Property Type</label>
              <select name="propertyType" value={formData.propertyType} onChange={onChange} className="w-full px-3 py-2.5 text-xs rounded-xl bg-white border border-gray-300 focus:outline-none focus:border-[#76A786]">
                <option>Apartment</option>
                <option>Boarding House</option>
                <option>Dormitory</option>
              </select>
            </div>
          </div>
        </>
      )}

      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] text-emerald-800 flex items-start space-x-2 mt-2">
        <span>🛡️</span>
        <p>Why do we need this? This helps us verify your identity and ensure trust on our platform.</p>
      </div>

      <button 
        onClick={onNext}
        className="w-full py-3 rounded-2xl bg-[#76A786] text-white font-bold text-sm shadow-md hover:bg-[#659374] transition mt-2"
      >
        Next ➔
      </button>
    </div>
  );
}