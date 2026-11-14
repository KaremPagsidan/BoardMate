import { supabase } from '../supabaseClient';

export async function recordActivity(userId, action, details = '') {
  const { error } = await supabase.from('activity_history').insert([{
    user_id: userId,
    action,
    details,
  }]);

  if (error) throw error;
}

export async function fetchActivityHistory(userId) {
  const { data, error } = await supabase
    .from('activity_history')
    .select('id, action, details, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}
