import { useState } from 'react';
import BoardMateHouseIcon from './BoardMateHouseIcon';

export default function WelcomeScreen({ onStart }) {
  const [isStarting, setIsStarting] = useState(false);

  const handleStart = () => {
    if (isStarting) return;

    setIsStarting(true);
    window.setTimeout(onStart, 500);
  };

  return (
    <button
      type="button"
      onClick={handleStart}
      disabled={isStarting}
      aria-label="Tap anywhere to get started"
      className={`relative flex min-h-0 w-full flex-1 cursor-pointer flex-col items-center justify-center overflow-hidden bg-[#76A77E] p-4 text-center select-none focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-[-8px] focus-visible:outline-[#FAF6EE] ${isStarting ? 'splash-starting' : ''}`}
    >
      <div className="splash-card flex w-[56%] max-w-[240px] flex-col items-center rounded-[28px] bg-[#FAF6EE] px-4 py-5 shadow-lg">
        <BoardMateHouseIcon className="splash-logo mb-3 h-16 w-16 text-[#6D9675]" />
        <h1 className="whitespace-nowrap font-serif text-2xl font-bold text-[#1F2923]">
          Board<span className="text-[#76A77E]">Mate</span>
        </h1>
        <p className="mt-1 text-[11px] font-medium text-gray-500">
          Tap anywhere to get started
        </p>
      </div>
      <span className="absolute bottom-5 text-[10px] font-medium text-[#436D4C]/60">
        BoardMate App
      </span>
    </button>
  );
}
