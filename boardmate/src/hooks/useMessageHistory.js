import { useCallback, useRef, useState } from 'react';
import { fetchDirectConversation as fetchWindow, fetchDirectConversationPage } from '../lib/directMessages';

// Shared by the renter and owner dashboards. Serialize requests per conversation
// so realtime refreshes cannot overwrite an older page with a narrower window.
export default function useMessageHistory() {
  const windows = useRef(new Map());
  const queues = useRef(new Map());
  const [pages, setPages] = useState({});

  const fetchDirectConversation = useCallback((userId, contactId, { older = false } = {}) => {
    const key = `${userId}:${contactId}`;
    if (!older && queues.current.has(key)) return queues.current.get(key);
    const request = (queues.current.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
      const current = windows.current.get(key);
      let result = await fetchWindow(userId, contactId, { through: current?.cursor });
      if (older && result.hasOlder) {
        const previous = await fetchDirectConversationPage(userId, contactId, { before: result.cursor });
        result = { ...previous, messages: [...previous.messages, ...result.messages] };
      }
      windows.current.set(key, { cursor: result.cursor });
      setPages(value => ({ ...value, [key]: { hasOlder: result.hasOlder } }));
      return result.messages;
    });
    queues.current.set(key, request);
    const clear = () => {
      if (queues.current.get(key) === request) queues.current.delete(key);
    };
    request.then(clear, clear);
    return request;
  }, []);

  return { fetchDirectConversation, pages };
}
