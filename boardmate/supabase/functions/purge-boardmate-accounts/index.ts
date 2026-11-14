import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const purgeSecret = Deno.env.get('PURGE_SECRET');
const storageBuckets = [
  'profile-photos',
  'listing-photos',
  'roommate-post-photos',
  'verification-documents',
  'direct-message-attachments',
  'direct-message-report-evidence',
];

function requiredEnvironmentValue(value: string | undefined, name: string) {
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

async function removeUserPrefix(admin: SupabaseClient, bucket: string, userId: string) {
  const paths: string[] = [];

  async function collectFiles(prefix: string) {
    let offset = 0;
    while (true) {
      const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000, offset });
      if (error) throw new Error(`Could not list ${bucket}/${prefix}: ${error.message}`);

      for (const entry of data) {
        const path = `${prefix}/${entry.name}`;
        if (entry.id) paths.push(path);
        else await collectFiles(path);
      }

      if (data.length < 1000) break;
      offset += data.length;
    }
  }

  await collectFiles(userId);
  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await admin.storage.from(bucket).remove(paths.slice(index, index + 100));
    if (error) throw new Error(`Could not remove files from ${bucket}: ${error.message}`);
  }
}

async function removeConversationAttachments(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin
    .from('direct_messages')
    .select('attachment_path')
    .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
    .not('attachment_path', 'is', null);
  if (error) throw new Error(`Could not load conversation attachments: ${error.message}`);

  const paths = [...new Set(data.map(message => message.attachment_path).filter(Boolean))];
  for (let index = 0; index < paths.length; index += 100) {
    const { error: removeError } = await admin.storage
      .from('direct-message-attachments')
      .remove(paths.slice(index, index + 100));
    if (removeError) throw new Error(`Could not remove conversation attachments: ${removeError.message}`);
  }
}

Deno.serve(async request => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const expectedSecret = requiredEnvironmentValue(purgeSecret, 'PURGE_SECRET');
    if (request.headers.get('x-purge-secret') !== expectedSecret) {
      return new Response('Unauthorized', { status: 401 });
    }

    const admin = createClient(
      requiredEnvironmentValue(supabaseUrl, 'SUPABASE_URL'),
      requiredEnvironmentValue(serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: dueAccounts, error: claimError } = await admin.rpc('claim_due_boardmate_account_deletions');
    if (claimError) throw new Error(`Could not claim due account deletions: ${claimError.message}`);

    const deleted: string[] = [];
    const failures: { userId: string; message: string }[] = [];
    for (const dueAccount of dueAccounts || []) {
      try {
        await removeConversationAttachments(admin, dueAccount.user_id);
        for (const bucket of storageBuckets) {
          await removeUserPrefix(admin, bucket, dueAccount.user_id);
        }

        const { error: deleteError } = await admin.auth.admin.deleteUser(dueAccount.user_id);
        if (deleteError) throw new Error(`Could not delete the Auth account: ${deleteError.message}`);
        deleted.push(dueAccount.user_id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const { error: retryError } = await admin
          .from('boardmate_account_deletion_requests')
          .update({
            status: 'scheduled',
            scheduled_for: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            purge_claimed_at: null,
          })
          .eq('id', dueAccount.request_id)
          .eq('status', 'purging');
        failures.push({
          userId: dueAccount.user_id,
          message: retryError ? `${message}; retry could not be scheduled: ${retryError.message}` : message,
        });
      }
    }

    return Response.json({ deleted: deleted.length, failures });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return Response.json({ error: message }, { status: 500 });
  }
});
