import ImageUploadInput from './ImageUploadInput';
import BoardMateHouseIcon from './BoardMateHouseIcon';

export default function Step2Verification({ onSetIdFile, onSetSelfieFile, onNext, onBack }) {
  return (
    <div className="space-y-4">
      {/* Header Logo */}
      <div className="w-full flex items-center justify-center gap-2 mb-2">
        <BoardMateHouseIcon className="h-8 w-8 text-[#76A77E]" />
        <span className="text-xl font-serif font-bold text-[#1E2923]">
          Board<span className="text-[#76A77E]">Mate</span>
        </span>
      </div>
      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-center text-emerald-800">
        We need to verify your identity. Please upload a valid ID and a clear selfie.
      </div>

      <div className="border-2 border-dashed border-gray-300 rounded-2xl p-4 text-center bg-white">
        <p className="text-xs font-bold text-gray-700 mb-1">1. Upload a valid ID</p>
        <p className="text-[10px] text-gray-400 mb-3">Accepted: Passport, Driver's License, UMID, National ID</p>
        <ImageUploadInput 
          type="file" 
          accept="image/*"
          onChange={(e) => onSetIdFile(e.target.files[0])}
          className="text-xs text-gray-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:bg-[#76A786] file:text-white file:font-semibold"
        />
      </div>

      <div className="border-2 border-dashed border-gray-300 rounded-2xl p-4 text-center bg-white">
        <p className="text-xs font-bold text-gray-700 mb-1">2. Take a selfie</p>
        <p className="text-[10px] text-gray-400 mb-3">Ensure good lighting and remove glasses/mask</p>
        <ImageUploadInput 
          type="file" 
          accept="image/*"
          onChange={(e) => onSetSelfieFile(e.target.files[0])}
          className="text-xs text-gray-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:bg-[#76A786] file:text-white file:font-semibold"
        />
      </div>

      <div className="flex space-x-2 pt-2">
        <button onClick={onBack} className="w-1/3 py-3 rounded-2xl bg-gray-200 text-gray-700 font-bold text-xs">Back</button>
        <button onClick={onNext} className="w-2/3 py-3 rounded-2xl bg-[#76A786] text-white font-bold text-xs shadow-md">Next ➔</button>
      </div>
    </div>
  );
}