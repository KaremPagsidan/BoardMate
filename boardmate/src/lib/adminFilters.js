export const propertyTypes = ['Apartment', 'House', 'Condo', 'Dormitory', 'Room', 'Boarding House'];
export const normalize = value => String(value || '').trim().toLowerCase();
export function filterAdminRecords(records, filters = {}, search = '', now = new Date()) {
  return records.filter(record => {
    if (filters.property && normalize(record.property_type) !== normalize(filters.property)) return false;
    if (filters.role && normalize(record.role) !== normalize(filters.role)) return false;
    if (filters.status && normalize(record.moderation_status || record.verification_status || record.status) !== normalize(filters.status)) return false;
    if (filters.action && record.action !== filters.action) return false;
    if (filters.date) {
      const timestamp = Date.parse(record.created_at || record.reviewed_at);
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      if (filters.date === 'week') start.setDate(start.getDate() - 6);
      if (filters.date === 'month') start.setDate(start.getDate() - 29);
      if (!Number.isFinite(timestamp) || timestamp < start.getTime() || timestamp > now.getTime()) return false;
    }
    const term = normalize(search);
    return !term || [record, record.owner, record.reporter, record.reportedUser].filter(Boolean)
      .some(item => Object.values(item).some(value => typeof value !== 'object' && normalize(value).includes(term)));
  });
}
