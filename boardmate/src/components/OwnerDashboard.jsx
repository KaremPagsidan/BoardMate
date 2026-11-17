import { isVerificationNotification, restrictedVerificationMessage, isVerificationAccessError } from '../lib/verificationSettings';
import SearchBar from './SearchBar';
import useScrollMemory from '../hooks/useScrollMemory';
import QuickActions from './QuickActions';
import UploadedMedia from './UploadedMedia';
import ImageUploadInput from './ImageUploadInput';
import ProfileImage from './ProfileImage';
import useAppDialog from '../hooks/useAppDialog';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import {
  fetchDirectInbox,
  assertDirectContactAvailable,
  fetchBoardmateNotifications,
  deleteBoardmateNotification,
  hideBoardmateNotification,
  formatLastSeen,
  blockDirectContact,
  hideDirectConversation,
  isUserActive,
  markDirectConversationSeen,
  markBoardmateNotificationsRead,
  reactToDirectMessage,
  reportDirectConversation,
  shareDirectMessage,
  sendDirectMessage,
  unsendDirectMessage,
  unblockDirectContact,
} from '../lib/directMessages';
import { fetchProfilePhotoGallery, updateAccountProfile, uploadProfilePhoto } from '../lib/profileMedia';
import { fetchActivityHistory, recordActivity } from '../lib/activityHistory';
import { publishBoardmatePresence } from '../lib/presence';
import BoardMateHouseIcon from './BoardMateHouseIcon';
import LocationIcon from './LocationIcon';
import MessageIcon from './MessageIcon';
import PublicProfileDialog from './PublicProfileDialog';
import ListingSearchDialog from './ListingSearchDialog';
import SearchResultsDialog from './SearchResultsDialog';
import ImageCropDialog from './ImageCropDialog';
import MediaPreviewDialog from './MediaPreviewDialog';
import ConversationMediaPlayer from './ConversationMediaPlayer';
import ErrorDialog from './ErrorDialog';
import AccountToolsDialog from './AccountToolsDialog';
import SidebarDrawer from './SidebarDrawer';
import NotificationsPage from './NotificationsPage';
import { defaultListingFilters, filterListings, getPopularListingLocations } from '../lib/listingSearch';
import { fetchAccountPreferences, saveSearchPreferences } from '../lib/accountTools';
import { fetchListingRatingSummary } from '../lib/listingRatings';
import { loadVerificationStatus } from '../lib/verificationStatus';
import usePullToRefresh from '../hooks/usePullToRefresh';
import useMessageHistory from '../hooks/useMessageHistory';
import { listingMedia as getListingMedia } from '../lib/listingDetails';
import AccommodationDetailPage from './AccommodationDetailPage';
import { ProfileHero, ProfileDetails, ProfileSection, ProfileMediaGallery, ProfilePostCard } from './ProfileLayout';
import { collectProfileMedia } from '../lib/profilePresentation';

async function fetchOwnerListings(userId) {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  const ratings = await fetchListingRatingSummary(data.map(item => item.id));
  return data.map(item => ({
    id: item.id,
    title: item.title,
    price: item.price,
    location: item.location,
    propertyType: item.property_type || '',
    description: item.description,
    available: item.is_available,
    moderationStatus: item.moderation_status,
    moderationReason: item.moderation_reason,
    image: getListingMedia(item).find(media => media.mimeType.startsWith('image/'))?.url || null,
    photos: Array.isArray(item.photos) ? item.photos : [],
    ratingAverage: ratings[String(item.id)]?.average || 0,
    ratingCount: ratings[String(item.id)]?.count || 0,
  }));
}

export default function OwnerDashboard({ userProfile, onProfileUpdate, onVerificationSubmit, verificationSubmission, initialSettingsSection = null, onLogout }) {
  const dashboardScroll = useScrollMemory();
  const searchScroll = useScrollMemory();
  const { notify } = useAppDialog();
  const [activeTab, setActiveTab] = useState('home'); // 'home', 'listings', 'create', 'messages', 'profile'
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showLogoutConfirmation, setShowLogoutConfirmation] = useState(false);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [accountToolsOpen, setAccountToolsOpen] = useState(Boolean(initialSettingsSection));
  const [accountToolsSection, setAccountToolsSection] = useState(initialSettingsSection || 'settings');
  const [selectedChat, setSelectedChat] = useState(null); // null = Inbox list, or object for active conversation
  const [chatOptionsOpen, setChatOptionsOpen] = useState(false);
  const [contactOptionsOpenId, setContactOptionsOpenId] = useState(null);
  const [messageOptionsOpenId, setMessageOptionsOpenId] = useState(null);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState(null);
  const [shareTargetMessage, setShareTargetMessage] = useState(null);
  const [shareSearch, setShareSearch] = useState('');
  const [sharingMessage, setSharingMessage] = useState(false);
  const shareRequestRef = useRef(false);
  const [blockConfirmationOpen, setBlockConfirmationOpen] = useState(false);
  const [blockTargetContact, setBlockTargetContact] = useState(null);
  const [messageActionConfirmation, setMessageActionConfirmation] = useState(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [publicProfileUserId, setPublicProfileUserId] = useState(null);
  const [messageSyncNotice, setMessageSyncNotice] = useState('');
  const [chatAttachment, setChatAttachment] = useState(null);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [reportCategory, setReportCategory] = useState('other');
  const [reportReason, setReportReason] = useState('');
  const [reportEvidence, setReportEvidence] = useState(null);
  const [submittingReport, setSubmittingReport] = useState(false);
  const [profileListingPreview, setProfileListingPreview] = useState(null);
  const [mediaPreview, setMediaPreview] = useState(null);
  const [imageEditor, setImageEditor] = useState(null);

  const [myListings, setMyListings] = useState([]);
  const [uniqueProfileViews, setUniqueProfileViews] = useState(0);
  const [profilePhotos, setProfilePhotos] = useState([]);
  const [listingFavoriteCounts, setListingFavoriteCounts] = useState({});
  const [chats, setChats] = useState([]);
  const [moderationNotifications, setModerationNotifications] = useState([]);
  const [notificationTime, setNotificationTime] = useState(0);
  const [loadingListings, setLoadingListings] = useState(Boolean(userProfile?.id));
  const [dashboardError, setDashboardError] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingListing, setUploadingListing] = useState(false);
  const [activityHistory, setActivityHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [profileDraft, setProfileDraft] = useState({});

  // Create Post Form State
  const [newPost, setNewPost] = useState({ title: '', price: '', location: '', propertyType: '', description: '' });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFilters, setSearchFilters] = useState(defaultListingFilters);
  const [searchPreferencesLoaded, setSearchPreferencesLoaded] = useState(false);
  const [coverPhoto, setCoverPhoto] = useState(null);
  const [listingMedia, setListingMedia] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const chatInputRef = useRef(null);
  const chatFileInput = useRef(null);
  const chatMessagesRef = useRef(null);
  const { fetchDirectConversation, pages: historyPages } = useMessageHistory();
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const olderRequest = useRef(false);
  const scrollAnchorRef = useRef(null);
  const [historyScrollVersion, setHistoryScrollVersion] = useState(0);
  const currentContactRef = useRef(null);
  const previewUrls = useRef(new Set());
  const reportEvidenceInput = useRef(null);
  const chatAttachmentPreviewUrl = useRef(null);
  const reportEvidencePreviewUrl = useRef(null);
  const userId = userProfile?.id;
  const ownProfileMedia = useMemo(() => collectProfileMedia(profilePhotos, myListings), [profilePhotos, myListings]);
  const isConversationOpen = Boolean(selectedChat?.userId);
  const conversationMessageCount = selectedChat?.messages?.length || 0;
  const createMediaPreviewUrl = (file) => {
    const url = URL.createObjectURL(file);
    previewUrls.current.add(url);
    return url;
  };
  const revokeMediaPreviewUrl = (url) => {
    if (!previewUrls.current.delete(url)) return;
    URL.revokeObjectURL(url);
  };
  const clearChatAttachment = () => {
    if (chatAttachmentPreviewUrl.current) revokeMediaPreviewUrl(chatAttachmentPreviewUrl.current);
    chatAttachmentPreviewUrl.current = null;
    setChatAttachment(null);
  };
  const selectChatAttachment = (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (!file) return;
    clearChatAttachment();
    const previewUrl = createMediaPreviewUrl(file);
    chatAttachmentPreviewUrl.current = previewUrl;
    setChatAttachment(file);
    setMediaPreview({ src: previewUrl, name: file.name, mimeType: file.type });
  };
  const clearReportEvidence = () => {
    if (reportEvidencePreviewUrl.current) revokeMediaPreviewUrl(reportEvidencePreviewUrl.current);
    reportEvidencePreviewUrl.current = null;
    setReportEvidence(null);
    if (reportEvidenceInput.current) reportEvidenceInput.current.value = '';
  };
  const selectReportEvidence = (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (!file) return;
    clearReportEvidence();
    const previewUrl = createMediaPreviewUrl(file);
    reportEvidencePreviewUrl.current = previewUrl;
    setReportEvidence(file);
    setMediaPreview({ src: previewUrl, name: file.name, mimeType: file.type });
  };
  const closeReportDialog = () => {
    setReportDialogOpen(false);
    clearReportEvidence();
  };
  const filteredOwnerListings = filterListings(myListings, searchQuery, searchFilters);
  const ownerListingIds = myListings.map(listing => String(listing.id)).join(',');
  const popularLocations = getPopularListingLocations(myListings, listingFavoriteCounts);
  const totalListingLikes = Object.values(listingFavoriteCounts).reduce((total, count) => total + count, 0);
  const totalListingRatings = myListings.reduce((total, listing) => total + listing.ratingCount, 0);
  const averageListingRating = totalListingRatings
    ? myListings.reduce((total, listing) => total + listing.ratingAverage * listing.ratingCount, 0) / totalListingRatings
    : 0;
  const totalListingInquiries = chats.reduce(
    (total, chat) => total + (chat.incomingCount || 0),
    0,
  );
  const closeSearchResults = () => {
    setShowSearchResults(false);
  };

  useEffect(() => {
    if (!userId || userProfile?.verificationStatus !== 'approved' || userProfile?.suspendedAt) return undefined;
    let active = true;
    const refreshUniqueProfileViews = async () => {
      const { data, error } = await supabase.rpc('record_boardmate_profile_view', { p_owner_id: userId });
      if (error) throw error;
      if (active) setUniqueProfileViews(Number(data) || 0);
    };
    refreshUniqueProfileViews().catch(error => {
      if (active) setDashboardError(`Unable to load profile views: ${error.message}`);
    });

    const refreshInterval = window.setInterval(() => {
      refreshUniqueProfileViews().catch(error => {
        if (active) setDashboardError(`Unable to refresh profile views: ${error.message}`);
      });
    }, 30_000);
    return () => {
      active = false;
      window.clearInterval(refreshInterval);
    };
  }, [userId, userProfile?.verificationStatus, userProfile?.suspendedAt]);

  useEffect(() => {
    if (!userId || !ownerListingIds) return undefined;
    let active = true;
    const refreshRatingSummaries = async () => {
      const summaries = await fetchListingRatingSummary(ownerListingIds.split(','));
      if (!active) return;
      setMyListings(current => current.map(listing => ({
        ...listing,
        ratingAverage: summaries[String(listing.id)]?.average || 0,
        ratingCount: summaries[String(listing.id)]?.count || 0,
      })));
    };
    const refresh = () => refreshRatingSummaries().catch(error => {
      if (active) setDashboardError(`Unable to refresh listing ratings: ${error.message}`);
    });

    refresh();
    const intervalId = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refresh);
    };
  }, [ownerListingIds, userId]);

  useEffect(() => {
    if (!userId) return undefined;
    let active = true;
    const listingIds = myListings.map(listing => listing.id);
    const refreshListingFavoriteCounts = async () => {
      if (listingIds.length === 0) {
        if (active) setListingFavoriteCounts({});
        return;
      }
      const { data, error } = await supabase
        .from('listing_favorites')
        .select('listing_id')
        .in('listing_id', listingIds);
      if (error) throw error;
      const counts = {};
      data.forEach(favorite => {
        counts[favorite.listing_id] = (counts[favorite.listing_id] || 0) + 1;
      });
      if (active) setListingFavoriteCounts(counts);
    };

    refreshListingFavoriteCounts().catch(error => {
      if (active) setDashboardError(`Unable to load listing likes: ${error.message}`);
    });
    const channel = supabase
      .channel(`owner-listing-likes-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'listing_favorites' }, () => {
        refreshListingFavoriteCounts().catch(error => {
          if (active) setDashboardError(`Unable to refresh listing likes: ${error.message}`);
        });
      })
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [userId, myListings]);

  useEffect(() => {
    if (!userId) return undefined;
    let active = true;
    fetchAccountPreferences(userId)
      .then(preferences => {
        if (!active) return;
        setSearchFilters({
          location: preferences.search_location,
          propertyType: preferences.search_property_type,
          maxPrice: preferences.search_max_price,
        });
        setSearchPreferencesLoaded(true);
      })
      .catch(error => {
        if (active) {
          setSearchPreferencesLoaded(true);
          setDashboardError(`Unable to load saved search preferences: ${error.message}`);
        }
      });
    return () => { active = false; };
  }, [userId]);

  useEffect(() => {
    const nextExpiry = moderationNotifications
      .map(notification => Date.parse(notification.hidden_until))
      .filter(expiry => Number.isFinite(expiry) && expiry > Date.now())
      .sort((left, right) => left - right)[0];
    if (!userId || !nextExpiry) return undefined;
    let active = true;
    const timeoutId = window.setTimeout(() => {
      fetchBoardmateNotifications(userId)
        .then(notifications => {
          if (active) {
            setModerationNotifications(notifications);
            setNotificationTime(Date.now());
          }
        })
        .catch(error => {
          if (active) setDashboardError(`Unable to restore hidden notifications: ${error.message}`);
        });
    }, Math.max(0, nextExpiry - Date.now()) + 1000);
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [userId, moderationNotifications]);

  useEffect(() => {
    if (!userId || !searchPreferencesLoaded) return undefined;
    const timeoutId = window.setTimeout(() => {
      saveSearchPreferences(userId, searchFilters)
        .catch(error => setDashboardError(`Search filters changed but could not be saved: ${error.message}`));
    }, 500);
    return () => window.clearTimeout(timeoutId);
  }, [searchFilters, searchPreferencesLoaded, userId]);

  useLayoutEffect(() => {
    currentContactRef.current = selectedChat?.userId;
  }, [selectedChat?.userId]);

  const loadOlderMessages = async () => {
    const contactId = selectedChat?.userId;
    if (!contactId || olderRequest.current) return;
    olderRequest.current = true;
    setLoadingOlderMessages(true);
    try {
      const history = await fetchDirectConversation(userId, contactId, { older: true });
      if (currentContactRef.current !== contactId) return;
      const element = chatMessagesRef.current;
      scrollAnchorRef.current = element ? { contactId, height: element.scrollHeight, top: element.scrollTop } : null;
      setHistoryScrollVersion(value => value + 1);
      setSelectedChat(current => current?.userId === contactId ? { ...current, messages: history } : current);
    } catch (error) {
      setDashboardError(`Unable to load older messages: ${error.message}`);
    } finally {
      olderRequest.current = false;
      setLoadingOlderMessages(false);
    }
  };

  useLayoutEffect(() => {
    if (activeTab === 'messages' && isConversationOpen) {
      const anchor = scrollAnchorRef.current;
      scrollAnchorRef.current = null;
      if (anchor && anchor.contactId === currentContactRef.current && chatMessagesRef.current) {
        chatMessagesRef.current.scrollTop = anchor.top + chatMessagesRef.current.scrollHeight - anchor.height;
        return;
      }
      chatMessagesRef.current?.scrollTo({ top: chatMessagesRef.current.scrollHeight });
    }
  }, [activeTab, isConversationOpen, conversationMessageCount, historyScrollVersion]);

  const unreadMessageCount = chats.reduce(
    (total, chat) => total + (chat.unreadCount || 0),
    0,
  );
  const shareContacts = [
    ...chats,
    ...(userId ? [{
      userId,
      sender: 'You',
      name: 'You',
      avatar: userProfile?.avatar,
      isSelf: true,
    }] : []),
  ].filter((contact, index, contacts) => (
    contacts.findIndex(item => item.userId === contact.userId) === index
  ));
  useEffect(() => {
    const handleMessagePopoverOutsideClick = (event) => {
      if (event.target instanceof Element && event.target.closest('[data-message-popover]')) return;
      setMessageOptionsOpenId(null);
      setReactionPickerMessageId(null);
      setContactOptionsOpenId(null);
      setChatOptionsOpen(false);
    };
    document.addEventListener('pointerdown', handleMessagePopoverOutsideClick);
    return () => document.removeEventListener('pointerdown', handleMessagePopoverOutsideClick);
  }, []);

  useEffect(() => {
    if (!userId || userProfile?.suspendedAt || userProfile?.verificationStatus !== 'approved') return undefined;
    let active = true;
    const updatePresence = () => {
      publishBoardmatePresence(userId)
        .then(() => {
          if (active) {
            setDashboardError(current => (
              current.startsWith('Unable to update your active status:') ? '' : current
            ));
          }
        })
        .catch(error => {
          if (active) setDashboardError(`Unable to update your active status: ${error.message}`);
        });
    };
    updatePresence();
    const intervalId = window.setInterval(updatePresence, 30_000);
    document.addEventListener('visibilitychange', updatePresence);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', updatePresence);
    };
  }, [userId, userProfile?.suspendedAt, userProfile?.verificationStatus]);

  useEffect(() => {
    if (!userId) return undefined;
    let active = true;
    const refreshNotifications = () => {
      fetchBoardmateNotifications(userId)
        .then(notifications => {
          if (active) {
            setModerationNotifications(notifications);
            setNotificationTime(Date.now());
          }
        })
        .catch(error => {
          if (active) setDashboardError(`Unable to load account notifications: ${error.message}`);
        });
    };
    refreshNotifications();
    const channel = supabase
      .channel(`owner-notifications-${userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'boardmate_notifications',
        filter: `user_id=eq.${userId}`,
      }, refreshNotifications)
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  useEffect(() => () => {
    previewUrls.current.forEach(url => URL.revokeObjectURL(url));
    previewUrls.current.clear();
  }, []);

  useEffect(() => {
    if (!userId) return undefined;
    let active = true;
    fetchProfilePhotoGallery(userId)
      .then(photos => {
        if (active) setProfilePhotos(photos);
      })
      .catch(error => {
        if (active) setDashboardError(error.message);
      });
    return () => { active = false; };
  }, [userId]);

  useEffect(() => {
    if (!userId) return undefined;
    const channel = supabase
      .channel(`owner-listings-${userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'listings',
        filter: `owner_id=eq.${userId}`,
      }, () => {
        fetchOwnerListings(userId)
          .then(listings => {
            setMyListings(listings);
            setDashboardError('');
          })
          .catch(error => setDashboardError(error.message));
      })
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Realtime disconnects are transport failures, not review decisions.
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return undefined;
    let active = true;
    const refreshInbox = async () => {
      try {
        const inbox = await fetchDirectInbox(userId);
        if (!active) return;
        const ownerChats = inbox.map(contact => ({ ...contact, sender: contact.name }));
        setChats(ownerChats);
        if (activeTab === 'messages' && selectedChat?.userId) {
          const refreshedChat = ownerChats.find(chat => chat.userId === selectedChat.userId);
          if (refreshedChat) {
            const unreadMessages = refreshedChat.unreadCount > 0;
            if (unreadMessages) {
              try {
                await markDirectConversationSeen(refreshedChat.userId);
              } catch (error) {
                setDashboardError(`Messages loaded, but read receipts could not be updated: ${error.message}`);
              }
            }
            const messages = await fetchDirectConversation(userId, refreshedChat.userId);
            if (!active) return;
            setSelectedChat(current => current?.userId === refreshedChat.userId ? { ...refreshedChat, messages } : current);
          } else {
            const refreshedMessages = await fetchDirectConversation(userId, selectedChat.userId);
            if (!active) return;
            setSelectedChat(current => current?.userId === selectedChat.userId
              ? { ...current, messages: refreshedMessages }
              : current);
          }
        }
      } catch (error) {
        if (active) setDashboardError(`Unable to load messages: ${error.message}`);
      }
    };

    refreshInbox();
    const channel = supabase
      .channel(`owner-direct-messages-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'direct_messages' }, refreshInbox)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'direct_message_reactions' }, refreshInbox)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'direct_message_user_deletions' }, refreshInbox)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'boardmate_presence' }, refreshInbox)
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setMessageSyncNotice('Realtime is unavailable; messages will refresh automatically every few seconds.');
        } else if (status === 'SUBSCRIBED') {
          setMessageSyncNotice('');
        }
      });
    const refreshInterval = window.setInterval(refreshInbox, 5000);

    return () => {
      active = false;
      window.clearInterval(refreshInterval);
      supabase.removeChannel(channel);
    };
  }, [activeTab, selectedChat?.userId, userId, fetchDirectConversation]);

  const loadListings = useCallback(async () => {
    if (!userId) return;
    try {
      const listings = await fetchOwnerListings(userId);
      setDashboardError('');
      setMyListings(listings);
    } catch (error) {
      setDashboardError(error.message);
      throw error;
    }
    setLoadingListings(false);
  }, [userId]);

  const pullRefreshIndicator = usePullToRefresh(async () => {
    if (!userId) return;
    setLoadingListings(true);
    try {
      const [listings, photos, notifications, accountStatus] = await Promise.all([
        fetchOwnerListings(userId),
        fetchProfilePhotoGallery(userId),
        fetchBoardmateNotifications(userId),
        loadVerificationStatus(supabase, userId),
      ]);
      setMyListings(listings);
      setProfilePhotos(photos);
      setModerationNotifications(notifications);
      setNotificationTime(Date.now());
      onProfileUpdate?.(current => current?.id === userId ? {
        ...current,
        verificationStatus: accountStatus.status || 'not_submitted',
        verificationReason: accountStatus.reason || '',
        suspendedAt: accountStatus.suspendedAt || null,
        suspensionReason: accountStatus.suspensionReason || '',
      } : current);

      const listingIds = listings.map(listing => listing.id);
      const favoritesResult = listingIds.length
        ? await supabase.from('listing_favorites').select('listing_id').in('listing_id', listingIds)
        : { data: [], error: null };
      if (favoritesResult.error) throw favoritesResult.error;
      const favoriteCounts = {};
      favoritesResult.data.forEach(favorite => {
        favoriteCounts[favorite.listing_id] = (favoriteCounts[favorite.listing_id] || 0) + 1;
      });
      setListingFavoriteCounts(favoriteCounts);

      if (accountStatus.status === 'approved' && !accountStatus.suspendedAt) {
        const viewsResult = await supabase.rpc('record_boardmate_profile_view', { p_owner_id: userId });
        if (viewsResult.error) throw viewsResult.error;
        setUniqueProfileViews(Number(viewsResult.data) || 0);
      }

      if (activeTab === 'messages') {
        const inbox = await fetchDirectInbox(userId);
        const ownerChats = inbox.map(contact => ({ ...contact, sender: contact.name }));
        setChats(ownerChats);
        if (selectedChat?.userId) {
          const messages = await fetchDirectConversation(userId, selectedChat.userId);
          setSelectedChat(current => current?.userId === selectedChat.userId ? { ...current, messages } : current);
        }
      } else if (activeTab === 'history') {
        setActivityHistory(await fetchActivityHistory(userId));
      }
      setDashboardError('');
    } catch (error) {
      setDashboardError(`Unable to refresh dashboard: ${error.message}`);
      throw error;
    } finally {
      setLoadingListings(false);
    }
  });

  useEffect(() => {
    if (activeTab !== 'history' || !userId) return undefined;
    let active = true;
    fetchActivityHistory(userId)
      .then(history => {
        if (active) setActivityHistory(history);
      })
      .catch(error => {
        if (active) setDashboardError(error.message);
      })
      .finally(() => {
        if (active) setLoadingHistory(false);
      });
    return () => { active = false; };
  }, [activeTab, userId]);

  const openProfileEditor = () => {
    setProfileDraft({
      fullName: userProfile?.fullName || '',
      phone: userProfile?.phone || '',
      dob: userProfile?.dob || '',
      gender: userProfile?.gender || '',
      businessName: userProfile?.businessName || '',
      address: userProfile?.address || '',
      govIdNumber: userProfile?.govIdNumber || '',
      propertyType: userProfile?.propertyType || '',
    });
    setShowProfileEditor(true);
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    try {
      const verification = await updateAccountProfile(userId, profileDraft);
      onProfileUpdate({ ...userProfile, ...profileDraft, ...verification });
      setShowProfileEditor(false);
      setDashboardError('');
    } catch (error) {
      setDashboardError(error.message);
      return;
    }
    try {
      await recordActivity(userId, 'Updated profile information');
    } catch (error) {
      setDashboardError(`Profile saved, but activity history could not be recorded: ${error.message}`);
    }
  };

  useEffect(() => {
    if (!userId) return undefined;
    let active = true;

    fetchOwnerListings(userId)
      .then(listings => {
        if (!active) return;
        setDashboardError('');
        setMyListings(listings);
      })
      .catch(error => {
        if (active) setDashboardError(error.message);
      })
      .finally(() => {
        if (active) setLoadingListings(false);
      });

    return () => { active = false; };
  }, [userId]);

  const toggleAvailability = async (item) => {
    const { error } = await supabase
      .from('listings')
      .update({ is_available: !item.available })
      .eq('id', item.id)
      .eq('owner_id', userProfile.id);

    if (error) {
      setDashboardError(error.message);
      return;
    }
    setMyListings(prev => prev.map(listing => (
      listing.id === item.id ? { ...listing, available: !item.available } : listing
    )));
    try {
      await recordActivity(userProfile.id, 'Changed listing availability', `${item.title}: ${item.available ? 'unavailable' : 'available'}.`);
    } catch (historyError) {
      setDashboardError(historyError.message);
    }
  };

  const handleProfilePhotoChange = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!userProfile?.id) {
      setDashboardError('Please sign in before updating your profile photo.');
      return;
    }

    setImageEditor({ type: 'profile', file, previewUrl: createMediaPreviewUrl(file) });
  };

  const uploadOwnerProfilePhoto = async (file) => {
    setUploadingPhoto(true);
    setDashboardError('');
    try {
      const avatar = await uploadProfilePhoto(userProfile.id, file);
      onProfileUpdate({ ...userProfile, avatar });
      setProfilePhotos(await fetchProfilePhotoGallery(userProfile.id));
      setDashboardError('');
      try {
        await recordActivity(userProfile.id, 'Updated profile photo');
      } catch (historyError) {
        setDashboardError(`Photo updated, but activity history could not be recorded: ${historyError.message}`);
      }
      return true;
    } catch (error) {
      setDashboardError(error.message);
      return false;
    } finally {
      setUploadingPhoto(false);
    }
  };

  useVisibilityRefresh(async () => {
    const [inbox, listings, photos] = await Promise.all([fetchDirectInbox(userId), fetchOwnerListings(userId), fetchProfilePhotoGallery(userId)]);
    setProfilePhotos(photos);
    setMyListings(listings);
    setChats(inbox.map(contact => ({ ...contact, sender: contact.name })));
    if (selectedChat?.userId) {
      try { await assertDirectContactAvailable(userId, selectedChat.userId); }
      catch (error) {
        if (error.message.includes('suspended or inactive')) setSelectedChat(null);
      }
    }
  }, Boolean(userId && !userProfile?.suspendedAt));

  const openOwnerChat = async (chat) => {
    if (!chat?.userId) return;
    try { await assertDirectContactAvailable(userId, chat.userId); }
    catch (error) { setDashboardError(error.message); return; }
    setSelectedChat({ ...chat, messages: [] });
    setChatOptionsOpen(false);
    clearChatAttachment();
    if (!chat?.userId) return;
    try {
      const conversation = await fetchDirectConversation(userId, chat.userId);
      if ((chat.unreadCount || 0) > 0 || conversation.some(message => message.sender === 'them' && !message.seenAt)) {
        try {
          await markDirectConversationSeen(chat.userId);
        } catch (error) {
          setDashboardError(`Messages loaded, but read receipts could not be updated: ${error.message}`);
        }
      }
      const refreshedMessages = await fetchDirectConversation(userId, chat.userId);
      setSelectedChat(current => current?.userId === chat.userId
        ? { ...current, messages: refreshedMessages }
        : current);
      setDashboardError(current => current.startsWith('Messages loaded, but read receipts could not be updated:') ? current : '');
    } catch (error) {
      setDashboardError(`Unable to open conversation: ${error.message}`);
    }
  };

  const sendMessage = async () => {
    const body = chatInput.trim();
    if ((!body && !chatAttachment) || !selectedChat?.userId || !userId) return;
    if (userProfile?.verificationStatus !== 'approved') { notify(restrictedVerificationMessage); return; }
    setDashboardError('');
    let sentMessage;
    try {
      sentMessage = await sendDirectMessage(userId, selectedChat.userId, body, chatAttachment);
      setChatInput('');
      if (chatInputRef.current) chatInputRef.current.style.height = '';
      clearChatAttachment();
    } catch (error) {
      if (error.code === '42501' || error.message?.toLowerCase().includes('row-level security')) {
        setDashboardError('Message could not be sent: make sure both accounts are active, neither account has blocked the other, and the recipient is still available.');
      } else {
        setDashboardError(`Unable to send message: ${error.message}`);
      }
      return;
    }
    setSelectedChat(current => current?.userId === selectedChat.userId
      ? { ...current, messages: [...current.messages, sentMessage] }
      : current);
    fetchDirectInbox(userId)
      .then(inbox => setChats(inbox.map(contact => ({ ...contact, sender: contact.name }))))
      .catch(error => setDashboardError(`Message sent, but inbox could not refresh: ${error.message}`));
    recordActivity(userId, 'Sent message', body || 'Sent an attachment').catch(error => setDashboardError(error.message));
  };

  const deleteOwnerConversation = (contact = selectedChat) => {
    if (!contact?.userId) return;
    setChatOptionsOpen(false);
    setContactOptionsOpenId(null);
    setMessageActionConfirmation({
      title: 'Are you sure you want to delete?',
      message: contact.userId === userId
        ? 'This self-conversation will be hidden. Any new message you send to yourself will start a fresh visible conversation.'
        : 'It will be hidden from your Messages only. The other participant will still have their copy.',
      onConfirm: async () => {
        try {
          await hideDirectConversation(contact.userId);
          setChats(current => current.filter(chat => chat.userId !== contact.userId));
          setSelectedChat(current => current?.userId === contact.userId ? null : current);
          recordActivity(userId, 'Deleted conversation', contact.name || contact.sender).catch(error => setDashboardError(error.message));
          setDashboardError('');
        } catch (error) {
          setDashboardError(`Unable to delete conversation: ${error.message}`);
        }
      },
    });
  };

  const reportOwnerConversation = (contact = selectedChat) => {
    if (!contact?.userId || contact.userId === userId || !userId) return;
    setSelectedChat(current => current?.userId === contact.userId ? current : { ...contact, messages: [] });
    setDashboardError('');
    setChatOptionsOpen(false);
    setContactOptionsOpenId(null);
    setReportCategory('other');
    setReportReason('');
    clearReportEvidence();
    setReportDialogOpen(true);
  };

  const submitConversationReport = async (event) => {
    event.preventDefault();
    if (!selectedChat?.userId || !userId || submittingReport) return;
    setSubmittingReport(true);
    setDashboardError('');
    try {
      await reportDirectConversation(userId, selectedChat.userId, reportCategory, reportReason, reportEvidence);
      setReportDialogOpen(false);
      setReportReason('');
      clearReportEvidence();
      recordActivity(userId, 'Reported conversation', selectedChat.name || selectedChat.sender).catch(error => setDashboardError(error.message));
      setDashboardError('Report submitted to the BoardMate admin team for review.');
    } catch (error) {
      setDashboardError(`Unable to submit report: ${error.message}`);
    } finally {
      setSubmittingReport(false);
    }
  };

  const blockSelectedContact = async (contact = selectedChat) => {
    if (!contact?.userId || contact.userId === userId || !userId) return;
    try {
      await blockDirectContact(userId, contact.userId);
      setChats(current => current.filter(chat => chat.userId !== contact.userId));
      setSelectedChat(current => current?.userId === contact.userId ? null : current);
      setChatOptionsOpen(false);
      setContactOptionsOpenId(null);
      setBlockConfirmationOpen(false);
      setBlockTargetContact(null);
      recordActivity(userId, 'Blocked account', contact.sender || contact.name).catch(error => setDashboardError(error.message));
      setDashboardError('');
    } catch (error) {
      setDashboardError(`Unable to block account: ${error.message}`);
    }
  };

  const unblockContact = async (contact) => {
    try {
      await unblockDirectContact(contact.userId);
      const inbox = await fetchDirectInbox(userId);
      setChats(inbox.map(item => ({ ...item, sender: item.name })));
      recordActivity(userId, 'Unblocked account', contact.name).catch(error => setDashboardError(error.message));
      setDashboardError('');
      return true;
    } catch (error) {
      setDashboardError(`Unable to unblock account: ${error.message}`);
      return error.message;
    }
  };

  const unsendMessage = (message, forEveryone) => {
    setMessageOptionsOpenId(null);
    setMessageActionConfirmation({
      title: 'Are you sure you want to delete?',
      message: forEveryone
        ? 'The message will be removed for both you and the recipient.'
        : 'The message will disappear only from your account.',
      onConfirm: async () => {
        try {
          await unsendDirectMessage(message.id, forEveryone);
          const conversation = await fetchDirectConversation(userId, selectedChat.userId);
          setSelectedChat(current => current?.userId === selectedChat.userId
            ? { ...current, messages: conversation }
            : current);
          setChats(current => current.map(chat => (
            chat.userId === selectedChat.userId
              ? {
                ...chat,
                messages: conversation,
                lastMessage: conversation.at(-1)?.text || 'Message unsent',
              }
              : chat
          )));
          recordActivity(userId, forEveryone ? 'Unsent message for everyone' : 'Unsent message for you').catch(error => setDashboardError(error.message));
          setDashboardError('');
        } catch (error) {
          setDashboardError(`Unable to unsend message: ${error.message}`);
        }
      },
    });
  };

  const toggleMessageReaction = async (message, reaction) => {
    const currentReaction = message.reactions.find(item => item.isMine)?.reaction;
    try {
      await reactToDirectMessage(message.id, currentReaction === reaction ? null : reaction);
      const conversation = await fetchDirectConversation(userId, selectedChat.userId);
      setSelectedChat(current => current?.userId === selectedChat.userId
        ? { ...current, messages: conversation }
        : current);
      recordActivity(userId, currentReaction === reaction ? 'Removed message reaction' : 'Reacted to message', reaction).catch(error => setDashboardError(error.message));
      setDashboardError('');
    } catch (error) {
      setDashboardError(`Unable to update message reaction: ${error.message}`);
    } finally {
      setReactionPickerMessageId(null);
    }
  };

  const shareMessageToContact = async (contact) => {
    if (!shareTargetMessage || !userId || sharingMessage || shareRequestRef.current) return;
    shareRequestRef.current = true;
    setSharingMessage(true);
    setDashboardError('');
    try {
      const forwarded = await shareDirectMessage(userId, contact.userId, shareTargetMessage);
      if (!forwarded?.id || forwarded.recipient_id !== contact.userId) {
        throw new Error('The forwarded message could not be confirmed for the selected recipient.');
      }
    } catch (error) {
      setDashboardError(`Unable to share message: ${error.message}`);
      return;
    } finally {
      shareRequestRef.current = false;
      setSharingMessage(false);
    }
    setShareTargetMessage(null);
    setShareSearch('');
    setDashboardError('');
    notify('Your message has been successfully forwarded.', 'Message Forwarded Successfully', 'success');
    recordActivity(userId, 'Shared message', `Shared with ${contact.sender || contact.name}.`).catch(error => {
      setMessageSyncNotice(`Message was forwarded, but activity could not be recorded: ${error.message}`);
    });
    try {
      const inbox = await fetchDirectInbox(userId);
      setChats(inbox.map(item => ({ ...item, sender: item.name })));
    } catch (error) {
      setMessageSyncNotice(`Message was forwarded, but the inbox could not refresh: ${error.message}`);
    }
  };

  const handleUploadPost = async () => {
    if (userProfile?.verificationStatus !== 'approved') {
      notify(restrictedVerificationMessage);
      return;
    }
    if (!['OWNER', 'LANDLORD'].includes(String(userProfile?.role || '').toUpperCase())) {
      setDashboardError('This account is not registered with an owner/landlord role. Sign out and choose the owner account, or contact an administrator to correct the account role.');
      return;
    }
    if (!newPost.title.trim() || !newPost.price.trim() || !newPost.location.trim()) {
      notify('Please enter the title, price, and location.');
      return;
    }
    if (!userProfile?.id) {
      notify('Please sign in before creating a listing.');
      return;
    }

    setUploadingListing(true);
    setDashboardError('');
    const uploadedPaths = [];
    let listingCreated = false;
    try {
      const selectedMedia = [
        ...(coverPhoto ? [{ ...coverPhoto, isCover: true }] : []),
        ...listingMedia.map(media => ({ ...media, isCover: false })),
      ];
      const uploadedMedia = [];
      for (const media of selectedMedia) {
        const { file } = media;
        const allowedTypes = [
          'image/jpeg', 'image/png', 'image/webp', 'image/gif',
          'video/mp4', 'video/webm', 'video/quicktime',
          'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/aac',
        ];
        if (!allowedTypes.includes(file.type)) {
          throw new Error('Choose a supported image, video, or audio file for listing media.');
        }
        if (file.size > 20 * 1024 * 1024) {
          throw new Error('Each listing media file must be 20 MB or smaller.');
        }

        const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const path = `${userProfile.id}/${window.crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from('listing-photos')
          .upload(path, file, { contentType: file.type, upsert: false });
        if (uploadError) {
          const message = uploadError.message || 'Unknown storage error';
          if (/failed to fetch|network|fetch error/i.test(message)) {
            throw new Error(`Could not connect to Supabase Storage while uploading "${file.name}". Check your internet connection and confirm VITE_SUPABASE_URL points to the active Supabase project. Storage policies cannot fix a network connection failure.`);
          }
          if (/bucket not found/i.test(message)) {
            throw new Error('The listing-photos storage bucket is missing. Apply supabase/migrations/20261029000000_fix_listing_photos_storage_policies.sql in the Supabase SQL Editor.');
          }
          if (uploadError.statusCode === '401' || uploadError.statusCode === '403' || /row-level security|unauthorized|permission/i.test(message)) {
            throw new Error(`Supabase denied this upload (${message}). Confirm this is an approved OWNER/LANDLORD account and apply the latest listing photo storage policy migration.`);
          }
          throw new Error(`The listing photo could not be uploaded (${message}).`);
        }
        uploadedPaths.push(path);
        const url = supabase.storage.from('listing-photos').getPublicUrl(path).data.publicUrl;
        uploadedMedia.push({
          url,
          mimeType: file.type,
          name: file.name,
          isCover: media.isCover,
        });
      }

      const imageUrl = uploadedMedia.find(media => media.isCover)?.url
        || uploadedMedia.find(media => media.mimeType.startsWith('image/'))?.url
        || null;
      const listingPayload = {
        owner_id: userProfile.id,
        title: newPost.title.trim(),
        price: newPost.price.trim(),
        location: newPost.location.trim(),
        property_type: newPost.propertyType || null,
        description: newPost.description.trim(),
        image_url: imageUrl,
        photos: uploadedMedia.map(({ url, mimeType, name }) => ({ url, mimeType, name })),
        is_available: true,
      };

      let { error } = await supabase.from('listings').insert([listingPayload]);
      if (error && (error.message?.includes('property_type') || error.code === '42703')) {
        const fallbackPayload = { ...listingPayload };
        delete fallbackPayload.property_type;
        const retryResult = await supabase.from('listings').insert([fallbackPayload]);
        error = retryResult.error;
      }

      if (error) {
        if (/photos.*(column|schema cache)|column.*photos/i.test(error.message || '')) {
          throw new Error('The listing media database update is missing. Apply supabase/migrations/20261101000000_listing_media_gallery.sql in the Supabase SQL Editor, then try again.');
        }
        if (error.code === '42501' || error.message?.toLowerCase().includes('row-level security')) {
          throw new Error(`Supabase blocked listing creation (${error.message}). The database profile must be approved and have the OWNER or LANDLORD role, and the latest listing-review migration must be applied.`);
        }
        throw error;
      }
      listingCreated = true;

      try {
        await recordActivity(userProfile.id, 'Created accommodation listing', newPost.title.trim());
      } catch (historyError) {
        setDashboardError(`Listing saved, but activity history could not be recorded: ${historyError.message}`);
      }
      await loadListings();
      if (coverPhoto) revokeMediaPreviewUrl(coverPhoto.previewUrl);
      listingMedia.forEach(media => revokeMediaPreviewUrl(media.previewUrl));
      setNewPost({ title: '', price: '', location: '', propertyType: '', description: '' });
      setCoverPhoto(null);
      setListingMedia([]);
      setActiveTab('listings');
    } catch (err) {
      let message = err.message || 'The listing could not be uploaded.';
      if (/failed to fetch|networkerror|fetch failed/i.test(message)) {
        message = 'Could not reach Supabase. Check your internet connection and confirm VITE_SUPABASE_URL points to the active project; storage policies cannot resolve a network failure.';
      }
      if (!listingCreated && uploadedPaths.length) {
        try {
          const { error: cleanupError } = await supabase.storage.from('listing-photos').remove(uploadedPaths);
          if (cleanupError) {
            message = `${message} Uploaded file cleanup also failed: ${cleanupError.message}`;
          }
        } catch (cleanupError) {
          message = `${message} Uploaded file cleanup also failed: ${cleanupError.message}`;
        }
      }
      if (isVerificationAccessError(err, userProfile?.verificationStatus)) notify(restrictedVerificationMessage);
      else setDashboardError(message);
    } finally {
      setUploadingListing(false);
    }
  };

  const openImageEditor = (type, media, index = null) => {
    setImageEditor({ type, index, file: media.file, previewUrl: media.previewUrl });
  };

  const applyImageCrop = async (file) => {
    if (imageEditor?.type === 'profile') {
      if (await uploadOwnerProfilePhoto(file)) {
        revokeMediaPreviewUrl(imageEditor.previewUrl);
        setImageEditor(null);
      }
      return;
    }

    const updatedMedia = { file, previewUrl: createMediaPreviewUrl(file) };
    if (imageEditor?.type === 'cover') {
      revokeMediaPreviewUrl(coverPhoto.previewUrl);
      setCoverPhoto(updatedMedia);
    } else if (imageEditor?.type === 'gallery') {
      revokeMediaPreviewUrl(listingMedia[imageEditor.index]?.previewUrl);
      setListingMedia(current => current.map((media, index) => (
        index === imageEditor.index ? updatedMedia : media
      )));
    }
    setImageEditor(null);
  };

  const keepOriginalImage = async () => {
    if (!imageEditor) return;
    if (imageEditor.type !== 'profile') {
      setImageEditor(null);
      return;
    }
    if (await uploadOwnerProfilePhoto(imageEditor.file)) {
      revokeMediaPreviewUrl(imageEditor.previewUrl);
      setImageEditor(null);
    }
  };

  const removeEditedImage = () => {
    if (imageEditor?.type === 'profile') {
      revokeMediaPreviewUrl(imageEditor.previewUrl);
    } else if (imageEditor?.type === 'cover') {
      revokeMediaPreviewUrl(coverPhoto.previewUrl);
      setCoverPhoto(null);
    } else if (imageEditor?.type === 'gallery') {
      revokeMediaPreviewUrl(listingMedia[imageEditor.index]?.previewUrl);
      setListingMedia(current => current.filter((_, index) => index !== imageEditor.index));
    }
    setImageEditor(null);
  };

  const removeListingMedia = (index) => {
    setMessageActionConfirmation({
      title: 'Are you sure you want to delete?',
      message: 'This photo will be removed from your listing.',
      onConfirm: () => {
        const media = listingMedia[index];
        if (media) revokeMediaPreviewUrl(media.previewUrl);
        setListingMedia(current => current.filter((_, mediaIndex) => mediaIndex !== index));
      },
    });
  };

  const deleteNotification = notificationId => {
    setMessageActionConfirmation({
      title: 'Are you sure you want to delete?',
      message: 'This notification will be permanently deleted.',
      onConfirm: async () => {
        try {
          await deleteBoardmateNotification(notificationId);
          setModerationNotifications(current => current.filter(notification => notification.id !== notificationId));
        } catch (error) {
          setDashboardError(`Unable to delete notification: ${error.message}`);
        }
      },
    });
  };

  const hideNotification = async notificationId => {
    try {
      const hiddenUntil = await hideBoardmateNotification(notificationId);
      setModerationNotifications(current => current.map(notification => (
        notification.id === notificationId ? { ...notification, hidden_until: hiddenUntil } : notification
      )));
      setNotificationTime(Date.now());
    } catch (error) {
      setDashboardError(`Unable to hide notification: ${error.message}`);
    }
  };

  const visibleNotifications = moderationNotifications.filter(notification => (
    !notification.hidden_until || Date.parse(notification.hidden_until) <= notificationTime
  ));
  const renderProfileListing = item => (
    <ProfilePostCard onPhotoChanged={refreshProfilePhotos} key={item.id} title={item.title} price={item.price} location={item.location}
      description={item.description} status={item.moderationStatus}
      reason={item.moderationStatus === 'rejected' ? item.moderationReason : ''}
      media={collectProfileMedia([], [item])} onPreview={setMediaPreview}
      onOpen={() => setProfileListingPreview(item)}>
      <p className="bm-profile-post-meta">{item.available ? 'Available' : 'Unavailable'} &middot; {item.ratingCount ? `${Number(item.ratingAverage).toFixed(1)} / 5 from ${item.ratingCount} ratings` : 'No ratings yet'}</p>
    </ProfilePostCard>
  );

  const unreadNotificationCount = visibleNotifications.filter(notification => !notification.read_at).length;
  const openNotifications = async () => {
    setNotificationsOpen(true);
    setIsSidebarOpen(false);
    try {
      const readAt = await markBoardmateNotificationsRead(userId);
      setModerationNotifications(current => current.map(notification => (
        notification.read_at ? notification : { ...notification, read_at: readAt }
      )));
    } catch (error) {
      setDashboardError(`Unable to mark notifications as read: ${error.message}`);
    }
  };
  const openNotification = async notification => {
    setNotificationsOpen(false);
    try {
      const readAt = await markBoardmateNotificationsRead(userId, notification.id);
      setModerationNotifications(current => current.map(item => (
        item.id === notification.id && !item.read_at ? { ...item, read_at: readAt } : item
      )));
    } catch (error) {
      setDashboardError(`Unable to mark notification as read: ${error.message}`);
    }

    if (notification.target_type === 'listing') {
      setActiveTab('listings');
      const listing = myListings.find(item => String(item.id) === String(notification.target_id));
      if (listing) setProfileListingPreview(listing);
    } else if (isVerificationNotification(notification)) {
      setAccountToolsSection('verification'); setAccountToolsOpen(true);
    } else if (notification.target_type === 'conversation_report') {
      setAccountToolsSection('report-history');
      setAccountToolsOpen(true);
    }
  };

  const refreshProfilePhotos = async (photo, action) => {
    setProfilePhotos(await fetchProfilePhotoGallery(userId));
    if (action === 'delete') {
      setMyListings(await fetchOwnerListings(userId));
      setProfileListingPreview(null);
      setMediaPreview(current => current?.src === photo.url ? null : current);
      if (userProfile?.avatar === photo.url) onProfileUpdate?.({ ...userProfile, avatar: null });
    }
  };

  if (publicProfileUserId) return <>{pullRefreshIndicator}<PublicProfileDialog key={publicProfileUserId} userId={publicProfileUserId} onClose={() => setPublicProfileUserId(null)} /></>;
  if (profileListingPreview) {
    const listing = myListings.find(item => item.id === profileListingPreview.id) || profileListingPreview;
    return <>
      {pullRefreshIndicator}
      <AccommodationDetailPage listing={listing} onBack={() => { setMediaPreview(null); setProfileListingPreview(null); }} onPreviewMedia={setMediaPreview}
        actions={listing.moderationStatus === 'approved' && <button type="button" disabled={Boolean(userProfile?.suspendedAt)} onClick={() => toggleAvailability(listing)}>{listing.available ? 'Mark unavailable' : 'Mark available'}</button>} />
      {mediaPreview && <MediaPreviewDialog media={mediaPreview} onClose={() => setMediaPreview(null)} />}
      <ErrorDialog message={dashboardError} onClose={() => setDashboardError('')} />
    </>;
  }

  if (accountToolsOpen) return <>{pullRefreshIndicator}<AccountToolsDialog
          userId={userId}
          userProfile={userProfile}
          onProfileUpdate={onProfileUpdate}
          onVerificationSubmit={onVerificationSubmit}
          verificationSubmission={verificationSubmission}
          initialSection={accountToolsSection}
          searchFilters={searchFilters}
          onSearchFiltersChange={setSearchFilters}
          onUnblockContact={unblockContact}
          onError={message => setDashboardError(message)}
          onLogout={onLogout}
          onClose={() => setAccountToolsOpen(false)}
        /></>;
  if (notificationsOpen) return <>{pullRefreshIndicator}<NotificationsPage error={dashboardError} onDismissError={() => setDashboardError('')} notifications={visibleNotifications} onBack={() => setNotificationsOpen(false)} onDelete={deleteNotification} onHide={hideNotification} onOpen={openNotification} /></>;

  return (
    <div className="boardmate-user-dashboard relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-[#FAF6EE] font-sans text-gray-800">
      {pullRefreshIndicator}
      {activeTab === 'messages' && messageSyncNotice && <p className="absolute left-3 right-3 top-3 z-30 rounded-lg bg-amber-50 px-3 py-2 text-[10px] text-amber-800" role="status">{messageSyncNotice}</p>}
      
      {/* ---------------- SIDEBAR DRAWER ---------------- */}
      {isSidebarOpen && (
        <SidebarDrawer
          onClose={() => setIsSidebarOpen(false)}
          onProfile={() => { setActiveTab('profile'); setIsSidebarOpen(false); }}
          onSettings={() => { setAccountToolsSection('settings'); setAccountToolsOpen(true); setIsSidebarOpen(false); }}
          onHistory={() => { setLoadingHistory(true); setActiveTab('history'); setIsSidebarOpen(false); }}
          onNotifications={openNotifications}
          onReport={() => { setAccountToolsSection('report'); setAccountToolsOpen(true); setIsSidebarOpen(false); }}
          onLogout={() => setShowLogoutConfirmation(true)}
          notificationCount={unreadNotificationCount}
        />
      )}

      {/* ---------------- HEADER ---------------- */}
      {!selectedChat && <div className="mx-auto w-full max-w-7xl p-4 pt-5 pb-2 flex items-center justify-between border-b border-gray-200/40 bg-[#FAF6EE]">
        <button aria-label="Open menu" onClick={() => setIsSidebarOpen(true)} className="p-1 text-2xl text-gray-800 cursor-pointer">
          <i className="fa-solid fa-bars"></i>
        </button>

        <div className="flex flex-col items-center">
          <div className="flex items-center gap-1">
            <span className="text-xl font-serif font-bold text-gray-800">Board<span className="text-[#76A77E]">Mate</span></span>
            <BoardMateHouseIcon className="w-7 h-7 text-[#76A77E]" />
          </div>
          {activeTab !== 'home' && (
            <p className="text-[10px] leading-none text-gray-600">Manage your properties with ease.</p>
          )}
        </div>
      </div>}

      {/* ---------------- MAIN BODY (SCROLLABLE) ---------------- */}
      <div ref={dashboardScroll} className={selectedChat
        ? 'absolute inset-0 z-50 flex min-h-0 flex-col bg-[#FAF6EE] p-3'
        : 'mx-auto w-full max-w-7xl flex-1 space-y-4 overflow-y-auto p-4 no-scrollbar'}>
        {userProfile?.suspendedAt && (
          <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-red-800" role="alert">
            <p className="font-bold">Your account is suspended. Posting, editing, messaging, and other account actions are disabled.</p>
            {userProfile.suspensionReason && <p className="mt-1">{userProfile.suspensionReason}</p>}
          </div>
        )}
        {dashboardError && <p className="text-xs text-red-600" role="alert">{dashboardError}</p>}
        
        
        {/* ==================== TAB 1: HOME ==================== */}
        {activeTab === 'home' && (
          <div className="space-y-4">
            {/* User Greeting */}
            <div className="flex items-center gap-3">
              <button onClick={() => setActiveTab('profile')} aria-label="Open owner profile" className="relative rounded-full focus:outline-none focus:ring-2 focus:ring-[#76A77E]">
                {userProfile?.avatar ? (
                  <ProfileImage src={userProfile.avatar} alt="Owner profile" className="w-14 h-14 rounded-full object-cover border-2 border-[#76A77E]" />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-white border-2 border-[#76A77E] flex items-center justify-center text-gray-400">
                    <i className="fa-regular fa-user"></i>
                  </div>
                )}
                
              </button>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-600">Welcome back,</span>
                </div>
                <div className="flex items-center gap-2">
                  <h2 className="font-bold text-gray-900 text-sm">{userProfile?.fullName || 'Owner'}</h2>
                  <span className="text-[10px] bg-[#C5DCB9] text-gray-700 px-2 py-0.5 rounded-full font-medium">Owner</span>
                </div>
                <p className="text-[11px] text-gray-500">Manage your properties with ease.</p>
              </div>
            </div>

            

            {/* Search Bar with Filter Trigger */}
            <div className="relative flex items-center">
              <SearchBar
                type="button"
                onClick={() => setShowSearchResults(true)}
                aria-label="Search listings"
              >
                {searchQuery || searchFilters.location || searchFilters.propertyType || Number(searchFilters.maxPrice) < 200000
                  ? [searchQuery, searchFilters.location, searchFilters.propertyType, Number(searchFilters.maxPrice) < 200000 ? `Up to ₱${Number(searchFilters.maxPrice).toLocaleString()}` : ''].filter(Boolean).join(' • ')
                  : 'Search location, property, or listings...'}
              </SearchBar>
              <button 
                onClick={() => setShowFilterModal(true)} 
                type="button"
                aria-label="Open search filters"
                className="absolute right-3 text-gray-600 hover:text-emerald-700 cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
              </button>
            </div>

            {/* Overview Box */}
            <div className="bg-[#CFE2CE] p-3.5 rounded-2xl border border-[#B3D3AC]">
              <h3 className="text-xs font-bold text-gray-800 mb-2">Overview</h3>
              <div className="boardmate-dashboard-shortcuts grid grid-cols-5 gap-2">
                <div className="bg-[#B2D5A8] p-2 rounded-xl text-center flex flex-col items-center justify-center">
                  <BoardMateHouseIcon className="w-4 h-4 text-[#76A77E] mb-1" />
                  <span className="text-xs font-bold text-gray-800">{myListings.filter(item => item.available && item.moderationStatus === 'approved').length}</span>
                  <span className="text-[8px] text-gray-600 leading-tight">Active Listings</span>
                </div>
                <div className="bg-[#B2D5A8] p-2 rounded-xl text-center flex flex-col items-center justify-center">
                  <MessageIcon className="mb-1 h-5 w-5 text-[#76A77E]" />
                  <span className="text-xs font-bold text-gray-800">{totalListingInquiries}</span>
                  <span className="text-[8px] text-gray-600 leading-tight">Inquiries</span>
                </div>
                <div className="bg-[#B2D5A8] p-2 rounded-xl text-center flex flex-col items-center justify-center">
                  <i className="fa-regular fa-eye text-[#76A77E] text-base mb-1"></i>
                  <span className="text-xs font-bold text-gray-800">{uniqueProfileViews}</span>
                  <span className="text-[8px] text-gray-600 leading-tight">Profile Views</span>
                </div>
                <div className="bg-[#B2D5A8] p-2 rounded-xl text-center flex flex-col items-center justify-center">
                  <i className="fa-regular fa-heart text-[#76A77E] text-base mb-1"></i>
                  <span className="text-xs font-bold text-gray-800">{totalListingLikes}</span>
                  <span className="text-[8px] text-gray-600 leading-tight">Liked</span>
                </div>
                <div className="bg-[#B2D5A8] p-2 rounded-xl text-center flex flex-col items-center justify-center">
                  <i className="fa-solid fa-star text-amber-500 text-base mb-1"></i>
                  <span className="text-xs font-bold text-gray-800">{averageListingRating.toFixed(1)}</span>
                  <span className="text-[8px] text-gray-600 leading-tight">Stars · {totalListingRatings}</span>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div>
              <h3 className="text-xs font-bold text-gray-800 mb-2">Quick Actions</h3>
              <QuickActions>
                <button 
                  onClick={() => setActiveTab('create')}
                  className="bg-[#CFE2CE] p-3 rounded-2xl flex flex-col items-center justify-center gap-1 hover:bg-[#B2D5A8] transition cursor-pointer"
                >
                  <div className="w-8 h-8 rounded-full bg-[#76A77E] text-white flex items-center justify-center text-sm">
                    <i className="fa-solid fa-plus"></i>
                  </div>
                  <span className="text-[10px] font-bold text-gray-800">Add New Listing</span>
                </button>

                <button 
                  onClick={() => setActiveTab('listings')}
                  className="bg-[#CFE2CE] p-3 rounded-2xl flex flex-col items-center justify-center gap-1 hover:bg-[#B2D5A8] transition cursor-pointer"
                >
                  <i className="fa-solid fa-city text-[#76A77E] text-xl"></i>
                  <span className="text-[10px] font-bold text-gray-800">My Listing</span>
                </button>

                <button 
                  onClick={() => setActiveTab('messages')}
                  className="bg-[#CFE2CE] p-3 rounded-2xl flex flex-col items-center justify-center gap-1 hover:bg-[#B2D5A8] transition cursor-pointer relative"
                >
                  <MessageIcon className="h-6 w-6 text-[#76A77E]" />
                  <span className="text-[10px] font-bold text-gray-800">Messages</span>
                  {unreadMessageCount > 0 && <span className="absolute top-2 right-2 grid min-h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{unreadMessageCount > 9 ? '9+' : unreadMessageCount}</span>}
                </button>

                <button
                  type="button"
                  onClick={openNotifications}
                  aria-label={`Notifications, ${unreadNotificationCount} unread`}
                  className="relative bg-[#CFE2CE] p-3 rounded-2xl flex flex-col items-center justify-center gap-1 hover:bg-[#B2D5A8] transition cursor-pointer"
                >
                  <i className="fa-regular fa-bell text-[#76A77E] text-xl"></i>
                  <span className="text-[10px] font-bold text-gray-800">Notifications</span>
                  {unreadNotificationCount > 0 && <span className="absolute top-2 right-2 grid min-h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}</span>}
                </button>
              </QuickActions>
            </div>

            {/* My Listings Preview */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-xs font-bold text-gray-800">My Listings</h3>
                <button onClick={() => setActiveTab('listings')} className="text-[10px] text-[#76A77E] font-bold underline cursor-pointer">View All</button>
              </div>

              {dashboardError && <p className="text-xs text-red-600" role="alert">{dashboardError}</p>}
              <div className="space-y-3">
                {filteredOwnerListings.map(item => (
                  <button key={item.id} type="button" onClick={() => setProfileListingPreview(item)} aria-label={`View full details for ${item.title}`} className="w-full min-w-0 text-left bg-white p-2.5 rounded-2xl shadow-sm border border-gray-100 flex gap-3 items-center transition hover:shadow-md hover:border-[#76A77E] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#76A77E]">
                    {item.image ? (
                      <ProfileImage src={item.image} alt={item.title} className="w-24 h-20 rounded-xl object-cover" />
                    ) : (
                      <div className="w-24 h-20 rounded-xl bg-gray-100 flex items-center justify-center text-gray-400">
                        <i className="fa-regular fa-image"></i>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start">
                        <h4 className="font-bold text-xs text-gray-800 truncate">{item.title}</h4>
                      </div>
                      <p className="text-[10px] text-[#76A77E] font-bold">{item.price}</p>
                      <p className="flex items-center gap-1 text-[9px] text-gray-500">
                        <LocationIcon className="h-3 w-3 shrink-0" />
                        <span className="truncate">{item.location}</span>
                      </p>
                      {item.moderationStatus !== 'approved' && (
                        <p className={`mt-1 text-[9px] font-bold ${item.moderationStatus === 'rejected' ? 'text-red-600' : 'text-amber-700'}`}>
                          {item.moderationStatus === 'rejected' ? 'Rejected' : 'Pending review'}
                        </p>
                      )}
                      <div className="mt-2 flex justify-end">
                        <span className="text-[9px] text-gray-400 flex items-center gap-1">
                          {listingFavoriteCounts[item.id] || 0} likes
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
                {!loadingListings && filteredOwnerListings.length === 0 && myListings.length > 0 && (
                  <div className="py-4 text-center">
                    <p className="text-xs text-gray-400">No listings match your search filters.</p>
                    <button
                      type="button"
                      onClick={() => { setSearchQuery(''); setSearchFilters(defaultListingFilters); }}
                      className="mt-1 text-xs font-semibold text-[#76A77E] underline cursor-pointer"
                    >
                      Clear filters
                    </button>
                  </div>
                )}
                {!loadingListings && myListings.length === 0 && (
                  <p className="text-center text-xs text-gray-400 py-4">You have not created any listings yet.</p>
                )}
                {loadingListings && <p className="text-center text-xs text-gray-400 py-4">Loading listings...</p>}
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 2: MY LISTINGS ==================== */}
        {activeTab === 'listings' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <i className="fa-solid fa-city text-2xl text-gray-800"></i>
              <h2 className="text-lg font-bold text-gray-800">My Listings</h2>
            </div>
            <SearchBar value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search your listings" aria-label="Search owner listings" />

            {dashboardError && <p className="text-xs text-red-600" role="alert">{dashboardError}</p>}
            <div className="space-y-4">
              {filteredOwnerListings.map(item => (
                <article id={`owner-listing-${item.id}`} key={item.id} className="relative isolate bg-white p-3 rounded-2xl shadow-sm border border-gray-100 space-y-2 transition hover:shadow-md hover:border-[#76A77E]">
                  <button type="button" onClick={() => setProfileListingPreview(item)} aria-label={`View full details for ${item.title}`} className="absolute inset-0 z-10 rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#76A77E]">
                    <span className="sr-only">View full listing details</span>
                  </button>
                  <div className="flex gap-3 items-start">
                    {item.image ? (
                      <ProfileImage src={item.image} alt={item.title} className="w-28 h-20 rounded-xl object-cover" />
                    ) : (
                      <div className="w-28 h-20 rounded-xl bg-gray-100 flex items-center justify-center text-gray-400">
                        <i className="fa-regular fa-image"></i>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-xs text-gray-800">{item.title}</h4>
                      <p className="text-[10px] text-[#76A77E] font-bold">{item.price}</p>
                      <p className="flex items-center gap-1 text-[9px] text-gray-500">
                        <LocationIcon className="h-3 w-3 shrink-0" />{item.location}
                      </p>
                      <p className="text-[9px] text-amber-700">★ {item.ratingAverage.toFixed(1)} · {item.ratingCount} ratings</p>
                      <p className={`mt-1 text-[9px] font-bold ${item.moderationStatus === 'approved' ? 'text-emerald-700' : item.moderationStatus === 'rejected' ? 'text-red-600' : 'text-amber-700'}`}>
                        {item.moderationStatus === 'approved' ? 'Published' : item.moderationStatus === 'rejected' ? `Rejected${item.moderationReason ? `: ${item.moderationReason}` : ''}` : 'Pending admin review'}
                      </p>
                      <p className="mt-1 text-[9px] font-semibold text-[#588061]">Open full details &middot; {getListingMedia(item).length} media</p>
                    </div>
                  </div>

                  <div className="text-[10px] text-gray-600 bg-gray-50 p-2 rounded-xl">
                    <span className="font-bold block text-gray-700">Description:</span>
                    <p className="whitespace-pre-line">{item.description}</p>
                  </div>

                  {getListingMedia(item).length > 1 && <div className="grid grid-cols-4 gap-2" aria-label={`Uploaded media for ${item.title}`}>
                    {getListingMedia(item).filter(media => media.url !== item.image).map(media => (
                      media.mimeType.startsWith('image/')
                        ? <ProfileImage key={media.url} src={media.url} alt={media.name} loading="lazy" className="aspect-[4/3] w-full rounded-lg object-cover" />
                        : <div key={media.url} className="grid aspect-[4/3] place-items-center rounded-lg bg-gray-100 text-[9px] font-semibold text-gray-500">{media.mimeType.startsWith('video/') ? 'Video' : 'Audio'}</div>
                    ))}
                  </div>}

                  <div className="pointer-events-none relative z-20 flex justify-between items-center pt-1">
                    {item.moderationStatus === 'approved' ? (
                      <>
                        <button 
                          onClick={() => toggleAvailability(item)}
                          className={`pointer-events-auto text-[10px] px-4 py-1 rounded-full font-bold transition ${item.available ? 'bg-[#76A77E] text-white' : 'bg-gray-400 text-white'}`}
                        >
                          {item.available ? 'Available' : 'Unavailable'}
                        </button>
                        <button onClick={() => toggleAvailability(item)} className="pointer-events-auto text-[9px] text-gray-500 underline cursor-pointer">
                          Change Availability
                        </button>
                      </>
                    ) : (
                      <span className="text-[10px] text-gray-500">
                        {item.moderationStatus === 'rejected' ? 'Update your listing and submit a new version.' : 'It will appear in search after approval.'}
                      </span>
                    )}
                  </div>
                </article>
              ))}
            </div>

            {!loadingListings && myListings.length === 0 && (
              <p className="text-center text-[10px] text-gray-400 py-2">You have not created any listings yet.</p>
            )}
            {loadingListings && <p className="text-center text-[10px] text-gray-400 py-2">Loading listings...</p>}
          </div>
        )}

        {/* ==================== TAB 3: CREATE POST ==================== */}
        {activeTab === 'create' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 border-2 border-gray-800 rounded-lg flex items-center justify-center text-sm font-bold">
                <i className="fa-solid fa-plus"></i>
              </div>
              <h2 className="text-lg font-bold text-gray-800">Create a Post</h2>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-gray-700 block mb-1">Title:</label>
                <input 
                  type="text" 
                  value={newPost.title}
                  onChange={(e) => setNewPost({ ...newPost, title: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl bg-white border border-gray-300 text-xs focus:outline-none focus:ring-2 focus:ring-[#76A77E]" 
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-gray-700 block mb-1">Price:</label>
                <input 
                  type="text" 
                  value={newPost.price}
                  onChange={(e) => setNewPost({ ...newPost, price: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl bg-white border border-gray-300 text-xs focus:outline-none focus:ring-2 focus:ring-[#76A77E]" 
                />
              </div>

              <div>
                <label htmlFor="listing-location" className="mb-1 flex items-center gap-1 text-[11px] font-bold text-gray-700">
                  <LocationIcon className="h-4 w-4" />Location:
                </label>
                <input
                  id="listing-location"
                  type="text"
                  value={newPost.location}
                  onChange={(e) => setNewPost({ ...newPost, location: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl bg-white border border-gray-300 text-xs focus:outline-none focus:ring-2 focus:ring-[#76A77E]"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-bold text-gray-700">Description:</label>
                <textarea 
                  rows={3}
                  value={newPost.description}
                  onChange={(e) => setNewPost({ ...newPost, description: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-white border border-gray-300 text-xs focus:outline-none focus:ring-2 focus:ring-[#76A77E]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <label className="bg-white border border-[#76A77E] rounded-2xl p-4 text-center flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50">
                  <i className="fa-solid fa-cloud-arrow-up text-3xl text-gray-800 mb-2"></i>
                  <span className="text-[10px] font-bold text-gray-700">Add Cover Photo</span>
                  <ImageUploadInput
                    type="file"
                    className="hidden"
                    accept="image/*"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        if (coverPhoto) revokeMediaPreviewUrl(coverPhoto.previewUrl);
                        setCoverPhoto({ file, previewUrl: createMediaPreviewUrl(file) });
                      }
                      event.target.value = '';
                    }}
                  />
                </label>

                <div className="h-28 overflow-hidden rounded-2xl border border-gray-200 bg-white text-center">
                  {coverPhoto ? (
                    <button
                      type="button"
                      onClick={() => openImageEditor('cover', coverPhoto)}
                      aria-label="Crop or cancel cover photo"
                      className="h-full w-full cursor-zoom-in"
                    >
                      <ProfileImage src={coverPhoto.previewUrl} alt={`Cover photo preview: ${coverPhoto.file.name}`} className="h-full w-full object-cover" />
                    </button>
                  ) : (
                    <div className="flex h-full items-center justify-center p-4 text-[10px] text-gray-400">No cover photo selected</div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="bg-white border border-[#76A77E] rounded-2xl p-4 text-center flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50">
                  <i className="fa-solid fa-cloud-arrow-up text-3xl text-gray-800 mb-2"></i>
                  <span className="text-[10px] font-bold text-gray-700">Add Photos / videos</span>
                  <ImageUploadInput
                    type="file"
                    className="hidden"
                    multiple
                    accept="image/*,video/*,audio/*"
                    onChange={(event) => {
                      const files = Array.from(event.target.files || []);
                      setListingMedia(current => [
                        ...current,
                        ...files.map(file => {
                          const previewUrl = createMediaPreviewUrl(file);
                          return { file, previewUrl };
                        }),
                      ]);
                      event.target.value = '';
                    }}
                  />
                </label>

                <div className="max-h-28 min-h-28 overflow-y-auto rounded-2xl border border-gray-200 bg-white p-2">
                  {listingMedia.length ? (
                    <div className="grid grid-cols-2 gap-1.5">
                      {listingMedia.map(({ file, previewUrl }, index) => (
                        <div key={previewUrl} className="min-w-0">
                          {file.type.startsWith('video/') ? (
                            <div>
                              <UploadedMedia as="video" src={previewUrl} aria-label={`Video preview: ${file.name}`} controls playsInline className="h-14 w-full rounded-lg bg-gray-100 object-cover" />
                              <button type="button" onClick={() => setMediaPreview({ src: previewUrl, name: file.name, mimeType: file.type })} className="mt-1 text-[8px] font-semibold text-emerald-700">Preview and save</button>
                            </div>
                          ) : file.type.startsWith('audio/') ? (
                            <div>
                              <UploadedMedia as="audio" src={previewUrl} aria-label={`Audio preview: ${file.name}`} controls className="w-full" />
                              <button type="button" onClick={() => setMediaPreview({ src: previewUrl, name: file.name, mimeType: file.type })} className="mt-1 text-[8px] font-semibold text-emerald-700">Preview audio</button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openImageEditor('gallery', { file, previewUrl }, index)}
                              aria-label={`Crop or cancel ${file.name}`}
                              className="w-full cursor-zoom-in"
                            >
                              <ProfileImage src={previewUrl} alt={`Photo preview: ${file.name}`} className="h-14 w-full rounded-lg object-cover" />
                            </button>
                          )}
                          <p className="truncate text-[8px] text-gray-500" title={file.name}>{file.name}</p>
                          <button
                            type="button"
                            onClick={() => removeListingMedia(index)}
                            className="text-[8px] font-semibold text-red-600 underline"
                          >
                            Cancel photo
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center text-center text-[10px] text-gray-400">Added photos and videos appear here</div>
                  )}
                </div>
              </div>

              <div className="flex justify-end items-center gap-3 pt-3">
                <button 
                  onClick={() => setActiveTab('home')}
                  className="text-xs font-bold text-gray-500 hover:text-gray-700 cursor-pointer"
                >
                  CANCEL
                </button>
              <button
                type="button"
                onClick={handleUploadPost}
                disabled={uploadingListing}
                className="px-6 py-2 bg-[#76A77E] text-white font-bold rounded-xl text-xs shadow hover:bg-[#638F6A] transition cursor-pointer disabled:cursor-wait disabled:opacity-60"
              >
                {uploadingListing ? 'UPLOADING...' : 'UPLOAD'}
              </button>
              </div>
              {dashboardError && <p className="text-xs text-red-600" role="alert">{dashboardError}</p>}
            </div>
          </div>
        )}

        {/* ==================== TAB 4: MESSAGES (INBOX & CHAT) ==================== */}
        {activeTab === 'messages' && (
          <div className={selectedChat ? 'flex h-full min-h-0 flex-1 flex-col' : 'space-y-3'}>
            {/* Owner Greeting on top */}
            {!selectedChat && <div className="flex items-center gap-3 mb-2">
              <span className="relative shrink-0">
                {userProfile?.avatar ? (
                  <ProfileImage src={userProfile.avatar} alt="Owner" className="w-12 h-12 rounded-full object-cover border-2 border-[#76A77E]" />
                ) : (
                  <span className="grid h-12 w-12 place-items-center rounded-full border-2 border-[#76A77E] bg-white text-gray-400">
                    <i className="fa-regular fa-user"></i>
                  </span>
                )}
                
              </span>
              <div>
                <span className="text-[10px] text-gray-500">Welcome back,</span>
                <div className="flex items-center gap-1.5">
                  <h2 className="font-bold text-gray-800 text-xs">{userProfile?.fullName || 'Owner'}</h2>
                  <span className="text-[9px] bg-[#C5DCB9] text-gray-700 px-1.5 py-0.2 rounded-full">Owner</span>
                </div>
                <p className="text-[9px] text-gray-400">Manage your properties with ease.</p>
              </div>
            </div>}

            

            {!selectedChat ? (
              /* VIEW 1: INBOX LIST */
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <MessageIcon className="h-7 w-7 text-gray-800" />
                  <h2 className="text-base font-bold text-gray-800">Messages</h2>
                </div>

                <div className="bg-white rounded-2xl p-3 shadow-sm space-y-2 min-h-[360px]">
                  {chats.map(chat => (
                    <div key={chat.id} className="relative flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openOwnerChat(chat)}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl bg-gray-100/70 p-2 text-left transition hover:bg-gray-200/80"
                      >
                        <div className="relative shrink-0">
                          {chat.avatar ? (
                            <ProfileImage src={chat.avatar} alt="" className="h-10 w-10 rounded-full object-cover" />
                          ) : (
                            <div className="grid h-10 w-10 place-items-center rounded-full bg-gray-200 text-gray-500">
                              <i className="fa-regular fa-user"></i>
                            </div>
                          )}
                          {isUserActive(chat.lastSeenAt) && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="font-bold text-xs text-gray-800">{chat.sender}</h4>
                          <p className="truncate text-[10px] text-gray-500">
                            {chat.lastMessage || 'New conversation'}
                            {chat.lastSeenAt && <span className="ml-1">{isUserActive(chat.lastSeenAt) ? '· Active now' : `· ${formatLastSeen(chat.lastSeenAt)}`}</span>}
                          </p>
                        </div>
                        {(chat.unreadCount || 0) > 0 && (
                          <span className="grid min-h-4 min-w-4 place-items-center rounded-full bg-[#76A77E] px-1 text-[9px] font-bold text-white">
                            {(chat.unreadCount || 0) > 9 ? '9+' : (chat.unreadCount || 0)}
                          </span>
                        )}
                      </button>
                      <div data-message-popover className="relative shrink-0">
                        <button type="button" aria-label={`Options for ${chat.sender}`} aria-expanded={contactOptionsOpenId === chat.userId} onClick={() => setContactOptionsOpenId(current => current === chat.userId ? null : chat.userId)} className="relative z-10 grid h-10 w-10 shrink-0 touch-manipulation place-items-center rounded-full text-gray-500 hover:bg-gray-100">•••</button>
                        {contactOptionsOpenId === chat.userId && (
                          <div data-message-popover className="absolute right-0 top-full z-30 w-44 rounded-xl border border-gray-200 bg-white p-1 shadow-xl">
                            <button type="button" onClick={() => deleteOwnerConversation(chat)} className="w-full rounded-lg px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50">Delete Conversation…</button>
                            {chat.userId !== userId && (
                              <>
                              <button type="button" onClick={event => { event.preventDefault(); event.stopPropagation(); reportOwnerConversation(chat); }} className="min-h-10 w-full touch-manipulation rounded-lg px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50">Report</button>
                              <button type="button" onClick={() => { setDashboardError(''); setBlockTargetContact(chat); setContactOptionsOpenId(null); setBlockConfirmationOpen(true); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-red-700 hover:bg-red-50">Block Account</button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {chats.length === 0 && <p className="text-center text-[10px] text-gray-400 pt-10">No messages yet.</p>}
                </div>
              </div>
            ) : (
              /* VIEW 2: ACTIVE CONVERSATION */
              <div className="relative flex min-h-0 flex-1 flex-col rounded-2xl bg-white p-3 shadow-sm">
                {/* Chat Header */}
                <div className="relative flex items-center justify-between border-b border-gray-100 pb-3">
                  <button onClick={() => { setSelectedChat(null); setChatOptionsOpen(false); }} aria-label="Back to messages" className="text-gray-700 text-lg cursor-pointer">
                    <i className="fa-solid fa-chevron-left"></i>
                  </button>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setPublicProfileUserId(selectedChat.userId)} aria-label={`View ${selectedChat.sender}'s profile`} className="relative">
                      {selectedChat.avatar ? <ProfileImage src={selectedChat.avatar} alt="" className="h-9 w-9 rounded-full object-cover" /> : <span className="grid h-9 w-9 place-items-center rounded-full bg-gray-100">👤</span>}
                      {isUserActive(selectedChat.lastSeenAt) && <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" />}
                    </button>
                    <button type="button" onClick={() => setPublicProfileUserId(selectedChat.userId)} className="text-left">
                      <span className="block font-bold text-xs text-gray-800">{selectedChat.sender}</span>
                      <span className="block text-[9px] text-gray-500">
                        {isUserActive(selectedChat.lastSeenAt) ? 'Active now' : formatLastSeen(selectedChat.lastSeenAt)}
                      </span>
                    </button>
                  </div>
                  <div data-message-popover className="relative">
                    <button type="button" aria-label="Conversation options" onClick={() => setChatOptionsOpen(open => !open)} className="relative z-10 grid h-10 w-10 shrink-0 touch-manipulation place-items-center rounded-full text-gray-500">•••</button>
                    {chatOptionsOpen && (
                      <div data-message-popover className="absolute right-0 top-full z-30 w-48 rounded-xl border border-gray-200 bg-white p-1 shadow-xl">
                        <button type="button" onClick={() => deleteOwnerConversation(selectedChat)} className="w-full rounded-lg px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50">Delete Conversation…</button>
                        {selectedChat.userId !== userId && (
                          <>
                            <button type="button" onClick={event => { event.preventDefault(); event.stopPropagation(); reportOwnerConversation(selectedChat); }} className="min-h-10 w-full touch-manipulation rounded-lg px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50">Report</button>
                            <button type="button" onClick={() => { setDashboardError(''); setBlockTargetContact(selectedChat); setChatOptionsOpen(false); setBlockConfirmationOpen(true); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-red-700 hover:bg-red-50">Block Account</button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Chat Messages Body */}
                <div ref={chatMessagesRef} role="log" aria-live="polite" aria-label="Conversation messages" className="min-h-0 flex-1 space-y-3 overflow-y-auto py-3 no-scrollbar">
                  {historyPages[`${userId}:${selectedChat?.userId}`]?.hasOlder && (
                    <button type="button" onClick={loadOlderMessages} disabled={loadingOlderMessages} className="mx-auto block rounded-lg px-3 py-2 text-xs font-bold text-emerald-800 disabled:opacity-50">
                      {loadingOlderMessages ? 'Loading older messages...' : 'Load older messages'}
                    </button>
                  )}
                  {(selectedChat.messages || []).map((m) => (
                    <div key={m.id} className={`flex flex-col ${m.sender === 'me' ? 'items-end' : 'items-start'}`}>
                      <div className={`flex min-w-0 w-full max-w-full items-start gap-1 ${m.sender === 'me' ? 'flex-row-reverse' : ''}`}>
                        {!m.deletedAt && (
                          <div data-message-popover className="relative z-20 shrink-0">
                            <button type="button" aria-label="Message options" onClick={() => setMessageOptionsOpenId(current => current === m.id ? null : m.id)} className="grid h-8 w-5 place-items-center text-gray-400">⋮</button>
                            {messageOptionsOpenId === m.id && (
                              <div onClick={event => event.stopPropagation()} className={`absolute ${m.sender === 'me' ? 'right-0' : 'left-0'} top-full z-30 w-40 rounded-xl border border-gray-200 bg-white p-1 shadow-xl`}>
                                {m.sender === 'me' && <button type="button" onClick={() => unsendMessage(m, true)} className="w-full rounded-lg px-2 py-2 text-left text-[10px] text-red-600 hover:bg-red-50">Unsend for everyone</button>}
                                <button type="button" onClick={() => unsendMessage(m, false)} className="w-full rounded-lg px-2 py-2 text-left text-[10px] text-gray-700 hover:bg-gray-50">Unsend for you</button>
                              </div>
                            )}
                          </div>
                        )}
                        <div className={`bm-message-bubble ${m.attachmentUrl ? 'bm-message-attachment' : ''} min-w-0 max-w-[78%] space-y-1 rounded-2xl p-2.5 text-[11px] ${
                          m.sender === 'me' ? 'bg-[#DCEBDD] text-gray-800' : 'bg-gray-200/90 text-gray-800'
                        } ${m.deletedAt ? 'italic text-gray-500' : ''}`}>
                          {m.isForwarded && <p className="text-[9px] font-semibold text-emerald-700">Shared</p>}
                          {m.attachmentMime?.startsWith('image/') && m.attachmentUrl && (
                            <button className="bm-chat-image-button" type="button" onClick={() => setMediaPreview({ src: m.attachmentUrl, name: m.attachmentName || 'Message photo', mimeType: m.attachmentMime })}>
                              <ProfileImage src={m.attachmentUrl} alt={m.attachmentName || 'Message attachment'} className="bm-chat-image" />
                            </button>
                          )}
                          {m.attachmentMime?.startsWith('video/') && m.attachmentUrl && (
                            <div>
                              <ConversationMediaPlayer src={m.attachmentUrl} mimeType={m.attachmentMime} className="max-h-64 max-w-full rounded-xl" onPreview={() => setMediaPreview({ src: m.attachmentUrl, name: m.attachmentName || 'Message video', mimeType: m.attachmentMime })} />
                            </div>
                          )}
                          {m.attachmentMime?.startsWith('audio/') && m.attachmentUrl && (
                            <div>
                              <ConversationMediaPlayer src={m.attachmentUrl} mimeType={m.attachmentMime} className="max-w-full" onPreview={() => setMediaPreview({ src: m.attachmentUrl, name: m.attachmentName || 'Message audio', mimeType: m.attachmentMime })} />
                            </div>
                          )}
                          {m.attachmentUrl && !/^(image|video|audio)\//.test(m.attachmentMime || '') && <button type="button" className="block max-w-full break-words text-left text-xs underline" onClick={() => setMediaPreview({ src: m.attachmentUrl, name: m.attachmentName || 'Attachment', mimeType: m.attachmentMime || 'application/octet-stream' })}>Preview and download {m.attachmentName || 'attachment'}</button>}
                          {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                        </div>
                        {!m.deletedAt && <button type="button" aria-label="Share message" onClick={() => { setShareTargetMessage(m); setShareSearch(''); }} className="grid h-8 w-6 shrink-0 self-center place-items-center text-gray-400 hover:text-emerald-700"><span aria-hidden="true">{m.sender === 'me' ? '←' : '→'}</span></button>}
                      </div>
                      <div className="mt-1 flex items-center gap-1 text-[9px] text-gray-400">
                        <time dateTime={m.createdAt} title={new Date(m.createdAt).toLocaleString()}>
                          {new Date(m.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        </time>
                        {m.sender === 'me' && (
                          <span className="flex items-center gap-1 text-gray-500">
                            {m.seenAt
                              ? <><span className="font-bold text-sky-600">✓✓</span> Seen</>
                              : <><span className="font-bold">✓</span> Sent</>}
                          </span>
                        )}
                      </div>
                      {!m.deletedAt && (
                        <div className="relative mt-1 flex flex-wrap items-center gap-1">
                          {m.reactions.filter((reaction, index, all) => all.findIndex(item => item.reaction === reaction.reaction) === index).map(reaction => (
                            <button key={reaction.reaction} type="button" onClick={() => toggleMessageReaction(m, reaction.reaction)} className={`rounded-full border px-1.5 py-0.5 text-[10px] ${m.reactions.some(item => item.reaction === reaction.reaction && item.isMine) ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 bg-white'}`}>
                              {{ like: '👍', heart: '❤️', laugh: '😂', surprise: '😮', sad: '😢', angry: '😡' }[reaction.reaction]}
                              {' '}{m.reactions.filter(item => item.reaction === reaction.reaction).length}
                            </button>
                          ))}
                          <button type="button" aria-label="React to message" onClick={() => setReactionPickerMessageId(current => current === m.id ? null : m.id)} className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] text-gray-500">＋ React</button>
                          {reactionPickerMessageId === m.id && (
                            <div data-message-popover className={`absolute bottom-full z-30 mb-1 flex gap-1 rounded-full border border-gray-200 bg-white p-1 shadow-lg ${m.sender === 'me' ? 'right-0' : 'left-0'}`}>
                              {[['like', '👍'], ['heart', '❤️'], ['laugh', '😂'], ['surprise', '😮'], ['sad', '😢'], ['angry', '😡']].map(([reaction, emoji]) => (
                                <button key={reaction} type="button" aria-label={`React ${reaction}`} onClick={() => toggleMessageReaction(m, reaction)} className="rounded-full p-1 text-base hover:bg-gray-100">{emoji}</button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  <div aria-hidden="true" />
                </div>

                {/* Chat Input Bar */}
                <div className="flex items-center gap-2 border-t border-gray-100 pt-2">
                  <button type="button" onClick={() => chatFileInput.current?.click()} aria-label="Attach an image, video, or audio file" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-gray-600 hover:bg-gray-100">
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L7 9m5-5 5 5M5 14v4a2 2 0 002 2h10a2 2 0 002-2v-4" />
                    </svg>
                  </button>
                  <ImageUploadInput
                    ref={chatFileInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/webm,audio/aac"
                    className="hidden"
                    onChange={selectChatAttachment}
                  />
                  <textarea
                    ref={chatInputRef}
                    rows={1}
                    maxLength={2000}
                    placeholder="Type here to start conversation..."
                    value={chatInput}
                    onChange={event => {
                      setChatInput(event.target.value);
                      event.currentTarget.style.height = 'auto';
                      event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 112)}px`;
                    }}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        sendMessage();
                      }
                    }}
                    className="max-h-28 min-h-10 flex-1 resize-none overflow-y-auto rounded-2xl border border-gray-300 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#76A77E]"
                  />
                  {chatAttachment && (
                    <span className="flex max-w-24 items-center gap-1">
                      <button type="button" onClick={() => chatAttachmentPreviewUrl.current && setMediaPreview({ src: chatAttachmentPreviewUrl.current, name: chatAttachment.name, mimeType: chatAttachment.type })} className="truncate text-[9px] text-emerald-700 underline">Preview {chatAttachment.name}</button>
                      <button type="button" onClick={clearChatAttachment} aria-label="Remove message attachment" className="text-sm font-bold text-red-600">×</button>
                    </span>
                  )}
                  <button type="button" onClick={sendMessage} disabled={!chatInput.trim() && !chatAttachment} aria-label="Send message" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#76A77E] text-white disabled:opacity-40">
                    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M3.4 20.4 21 12 3.4 3.6l.1 6.5 12.2 1.9-12.2 1.9-.1 6.5z" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================== TAB 5: OWNER ACCOUNT & PROFILE ==================== */}
        {activeTab === 'profile' && (
          <div className="bm-profile-page">
            <ProfileHero name={userProfile?.fullName || 'Owner'} avatar={userProfile?.avatar}
              role="Owner / Landlord"
              onPreview={setMediaPreview} onPhotoChange={handleProfilePhotoChange} uploading={uploadingPhoto} />
            
            <ProfileDetails onEdit={openProfileEditor} fields={[
              { label: 'Full name', value: userProfile?.fullName },
              { label: 'Email address', value: userProfile?.email },
              { label: 'Phone number', value: userProfile?.phone },
              { label: 'Date of birth', value: userProfile?.dob },
              { label: 'Gender', value: userProfile?.gender },
              { label: 'Business / owner name', value: userProfile?.businessName },
              { label: 'Government ID number', value: userProfile?.govIdNumber },
              { label: 'Property type', value: userProfile?.propertyType },
              { label: 'Address', value: userProfile?.address, wide: true },
            ]} />
            <ProfileSection title="Photos & media" action="See all media" onAction={() => setActiveTab('profile_photos')}>
              <ProfileMediaGallery onPhotoChanged={refreshProfilePhotos} media={ownProfileMedia.slice(0, 6)} onPreview={setMediaPreview} />
            </ProfileSection>
            <ProfileSection title="My listings" action="See all listings" onAction={() => setActiveTab('profile_posts')}>
              <div className="bm-profile-feed">{myListings.map(renderProfileListing)}</div>
              {!myListings.length && <p className="bm-profile-empty">No listings yet.</p>}
            </ProfileSection>
          </div>
        )}

        {activeTab === 'profile_photos' && (
          <div className="bm-profile-page">
            <div className="bm-profile-gallery-page-heading"><h1>Photos & media</h1><button type="button" className="bm-profile-link" onClick={() => setActiveTab('profile')}>Back to profile</button></div>
            <ProfileSection title={`Your gallery (${ownProfileMedia.length})`}>
              <ProfileMediaGallery onPhotoChanged={refreshProfilePhotos} media={ownProfileMedia} onPreview={setMediaPreview} />
            </ProfileSection>
          </div>
        )}

        {activeTab === 'profile_posts' && (
          <div className="bm-profile-page">
            <div className="bm-profile-gallery-page-heading"><h1>My listings</h1><button type="button" className="bm-profile-link" onClick={() => setActiveTab('profile')}>Back to profile</button></div>
            <div className="bm-profile-feed">{myListings.map(renderProfileListing)}</div>
            {!myListings.length && <p className="bm-profile-empty">No listings yet.</p>}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-3">
            <h2 className="text-base font-bold">Activity History</h2>
            {dashboardError && <p className="text-xs text-red-600" role="alert">{dashboardError}</p>}
            {loadingHistory && <p className="text-xs text-gray-400">Loading history...</p>}
            {!loadingHistory && activityHistory.map(entry => (
              <div key={entry.id} className="rounded-xl bg-white p-3 shadow-sm">
                <p className="text-xs font-semibold">{entry.action}</p>
                {entry.details && <p className="mt-1 text-[10px] text-gray-500">{entry.details}</p>}
                <time className="mt-1 block text-[9px] text-gray-400">{new Date(entry.created_at).toLocaleString()}</time>
              </div>
            ))}
            {!loadingHistory && activityHistory.length === 0 && <p className="text-xs text-gray-400">No activity recorded yet.</p>}
          </div>
        )}

      </div>

      {userProfile?.suspendedAt && (
        <div className="absolute inset-0 z-[95] flex items-center justify-center bg-[#FAF6EE]/95 p-5" role="alertdialog" aria-modal="true" aria-labelledby="owner-suspension-title">
          <div className="w-full max-w-sm space-y-3 rounded-2xl border border-red-200 bg-white p-5 shadow-2xl">
            <h2 id="owner-suspension-title" className="text-sm font-bold text-red-800">Account suspended</h2>
            <p className="text-xs text-gray-700">Your account is suspended. Posting, editing, messaging, and other account actions are disabled.</p>
            {userProfile.suspensionReason && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-800">{userProfile.suspensionReason}</p>}
            <button type="button" onClick={onLogout} className="w-full rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white">Log out</button>
          </div>
        </div>
      )}

      {blockConfirmationOpen && blockTargetContact && (
        <div className="absolute inset-0 z-[84] flex items-center justify-center bg-black/55 p-4" role="alertdialog" aria-modal="true" aria-labelledby="owner-block-title">
          <div className="w-full max-w-xs space-y-4 rounded-2xl bg-white p-5 shadow-2xl">
            <h2 id="owner-block-title" className="text-sm font-bold text-gray-900">Are you sure you want to block this person?</h2>
            <p className="text-xs text-gray-600">{blockTargetContact.sender || blockTargetContact.name} and their posts/listings will no longer appear to you.</p>
            {dashboardError && <p className="text-xs text-red-600" role="alert">{dashboardError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setBlockConfirmationOpen(false); setBlockTargetContact(null); }} className="rounded-lg bg-gray-100 px-4 py-2 text-xs font-semibold text-gray-700">NO</button>
              <button type="button" onClick={() => blockSelectedContact(blockTargetContact)} className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white">YES</button>
            </div>
          </div>
        </div>
      )}

      {messageActionConfirmation && (
        <div className="absolute inset-0 z-[86] flex items-center justify-center bg-black/55 p-4" role="alertdialog" aria-modal="true" aria-labelledby="owner-message-action-title">
          <div className="w-full max-w-xs space-y-4 rounded-2xl bg-white p-5 shadow-2xl">
            <h2 id="owner-message-action-title" className="text-sm font-bold text-gray-900">{messageActionConfirmation.title}</h2>
            <p className="text-xs text-gray-600">{messageActionConfirmation.message}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setMessageActionConfirmation(null)} className="rounded-lg bg-gray-100 px-4 py-2 text-xs font-semibold text-gray-700">No</button>
              <button type="button" onClick={() => {
                const action = messageActionConfirmation;
                setMessageActionConfirmation(null);
                action.onConfirm();
              }} className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white">Yes</button>
            </div>
          </div>
        </div>
      )}



  


      {shareTargetMessage && (
        <div className="absolute inset-0 z-[84] flex items-center justify-center bg-black/55 p-4">
          <section className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-4 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="owner-share-title">
            <div className="flex items-center justify-between">
              <h2 id="owner-share-title" className="text-sm font-bold text-gray-900">Share message</h2>
              <button type="button" onClick={() => setShareTargetMessage(null)} aria-label="Close share dialog" className="text-xl text-gray-500">×</button>
            </div>
            <SearchBar  value={shareSearch} onChange={event => setShareSearch(event.target.value)} placeholder="Search people you've chatted with" aria-label="Search people in your conversations" />
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {shareContacts
                .filter(contact => (contact.sender || contact.name || '').toLowerCase().includes(shareSearch.trim().toLowerCase()))
                .map(contact => (
                  <button key={contact.userId} type="button" onClick={() => shareMessageToContact(contact)} disabled={sharingMessage} className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-xs hover:bg-gray-50 disabled:opacity-50">
                    {contact.avatar ? <ProfileImage src={contact.avatar} alt="" className="h-8 w-8 rounded-full object-cover" /> : <span className="grid h-8 w-8 place-items-center rounded-full bg-gray-100">👤</span>}
                    <span className="flex-1 truncate">{contact.sender || contact.name}</span>
                    <span className="text-emerald-700">{sharingMessage ? 'Sharing…' : 'Share'}</span>
                  </button>
                ))}
              {shareContacts.filter(contact => (contact.sender || contact.name || '').toLowerCase().includes(shareSearch.trim().toLowerCase())).length === 0 && (
                <p className="rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
                  No people found in your conversations.
                </p>
              )}
            </div>
          </section>
        </div>
      )}

      {reportDialogOpen && (
        <div className="absolute inset-0 z-[90] flex items-center justify-center bg-black/55 p-4">
          <form onSubmit={submitConversationReport} className="max-h-[90cqh] w-full max-w-sm space-y-3 overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="owner-report-title">
            <div className="flex items-center justify-between">
              <h2 id="owner-report-title" className="text-sm font-bold text-gray-900">Report {selectedChat?.sender || 'account'}</h2>
              <button type="button" onClick={closeReportDialog} aria-label="Close report form" className="text-xl text-gray-500">×</button>
            </div>
            {dashboardError && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700" role="alert">{dashboardError}</p>}
            <label className="block text-xs font-semibold text-gray-700">
              What are you reporting?
              <select value={reportCategory} onChange={event => setReportCategory(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-xs">
                <option value="harassment">Harassment or bullying</option>
                <option value="scam">Scam or fraud</option>
                <option value="safety">Safety concern</option>
                <option value="inappropriate">Inappropriate content</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-gray-700">
              Reason
              <textarea required minLength={3} maxLength={1000} value={reportReason} onChange={event => setReportReason(event.target.value)} rows={4} placeholder="Explain what happened so our admin team can review it." className="mt-1 w-full resize-y rounded-lg border border-gray-300 p-2 text-xs" />
            </label>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-gray-700">Evidence media (optional)</p>
              <ImageUploadInput ref={reportEvidenceInput} type="file" accept="image/*,video/*,audio/*" onChange={selectReportEvidence} className="block w-full text-[10px] text-gray-600" />
              <p className="text-[9px] text-gray-400">Images, videos, and audio files up to 10 MB. Only admins can view submitted evidence.</p>
              {reportEvidence && (
                <div className="flex items-center justify-between gap-2">
                  <button type="button" onClick={() => reportEvidencePreviewUrl.current && setMediaPreview({ src: reportEvidencePreviewUrl.current, name: reportEvidence.name, mimeType: reportEvidence.type })} className="truncate text-[10px] text-emerald-700 underline">Preview {reportEvidence.name}</button>
                  <button type="button" onClick={clearReportEvidence} className="shrink-0 text-[10px] font-semibold text-red-600">Remove</button>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={closeReportDialog} className="rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-700">Cancel</button>
              <button type="submit" disabled={submittingReport || reportReason.trim().length < 3} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                {submittingReport ? 'Submitting…' : 'Send report'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showFilterModal && (
        <ListingSearchDialog
          filters={searchFilters}
          onChange={setSearchFilters}
          locations={popularLocations}
          onSave={async () => {
            try {
              await saveSearchPreferences(userId, searchFilters);
              setShowFilterModal(false);
            } catch (error) {
              setDashboardError(`Search filters changed but could not be saved: ${error.message}`);
            }
          }}
          onClose={() => setShowFilterModal(false)}
        />
      )}
      {showSearchResults && (
        <SearchResultsDialog
          scrollRef={searchScroll}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          listings={filteredOwnerListings}
          filters={searchFilters}
          onSelectListing={listing => {
            setProfileListingPreview(listing);
          }}
          onClose={closeSearchResults}
        />
      )}
      {imageEditor && (
        <ImageCropDialog
          file={imageEditor.file}
          previewUrl={imageEditor.previewUrl}
          onApply={applyImageCrop}
          onRemove={removeEditedImage}
          onClose={() => {
            if (imageEditor.type === 'profile') revokeMediaPreviewUrl(imageEditor.previewUrl);
            setImageEditor(null);
          }}
          onKeepOriginal={keepOriginalImage}
        />
      )}
      {mediaPreview && <MediaPreviewDialog media={mediaPreview} onClose={() => setMediaPreview(null)} />}
      <ErrorDialog
        message={/^(Report submitted|Listing saved\.)/.test(dashboardError) ? '' : dashboardError}
        onClose={() => setDashboardError('')}
      />

      {showProfileEditor && (
        <div className="absolute inset-0 z-[55] flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={saveProfile} className="max-h-full w-full max-w-sm space-y-3 overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold">Edit Account Information</h2>
              <button type="button" onClick={() => setShowProfileEditor(false)} aria-label="Close editor" className="text-gray-500">✕</button>
            </div>
            {[
              ['fullName', 'Full Name', 'text'],
              ['phone', 'Phone Number', 'tel'],
              ['dob', 'Date of Birth', 'date'],
              ['gender', 'Gender', 'text'],
              ['businessName', 'Business / Owner Name', 'text'],
              ['address', 'Address', 'text'],
              ['govIdNumber', 'Government ID Number', 'text'],
              ['propertyType', 'Property Type', 'text'],
            ].map(([name, label, type]) => (
              <label key={name} className="block text-[10px] font-semibold text-gray-600">
                {label}
                <input
                  type={type}
                  value={profileDraft[name] || ''}
                  onChange={event => setProfileDraft(current => ({ ...current, [name]: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-xs text-gray-800"
                />
              </label>
            ))}
            <p className="text-[10px] text-gray-400">Email: {userProfile?.email} (managed by your login account)</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowProfileEditor(false)} className="rounded-lg bg-gray-200 px-4 py-2 text-xs font-bold">Cancel</button>
              <button type="submit" className="rounded-lg bg-[#76A77E] px-4 py-2 text-xs font-bold text-white">Save</button>
            </div>
          </form>
        </div>
      )}

      {showLogoutConfirmation && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/50 p-5" role="presentation">
          <div className="w-full max-w-xs rounded-2xl bg-white p-5 text-center shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="owner-logout-title">
            <h2 id="owner-logout-title" className="text-sm font-bold text-gray-800">Are you sure to log out?</h2>
            <div className="mt-5 flex justify-center gap-3">
              <button onClick={onLogout} className="rounded-xl bg-red-500 px-5 py-2 text-xs font-bold text-white hover:bg-red-600">
                YES
              </button>
              <button onClick={() => setShowLogoutConfirmation(false)} className="rounded-xl bg-gray-200 px-5 py-2 text-xs font-bold text-gray-700 hover:bg-gray-300">
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- BOTTOM NAVIGATION BAR ---------------- */}
      {!selectedChat && <div className="boardmate-mobile-nav bg-[#FAF6EE] border-t border-gray-300/80 px-4 py-2 flex shrink-0 justify-around items-center">
        <button 
          onClick={() => { setActiveTab('home'); setSelectedChat(null); }}
          className={`flex flex-col items-center cursor-pointer ${activeTab === 'home' ? 'text-[#76A77E]' : 'text-gray-500'}`}
        >
          <BoardMateHouseIcon className={`w-5 h-5 ${activeTab === 'home' ? 'nav-icon-active' : ''}`} />
          <span className="text-[9px] font-bold">Home</span>
        </button>

        <button 
          onClick={() => { setActiveTab('listings'); setSelectedChat(null); }}
          className={`flex flex-col items-center cursor-pointer ${activeTab === 'listings' ? 'text-[#76A77E]' : 'text-gray-500'}`}
        >
          <i className={`fa-solid fa-city text-lg ${activeTab === 'listings' ? 'nav-icon-active' : ''}`}></i>
          <span className="text-[9px] font-bold">Listings</span>
        </button>

        <button aria-label="Create accommodation listing" 
          onClick={() => { setActiveTab('create'); setSelectedChat(null); }}
          className={`w-10 h-10 rounded-xl border-2 bg-[#FAF6EE] flex items-center justify-center hover:border-[#76A77E] hover:text-[#76A77E] transition cursor-pointer ${activeTab === 'create' ? 'nav-icon-active border-[#76A77E] text-[#76A77E]' : 'border-gray-700 text-gray-800'}`}
        >
          <i className="fa-solid fa-plus text-xl"></i>
        </button>

        <button 
          onClick={() => { setActiveTab('messages'); setSelectedChat(null); }}
          className={`flex flex-col items-center cursor-pointer ${activeTab === 'messages' ? 'text-[#76A77E]' : 'text-gray-500'}`}
        >
          <span className="relative">
            <MessageIcon className={`h-5 w-5 ${activeTab === 'messages' ? 'nav-icon-active' : ''}`} />
            {unreadMessageCount > 0 && <span className="absolute -right-2 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{unreadMessageCount > 9 ? '9+' : unreadMessageCount}</span>}
          </span>
          <span className="text-[9px] font-bold">Messages</span>
        </button>

        <button 
          onClick={() => { setActiveTab('profile'); setSelectedChat(null); }}
          className={`flex flex-col items-center cursor-pointer ${activeTab === 'profile' ? 'text-[#76A77E]' : 'text-gray-500'}`}
        >
          <i className={`fa-regular fa-user text-lg ${activeTab === 'profile' ? 'nav-icon-active' : ''}`}></i>
          <span className="text-[9px] font-bold">Profile</span>
        </button>
      </div>}

    </div>
  );
}
