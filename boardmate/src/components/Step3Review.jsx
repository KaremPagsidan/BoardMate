import BoardMateHouseIcon from './BoardMateHouseIcon';

export default function Step3Review({ role, formData, idFile, selfieFile, onSubmit, loading, onBack }) {
  return (
    <div className="space-y-4">
      {/* Header Logo */}
      <div className="w-full flex items-center justify-center gap-2 mb-2">
        <BoardMateHouseIcon className="h-8 w-8 text-[#76A77E]" />
        <span className="text-xl font-serif font-bold text-[#1E2923]">
          Board<span className="text-[#76A77E]">Mate</span>
        </span>
      </div>
      <div className="bg-white p-4 rounded-2xl border border-gray-200 text-xs space-y-2">
        <h3 className="font-bold text-[#2C3E35] border-b pb-1">Account Information</h3>
        <p><span className="text-gray-400">Full Name:</span> {formData.fullName || 'N/A'}</p>
        <p><span className="text-gray-400">Email:</span> {formData.email || 'N/A'}</p>
        <p><span className="text-gray-400">Phone:</span> {formData.phone || 'N/A'}</p>
        {role === 'LANDLORD' && (
          <>
            <p><span className="text-gray-400">Business:</span> {formData.businessName || 'N/A'}</p>
            <p><span className="text-gray-400">Address:</span> {formData.address || 'N/A'}</p>
          </>
        )}

        <h3 className="font-bold text-[#2C3E35] border-b pt-2 pb-1">Verification Documents</h3>
        <p><span className="text-gray-400">Valid ID:</span> {idFile ? idFile.name : 'Uploaded'}</p>
        <p><span className="text-gray-400">Selfie:</span> {selfieFile ? selfieFile.name : 'Uploaded'}</p>
      </div>

      <button 
        onClick={onSubmit}
        disabled={loading}
        className="w-full py-3.5 rounded-2xl bg-[#76A786] text-white font-bold text-sm shadow-md hover:bg-[#659374] transition"
      >
        {loading ? 'Submitting...' : 'Submit Registration'}
      </button>

      <button onClick={onBack} className="w-full py-2 text-xs text-gray-500 text-center">Back to Verification</button>
    </div>
  );
}