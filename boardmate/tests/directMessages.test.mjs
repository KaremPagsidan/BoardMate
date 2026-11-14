import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Load the real helpers with an in-memory Supabase adapter. No accounts, network
// calls, database writes, or production credentials are used by these tests.
const source = (await readFile(new URL('../src/lib/directMessages.js', import.meta.url), 'utf8'))
  .replace("import { supabase } from '../supabaseClient';", 'const supabase = globalThis.messageTestClient;')
  .replace("import { fetchBoardmatePresence } from './presence';", 'const fetchBoardmatePresence = async () => new Map();');
let moduleNumber = 0;

function row(id, contact = 'alice', extra = {}) {
  return { id, sender_id: contact, recipient_id: 'me', body: `Message ${id}`,
    created_at: new Date(Date.UTC(2026, 0, 1) + id * 1000).toISOString(), seen_at: null,
    attachment_path: null, attachment_mime: null, deleted_at: null, ...extra };
}

async function fixture(rows, { hidden = [], conversations = [], reactions = [] } = {}) {
  const calls = [];
  const signed = [];
  const tables = {
    direct_messages: rows,
    direct_message_hidden_conversations: conversations.map(value => ({ user_id: 'me', ...value })),
    direct_message_user_deletions: hidden.map(message_id => ({ user_id: 'me', message_id })),
    direct_message_reactions: reactions,
  };
  const client = {
    rpc: async () => ({ data: ['alice', 'bob', 'me'].map(user_id => ({ user_id, full_name: user_id })), error: null }),
    storage: { from: () => ({ createSignedUrl: async path => {
      signed.push(path);
      return { data: { signedUrl: `signed:${path}` }, error: null };
    } }) },
    from(table) {
      const filters = [];
      const orders = [];
      let limit = Infinity;
      const query = {
        select() { return this; },
        eq(column, value) { filters.push(valueRow => valueRow[column] === value); return this; },
        gt(column, value) { filters.push(valueRow => valueRow[column] > value); return this; },
        in(column, values) { filters.push(valueRow => values.includes(valueRow[column])); return this; },
        or(expression) {
          if (expression.startsWith('created_at.lt.')) {
            const [, timestamp, id] = expression.match(/^created_at\.lt\.(.*),and\(created_at\.eq\..*,id\.lt\.(\d+)\)$/);
            filters.push(value => value.created_at < timestamp || (value.created_at === timestamp && BigInt(value.id) < BigInt(id)));
          } else if (expression.startsWith('and(')) {
            const [, user, contact] = expression.match(/^and\(sender_id\.eq\.([^,]+),recipient_id\.eq\.([^)]+)\)/);
            filters.push(value => (value.sender_id === user && value.recipient_id === contact)
              || (value.sender_id === contact && value.recipient_id === user));
          } else {
            const user = expression.match(/^sender_id\.eq\.([^,]+)/)[1];
            filters.push(value => value.sender_id === user || value.recipient_id === user);
          }
          return this;
        },
        order(column, options) { orders.push([column, options.ascending]); return this; },
        limit(value) { limit = value; return this; },
        then(resolve, reject) {
          calls.push({ table, limit, orders });
          const data = tables[table].filter(value => filters.every(filter => filter(value))).sort((a, b) => {
            for (const [column, ascending] of orders) {
              const result = a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0;
              if (result) return ascending ? result : -result;
            }
            return 0;
          }).slice(0, limit);
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  globalThis.messageTestClient = client;
  const api = await import(`data:text/javascript;base64,${Buffer.from(source + `\n// fixture ${moduleNumber++}`).toString('base64')}`);
  delete globalThis.messageTestClient;
  return { api, calls, signed, tables };
}

test('latest history beyond 500 and all older pages have no omissions or duplicates', async () => {
  const { api } = await fixture(Array.from({ length: 653 }, (_, index) => row(index + 1)));
  let page = await api.fetchDirectConversationPage('me', 'alice');
  assert.deepEqual(page.messages.map(value => value.id), Array.from({ length: 50 }, (_, index) => index + 604));
  let ids = page.messages.map(value => value.id);
  while (page.hasOlder) {
    page = await api.fetchDirectConversationPage('me', 'alice', { before: page.cursor });
    ids = [...page.messages.map(value => value.id), ...ids];
  }
  assert.deepEqual(ids, Array.from({ length: 653 }, (_, index) => index + 1));
});

test('cursor survives equal timestamps and new messages between pages', async () => {
  const timestamp = row(1).created_at;
  const rows = Array.from({ length: 120 }, (_, index) => row(index + 1, 'alice', { created_at: timestamp }));
  const { api } = await fixture(rows);
  const first = await api.fetchDirectConversationPage('me', 'alice');
  rows.push(row(121, 'alice', { created_at: timestamp }));
  const older = await api.fetchDirectConversationPage('me', 'alice', { before: first.cursor });
  assert.deepEqual(older.messages.map(value => value.id), Array.from({ length: 50 }, (_, index) => index + 21));
  const refreshed = await api.fetchDirectConversation('me', 'alice', { through: older.cursor });
  assert.deepEqual(refreshed.messages.map(value => value.id), Array.from({ length: 101 }, (_, index) => index + 21));
  const repeated = await api.fetchDirectConversation('me', 'alice', { through: refreshed.cursor });
  assert.deepEqual(repeated.messages, refreshed.messages);
});

test('hidden messages fill pages and a deleted conversation never restores old history', async () => {
  const { api } = await fixture(Array.from({ length: 160 }, (_, index) => row(index + 1)), {
    hidden: Array.from({ length: 70 }, (_, index) => index + 91),
    conversations: [{ contact_id: 'alice', hidden_at: row(30).created_at }],
  });
  const first = await api.fetchDirectConversationPage('me', 'alice');
  assert.deepEqual(first.messages.map(value => value.id), Array.from({ length: 50 }, (_, index) => index + 41));
  const older = await api.fetchDirectConversationPage('me', 'alice', { before: first.cursor });
  assert.deepEqual(older.messages.map(value => value.id), Array.from({ length: 10 }, (_, index) => index + 31));
  assert.equal(older.hasOlder, false);
});

test('inbox counts all unread messages and orders contacts by their latest visible message', async () => {
  const rows = Array.from({ length: 650 }, (_, index) => row(index + 1));
  rows.push(row(651, 'bob'), row(652, 'bob'), row(653, 'bob'));
  const { api, signed, calls } = await fixture(rows, {
    hidden: [650, 653],
    conversations: [{ contact_id: 'bob', hidden_at: row(651).created_at }],
  });
  const inbox = await api.fetchDirectInbox('me');
  assert.deepEqual(inbox.map(value => value.userId), ['bob', 'alice']);
  assert.equal(inbox[0].lastMessage, 'Message 652');
  assert.equal(inbox[0].unreadCount, 1);
  assert.equal(inbox[1].lastMessage, 'Message 649');
  assert.equal(inbox[1].unreadCount, 649);
  assert.equal(inbox[1].incomingCount, 649);
  assert.equal(signed.length, 0);
  assert.ok(calls.filter(value => value.table === 'direct_messages').every(value => value.limit === 250));
});

test('refresh retains loaded history while reflecting hides, unsends, reactions, attachments and seen state', async () => {
  const rows = Array.from({ length: 120 }, (_, index) => row(index + 1));
  const { api, tables, signed } = await fixture(rows);
  const first = await api.fetchDirectConversationPage('me', 'alice');
  const older = await api.fetchDirectConversationPage('me', 'alice', { before: first.cursor });
  tables.direct_message_user_deletions.push({ user_id: 'me', message_id: 25 });
  Object.assign(rows[29], { deleted_at: row(121).created_at, body: null });
  Object.assign(rows[30], { attachment_path: 'alice/me/photo.jpg', attachment_mime: 'image/jpeg', seen_at: row(122).created_at });
  tables.direct_message_reactions.push({ message_id: 32, user_id: 'me', reaction: 'like' });
  rows.push(row(121));
  const refreshed = await api.fetchDirectConversation('me', 'alice', { through: older.cursor });
  assert.equal(refreshed.messages[0].id, 21);
  assert.equal(refreshed.messages.at(-1).id, 121);
  assert.equal(refreshed.messages.some(value => value.id === 25), false);
  assert.equal(refreshed.messages.find(value => value.id === 30).text, 'This message was unsent.');
  assert.equal(refreshed.messages.find(value => value.id === 31).attachmentUrl, 'signed:alice/me/photo.jpg');
  assert.equal(refreshed.messages.find(value => value.id === 31).seenAt, row(122).created_at);
  assert.equal(refreshed.messages.find(value => value.id === 32).reactions[0].isMine, true);
  assert.ok(signed.length > 0);
});

test('empty and self conversations work with the same pagination', async () => {
  const { api } = await fixture([row(1, 'me', { recipient_id: 'me', is_forwarded: true })]);
  assert.deepEqual((await api.fetchDirectConversationPage('me', 'alice')).messages, []);
  const self = await api.fetchDirectConversationPage('me', 'me');
  assert.equal(self.messages[0].sender, 'me');
  assert.equal(self.hasOlder, false);
  const inbox = await api.fetchDirectInbox('me');
  assert.equal(inbox[0].name, 'You');
  assert.equal(inbox[0].unreadCount, 0);
});

test('audio/video attachment URLs remain stable across polling, expire safely, and disappear when unsent', async () => {
  const rows = [row(1, 'alice', { attachment_path: 'alice/me/audio.mp3', attachment_mime: 'audio/mpeg' })];
  const { api, signed } = await fixture(rows);
  const realNow = Date.now;
  let clock = realNow();
  Date.now = () => clock;
  try {
    const first = await api.fetchDirectConversationPage('me', 'alice');
    for (let i = 0; i < 4; i += 1) {
      clock += 5000;
      const refreshed = await api.fetchDirectConversationPage('me', 'alice');
      assert.equal(refreshed.messages[0].attachmentUrl, first.messages[0].attachmentUrl);
    }
    assert.equal(signed.length, 1);
    clock += 51 * 60 * 1000;
    await api.fetchDirectConversationPage('me', 'alice');
    assert.equal(signed.length, 2);
    rows[0].deleted_at = new Date(clock).toISOString();
    const unsent = await api.fetchDirectConversationPage('me', 'alice');
    assert.equal(unsent.messages[0].attachmentUrl, null);
    assert.equal(signed.length, 2);
  } finally { Date.now = realNow; }
});

test('history request coordination coalesces refreshes and retains the older-page cursor', async () => {
  const { api } = await fixture(Array.from({ length: 160 }, (_, index) => row(index + 1)));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let windowCalls = 0;
  globalThis.historyTestApi = {
    fetchWindow: async (...args) => {
      windowCalls += 1;
      await gate;
      return api.fetchDirectConversation(...args);
    },
    fetchDirectConversationPage: api.fetchDirectConversationPage,
  };
  // Minimal hook primitives exercise async coordination without a browser.
  const hookSource = (await readFile(new URL('../src/hooks/useMessageHistory.js', import.meta.url), 'utf8'))
    .replace("import { useCallback, useRef, useState } from 'react';", `
      const useCallback = fn => fn;
      const useRef = current => ({ current });
      const useState = initial => { let value = initial; return [value, update => { value = update(value); }]; };`)
    .replace("import { fetchDirectConversation as fetchWindow, fetchDirectConversationPage } from '../lib/directMessages';",
      'const { fetchWindow, fetchDirectConversationPage } = globalThis.historyTestApi;');
  const { default: useHistory } = await import(`data:text/javascript;base64,${Buffer.from(hookSource).toString('base64')}`);
  delete globalThis.historyTestApi;
  const history = useHistory();
  const first = history.fetchDirectConversation('me', 'alice');
  assert.equal(history.fetchDirectConversation('me', 'alice'), first);
  const older = history.fetchDirectConversation('me', 'alice', { older: true });
  release();
  assert.equal((await first).length, 50);
  assert.equal((await older).length, 100);
  const refreshed = await history.fetchDirectConversation('me', 'alice');
  assert.equal(refreshed.length, 100);
  assert.equal(refreshed[0].id, 61);
  assert.equal(windowCalls, 3);
});
