import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterAdminRecords } from '../src/lib/adminFilters.js';
test('filters intersect property, approval, date and search; reset restores all records', () => {
  const records = [
    { id: 1, property_type: 'Apartment', moderation_status: 'approved', created_at: '2026-11-11T01:00:00Z', owner: { full_name: 'Ana' } },
    { id: 2, property_type: 'House', moderation_status: 'rejected', created_at: '2026-10-01T01:00:00Z' },
    { id: 3, property_type: 'apartment', moderation_status: 'rejected', created_at: null },
  ];
  const now = new Date('2026-11-11T12:00:00Z');
  assert.deepEqual(filterAdminRecords(records, { property: 'Apartment', status: 'approved', date: 'week' }, 'ana', now).map(row => row.id), [1]);
  assert.deepEqual(filterAdminRecords(records, { status: 'rejected' }).map(row => row.id), [2, 3]);
  assert.equal(filterAdminRecords(records, { date: 'month' }, '', now).length, 1);
  assert.equal(filterAdminRecords(records, {}).length, 3);
});
