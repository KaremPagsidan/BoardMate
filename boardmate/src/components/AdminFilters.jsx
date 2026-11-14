import { normalize, propertyTypes } from '../lib/adminFilters';
export default function AdminFilters({ tab, records, filters, onChange }) {
  const unique = key => [...new Set(records.map(record => normalize(record[key])).filter(Boolean))].sort();
  const fields = [];
  if (['listings', 'accommodations'].includes(tab)) fields.push(['property', 'Property type', propertyTypes]);
  if (['users', 'verifications', 'roommates', 'user_posts'].includes(tab)) fields.push(['role', 'Role', unique('role')]);
  if (tab === 'activity') fields.push(['action', 'Action', [...new Set(records.map(record => record.action).filter(Boolean))].sort()]);
  else if (tab !== 'dashboard') fields.push(['status', 'Approval / status', unique(['users', 'verifications'].includes(tab) ? 'verification_status' : tab === 'safety' ? 'status' : 'moderation_status')]);
  fields.push(['date', 'Date submitted', [['today', 'Today'], ['week', 'Last 7 days'], ['month', 'Last 30 days']]]);
  return <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-3" aria-label="Section filters">
    {fields.map(([key, label, options]) => <label key={key} className="text-[10px] font-bold text-gray-600">{label}<select className="mt-1 block rounded-lg border border-gray-200 bg-white p-2 text-xs" value={filters[key] || ''} onChange={event => onChange({ ...filters, [key]: event.target.value })}><option value="">All</option>{options.map(option => { const [value, title] = Array.isArray(option) ? option : [option, option.replaceAll('_', ' ')]; return <option key={value} value={value}>{title}</option>; })}</select></label>)}
    <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold" onClick={() => onChange({})}>Reset filters</button>
  </div>;
}
