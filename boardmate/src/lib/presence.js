import { supabase } from '../supabaseClient';

export async function publishBoardmatePresence(userId) {
  if (!userId) return;
  const { error } = await supabase.rpc('publish_boardmate_presence');
  if (error) throw error;
}

export async function fetchBoardmatePresence(userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const { data, error } = await supabase
    .from('boardmate_presence')
    .select('user_id, last_seen_at')
    .in('user_id', ids);
  if (error) throw error;
  return new Map(data.map(row => [row.user_id, row.last_seen_at]));
}
