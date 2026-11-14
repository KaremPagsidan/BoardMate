import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { approvalChange, approvalTotals, manilaDate, shiftWeek, weekStart } from '../lib/weeklyStatistics';

const categories = [['accounts', 'Accounts', '#53795a'], ['listings', 'Listings', '#8daa79'], ['posts', 'Roommate posts', '#637ca0']];
const formatDay = value => new Intl.DateTimeFormat('en', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' }).format(new Date(`${value}T00:00:00+08:00`));
export default function WeeklyStatistics() {
  const [week, setWeek] = useState(() => weekStart());
  const [report, setReport] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true, sequence = 0;
    const load = async () => {
      const request = ++sequence;
      setLoading(true);
      try {
        const { data, error: failure } = await supabase.rpc('get_boardmate_weekly_statistics', { p_week: week });
        if (failure) throw failure;
        if (active && request === sequence) { setReport(data); setError(''); }
      } catch (failure) { if (active && request === sequence) setError(failure.code === 'PGRST202' ? 'Weekly history needs the latest database migration. Apply 20261111000006_weekly_approval_history.sql.' : 'Weekly statistics could not be loaded. Please retry.'); }
      finally { if (active && request === sequence) setLoading(false); }
    };
    load();
    const timer = window.setInterval(load, 30000);
    window.addEventListener('focus', load);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', load); };
  }, [week, retry]);
  const currentWeek = weekStart();
  const selected = report?.week === week ? report : null;
  const totals = selected ? approvalTotals(selected.days) : null;
  const max = selected ? Math.max(1, ...selected.trend.flatMap(row => categories.map(([key]) => Number(row[key])))) : 1;
  return <section className="space-y-5" aria-labelledby="weekly-report-title">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><h2 id="weekly-report-title" className="text-xl font-extrabold">Weekly Statistics Reports</h2><p className="text-xs text-gray-500">Monday–Sunday · Asia/Manila · Approval events</p></div>
      <button type="button" disabled={loading} className="rounded-xl border bg-white px-4 py-2 text-xs" onClick={() => setRetry(value => value + 1)}>Refresh</button>
    </header>
    <nav className="flex flex-wrap items-end gap-3" aria-label="Weekly report navigation">
      <label className="text-xs font-semibold">Reporting week<select className="mt-1 block rounded-xl border bg-white p-2" value={week} onChange={event => setWeek(event.target.value)}>{[...new Set([week, ...Array.from({ length: 12 }, (_, index) => shiftWeek(currentWeek, -index))])].sort().reverse().map(value => <option key={value} value={value}>Week of {value}</option>)}</select></label>
      <button type="button" className="rounded-xl bg-white px-4 py-3 text-xs" onClick={() => setWeek(shiftWeek(week, -1))}>← Previous week</button>
      <label className="text-xs font-semibold">Week containing<input type="date" className="mt-1 block rounded-xl border bg-white p-2" value={week} max={manilaDate()} onChange={event => { if (event.target.value) setWeek(weekStart(event.target.value)); }} /></label>
      <button type="button" disabled={week >= currentWeek} className="rounded-xl bg-white px-4 py-3 text-xs disabled:opacity-40" onClick={() => setWeek(shiftWeek(week, 1))}>Next week →</button>
      <button type="button" className="text-xs font-semibold text-emerald-800 underline" onClick={() => setWeek(currentWeek)}>Current week</button>
    </nav>
    {loading && <p role="status" className="text-xs">Loading weekly history…</p>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {selected && <>
      <p className="text-sm font-semibold">Week of {formatDay(week)}, {week.slice(0, 4)}{week === currentWeek ? ' · In progress' : ''}</p>
      <div className="grid gap-3 sm:grid-cols-3">{categories.map(([key, label]) => {
        const previous = Number(selected.previous[key]), change = approvalChange(totals[key], previous);
        return <article key={key} className="rounded-2xl border border-gray-100 bg-white p-4"><h3 className="text-xs text-gray-500">{label}</h3><p className="my-2 text-3xl font-bold">{totals[key]}</p><p className={`text-xs font-semibold ${change.direction === 'increase' ? 'text-emerald-800' : change.direction === 'decrease' ? 'text-amber-800' : 'text-gray-600'}`}>{change.direction === 'increase' ? '↑' : change.direction === 'decrease' ? '↓' : '→'} {change.difference > 0 ? '+' : ''}{change.difference} ({change.label})</p><p className="mt-1 text-xs text-gray-500">Previous week: {previous}</p></article>;
      })}</div>
      <p className="text-xs text-gray-500">{week === currentWeek ? 'This partial week is compared with the full previous week. ' : ''}Past totals include the approvals retained in saved records. Complete event tracking begins {new Date(selected.tracking_started_at).toLocaleDateString('en', { timeZone: 'Asia/Manila' })}.</p>
      <section className="rounded-2xl bg-white p-5" aria-label="Eight-week approval trend"><h3 className="font-bold">Weekly approval trends</h3><div className="my-3 flex flex-wrap gap-4 text-xs">{categories.map(([key, label, color]) => <span key={key}><span style={{ color }}>●</span> {label}</span>)}</div>
        <div className="overflow-x-auto"><div className="flex min-w-[540px] gap-4" role="img" aria-label="Eight weeks of account, listing and roommate post approvals; exact values appear in the table below">{selected.trend.map(row => <div className="flex flex-1 flex-col items-center gap-2" key={row.week}><div className="flex h-36 w-full items-end justify-center gap-1">{categories.map(([key, label, color]) => <div key={key} style={{ background: color, height: `${Number(row[key]) / max * 100}%`, minHeight: 2, width: '25%' }} title={`${formatDay(row.week)}: ${row[key]} ${label}`} />)}</div><span className="text-[10px]">{formatDay(row.week)}</span></div>)}</div></div>
        <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-xs"><caption className="sr-only">Historical weekly approval totals</caption><thead><tr><th className="p-2">Week of</th>{categories.map(([key, label]) => <th className="p-2" key={key}>{label}</th>)}</tr></thead><tbody>{selected.trend.map(row => <tr key={row.week} className="border-t"><th className="p-2">{row.week}</th>{categories.map(([key]) => <td key={key} className="p-2">{row[key]}</td>)}</tr>)}</tbody></table></div>
      </section>
      <section className="rounded-2xl bg-white p-5"><h3 className="mb-3 font-bold">Daily approvals for selected week</h3><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">Date</th>{categories.map(([key,label]) => <th className="p-2" key={key}>{label}</th>)}</tr></thead><tbody>{selected.days.map(day => <tr className="border-t" key={day.day}><th className="p-2">{day.day}</th>{categories.map(([key]) => <td className="p-2" key={key}>{day[key]}</td>)}</tr>)}</tbody></table></div></section>
    </>}
  </section>;
}
