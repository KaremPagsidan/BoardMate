import { supabase } from '../supabaseClient';

export const defaultAccountPreferences = {
  is_active: true,
  show_profile: true,
  show_active_status: true,
  search_location: '',
  search_property_type: '',
  search_max_price: 200000,
};

export async function fetchAccountPreferences(userId) {
  try {
    const { data, error } = await supabase
      .from('boardmate_account_preferences')
      .select('is_active, show_profile, show_active_status, search_location, search_property_type, search_max_price')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      if (error.message?.includes('schema cache') || error.code === '42P01' || error.message?.includes('does not exist')) {
        return defaultAccountPreferences;
      }
      throw error;
    }
    return { ...defaultAccountPreferences, ...data };
  } catch (err) {
    if (err.message?.includes('schema cache') || err.code === '42P01' || err.message?.includes('does not exist')) {
      return defaultAccountPreferences;
    }
    throw err;
  }
}

export async function saveAccountPreferences(userId, preferences) {
  const { error } = await supabase
    .from('boardmate_account_preferences')
    .upsert({ user_id: userId, ...preferences, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}

export async function saveSearchPreferences(userId, filters) {
  try {
    const { error } = await supabase
      .from('boardmate_account_preferences')
      .upsert({
        user_id: userId,
        search_location: filters.location,
        search_property_type: filters.propertyType,
        search_max_price: filters.maxPrice,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    if (error) {
      if (error.message?.includes('schema cache') || error.code === '42P01' || error.message?.includes('does not exist')) {
        return;
      }
      throw error;
    }
  } catch (err) {
    if (err.message?.includes('schema cache') || err.code === '42P01' || err.message?.includes('does not exist')) {
      return;
    }
    throw err;
  }
}

export async function submitProblemReport(userId, category, details) {
  const { data, error } = await supabase
    .from('boardmate_problem_reports')
    .insert({ user_id: userId, category, details: details.trim() })
    .select('id, category, details, status, admin_note, created_at')
    .single();
  if (error) throw error;
  return data;
}

export async function fetchProblemReports(userId) {
  const { data, error } = await supabase
    .from('boardmate_problem_reports')
    .select('id, category, details, status, admin_note, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function fetchMyReports(userId) {
  const [problemReportsResult, conversationReportsResult] = await Promise.all([
    supabase
      .from('boardmate_problem_reports')
      .select('id, category, details, status, admin_note, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    supabase
      .from('direct_message_reports')
      .select('id, category, reason, status, resolution_note, created_at')
      .eq('reporter_id', userId)
      .order('created_at', { ascending: false }),
  ]);
  if (problemReportsResult.error) throw problemReportsResult.error;
  if (conversationReportsResult.error) throw conversationReportsResult.error;

  return [
    ...problemReportsResult.data.map(report => ({
      ...report,
      reportId: `problem-${report.id}`,
      status: report.status === 'open' ? 'pending' : report.status,
    })),
    ...conversationReportsResult.data.map(report => ({
      id: report.id,
      reportId: `conversation-${report.id}`,
      category: report.category,
      details: report.reason,
      status: report.status === 'open' ? 'pending' : report.status,
      admin_note: report.resolution_note,
      created_at: report.created_at,
    })),
  ].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
}

export async function fetchDeletionRequest(userId) {
  const { data, error } = await supabase
    .from('boardmate_account_deletion_requests')
    .select('id, status, created_at, scheduled_for')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function submitAccountDeletionRequest(userId) {
  const { error } = await supabase.rpc('schedule_boardmate_account_deletion');
  if (error) throw error;
  return fetchDeletionRequest(userId);
}

export async function cancelAccountDeletion() {
  const { data, error } = await supabase.rpc('cancel_boardmate_account_deletion');
  if (error) throw error;
  return data;
}
