import SearchBar from './SearchBar';
import { useState } from 'react';
import LocationIcon from './LocationIcon';
import { defaultListingFilters } from '../lib/listingSearch';

const propertyTypes = ['Apartment', 'House', 'Condo', 'Dormitory', 'Room', 'Boarding House'];

export default function ListingSearchDialog({ filters, onChange, locations, onSave, onClose }) {
  const [expanded, setExpanded] = useState('location');
  const [saving, setSaving] = useState(false);

  const update = (key, value) => onChange(current => ({ ...current, [key]: value }));
  const save = async () => {
    setSaving(true);
    try {
      await onSave();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-[#FAF7EE]" role="dialog" aria-modal="true" aria-labelledby="listing-filter-title">
      <section className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3 pt-[max(1rem,env(safe-area-inset-top))]">
          <button type="button" onClick={onClose} aria-label="Close filter search" className="text-xl leading-none text-gray-600">×</button>
          <h2 id="listing-filter-title" className="text-sm font-bold text-gray-800">Filter Search</h2>
          <button type="button" onClick={() => onChange({ ...defaultListingFilters })} className="text-xs font-semibold text-emerald-700">Reset</button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <section className="rounded-xl border border-gray-200 bg-white p-3">
          <button type="button" onClick={() => setExpanded(current => current === 'location' ? null : 'location')} aria-expanded={expanded === 'location'} className="flex w-full items-center justify-between text-xs font-bold text-gray-800">
            <span className="flex items-center gap-2"><LocationIcon className="h-4 w-4" /> Location</span>
            <span>{expanded === 'location' ? '▲' : '❯'}</span>
          </button>
          {expanded === 'location' && (
            <div className="mt-3 space-y-2">
              <SearchBar value={filters.location} onChange={event => update('location', event.target.value)} aria-label="Search filter locations" placeholder="Enter or search a location" />
              <p className="text-[10px] font-bold text-gray-600">Popular Locations</p>
              <div className="flex flex-wrap gap-1.5">
                {locations.length ? locations.map(location => (
                  <button key={location.name} type="button" onClick={() => update('location', location.name)} className={`rounded-md px-2 py-1 text-[9px] ${filters.location === location.name ? 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-500' : 'bg-gray-100 text-gray-700'}`}>
                    {location.name}{location.likes > 0 ? ` · ${location.likes} likes` : ''}
                  </button>
                )) : <span className="text-[10px] text-gray-400">Locations will appear as listings are added.</span>}
              </div>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-3">
          <button type="button" onClick={() => setExpanded(current => current === 'property' ? null : 'property')} aria-expanded={expanded === 'property'} className="flex w-full items-center justify-between text-xs font-bold text-gray-800">
            <span>🏠 Property Type</span><span>{expanded === 'property' ? '▲' : '❯'}</span>
          </button>
          {expanded === 'property' && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {propertyTypes.map(type => (
                <button key={type} type="button" aria-pressed={filters.propertyType === type} onClick={() => update('propertyType', filters.propertyType === type ? '' : type)} className={`min-h-14 rounded-xl border px-1 text-[9px] font-medium ${filters.propertyType === type ? 'border-emerald-500 bg-emerald-50 text-emerald-900' : 'border-gray-200 text-gray-700'}`}>
                  🏢<span className="mt-1 block">{type}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-3">
          <button type="button" onClick={() => setExpanded(current => current === 'price' ? null : 'price')} aria-expanded={expanded === 'price'} className="flex w-full items-center justify-between text-xs font-bold text-gray-800">
            <span>💰 Price Range</span><span>{expanded === 'price' ? '▲' : '❯'}</span>
          </button>
          {expanded === 'price' && (
            <div className="mt-3 space-y-2">
              <div className="flex justify-between text-[10px] font-bold text-gray-700"><span>₱ 0</span><span>₱ {Number(filters.maxPrice).toLocaleString()}{Number(filters.maxPrice) >= 200000 ? '+' : ''}</span></div>
              <input type="range" min="0" max="200000" step="1000" value={filters.maxPrice} onChange={event => update('maxPrice', Number(event.target.value))} aria-label="Maximum price" className="w-full accent-emerald-700" />
              <label className="block text-[10px] text-gray-600">
                Maximum price
                <input type="number" min="0" max="200000" step="1000" value={filters.maxPrice} onChange={event => update('maxPrice', Math.max(0, Math.min(200000, Number(event.target.value) || 0)))} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
              </label>
            </div>
          )}
        </section>
        </div>
        <footer className="shrink-0 border-t border-gray-200 bg-[#FAF7EE] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={save} disabled={saving} className="w-full rounded-xl bg-emerald-700 py-3 text-xs font-bold text-white disabled:opacity-60">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </section>
    </div>
  );
}
