export function manilaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = name => parts.find(value => value.type === name).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function weekStart(value = manilaDate()) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
export function shiftWeek(week, amount) {
  const date = new Date(`${week}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount * 7);
  return date.toISOString().slice(0, 10);
}
export function approvalChange(current, previous) {
  const difference = current - previous;
  return { difference, label: previous ? `${difference > 0 ? '+' : ''}${Math.round(difference / previous * 100)}%` : current ? 'New approvals' : '0%', direction: difference > 0 ? 'increase' : difference < 0 ? 'decrease' : 'unchanged' };
}
export function approvalTotals(days) {
  return days.reduce((total, day) => ({ accounts: total.accounts + Number(day.accounts), listings: total.listings + Number(day.listings), posts: total.posts + Number(day.posts) }), { accounts: 0, listings: 0, posts: 0 });
}
