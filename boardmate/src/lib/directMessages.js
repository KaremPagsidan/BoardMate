import { supabase } from '../supabaseClient';
import { fetchBoardmatePresence } from './presence';

const attachmentBucket = 'direct-message-attachments';
const reportEvidenceBucket = 'direct-message-report-evidence';
const directMessageColumns = 'id, sender_id, recipient_id, body, created_at, seen_at, attachment_path, attachment_mime, attachment_name, deleted_at, is_forwarded';
const maxAttachmentSize = 20 * 1024 * 1024;
// Polling must not replace a playing element's src every few seconds.
const attachmentUrls = new Map();
async function messageAttachmentUrl(path, userId) {
  const key = `${userId}:${path}`;
  const existing = attachmentUrls.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing.promise;
  const entry = { expiresAt: Date.now() + 50 * 60 * 1000 };
  entry.promise = supabase.storage.from(attachmentBucket).createSignedUrl(path, 3600).then(({ data, error }) => {
    if (error) throw error;
    return data.signedUrl;
  }).catch(error => { if (attachmentUrls.get(key) === entry) attachmentUrls.delete(key); throw error; });
  attachmentUrls.set(key, entry);
  if (attachmentUrls.size > 1000) attachmentUrls.delete(attachmentUrls.keys().next().value);
  return entry.promise;
}
const allowedAttachmentTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
  'audio/aac',
]);

async function mapDirectMessage(message, userId) {
  let attachmentUrl = null;
  if (message.attachment_path && !message.deleted_at) {
    attachmentUrl = await messageAttachmentUrl(message.attachment_path, userId);
  }

  return {
    id: message.id,
    sender: message.sender_id === userId ? 'me' : 'them',
    text: message.deleted_at ? 'This message was unsent.' : message.body,
    createdAt: message.created_at,
    seenAt: message.seen_at,
    attachmentUrl,
    attachmentPath: message.attachment_path,
    attachmentMime: message.deleted_at ? null : message.attachment_mime,
    attachmentName: message.attachment_name,
    deletedAt: message.deleted_at,
    isForwarded: message.is_forwarded || false,
    reactions: [],
    image: message.attachment_mime?.startsWith('image/') ? attachmentUrl : null,
  };
}

async function fetchHiddenMessageIds(userId, messageIds) {
  if (!messageIds.length) return new Set();
  const { data, error } = await supabase
    .from('direct_message_user_deletions')
    .select('message_id')
    .eq('user_id', userId)
    .in('message_id', messageIds);
  if (error) throw error;
  return new Set(data.map(row => row.message_id));
}

async function attachMessageReactions(messages, userId) {
  if (!messages.length) return messages;
  const { data, error } = await supabase
    .from('direct_message_reactions')
    .select('message_id, user_id, reaction')
    .in('message_id', messages.map(message => message.id));
  if (error) throw error;

  const reactionsByMessage = new Map();
  data.forEach(reaction => {
    const reactions = reactionsByMessage.get(reaction.message_id) || [];
    reactions.push({
      reaction: reaction.reaction,
      userId: reaction.user_id,
      isMine: reaction.user_id === userId,
    });
    reactionsByMessage.set(reaction.message_id, reactions);
  });
  return messages.map(message => ({
    ...message,
    reactions: reactionsByMessage.get(message.id) || [],
  }));
}

async function fetchHiddenConversations(userId) {
  const { data, error } = await supabase
    .from('direct_message_hidden_conversations')
    .select('contact_id, hidden_at')
    .eq('user_id', userId);
  if (error) throw error;
  return new Map(data.map(conversation => [conversation.contact_id, conversation.hidden_at]));
}

function isAfterHiddenAt(message, hiddenAt) {
  return !hiddenAt || message.created_at > hiddenAt;
}

const messagePageSize = 50;

function messageCursor(message) {
  return { createdAt: message.created_at, id: message.id };
}

function beforeCursor(query, cursor) {
  return cursor
    ? query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`)
    : query;
}

// Apply both order fields everywhere: timestamps alone are not unique.
function newestFirst(query, size) {
  return query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(size);
}

export async function fetchDirectInbox(userId) {
  const [contactsResult, hiddenConversations] = await Promise.all([
    supabase.rpc('get_boardmate_message_contacts'),
    fetchHiddenConversations(userId),
  ]);
  if (contactsResult.error) throw contactsResult.error;

  const contactIds = contactsResult.data.map(contact => contact.user_id);
  const presenceByUserId = await fetchBoardmatePresence(contactIds);
  const conversations = new Map(contactsResult.data.map(contact => [contact.user_id, {
    id: contact.user_id,
    userId: contact.user_id,
    name: contact.user_id === userId ? 'You' : contact.full_name || 'BoardMate member',
    avatar: contact.avatar_url,
    messages: [],
    unreadCount: 0,
    incomingCount: 0,
    lastMessage: '',
    lastSeenAt: presenceByUserId.get(contact.user_id) || null,
  }]));

  // Scan metadata in bounded pages so previews/counts cover every contact and
  // every unread message, independently of the open conversation's history.
  let cursor = null;
  while (true) {
    const { data, error } = await newestFirst(beforeCursor(supabase
      .from('direct_messages')
      .select('id, sender_id, recipient_id, body, created_at, seen_at, attachment_mime, deleted_at')
      .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`), cursor), 250);
    if (error) throw error;
    if (!data.length) break;
    const hiddenIds = await fetchHiddenMessageIds(userId, data.map(message => message.id));
    for (const row of data) {
      const contactId = row.sender_id === userId ? row.recipient_id : row.sender_id;
      const conversation = conversations.get(contactId);
      if (!conversation || hiddenIds.has(row.id) || !isAfterHiddenAt(row, hiddenConversations.get(contactId))) continue;
      if (row.sender_id !== userId) {
        conversation.incomingCount += 1;
        if (!row.seen_at) conversation.unreadCount += 1;
      }
      if (conversation.messages.length) continue;
      // Inbox previews need neither attachment URLs nor reactions.
      const message = {
        id: row.id,
        createdAt: row.created_at,
        sender: row.sender_id === userId ? 'me' : 'them',
        seenAt: row.seen_at,
        text: row.deleted_at ? 'This message was unsent.' : row.body,
        deletedAt: row.deleted_at,
        attachmentMime: row.attachment_mime,
        reactions: [],
      };
      conversation.messages.push(message);
      conversation.lastMessage = row.deleted_at ? 'Message unsent' : row.body || (row.attachment_mime?.startsWith('video/') ? 'Video' : row.attachment_mime?.startsWith('audio/') ? 'Audio' : 'Photo');
    }
    cursor = messageCursor(data.at(-1));
  }

  return [...conversations.values()]
    .filter(conversation => conversation.messages.length > 0)
    .sort((first, second) => {
    const firstDate = first.messages.at(-1)?.createdAt || '';
    const secondDate = second.messages.at(-1)?.createdAt || '';
    return secondDate.localeCompare(firstDate) || (BigInt(second.messages[0].id) > BigInt(first.messages[0].id) ? 1 : -1);
  });
}

export async function fetchDirectConversationPage(userId, contactId, { before = null } = {}) {
  const hiddenConversations = await fetchHiddenConversations(userId);
  const hiddenAt = hiddenConversations.get(contactId);
  const visibleMessages = [];
  let cursor = before;
  let exhausted = false;
  // Hidden rows must not create empty pages that strand older visible history.
  while (visibleMessages.length < messagePageSize && !exhausted) {
    let query = supabase.from('direct_messages').select(directMessageColumns)
      .or(`and(sender_id.eq.${userId},recipient_id.eq.${contactId}),and(sender_id.eq.${contactId},recipient_id.eq.${userId})`);
    if (hiddenAt) query = query.gt('created_at', hiddenAt);
    const { data, error } = await newestFirst(beforeCursor(query, cursor), messagePageSize);
    if (error) throw error;
    if (!data.length) { exhausted = true; break; }
    const hiddenIds = await fetchHiddenMessageIds(userId, data.map(message => message.id));
    for (const message of data) {
      cursor = messageCursor(message);
      if (!hiddenIds.has(message.id)) visibleMessages.push(message);
      if (visibleMessages.length === messagePageSize) break;
    }
    exhausted = data.length < messagePageSize && cursor.id === data.at(-1).id;
  }
  const messages = await Promise.all(visibleMessages.reverse().map(message => mapDirectMessage(message, userId)));
  return { messages: await attachMessageReactions(messages, userId), cursor, hasOlder: !exhausted };
}

// Refresh the whole loaded window, rather than merging stale hidden/unsent rows.
export async function fetchDirectConversation(userId, contactId, { through = null } = {}) {
  let page;
  let before = null;
  let messages = [];
  do {
    page = await fetchDirectConversationPage(userId, contactId, { before });
    messages = [...page.messages, ...messages];
    before = page.cursor;
  } while (through && page.hasOlder && before && (
    before.createdAt > through.createdAt
    || (before.createdAt === through.createdAt && BigInt(before.id) > BigInt(through.id))
  ));
  if (through) {
    const retained = messages.filter(message => message.createdAt > through.createdAt
      || (message.createdAt === through.createdAt && BigInt(message.id) >= BigInt(through.id)));
    return { messages: retained, cursor: through, hasOlder: page.hasOlder || retained.length < messages.length };
  }
  return { messages, cursor: page.cursor, hasOlder: page.hasOlder };
}

export async function assertDirectContactAvailable(userId, contactId) {
  const results = await Promise.all([...new Set([userId, contactId])].map(target =>
    supabase.rpc('is_boardmate_account_active', { target_user_id: target })));
  for (const result of results) {
    if (result.error) throw result.error;
    if (result.data !== true) throw new Error('This conversation is unavailable while an account is suspended or inactive.');
  }
}

export async function sendDirectMessage(userId, contactId, body, file = null, isForwarded = false) {
  const normalizedBody = body.trim();
  if (!normalizedBody && !file) throw new Error('Write a message or attach a photo, video, or audio file.');
  if (normalizedBody.length > 2000) throw new Error('Messages must be 2,000 characters or fewer.');
  if (file && !allowedAttachmentTypes.has(file.type)) {
    throw new Error('Choose a supported JPG, PNG, WEBP, GIF, MP4, WEBM, MOV, MP3, M4A, WAV, OGG, or AAC file.');
  }
  if (file && file.size > maxAttachmentSize) {
    throw new Error('Media attachments must be 20 MB or smaller.');
  }

  await assertDirectContactAvailable(userId, contactId);
  let attachmentPath = null;
  if (file) {
    const extension = file.name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) || 'bin';
    const fileName = `${crypto.randomUUID()}.${extension}`;
    attachmentPath = `${userId}/${contactId}/${fileName}`;
    const { error: uploadError } = await supabase.storage
      .from(attachmentBucket)
      .upload(attachmentPath, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
  }

  const { data, error } = await supabase
    .from('direct_messages')
    .insert({
      sender_id: userId,
      recipient_id: contactId,
      body: normalizedBody || null,
      attachment_path: attachmentPath,
      attachment_mime: file?.type || null,
      attachment_name: file?.name || null,
      is_forwarded: isForwarded,
    })
    .select(directMessageColumns)
    .single();
  if (error) {
    if (attachmentPath) {
      const { error: cleanupError } = await supabase.storage.from(attachmentBucket).remove([attachmentPath]);
      if (cleanupError) {
        throw new Error(`Message could not be sent (${error.message}); uploaded attachment cleanup failed (${cleanupError.message}).`);
      }
    }
    if (error.code === '42501' || error.message?.toLowerCase().includes('row-level security')) {
      throw new Error('Message blocked by privacy policy: confirm both accounts are active, neither account has blocked the other, and the recipient is still available.');
    }
    throw error;
  }

  return mapDirectMessage(data, userId);
}

export async function unsendDirectMessage(messageId, forEveryone) {
  const { data: attachmentPath, error } = await supabase.rpc('unsend_boardmate_message', {
    p_message_id: messageId,
    p_for_everyone: forEveryone,
  });
  if (error) throw error;
  if (attachmentPath) {
    const { error: removeError } = await supabase.storage
      .from(attachmentBucket)
      .remove([attachmentPath]);
    if (removeError) {
      throw new Error(`Message was unsent, but its attachment could not be removed from storage: ${removeError.message}`);
    }
  }
}

export async function reactToDirectMessage(messageId, reaction) {
  const { error } = await supabase.rpc('react_to_boardmate_message', {
    p_message_id: messageId,
    p_reaction: reaction,
  });
  if (error) throw error;
}

export async function shareDirectMessage(userId, contactId, message) {
  let attachment = null;
  if (message.attachmentPath && message.attachmentMime) {
    const { data, error } = await supabase.storage
      .from(attachmentBucket)
      .download(message.attachmentPath);
    if (error) throw error;
    const fileName = message.attachmentName || `shared-message.${message.attachmentMime.split('/')[1] || 'bin'}`;
    attachment = new File([data], fileName, { type: message.attachmentMime });
  }
  return sendDirectMessage(userId, contactId, message.deletedAt ? '' : message.text || '', attachment, true);
}

export async function markDirectConversationSeen(contactId) {
  const { error } = await supabase.rpc('mark_boardmate_conversation_seen', { p_contact_id: contactId });
  if (error) throw error;
}

export async function hideDirectConversation(contactId) {
  const { error } = await supabase.rpc('hide_boardmate_conversation', { p_contact_id: contactId });
  if (error) throw error;
}

export async function reportDirectConversation(reporterId, reportedUserId, category, reason, evidenceFile = null) {
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 3 || normalizedReason.length > 1000) {
    throw new Error('Report details must be between 3 and 1,000 characters.');
  }
  if (evidenceFile && !allowedAttachmentTypes.has(evidenceFile.type)) {
    throw new Error('Evidence must be a supported image, video, or audio file.');
  }
  if (evidenceFile && evidenceFile.size > 10 * 1024 * 1024) {
    throw new Error('Report evidence must be 10 MB or smaller.');
  }

  let evidencePath = null;
  if (evidenceFile) {
    const extension = evidenceFile.name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) || 'jpg';
    evidencePath = `${reporterId}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from(reportEvidenceBucket)
      .upload(evidencePath, evidenceFile, { contentType: evidenceFile.type, upsert: false });
    if (uploadError) throw uploadError;
  }

  const { error } = await supabase.rpc('submit_boardmate_message_report', {
    p_reported_user_id: reportedUserId,
    p_category: category,
    p_reason: normalizedReason,
    p_evidence_path: evidencePath,
  });
  if (error) {
    if (evidencePath) {
      const { error: cleanupError } = await supabase.storage.from(reportEvidenceBucket).remove([evidencePath]);
      if (cleanupError) {
        throw new Error(`Report could not be submitted (${error.message}); evidence cleanup failed (${cleanupError.message}).`);
      }
    }
    throw error;
  }
}

export async function blockDirectContact(blockerId, contactId) {
  const { error } = await supabase.from('blocked_boardmate_users').insert({
    blocker_id: blockerId,
    blocked_user_id: contactId,
  });
  if (error) throw error;
}

export async function unblockDirectContact(contactId) {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error('Sign in before managing blocked accounts.');
  const { error } = await supabase
    .from('blocked_boardmate_users')
    .delete()
    .eq('blocker_id', user.id)
    .eq('blocked_user_id', contactId);
  if (error) throw error;
}

export async function fetchBlockedDirectContacts() {
  const { data, error } = await supabase.rpc('get_boardmate_blocked_users');
  if (error) throw error;
  return data.map(contact => ({
    userId: contact.user_id,
    name: contact.full_name || 'BoardMate member',
    avatar: contact.avatar_url,
  }));
}

export async function fetchBoardmateNotifications(userId) {
  const { data, error } = await supabase
    .from('boardmate_notifications')
    .select('id, title, body, created_at, read_at, hidden_until, target_type, target_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function markBoardmateNotificationsRead(userId, notificationId = null) {
  const readAt = new Date().toISOString();
  let query = supabase
    .from('boardmate_notifications')
    .update({ read_at: readAt })
    .eq('user_id', userId)
    .is('read_at', null);
  if (notificationId !== null) query = query.eq('id', notificationId);
  const { error } = await query;
  if (error) throw error;
  return readAt;
}

export async function deleteBoardmateNotification(notificationId) {
  const { error } = await supabase
    .from('boardmate_notifications')
    .delete()
    .eq('id', notificationId);
  if (error) throw error;
}

export async function hideBoardmateNotification(notificationId) {
  const hiddenUntil = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from('boardmate_notifications')
    .update({ hidden_until: hiddenUntil })
    .eq('id', notificationId);
  if (error) throw error;
  return hiddenUntil;
}

export function isUserActive(lastSeenAt) {
  return Boolean(lastSeenAt && Date.now() - new Date(lastSeenAt).getTime() < 90_000);
}

export function formatLastSeen(lastSeenAt) {
  if (!lastSeenAt) return 'Offline';
  const elapsedMinutes = Math.max(1, Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / 60_000));
  if (elapsedMinutes < 60) return `Last seen ${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `Last seen ${elapsedHours}h ago`;
  return `Last seen ${new Date(lastSeenAt).toLocaleDateString()}`;
}
