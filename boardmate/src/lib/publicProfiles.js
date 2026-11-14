import { supabase } from '../supabaseClient';

export async function fetchBoardmatePublicProfile(userId) {
  const { data, error } = await supabase.rpc('get_boardmate_public_profile', { p_user_id: userId });
  if (error) throw error;
  if (!data) throw new Error('This profile is unavailable or not visible to your account.');
  return data;
}

export async function fetchBoardmateMessageContact(userId) {
  const { data, error } = await supabase.rpc('get_boardmate_message_contact', { p_contact_id: userId });
  if (error) {
    if (error.code !== 'PGRST202') throw error;

    let profile;
    try {
      profile = await fetchBoardmatePublicProfile(userId);
    } catch (profileError) {
      if (profileError.code === 'PGRST202') {
        throw new Error(
          'Owner messaging is unavailable because the public-profile database migration is missing. Apply the latest Supabase migrations and retry.',
          { cause: profileError },
        );
      }
      throw profileError;
    }
    if (profile.id !== userId) throw new Error('This member is unavailable or messaging is blocked.');
    return {
      userId: profile.id,
      name: profile.fullName || 'BoardMate member',
      avatar: profile.avatarUrl || null,
    };
  }
  const contact = data?.[0];
  if (!contact) throw new Error('This member is unavailable or messaging is blocked.');
  return {
    userId: contact.user_id,
    name: contact.full_name || 'BoardMate member',
    avatar: contact.avatar_url || null,
  };
}
