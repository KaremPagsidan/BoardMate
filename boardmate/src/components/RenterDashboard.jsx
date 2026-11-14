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
import BoardMateHouseIcon from './BoardMateHouseIcon';
import LocationIcon from './LocationIcon';
import MessageIcon from './MessageIcon';
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
import { fetchProfilePhotoGallery, getAge, updateAccountProfile, uploadProfilePhoto } from '../lib/profileMedia';
import { fetchActivityHistory, recordActivity } from '../lib/activityHistory';
import { publishBoardmatePresence } from '../lib/presence';
import PublicProfileDialog from './PublicProfileDialog';
import ListingSearchDialog from './ListingSearchDialog';
import SearchResultsDialog from './SearchResultsDialog';
import ImageCropDialog from './ImageCropDialog';
import MediaPreviewDialog from './MediaPreviewDialog';
import ConversationMediaPlayer from './ConversationMediaPlayer';
import ErrorDialog from './ErrorDialog';
import { defaultListingFilters, filterListings, filterRoommatePosts, getPopularListingLocations } from '../lib/listingSearch';
import AccountToolsDialog from './AccountToolsDialog';
import SidebarDrawer from './SidebarDrawer';
import NotificationsPage from './NotificationsPage';
import RoommatePostPage from './RoommatePostPage';
import AccommodationDetailPage from './AccommodationDetailPage';
import { fetchBoardmateMessageContact } from '../lib/publicProfiles';
import { fetchAccountPreferences, saveSearchPreferences } from '../lib/accountTools';
import { removeRoommatePostPhotos, uploadRoommatePostPhotos } from '../lib/roommatePostMedia';
import { fetchListingRatingSummary, saveListingRating } from '../lib/listingRatings';
import ListingRating from './ListingRating';
import usePullToRefresh from '../hooks/usePullToRefresh';
import useMessageHistory from '../hooks/useMessageHistory';
import { ProfileHero, ProfileDetails, ProfileSection, ProfileMediaGallery, ProfilePostCard } from './ProfileLayout';
import { collectProfileMedia } from '../lib/profilePresentation';

function getRoommateSchemaError(error) {
  const message = error?.message || '';
  if (
    ['heading', 'budget', 'description', 'location', 'role', 'author_gender', 'author_name', 'author_avatar_url', 'author_age', 'photos']
      .some(column => message.includes(column))
  ) {
    return 'Roommate post fields or photo support are missing in Supabase. Run the roommate post migrations, including supabase/migrations/20261102000000_roommate_post_photos.sql, in the SQL Editor, then try again.';
  }
  return message || 'Unable to load marketplace data.';
}

function getLegacyRejectedPostReceipts(history, posts, userId) {
  return history
    .filter(entry => ['Roommate post rejected', 'Roommate post rejected and removed'].includes(entry.action))
    .filter(entry => !posts.some(post => (
      post.userId === userId
      && post.moderationStatus === 'rejected'
      && post.title === entry.details.split('\n')[0]
    )));
}

async function fetchMarketplaceData() {
  const [listingResult, postResult] = await Promise.all([
    supabase.from('listings')
      .select('*')
      .eq('is_available', true)
      .eq('moderation_status', 'approved')
      .not('owner_id', 'is', null)
      .order('created_at', { ascending: false }),
    supabase.from('roommate_posts').select('*').order('created_at', { ascending: false }),
  ]);

  if (listingResult.error || postResult.error) {
    const error = listingResult.error || postResult.error;
    throw new Error(error === postResult.error ? getRoommateSchemaError(error) : error.message);
  }

  const ratings = await fetchListingRatingSummary(listingResult.data.map(item => item.id));
  return {
    listings: listingResult.data.map(item => ({
      id: item.id,
      ownerId: item.owner_id,
      title: item.title,
      price: item.price,
      location: item.location,
      propertyType: item.property_type || '',
      image: item.image_url,
      description: item.description,
      photos: Array.isArray(item.photos) ? item.photos : [],
      ratingAverage: ratings[String(item.id)]?.average || 0,
      ratingCount: ratings[String(item.id)]?.count || 0,
      myRating: ratings[String(item.id)]?.myRating || null,
    })),
    roommatePosts: postResult.data.map(post => ({
      id: post.id,
      userId: post.user_id,
      name: post.author_name || post.user_name || 'Renter',
      title: post.heading,
      budget: post.budget,
      gender: post.author_gender || '',
      age: post.author_age,
      role: post.role,
      location: post.location,
      time: new Date(post.created_at).toLocaleDateString(),
      details: post.description,
      avatar: post.author_avatar_url,
      photos: Array.isArray(post.photos) ? post.photos : [],
      moderationStatus: post.moderation_status,
      moderationReason: post.moderation_reason,
    })),
  };
}

export default function RenterDashboard({ user, onProfileUpdate, onVerificationSubmit, verificationSubmission, initialSettingsSection = null, onLogout }) {
  const dashboardScroll = useScrollMemory();
  const searchScroll = useScrollMemory();
  const { notify } = useAppDialog();
  // Navigation & View States
  const [activeTab, setActiveTab] = useState('home');
  const [showSideMenu, setShowSideMenu] = useState(false);
  const [showLogoutConfirmation, setShowLogoutConfirmation] = useState(false);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [accountToolsOpen, setAccountToolsOpen] = useState(Boolean(initialSettingsSection));
  const [accountToolsSection, setAccountToolsSection] = useState(initialSettingsSection || 'settings');
  const [searchQuery, setSearchQuery] = useState('');
  const [messageSearchQuery, setMessageSearchQuery] = useState('');

  // Selected Detail Views
  const [selectedListing, setSelectedListing] = useState(null);
  const [activeChat, setActiveChat] = useState(null);

  // Filter States
  const [searchFilters, setSearchFilters] = useState(() => {
    try {
      return { ...defaultListingFilters, ...JSON.parse(localStorage.getItem(`boardmate-search-${user?.id}`) || '{}') };
    } catch {
      return { ...defaultListingFilters };
    }
  });
  const [searchPreferencesLoaded, setSearchPreferencesLoaded] = useState(false);

  // Create Post Form State
  const [postForm, setPostForm] = useState({
    heading: '',
    budget: '',
    description: '',
    location: '',
    role: 'Student'
  });
  const [editingRoommatePostId, setEditingRoommatePostId] = useState(null);
  const [roommatePostMedia, setRoommatePostMedia] = useState([]);
  const [imageEditor, setImageEditor] = useState(null);
  const [mediaPreview, setMediaPreview] = useState(null);
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);

  // Chat Input State
  const [chatInput, setChatInput] = useState('');
  const chatInputRef = useRef(null);
  const [chatAttachment, setChatAttachment] = useState(null);
  const [chatOptionsOpen, setChatOptionsOpen] = useState(false);
  const [contactOptionsOpenId, setContactOptionsOpenId] = useState(null);
  const [messageOptionsOpenId, setMessageOptionsOpenId] = useState(null);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState(null);
  const [shareTargetMessage, setShareTargetMessage] = useState(null);
  const [shareSearch, setShareSearch] = useState('');
  const [sharingMessage, setSharingMessage] = useState(false);
  const [blockConfirmationOpen, setBlockConfirmationOpen] = useState(false);
  const [blockTargetContact, setBlockTargetContact] = useState(null);
  const [messageActionConfirmation, setMessageActionConfirmation] = useState(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [publicProfileUserId, setPublicProfileUserId] = useState(null);
  const [messageSyncNotice, setMessageSyncNotice] = useState('');
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [reportCategory, setReportCategory] = useState('other');
  const [reportReason, setReportReason] = useState('');
  const [reportEvidence, setReportEvidence] = useState(null);
  const [submittingReport, setSubmittingReport] = useState(false);
  const [messages, setMessages] = useState([]);
  const [messageContacts, setMessageContacts] = useState([]);
  const [moderationNotifications, setModerationNotifications] = useState([]);
  const [notificationTime, setNotificationTime] = useState(0);
  const [listings, setListings] = useState([]);
  const [roommatePosts, setRoommatePosts] = useState([]);
  const [selectedRoommatePost, setSelectedRoommatePost] = useState(null);
  const [rejectedRoommatePosts, setRejectedRoommatePosts] = useState([]);
  const [roommateLikeCounts, setRoommateLikeCounts] = useState({});
  const [likedRoommatePostIds, setLikedRoommatePostIds] = useState(() => new Set());
  const [likeActionPostId, setLikeActionPostId] = useState(null);
  const [ratingActionListingId, setRatingActionListingId] = useState(null);
  const [listingFavoriteCounts, setListingFavoriteCounts] = useState({});
  const [favoriteActionListingId, setFavoriteActionListingId] = useState(null);
  const [profilePhotos, setProfilePhotos] = useState([]);
  const [profilePostPreview, setProfilePostPreview] = useState(null);
  const [favoriteIds, setFavoriteIds] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [dashboardError, setDashboardError] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [submittingPost, setSubmittingPost] = useState(false);
  const [activityHistory, setActivityHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [profileDraft, setProfileDraft] = useState({});
  const chatFileInput = useRef(null);
  const chatMessagesRef = useRef(null);
  const { fetchDirectConversation, pages: historyPages } = useMessageHistory();
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const olderRequest = useRef(false);
  const scrollAnchorRef = useRef(null);
  const [historyScrollVersion, setHistoryScrollVersion] = useState(0);
  const currentContactRef = useRef(null);
  const roommatePhotoInput = useRef(null);
  const mediaPreviewUrls = useRef(new Set());
  const reportEvidenceInput = useRef(null);
  const chatAttachmentPreviewUrl = useRef(null);
  const reportEvidencePreviewUrl = useRef(null);
  const publicRoommatePosts = roommatePosts.filter(
    post => post.userId !== user?.id && post.moderationStatus === 'approved',
  );
  const publicRoommatePostKey = publicRoommatePosts.map(post => post.id).join(',');
  const ownProfilePosts = useMemo(() => roommatePosts.filter(post => post.userId === user?.id), [roommatePosts, user?.id]);
  const ownProfileMedia = useMemo(() => collectProfileMedia(profilePhotos, ownProfilePosts), [profilePhotos, ownProfilePosts]);
  const isConversationOpen = Boolean(activeChat?.userId);
  const filteredListings = filterListings(listings, searchQuery, searchFilters);
  const marketplaceListingIds = listings.map(listing => String(listing.id)).join(',');
  const filteredRoommatePosts = filterRoommatePosts(publicRoommatePosts, searchQuery);
  const searchRoommatePosts = filterRoommatePosts(publicRoommatePosts, searchQuery, searchFilters);
  const filteredMessageContacts = messageContacts.filter(contact => (
    `${contact.name || ''} ${contact.lastMessage || ''}`.toLocaleLowerCase().includes(messageSearchQuery.trim().toLocaleLowerCase())
  ));
  const popularLocations = getPopularListingLocations(listings, listingFavoriteCounts);
  const closeSearchResults = () => {
    setShowSearchResults(false);
  };

  const handleRoommatePostCardClick = (event, post) => {
    const interactiveTarget = event.target.closest('button, a, input, video, audio, [role="button"]');
    if (interactiveTarget && interactiveTarget !== event.currentTarget) return;
    setSelectedRoommatePost(post);
  };

  const handleRoommatePostCardKeyDown = (event, post) => {
    if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    setSelectedRoommatePost(post);
  };

  useEffect(() => {
    if (!user?.id) return;
    localStorage.setItem(`boardmate-search-${user.id}`, JSON.stringify(searchFilters));
  }, [searchFilters, user?.id]);

  useEffect(() => {
    if (!user?.id) return undefined;
    let active = true;
    fetchAccountPreferences(user.id)
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
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !searchPreferencesLoaded) return undefined;
    const timeoutId = window.setTimeout(() => {
      saveSearchPreferences(user.id, searchFilters)
        .catch(error => setDashboardError(`Search filters changed but could not be saved: ${error.message}`));
    }, 500);
    return () => window.clearTimeout(timeoutId);
  }, [searchFilters, searchPreferencesLoaded, user?.id]);

  useLayoutEffect(() => {
    currentContactRef.current = activeChat?.userId;
  }, [activeChat?.userId]);

  const loadOlderMessages = async () => {
    const contactId = activeChat?.userId;
    if (!contactId || olderRequest.current) return;
    olderRequest.current = true;
    setLoadingOlderMessages(true);
    try {
      const history = await fetchDirectConversation(user?.id, contactId, { older: true });
      if (currentContactRef.current !== contactId) return;
      const element = chatMessagesRef.current;
      scrollAnchorRef.current = element ? { contactId, height: element.scrollHeight, top: element.scrollTop } : null;
      setHistoryScrollVersion(value => value + 1);
      setMessages(history);
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
  }, [activeTab, isConversationOpen, messages.length, historyScrollVersion]);

  const unreadMessageCount = messageContacts.reduce(
    (total, contact) => total + (contact.unreadCount || 0),
    0,
  );
  const shareContacts = [
    ...messageContacts,
    ...(user?.id ? [{
      userId: user.id,
      name: 'You',
      avatar: user.avatar,
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
    if (!user?.id || user.suspendedAt || user.verificationStatus !== 'approved') return undefined;
    let active = true;
    const updatePresence = () => {
      publishBoardmatePresence(user.id)
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
  }, [user?.id, user?.suspendedAt, user?.verificationStatus]);

  useEffect(() => {
    if (!user?.id) return undefined;
    let active = true;
    const refreshNotifications = () => {
      fetchBoardmateNotifications(user.id)
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
      .channel(`renter-notifications-${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'boardmate_notifications',
        filter: `user_id=eq.${user.id}`,
      }, refreshNotifications)
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  useEffect(() => {
    const nextExpiry = moderationNotifications
      .map(notification => Date.parse(notification.hidden_until))
      .filter(expiry => Number.isFinite(expiry) && expiry > Date.now())
      .sort((left, right) => left - right)[0];
    if (!user?.id || !nextExpiry) return undefined;
    let active = true;
    const timeoutId = window.setTimeout(() => {
      fetchBoardmateNotifications(user.id)
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
  }, [user?.id, moderationNotifications]);

  useEffect(() => {
    if (!user?.id) return undefined;
    let active = true;
    const refreshLikes = async () => {
      const [allLikesResult, ownLikesResult] = await Promise.all([
        supabase.from('roommate_post_likes').select('post_id'),
        supabase.from('roommate_post_likes').select('post_id').eq('user_id', user.id),
      ]);
      if (allLikesResult.error || ownLikesResult.error) {
        throw allLikesResult.error || ownLikesResult.error;
      }

      const counts = {};
      for (const like of allLikesResult.data) {
        counts[like.post_id] = (counts[like.post_id] || 0) + 1;
      }
      if (active) {
        setRoommateLikeCounts(counts);
        setLikedRoommatePostIds(new Set(ownLikesResult.data.map(like => like.post_id)));
      }
    };

    refreshLikes().catch(error => {
      if (active) setDashboardError(`Unable to load roommate post likes: ${error.message}`);
    });

    const channel = supabase
      .channel(`renter-roommate-post-likes-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roommate_post_likes' }, () => {
        refreshLikes().catch(error => {
          if (active) setDashboardError(`Unable to refresh roommate post likes: ${error.message}`);
        });
      })
      .subscribe(status => {
        if (active && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')) {
          setDashboardError('Live like updates are unavailable. Reload the roommate posts to refresh counts.');
        }
      });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [user?.id, publicRoommatePostKey]);

  useEffect(() => {
    if (!user?.id) return undefined;
    let active = true;
    const refreshFavorites = async () => {
      const [allFavoritesResult, ownFavoritesResult] = await Promise.all([
        supabase.from('listing_favorites').select('listing_id'),
        supabase.from('listing_favorites').select('listing_id').eq('user_id', user.id),
      ]);
      if (allFavoritesResult.error || ownFavoritesResult.error) {
        throw allFavoritesResult.error || ownFavoritesResult.error;
      }

      const counts = {};
      allFavoritesResult.data.forEach(favorite => {
        counts[favorite.listing_id] = (counts[favorite.listing_id] || 0) + 1;
      });
      if (active) {
        setListingFavoriteCounts(counts);
        setFavoriteIds(ownFavoritesResult.data.map(favorite => favorite.listing_id));
      }
    };

    refreshFavorites().catch(error => {
      if (active) setDashboardError(`Unable to load listing favourites: ${error.message}`);
    });

    const channel = supabase
      .channel(`renter-listing-favorites-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'listing_favorites' }, () => {
        refreshFavorites().catch(error => {
          if (active) setDashboardError(`Unable to refresh listing favourites: ${error.message}`);
        });
      })
      .subscribe(status => {
        if (active && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')) {
          setDashboardError('Live favourite updates are unavailable. Reload the listings to refresh counts.');
        }
      });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const loadMarketplaceData = useCallback(async ({ background = false } = {}) => {
    try {
      const marketplaceData = await fetchMarketplaceData();
      if (!background) setDashboardError('');
      setListings(marketplaceData.listings);
      setRoommatePosts(marketplaceData.roommatePosts);
      setSelectedListing(current => current ? marketplaceData.listings.find(item => item.id === current.id) || null : null);
      setSelectedRoommatePost(current => current ? marketplaceData.roommatePosts.find(item => item.id === current.id) || null : null);
      return marketplaceData;
    } catch (error) {
      if (!background) setDashboardError(error.message);
      throw error;
    }
  }, []);

  useVisibilityRefresh(async () => {
    const fresh = await loadMarketplaceData({ background: true });
    setProfilePhotos(await fetchProfilePhotoGallery(user?.id));
    const removed = [...listings.filter(item => !fresh.listings.some(next => next.id === item.id)),
      ...roommatePosts.filter(item => !fresh.roommatePosts.some(next => next.id === item.id))];
    const removedUrls = new Set(collectProfileMedia([], removed).map(item => item.url));
    setMediaPreview(current => current && removedUrls.has(current.src) ? null : current);
    const inbox = await fetchDirectInbox(user?.id);
    setMessageContacts(inbox);
    if (activeChat?.userId) {
      try { await assertDirectContactAvailable(user?.id, activeChat.userId); }
      catch (error) {
        if (error.message.includes('suspended or inactive')) { setActiveChat(null); setMessages([]); }
      }
    }
  }, Boolean(user?.id && !user?.suspendedAt));

  const pullRefreshIndicator = usePullToRefresh(async () => {
    if (!user?.id) return;
    setLoadingData(true);
    try {
      const [marketplaceData, photos, allLikesResult, ownLikesResult] = await Promise.all([
        fetchMarketplaceData(),
        fetchProfilePhotoGallery(user.id),
        supabase.from('roommate_post_likes').select('post_id'),
        supabase.from('roommate_post_likes').select('post_id').eq('user_id', user.id),
      ]);
      if (allLikesResult.error || ownLikesResult.error) {
        throw allLikesResult.error || ownLikesResult.error;
      }

      const counts = {};
      for (const like of allLikesResult.data) {
        counts[like.post_id] = (counts[like.post_id] || 0) + 1;
      }
      setListings(marketplaceData.listings);
      setRoommatePosts(marketplaceData.roommatePosts);
      setProfilePhotos(photos);
      setRoommateLikeCounts(counts);
      setLikedRoommatePostIds(new Set(ownLikesResult.data.map(like => like.post_id)));

      if (activeTab === 'messages') {
        const inbox = await fetchDirectInbox(user.id);
        setMessageContacts(inbox);
        if (activeChat?.userId) {
          setMessages(await fetchDirectConversation(user.id, activeChat.userId));
        }
      } else if (activeTab === 'history' || activeTab === 'profile_posts') {
        const history = await fetchActivityHistory(user.id);
        if (activeTab === 'history') setActivityHistory(history);
        if (activeTab === 'profile_posts') {
          setRejectedRoommatePosts(getLegacyRejectedPostReceipts(history, marketplaceData.roommatePosts, user.id));
        }
      }
      setDashboardError('');
    } catch (error) {
      setDashboardError(`Unable to refresh dashboard: ${error.message}`);
      throw error;
    } finally {
      setLoadingData(false);
    }
  });

  useEffect(() => {
    let active = true;
    if (!user?.id) return undefined;
    fetchMarketplaceData()
      .then(marketplaceData => {
        if (!active) return;
        setDashboardError('');
        setListings(marketplaceData.listings);
        setRoommatePosts(marketplaceData.roommatePosts);
      })
      .catch(error => {
        if (active) setDashboardError(error.message);
      })
      .finally(() => {
        if (active) setLoadingData(false);
      });

    return () => { active = false; };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !marketplaceListingIds) return undefined;
    let active = true;
    const listingIds = marketplaceListingIds.split(',');
    const refreshRatingSummaries = async () => {
      const summaries = await fetchListingRatingSummary(listingIds);
      if (!active) return;
      const applySummary = listing => ({
        ...listing,
        ratingAverage: summaries[String(listing.id)]?.average || 0,
        ratingCount: summaries[String(listing.id)]?.count || 0,
        myRating: summaries[String(listing.id)]?.myRating || null,
      });
      setListings(current => current.map(applySummary));
      setSelectedListing(current => current ? applySummary(current) : current);
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
  }, [marketplaceListingIds, user?.id]);

  useEffect(() => {
    const channel = supabase
      .channel('renter-marketplace-review-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'listings' }, () => {
        loadMarketplaceData().catch(error => setDashboardError(error.message));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roommate_posts' }, () => {
        loadMarketplaceData().catch(error => setDashboardError(error.message));
      })
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Visibility refresh also polls and refreshes on window focus.
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadMarketplaceData]);

  useEffect(() => {
    if (!user?.id) return undefined;
    let active = true;
    const refreshInbox = async () => {
      try {
        const inbox = await fetchDirectInbox(user.id);
        if (!active) return;
        setMessageContacts(inbox);
        if (activeTab === 'messages' && activeChat?.userId) {
          const conversationMessages = await fetchDirectConversation(user.id, activeChat.userId);
          if (!active) return;
          setMessages(conversationMessages);
          if ((inbox.find(contact => contact.userId === activeChat.userId)?.unreadCount || 0) > 0) {
            try {
              await markDirectConversationSeen(activeChat.userId);
            } catch (error) {
              setDashboardError(`Messages loaded, but read receipts could not be updated: ${error.message}`);
            }
          }
        }
        setDashboardError(current => current.startsWith('Messages loaded, but read receipts could not be updated:') ? current : '');
      } catch (error) {
        if (active) setDashboardError(`Unable to load messages: ${error.message}`);
      }
    };

    refreshInbox();
    const channel = supabase
      .channel(`renter-direct-messages-${user.id}`)
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
  }, [activeTab, activeChat?.userId, user?.id, fetchDirectConversation]);

  useEffect(() => {
    if (!user?.id) return undefined;
    let active = true;
    fetchProfilePhotoGallery(user.id)
      .then(photos => {
        if (active) setProfilePhotos(photos);
      })
      .catch(error => {
        if (active) setDashboardError(error.message);
      });
    return () => { active = false; };
  }, [user?.id]);

  useEffect(() => {
    if (activeTab !== 'history' || !user?.id) return undefined;
    let active = true;
    fetchActivityHistory(user.id)
      .then(history => {
        if (active) {
          setActivityHistory(history);
          setDashboardError('');
        }
      })
      .catch(error => {
        if (active) setDashboardError(error.message);
      })
      .finally(() => {
        if (active) setLoadingHistory(false);
      });
    return () => { active = false; };
  }, [activeTab, user?.id]);

  useEffect(() => {
    if (activeTab !== 'profile_posts' || !user?.id) return undefined;
    let active = true;
    fetchActivityHistory(user.id)
      .then(history => {
        if (active) {
          setRejectedRoommatePosts(getLegacyRejectedPostReceipts(history, roommatePosts, user.id));
        }
      })
      .catch(error => {
        if (active) setDashboardError(`Unable to load post review history: ${error.message}`);
      });
    return () => { active = false; };
  }, [activeTab, roommatePosts, user?.id]);

  const openProfileEditor = () => {
    setProfileDraft({
      fullName: user?.fullName || '',
      phone: user?.phone || '',
      dob: user?.dob || '',
      gender: user?.gender || '',
    });
    setShowProfileEditor(true);
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    try {
      const verification = await updateAccountProfile(user.id, profileDraft);
      onProfileUpdate({ ...user, ...profileDraft, ...verification });
      setShowProfileEditor(false);
      setDashboardError('');
    } catch (error) {
      setDashboardError(error.message);
      return;
    }
    try {
      await recordActivity(user.id, 'Updated profile information');
    } catch (error) {
      setDashboardError(`Profile saved, but activity history could not be recorded: ${error.message}`);
    }
  };

  const toggleFavorite = async (listingId) => {
    if (user?.suspendedAt) {
      setDashboardError('Suspended accounts cannot save listing favourites.');
      return;
    }
    const wasFavorite = favoriteIds.includes(listingId);
    setFavoriteIds(current => current.includes(listingId)
      ? current.filter(id => id !== listingId)
      : [...current, listingId]);
    setListingFavoriteCounts(current => ({
      ...current,
      [listingId]: Math.max(0, (current[listingId] || 0) + (wasFavorite ? -1 : 1)),
    }));
    const listing = listings.find(item => item.id === listingId);
    setFavoriteActionListingId(listingId);
    try {
      const result = wasFavorite
        ? await supabase.from('listing_favorites').delete().eq('listing_id', listingId).eq('user_id', user.id)
        : await supabase.from('listing_favorites').insert({ listing_id: listingId, user_id: user.id });
      if (result.error) throw result.error;
    } catch (error) {
      setFavoriteIds(current => wasFavorite
        ? [...current, listingId]
        : current.filter(id => id !== listingId));
      setListingFavoriteCounts(current => ({
        ...current,
        [listingId]: Math.max(0, (current[listingId] || 0) + (wasFavorite ? 1 : -1)),
      }));
      if (isVerificationAccessError(error, user?.verificationStatus)) notify(restrictedVerificationMessage);
      else setDashboardError(`Unable to update listing favourite: ${error.message}`);
      setFavoriteActionListingId(null);
      return;
    }

    try {
      await recordActivity(user.id, wasFavorite ? 'Removed favorite listing' : 'Saved favorite listing', listing?.title || '');
    } catch (error) {
      setDashboardError(`Favourite updated, but activity history could not be recorded: ${error.message}`);
    } finally {
      setFavoriteActionListingId(null);
    }
  };

  const rateListing = async (listingId, rating) => {
    if (!user?.id || user.suspendedAt) {
      setDashboardError('Only active renter accounts can rate accommodation listings.');
      return;
    }

    setRatingActionListingId(listingId);
    setDashboardError('');
    try {
      const summary = await saveListingRating(listingId, rating);
      const updateRating = listing => listing.id === listingId
        ? {
          ...listing,
          ratingAverage: summary?.average || 0,
          ratingCount: summary?.count || 0,
          myRating: summary?.myRating || null,
        }
        : listing;
      setListings(current => current.map(updateRating));
      setSelectedListing(current => current?.id === listingId ? updateRating(current) : current);
    } catch (error) {
      if (isVerificationAccessError(error, user?.verificationStatus)) notify(restrictedVerificationMessage);
      else setDashboardError(`Unable to save listing rating: ${error.message}`);
    } finally {
      setRatingActionListingId(null);
    }
  };

  const handleCreatePost = async () => {
    if (user?.verificationStatus !== 'approved') {
      notify(restrictedVerificationMessage);
      return;
    }
    if (!postForm.heading.trim() || !postForm.budget.trim() || !postForm.location.trim()) {
      setDashboardError('Please enter a heading, budget, and location.');
      return;
    }
    if (!user?.id) {
      setDashboardError('Please sign in before creating a post.');
      return;
    }

    setSubmittingPost(true);
    setDashboardError('');
    const wasEditing = Boolean(editingRoommatePostId);
    let activityHistoryError = '';
    let uploadedPaths = [];
    let postSaved = false;
    try {
      const { photos, uploadedPaths: newPhotoPaths } = await uploadRoommatePostPhotos(user.id, roommatePostMedia);
      uploadedPaths = newPhotoPaths;
      const postValues = {
        user_id: user.id,
        user_name: user.fullName || user.email || 'Renter',
        heading: postForm.heading.trim(),
        budget: postForm.budget.trim(),
        description: postForm.description.trim(),
        location: postForm.location.trim(),
        role: postForm.role,
        author_name: user.fullName || null,
        author_avatar_url: user.avatar || null,
        author_gender: user.gender || null,
        author_age: getAge(user.dob),
        photos,
      };
      const result = editingRoommatePostId
        ? await supabase.from('roommate_posts')
          .update({
            heading: postValues.heading,
            budget: postValues.budget,
            description: postValues.description,
            location: postValues.location,
            role: postValues.role,
            author_name: postValues.author_name,
            author_gender: postValues.author_gender,
            author_age: postValues.author_age,
            photos: postValues.photos,
          })
          .eq('id', editingRoommatePostId)
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .select('id')
          .maybeSingle()
        : await supabase.from('roommate_posts').insert([postValues]);
      if (result.error) throw new Error(getRoommateSchemaError(result.error));
      if (editingRoommatePostId && !result.data) {
        throw new Error('This post is no longer available to edit. Refresh My Posts and try again.');
      }
      postSaved = true;

      const removedPhotoPaths = roommatePostMedia
        .filter(item => !item.file && item.path && !photos.some(photo => photo.path === item.path))
        .map(item => item.path);
      let photoCleanupError = '';
      try {
        await removeRoommatePostPhotos(removedPhotoPaths);
      } catch (error) {
        photoCleanupError = ` Some removed photos could not be deleted from storage: ${error.message}`;
      }

      try {
        await recordActivity(
          user.id,
          editingRoommatePostId ? 'Edited roommate post' : 'Created roommate post',
          postForm.heading.trim(),
        );
      } catch (historyError) {
        activityHistoryError = historyError.message;
      }
      if (!wasEditing) {
        notify('Your roommate post was submitted for administrator review. It will appear to other users after approval.');
      }
      await loadMarketplaceData();
      setLoadingData(false);
      setPostForm({ heading: '', budget: '', description: '', location: '', role: 'Student' });
      roommatePostMedia.forEach(item => {
        if (item.previewUrl?.startsWith('blob:')) revokeMediaPreviewUrl(item.previewUrl);
      });
      setRoommatePostMedia([]);
      setEditingRoommatePostId(null);
      setActiveTab(wasEditing ? 'profile_posts' : 'roommate_posts');
      if (activityHistoryError) {
        setDashboardError(`Post saved, but activity history could not be recorded: ${activityHistoryError}${photoCleanupError}`);
      } else if (wasEditing) {
        setDashboardError(`Post saved. Edited details require administrator review before appearing publicly.${photoCleanupError}`);
      } else if (photoCleanupError) {
        setDashboardError(`Post saved.${photoCleanupError}`);
      }
    } catch (error) {
      let message = error.message;
      if (!postSaved && uploadedPaths.length) {
        try {
          await removeRoommatePostPhotos(uploadedPaths);
        } catch (cleanupError) {
          message = `${message} Uploaded photo cleanup also failed: ${cleanupError.message}`;
        }
      }
      if (isVerificationAccessError(error, user?.verificationStatus)) notify(restrictedVerificationMessage);
      else setDashboardError(message);
    } finally {
      setSubmittingPost(false);
    }
  };

  const startEditingRoommatePost = (post) => {
    roommatePostMedia.forEach(item => {
      if (item.previewUrl?.startsWith('blob:')) revokeMediaPreviewUrl(item.previewUrl);
    });
    setEditingRoommatePostId(post.id);
    setRoommatePostMedia((post.photos || []).map(photo => ({ ...photo })));
    setPostForm({
      heading: post.title,
      budget: post.budget,
      description: post.details,
      location: post.location,
      role: post.role || 'Student',
    });
    setDashboardError('');
    setActiveTab('create_post');
  };

  const createMediaPreviewUrl = (file) => {
    const url = URL.createObjectURL(file);
    mediaPreviewUrls.current.add(url);
    return url;
  };

  const revokeMediaPreviewUrl = (url) => {
    if (!mediaPreviewUrls.current.delete(url)) return;
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

  const openImageEditor = (type, media, index = null) => {
    setImageEditor({ type, index, file: media.file, previewUrl: media.previewUrl });
  };

  const openProfilePhotoCrop = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImageEditor({ type: 'profile', file, previewUrl: createMediaPreviewUrl(file) });
  };

  const addRoommatePostPhotos = (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    const allowedMediaTypes = new Set([
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'video/mp4', 'video/webm', 'video/quicktime',
      'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/aac',
    ]);
    const invalidFile = files.find(file => !allowedMediaTypes.has(file.type) || file.size > 10 * 1024 * 1024);
    if (invalidFile) {
      setDashboardError(!allowedMediaTypes.has(invalidFile.type)
        ? 'Roommate post media must be a supported image, video, or audio file.'
        : `${invalidFile.name} is larger than the 10 MB media limit.`);
      return;
    }

    setDashboardError('');
    const newPhotos = files.map(file => ({
      file,
      name: file.name,
      mimeType: file.type,
      previewUrl: createMediaPreviewUrl(file),
    }));
    setRoommatePostMedia(current => [...current, ...newPhotos]);
  };

  const removeRoommatePostMedia = (index) => {
    setMessageActionConfirmation({
      title: 'Are you sure you want to delete?',
      message: 'This media file will be removed from your roommate post.',
      onConfirm: () => {
        const item = roommatePostMedia[index];
        if (item?.previewUrl?.startsWith('blob:')) revokeMediaPreviewUrl(item.previewUrl);
        setRoommatePostMedia(current => current.filter((_, mediaIndex) => mediaIndex !== index));
      },
    });
  };

  const cancelRoommatePost = () => {
    roommatePostMedia.forEach(item => {
      if (item.previewUrl?.startsWith('blob:')) revokeMediaPreviewUrl(item.previewUrl);
    });
    setRoommatePostMedia([]);
    setEditingRoommatePostId(null);
    setPostForm({ heading: '', budget: '', description: '', location: '', role: 'Student' });
    setActiveTab(editingRoommatePostId ? 'profile_posts' : 'home');
  };

  const uploadCroppedProfilePhoto = async (file) => {
    if (!user?.id) {
      setDashboardError('Please sign in before updating your profile photo.');
      return false;
    }

    setUploadingPhoto(true);
    setDashboardError('');
    try {
      const avatar = await uploadProfilePhoto(user.id, file, { syncRoommatePosts: true });
      onProfileUpdate({ ...user, avatar });
      setProfilePhotos(await fetchProfilePhotoGallery(user.id));
      setRoommatePosts(posts => posts.map(post => (
        post.userId === user.id ? { ...post, avatar } : post
      )));
      try {
        await recordActivity(user.id, 'Updated profile photo');
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

  const applyImageCrop = async (file) => {
    if (!imageEditor) return;
    if (imageEditor.type === 'profile') {
      if (await uploadCroppedProfilePhoto(file)) {
        revokeMediaPreviewUrl(imageEditor.previewUrl);
        setImageEditor(null);
      }
      return;
    }

    const updatedMedia = { file, name: file.name, mimeType: file.type, previewUrl: createMediaPreviewUrl(file) };
    if (imageEditor.type === 'roommate') {
      const previous = roommatePostMedia[imageEditor.index];
      if (previous?.previewUrl?.startsWith('blob:')) revokeMediaPreviewUrl(previous.previewUrl);
      setRoommatePostMedia(current => current.map((item, index) => (
        index === imageEditor.index ? updatedMedia : item
      )));
    }
    revokeMediaPreviewUrl(imageEditor.previewUrl);
    setImageEditor(null);
  };

  const keepOriginalImage = async () => {
    if (!imageEditor) return;
    if (imageEditor.type === 'profile') {
      if (await uploadCroppedProfilePhoto(imageEditor.file)) {
        revokeMediaPreviewUrl(imageEditor.previewUrl);
        setImageEditor(null);
      }
      return;
    }
    setImageEditor(null);
  };

  const removeEditedImage = () => {
    if (!imageEditor) return;
    revokeMediaPreviewUrl(imageEditor.previewUrl);
    if (imageEditor.type === 'roommate') {
      setRoommatePostMedia(current => current.filter((_, index) => index !== imageEditor.index));
    }
    setImageEditor(null);
  };

  useEffect(() => () => {
    mediaPreviewUrls.current.forEach(url => URL.revokeObjectURL(url));
    mediaPreviewUrls.current.clear();
  }, []);

  const deleteRoommatePost = post => {
    setMessageActionConfirmation({
      title: 'Are you sure you want to delete?',
      message: 'This roommate post will be removed from your posts and the public feed.',
      onConfirm: async () => {
        setDashboardError('');
        try {
          const { error } = await supabase.rpc('delete_own_roommate_post', { p_post_id: post.id });
          if (error) throw error;
          setRoommatePosts(current => current.filter(item => item.id !== post.id));
          try {
            await loadMarketplaceData();
            setDashboardError('');
          } catch (refreshError) {
            setDashboardError(`Post deleted, but the feed could not be refreshed: ${refreshError.message}`);
          }
        } catch (error) {
          setDashboardError(`Unable to delete roommate post: ${error.message}`);
        }
      },
    });
  };

  const toggleRoommatePostLike = async (postId) => {
    if (user?.suspendedAt) {
      setDashboardError('Suspended accounts cannot like roommate posts.');
      return;
    }

    const isLiked = likedRoommatePostIds.has(postId);
    setLikeActionPostId(postId);
    setDashboardError('');
    setLikedRoommatePostIds(current => {
      const next = new Set(current);
      if (isLiked) next.delete(postId);
      else next.add(postId);
      return next;
    });
    setRoommateLikeCounts(current => ({
      ...current,
      [postId]: Math.max(0, (current[postId] || 0) + (isLiked ? -1 : 1)),
    }));

    try {
      const result = isLiked
        ? await supabase.from('roommate_post_likes').delete().eq('post_id', postId).eq('user_id', user.id)
        : await supabase.from('roommate_post_likes').insert({ post_id: postId, user_id: user.id });
      if (result.error) throw result.error;
    } catch (error) {
      setLikedRoommatePostIds(current => {
        const next = new Set(current);
        if (isLiked) next.add(postId);
        else next.delete(postId);
        return next;
      });
      setRoommateLikeCounts(current => ({
        ...current,
        [postId]: Math.max(0, (current[postId] || 0) + (isLiked ? 1 : -1)),
      }));
      if (isVerificationAccessError(error, user?.verificationStatus)) notify(restrictedVerificationMessage);
      else setDashboardError(`Unable to update your like: ${error.message}`);
    } finally {
      setLikeActionPostId(null);
    }
  };

  const openDirectChat = async (contact) => {
    if (!contact?.userId) return;
    if (user?.suspendedAt) {
      setDashboardError('Suspended accounts cannot message members.');
      return;
    }

    try { await assertDirectContactAvailable(user?.id, contact.userId); }
    catch (error) { setDashboardError(error.message); return; }
    let chatContact = contact;
    if (contact.name === 'Property owner') {
      try {
        const ownerContact = await fetchBoardmateMessageContact(contact.userId);
        chatContact = { ...contact, ...ownerContact, avatar: ownerContact.avatar || contact.avatar };
      } catch (error) {
        setDashboardError(`Unable to contact this listing owner: ${error.message}`);
        return;
      }
    }
    setActiveChat(chatContact);
    setChatOptionsOpen(false);
    clearChatAttachment();
    setMessages([]);
    setActiveTab('messages');
    try {
      const conversation = await fetchDirectConversation(user.id, chatContact.userId);
      if ((chatContact.unreadCount || 0) > 0 || conversation.some(message => message.sender === 'them' && !message.seenAt)) {
        try {
          await markDirectConversationSeen(chatContact.userId);
        } catch (error) {
          setDashboardError(`Messages loaded, but read receipts could not be updated: ${error.message}`);
        }
      }
      const refreshedMessages = await fetchDirectConversation(user.id, chatContact.userId);
      if (currentContactRef.current !== chatContact.userId) return;
      setMessages(refreshedMessages);
      setDashboardError(current => current.startsWith('Messages loaded, but read receipts could not be updated:') ? current : '');
    } catch (error) {
      setDashboardError(`Unable to open conversation: ${error.message}`);
    }
  };

  const handleSendMessage = async () => {
    const body = chatInput.trim();
    if ((!body && !chatAttachment) || !activeChat?.userId || !user?.id) return;
    if (user.verificationStatus !== 'approved') { notify(restrictedVerificationMessage); return; }
    setDashboardError('');
    try {
      const message = await sendDirectMessage(user.id, activeChat.userId, body, chatAttachment);
      setMessages(current => [...current, message]);
      setChatInput('');
      if (chatInputRef.current) chatInputRef.current.style.height = '';
      clearChatAttachment();
      fetchDirectInbox(user.id)
        .then(setMessageContacts)
        .catch(error => setDashboardError(`Message sent, but inbox could not refresh: ${error.message}`));
      recordActivity(user.id, 'Sent message', body || 'Sent an attachment').catch(error => setDashboardError(error.message));
    } catch (error) {
      if (error.code === '42501' || error.message?.toLowerCase().includes('row-level security')) {
        setDashboardError('Message could not be sent: one account may be inactive or suspended, a participant may have blocked the other, or the recipient is no longer available.');
      } else {
        setDashboardError(error.message || `Unable to send message: ${error.message}`);
      }
    }
  };

  const deleteCurrentConversation = (contact = activeChat) => {
    if (!contact?.userId) return;
    setChatOptionsOpen(false);
    setContactOptionsOpenId(null);
    setMessageActionConfirmation({
      title: 'Are you sure you want to delete?',
      message: contact.userId === user?.id
        ? 'This self-conversation will be hidden. Any new message you send to yourself will start a fresh visible conversation.'
        : 'It will be hidden from your Messages only. The other participant will still have their copy.',
      onConfirm: async () => {
        try {
          await hideDirectConversation(contact.userId);
          setMessageContacts(current => current.filter(item => item.userId !== contact.userId));
          setActiveChat(current => current?.userId === contact.userId ? null : current);
          if (activeChat?.userId === contact.userId) setMessages([]);
          recordActivity(user.id, 'Deleted conversation', contact.name).catch(error => setDashboardError(error.message));
          setDashboardError('');
        } catch (error) {
          setDashboardError(`Unable to delete conversation: ${error.message}`);
        }
      },
    });
  };

  const reportCurrentConversation = (contact = activeChat) => {
    if (!contact?.userId || contact.userId === user?.id || !user?.id) return;
    setActiveChat(contact);
    setDashboardError('');
    if (activeChat?.userId !== contact.userId) setMessages([]);
    setChatOptionsOpen(false);
    setContactOptionsOpenId(null);
    setReportCategory('other');
    setReportReason('');
    clearReportEvidence();
    setReportDialogOpen(true);
  };

  const submitConversationReport = async (event) => {
    event.preventDefault();
    if (!activeChat?.userId || !user?.id || submittingReport) return;
    setSubmittingReport(true);
    setDashboardError('');
    try {
      await reportDirectConversation(user.id, activeChat.userId, reportCategory, reportReason, reportEvidence);
      setReportDialogOpen(false);
      setReportReason('');
      clearReportEvidence();
      setDashboardError('Report submitted to the BoardMate admin team for review.');
    } catch (error) {
      setDashboardError(`Unable to submit report: ${error.message}`);
    } finally {
      setSubmittingReport(false);
    }
  };

  const blockCurrentContact = async (contact = activeChat) => {
    if (!contact?.userId || contact.userId === user?.id || !user?.id) return;
    try {
      await blockDirectContact(user.id, contact.userId);
      setMessageContacts(current => current.filter(item => item.userId !== contact.userId));
      setListings(current => current.filter(listing => listing.ownerId !== contact.userId));
      setRoommatePosts(current => current.filter(post => post.userId !== contact.userId));
      setActiveChat(current => current?.userId === contact.userId ? null : current);
      if (activeChat?.userId === contact.userId) setMessages([]);
      setChatOptionsOpen(false);
      setContactOptionsOpenId(null);
      setBlockConfirmationOpen(false);
      setBlockTargetContact(null);
      recordActivity(user.id, 'Blocked account', contact.name).catch(error => setDashboardError(error.message));
      setDashboardError('');
    } catch (error) {
      setDashboardError(`Unable to block account: ${error.message}`);
    }
  };

  const unblockContact = async (contact) => {
    try {
      await unblockDirectContact(contact.userId);
      await loadMarketplaceData();
      const inbox = await fetchDirectInbox(user.id);
      setMessageContacts(inbox);
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
          const conversation = await fetchDirectConversation(user.id, activeChat.userId);
          setMessages(conversation);
          setMessageContacts(current => current.map(contact => (
            contact.userId === activeChat.userId
              ? {
                ...contact,
                messages: conversation,
                lastMessage: conversation.at(-1)?.text || 'Message unsent',
              }
              : contact
          )));
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
      setMessages(await fetchDirectConversation(user.id, activeChat.userId));
      setDashboardError('');
    } catch (error) {
      setDashboardError(`Unable to update message reaction: ${error.message}`);
    } finally {
      setReactionPickerMessageId(null);
    }
  };

  const shareMessageToContact = async (contact) => {
    if (!shareTargetMessage || !user?.id || sharingMessage) return;
    setSharingMessage(true);
    try {
      await shareDirectMessage(user.id, contact.userId, shareTargetMessage);
      setShareTargetMessage(null);
      setShareSearch('');
      setDashboardError(`Message shared with ${contact.name}.`);
      setMessageContacts(await fetchDirectInbox(user.id));
    } catch (error) {
      setDashboardError(`Unable to share message: ${error.message}`);
    } finally {
      setSharingMessage(false);
    }
  };

  const renderRoommatePostActions = (post) => (
    <div className="flex items-center gap-3">
      <button
        type="button"
        aria-label={`${likedRoommatePostIds.has(post.id) ? 'Unlike' : 'Like'} ${post.name}'s roommate post`}
        aria-pressed={likedRoommatePostIds.has(post.id)}
        disabled={user?.suspendedAt || likeActionPostId === post.id}
        onClick={() => toggleRoommatePostLike(post.id)}
        className="flex items-center gap-1 text-[10px] font-semibold text-rose-600 disabled:opacity-50"
      >
        <span key={likedRoommatePostIds.has(post.id) ? 'liked' : 'not-liked'} className={likedRoommatePostIds.has(post.id) ? 'roommate-heart-pop' : ''}>
          {likedRoommatePostIds.has(post.id) ? '♥' : '♡'}
        </span>
        {roommateLikeCounts[post.id] || 0}
      </button>
      {post.userId !== user?.id && (
        <button
          type="button"
          aria-label={`Message ${post.name}`}
          onClick={() => openDirectChat({ userId: post.userId, name: post.name, avatar: post.avatar })}
          className="text-base cursor-pointer"
        >
          <MessageIcon className="h-5 w-5" />
        </button>
      )}
    </div>
  );

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
  const renderProfilePost = post => (
    <ProfilePostCard onPhotoChanged={refreshProfilePhotos} key={post.id} title={post.title} price={post.budget} priceLabel="Budget"
      location={post.location} description={post.details} status={post.moderationStatus}
      reason={post.moderationStatus === 'rejected' ? post.moderationReason : ''}
      media={collectProfileMedia([], [post])} onPreview={setMediaPreview}
      onOpen={() => setProfilePostPreview(post)} actions={<>
        <button type="button" className="bm-profile-action" onClick={() => startEditingRoommatePost(post)}>Edit</button>
        <button type="button" className="bm-profile-action bm-profile-action-danger" onClick={() => deleteRoommatePost(post)}>Delete</button>
      </>}>
      <p className="bm-profile-post-meta" aria-label={`${roommateLikeCounts[post.id] || 0} likes`}>{roommateLikeCounts[post.id] || 0} likes</p>
    </ProfilePostCard>
  );

  const unreadNotificationCount = visibleNotifications.filter(notification => !notification.read_at).length;
  const openNotifications = async () => {
    setNotificationsOpen(true);
    setShowSideMenu(false);
    try {
      const readAt = await markBoardmateNotificationsRead(user.id);
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
      const readAt = await markBoardmateNotificationsRead(user.id, notification.id);
      setModerationNotifications(current => current.map(item => (
        item.id === notification.id && !item.read_at ? { ...item, read_at: readAt } : item
      )));
    } catch (error) {
      setDashboardError(`Unable to mark notification as read: ${error.message}`);
    }

    if (notification.target_type === 'listing') {
      setActiveTab('accommodation_listings');
      const listing = listings.find(item => String(item.id) === String(notification.target_id));
      if (listing) setSelectedListing(listing);
    } else if (notification.target_type === 'roommate_post') {
      setActiveTab('roommate_posts');
      const post = [...roommatePosts, ...publicRoommatePosts].find(item => String(item.id) === String(notification.target_id));
      if (post) setSelectedRoommatePost(post);
    } else if (isVerificationNotification(notification)) {
      setAccountToolsSection('verification'); setAccountToolsOpen(true);
    } else if (notification.target_type === 'conversation_report') {
      setAccountToolsSection('report-history');
      setAccountToolsOpen(true);
    }
  };

  const refreshProfilePhotos = async (photo, action) => {
    setProfilePhotos(await fetchProfilePhotoGallery(user?.id));
    if (action === 'delete') {
      await loadMarketplaceData({ background: true });
      setProfilePostPreview(null);
      setMediaPreview(current => current?.src === photo.url ? null : current);
      if (user?.avatar === photo.url) onProfileUpdate?.({ ...user, avatar: null });
    }
  };

  if (publicProfileUserId) return <PublicProfileDialog key={publicProfileUserId} userId={publicProfileUserId} onClose={() => setPublicProfileUserId(null)} />;
  if (selectedRoommatePost || profilePostPreview) {
    const post = selectedRoommatePost || profilePostPreview;
    return <>
      <RoommatePostPage post={post} onBack={() => { setMediaPreview(null); setSelectedRoommatePost(null); setProfilePostPreview(null); }} onPreviewMedia={setMediaPreview}
        isLiked={likedRoommatePostIds.has(post.id)} likeCount={roommateLikeCounts[post.id] || 0} likePending={likeActionPostId === post.id}
        isSuspended={Boolean(user?.suspendedAt)} onToggleLike={() => toggleRoommatePostLike(post.id)}
        onMessage={post.userId && post.userId !== user?.id ? () => { setSelectedRoommatePost(null); setProfilePostPreview(null); openDirectChat({ userId: post.userId, name: post.name, avatar: post.avatar }); } : undefined}
        actions={profilePostPreview && <>
          <button type="button" onClick={() => { setProfilePostPreview(null); startEditingRoommatePost(post); }}>Edit</button>
          <button type="button" onClick={() => { setProfilePostPreview(null); deleteRoommatePost(post); }}>Delete</button>
        </>} />
      {mediaPreview && <MediaPreviewDialog media={mediaPreview} onClose={() => setMediaPreview(null)} />}
      <ErrorDialog message={dashboardError} onClose={() => setDashboardError('')} />
    </>;
  }
  if (selectedListing) return <>
    <AccommodationDetailPage listing={selectedListing} onBack={() => { setMediaPreview(null); setSelectedListing(null); }} onPreviewMedia={setMediaPreview}
      rating={<ListingRating listingTitle={selectedListing.title} average={selectedListing.ratingAverage} count={selectedListing.ratingCount} myRating={selectedListing.myRating}
        disabled={Boolean(user?.suspendedAt)} saving={ratingActionListingId === selectedListing.id} onRate={rating => rateListing(selectedListing.id, rating)} />}
      actions={<>
        <button type="button" disabled={favoriteActionListingId === selectedListing.id} aria-pressed={favoriteIds.includes(selectedListing.id)} onClick={() => toggleFavorite(selectedListing.id)}>{favoriteIds.includes(selectedListing.id) ? 'Saved' : 'Save listing'} · {listingFavoriteCounts[selectedListing.id] || 0}</button>
        {selectedListing.ownerId && selectedListing.ownerId !== user?.id && <>
          <button type="button" onClick={() => setPublicProfileUserId(selectedListing.ownerId)}>View owner profile</button>
          <button type="button" onClick={() => { const ownerId = selectedListing.ownerId; setSelectedListing(null); openDirectChat({ userId: ownerId, name: 'Property owner' }); }}>Message property owner</button>
        </>}
      </>} />

    {mediaPreview && <MediaPreviewDialog media={mediaPreview} onClose={() => setMediaPreview(null)} />}
    <ErrorDialog message={dashboardError} onClose={() => setDashboardError('')} />
  </>;

  if (accountToolsOpen) return <AccountToolsDialog
          userId={user.id}
          userProfile={user}
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
        />;
  if (notificationsOpen) return <NotificationsPage error={dashboardError} onDismissError={() => setDashboardError('')} notifications={visibleNotifications} onBack={() => setNotificationsOpen(false)} onDelete={deleteNotification} onHide={hideNotification} onOpen={openNotification} />;

  return (
    <div className="boardmate-user-dashboard w-full h-full bg-[#F7F4EB] text-gray-800 font-sans flex flex-col justify-between relative overflow-hidden">
      {pullRefreshIndicator}
      
      {/* HEADER SECTION (Eksaktong kaparehas ng Owner) */}
      {!activeChat && <div className="mx-auto w-full max-w-7xl p-4 flex items-center justify-between bg-[#F7F4EB] shrink-0">
        <button aria-label="Open menu" onClick={() => setShowSideMenu(true)} className="p-1 text-gray-700 hover:text-black cursor-pointer">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div className="flex items-center gap-1">
          <span className="text-xl font-serif font-bold text-gray-800">Board<span className="text-[#76A77E]">Mate</span></span>
          <BoardMateHouseIcon className="w-7 h-7 text-[#76A77E]" />
        </div>
      </div>}

      {/* USER PROFILE CARD */}
      {!activeChat && <div className="mx-auto w-full max-w-7xl px-4 mb-2 flex items-center gap-3 shrink-0">
        <button onClick={() => setActiveTab('profile')} aria-label="Open renter profile" className="relative rounded-full focus:outline-none focus:ring-2 focus:ring-emerald-500">
          {user?.avatar ? (
            <ProfileImage src={user.avatar} alt="Profile" className="w-11 h-11 rounded-full object-cover border-2 border-emerald-500" />
          ) : (
            <div className="w-11 h-11 rounded-full bg-white border-2 border-emerald-500 flex items-center justify-center text-gray-400">
              <i className="fa-regular fa-user"></i>
            </div>
          )}
          
        </button>
        <div>
          <p className="text-[10px] text-gray-500 font-medium">Welcome back,</p>
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-gray-900 text-sm">{user?.fullName || 'Renter'}</h3>
            <span className="bg-[#D3E4D7] text-[#3D6B4A] text-[9px] font-semibold px-2 py-0.5 rounded-full">Renter</span>
          </div>
          <p className="text-[10px] text-gray-500 italic">Find your Place. Find your Mate.</p>
        </div>
      </div>}

      {/* MAIN CONTENT AREA */}
      <div ref={dashboardScroll} className={activeChat
        ? 'absolute inset-0 z-50 flex min-h-0 flex-col bg-[#F7F4EB] p-3'
        : 'mx-auto w-full max-w-7xl flex-1 overflow-y-auto px-4 pb-16'}>
        {activeTab === 'messages' && messageSyncNotice && <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-[10px] text-amber-800" role="status">{messageSyncNotice}</p>}
        {user?.suspendedAt && (
          <div className="mb-2 rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-red-800" role="alert">
            <p className="font-bold">Your account is suspended. Posting, editing, messaging, and other account actions are disabled.</p>
            {user.suspensionReason && <p className="mt-1">{user.suspensionReason}</p>}
          </div>
        )}
        {dashboardError && <p className="mb-2 text-xs text-red-600" role="alert">{dashboardError}</p>}
        

        {/* 1. HOME SCREEN (IMAGE 1) */}
        {activeTab === 'home' && !selectedListing && (
          <div className="space-y-4">
            {/* Search Bar with Filter Trigger */}
            <div className="relative flex items-center">
              <SearchBar type="button" onClick={() => setShowSearchResults(true)} aria-label="Search listings and roommate posts">
                {searchQuery || searchFilters.location || searchFilters.propertyType || Number(searchFilters.maxPrice) < 200000
                  ? [searchQuery, searchFilters.location, searchFilters.propertyType, Number(searchFilters.maxPrice) < 200000 ? `Up to ₱${Number(searchFilters.maxPrice).toLocaleString()}` : ''].filter(Boolean).join(' · ')
                  : 'Search location, property, or roommate...'}
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

            {/* Quick Actions */}
            <div>
              <h4 className="text-xs font-bold text-gray-700 mb-2">Quick Actions</h4>
              <QuickActions variant="renter">
                <button 
                  onClick={() => setActiveTab('accommodation_listings')}
                  className="col-span-2 bg-[#CBE3D1] p-2 rounded-xl flex flex-col items-center justify-center text-center shadow-sm cursor-pointer"
                >
                  <span className="text-base mb-1">🏠</span>
                  <span className="text-[8px] font-bold text-[#2D5A39] leading-tight">Search Accommodations</span>
                </button>

                <button 
                  onClick={() => setActiveTab('roommate_posts')}
                  className="col-span-2 bg-[#CBE3D1] p-2 rounded-xl flex flex-col items-center justify-center text-center shadow-sm cursor-pointer"
                >
                  <span className="text-base mb-1">👥</span>
                  <span className="text-[8px] font-bold text-[#2D5A39] leading-tight">Roommate Finder</span>
                </button>

                <button 
                  onClick={() => setActiveTab('messages')}
                  className="relative col-span-2 bg-[#CBE3D1] p-2 rounded-xl flex flex-col items-center justify-center text-center shadow-sm cursor-pointer"
                >
                  <MessageIcon className="mb-1 h-5 w-5 text-[#2D5A39]" />
                  <span className="text-[8px] font-bold text-[#2D5A39] leading-tight">Messages</span>
                  {unreadMessageCount > 0 && <span className="absolute right-1 top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{unreadMessageCount > 9 ? '9+' : unreadMessageCount}</span>}
                </button>

                <button 
                  onClick={() => setActiveTab('favourites')}
                  className="col-span-3 bg-[#CBE3D1] p-2 rounded-xl flex flex-col items-center justify-center text-center shadow-sm cursor-pointer"
                >
                  <span className="text-base mb-1">💚</span>
                  <span className="text-[8px] font-bold text-[#2D5A39] leading-tight">Saved Listing</span>
                </button>

                <button
                  type="button"
                  onClick={openNotifications}
                  aria-label={`Notifications, ${unreadNotificationCount} unread`}
                  className="relative col-span-3 bg-[#CBE3D1] p-2 rounded-xl flex flex-col items-center justify-center text-center shadow-sm cursor-pointer"
                >
                  <i className="fa-regular fa-bell mb-1 text-base text-[#2D5A39]"></i>
                  <span className="text-[8px] font-bold text-[#2D5A39] leading-tight">Notifications</span>
                  {unreadNotificationCount > 0 && <span className="absolute right-1 top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}</span>}
                </button>
              </QuickActions>
            </div>

            {/* Recommendations Listings */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-xs font-bold text-gray-800">Recommendation Listings</h4>
                <button onClick={() => setActiveTab('accommodation_listings')} className="text-[10px] text-emerald-700 font-semibold cursor-pointer">View All</button>
              </div>
              {filteredListings.length > 0 ? (
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {filteredListings.map((item) => (
                    <div key={item.id} className="min-w-[130px] bg-white p-2 rounded-2xl shadow-sm border border-gray-100 flex-shrink-0">
                      <button onClick={() => { setSelectedListing(item); }} className="w-full text-left">
                        {item.image ? (
                          <ProfileImage src={item.image} alt={item.title} className="w-full h-20 object-cover rounded-xl mb-1" />
                        ) : (
                          <div className="w-full h-20 bg-gray-100 rounded-xl mb-1 flex items-center justify-center text-gray-400"><i className="fa-regular fa-image"></i></div>
                        )}
                        <h5 className="font-bold text-[11px] text-gray-800 truncate">{item.title}</h5>
                        <p className="text-[9px] text-emerald-600 font-medium">{item.price}</p>
                        <p className="flex items-center gap-1 text-[8px] text-gray-400">
                          <LocationIcon className="h-3 w-3 shrink-0" />
                          <span className="truncate">{item.location}</span>
                        </p>
                      </button>
                      <ListingRating
                        listingTitle={item.title}
                        average={item.ratingAverage}
                        count={item.ratingCount}
                        myRating={item.myRating}
                        disabled={Boolean(user?.suspendedAt)}
                        saving={ratingActionListingId === item.id}
                        onRate={rating => rateListing(item.id, rating)}
                      />
                      <button
                        type="button"
                        onClick={() => toggleFavorite(item.id)}
                        disabled={favoriteActionListingId === item.id}
                        aria-label={favoriteIds.includes(item.id) ? 'Remove from favourites' : 'Add to favourites'}
                        aria-pressed={favoriteIds.includes(item.id)}
                        className={`mt-1 flex items-center gap-1 text-[10px] disabled:opacity-50 ${favoriteIds.includes(item.id) ? 'text-rose-600' : 'text-gray-500'}`}
                      >
                        <span key={favoriteIds.includes(item.id) ? 'liked' : 'not-liked'} className={favoriteIds.includes(item.id) ? 'roommate-heart-pop' : ''}>
                          {favoriteIds.includes(item.id) ? '♥' : '♡'}
                        </span>
                        {listingFavoriteCounts[item.id] || 0}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-2 text-[10px] text-gray-400" role="status">
                  {loadingData ? 'Loading recommendations…' : listings.length ? 'No listings match your search filters.' : 'No accommodation listings to recommend yet.'}
                </p>
              )}
            </div>

            {/* Roommate Posts Overview */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <h4 className="text-xs font-bold text-gray-800">Roommate Posts</h4>
                <button onClick={() => setActiveTab('roommate_posts')} className="text-[10px] text-emerald-700 font-semibold cursor-pointer">View All</button>
              </div>

              <div className="accommodation-detail">
                {filteredRoommatePosts.map((post) => (
                  <div
                    key={post.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`View roommate post: ${post.title}`}
                    onClick={event => handleRoommatePostCardClick(event, post)}
                    onKeyDown={event => handleRoommatePostCardKeyDown(event, post)}
                    className="cursor-pointer rounded-xl border-b border-gray-100 pb-3 last:border-none last:pb-0 hover:bg-[#FAF7EE] focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => setPublicProfileUserId(post.userId)} aria-label={`View ${post.name}'s profile`} className="shrink-0">
                          {post.avatar ? (
                            <ProfileImage src={post.avatar} alt="" className="h-8 w-8 rounded-full object-cover" />
                          ) : (
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-400"><i className="fa-regular fa-user"></i></span>
                          )}
                        </button>
                        <button type="button" onClick={() => setPublicProfileUserId(post.userId)} className="text-left">
                          <h5 className="font-bold text-xs text-gray-800">{post.name}</h5>
                          <p className="font-semibold text-[11px] text-gray-700">{post.title}</p>
                        </button>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-[8px] text-gray-400">{post.time}</span>
                        {renderRoommatePostActions(post)}
                      </div>
                    </div>
                    <p className="mt-2 line-clamp-2 text-[10px] leading-relaxed text-gray-600">
                      {post.details || 'Open this post to see the full details.'}
                    </p>
                    <p className="mt-1 text-[9px] font-semibold text-emerald-700">
                      {post.budget ? `Budget: ${post.budget}` : 'View roommate post'}
                      {post.location ? ` · ${post.location}` : ''}
                    </p>
                  </div>
                ))}
                {!loadingData && filteredRoommatePosts.length === 0 && <p className="text-[10px] text-gray-400">{publicRoommatePosts.length ? 'No roommate posts match your search.' : 'No roommate posts from other users yet.'}</p>}
              </div>
            </div>
          </div>
        )}

        {/* 2. FAVOURITES TAB (IMAGE 4) */}
        {activeTab === 'favourites' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-gray-800">
              <span className="text-xl">🤍</span>
              <h3 className="font-bold text-base">My Favourites</h3>
            </div>

            <div className="space-y-3">
            {listings.filter(item => favoriteIds.includes(item.id)).map((item) => (
                <div key={item.id} className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex gap-3 relative">
                  {item.image ? (
                    <ProfileImage src={item.image} alt={item.title} className="w-24 h-20 object-cover rounded-xl shrink-0" />
                  ) : (
                    <div className="w-24 h-20 bg-gray-100 rounded-xl shrink-0 flex items-center justify-center text-gray-400"><i className="fa-regular fa-image"></i></div>
                  )}
                  <div className="flex-1 flex flex-col justify-between">
                    <div>
                      <h4 className="font-bold text-xs text-gray-800">{item.title}</h4>
                      <p className="text-[10px] text-emerald-600 font-medium">{item.price}</p>
                      <p className="text-[9px] text-rose-600">{listingFavoriteCounts[item.id] || 0} likes</p>
                      <p className="flex items-center gap-1 text-[9px] text-gray-400">
                        <LocationIcon className="h-3 w-3 shrink-0" />{item.location}
                      </p>
                      <ListingRating
                        listingTitle={item.title}
                        average={item.ratingAverage}
                        count={item.ratingCount}
                        myRating={item.myRating}
                        disabled={Boolean(user?.suspendedAt)}
                        saving={ratingActionListingId === item.id}
                        onRate={rating => rateListing(item.id, rating)}
                      />
                    </div>
                    <button 
                      onClick={() => { setSelectedListing(item); }}
                      className="text-[9px] text-emerald-700 font-semibold self-start"
                    >
                      see Description
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleFavorite(item.id)}
                    disabled={favoriteActionListingId === item.id}
                    aria-label="Remove from favourites"
                    className="self-start text-lg text-rose-600 disabled:opacity-50"
                  >
                    ♥
                  </button>
                </div>
              ))}
              {!loadingData && !listings.some(item => favoriteIds.includes(item.id)) && <p className="text-center text-[10px] text-gray-400">No saved listings yet.</p>}
            </div>
          </div>
        )}

        {/* 3. CREATE POST TAB (IMAGE 5) */}
        {activeTab === 'create_post' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 border-2 border-gray-700 rounded-lg flex items-center justify-center font-bold text-sm">+</div>
              <h3 className="font-bold text-base text-gray-800">{editingRoommatePostId ? 'Edit Roommate Post' : 'Create a Post'}</h3>
            </div>

            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 space-y-3">
              <div>
                <label className="text-[10px] font-bold text-gray-700">Heading:</label>
                <input 
                  type="text" 
                  placeholder="(E.g., Looking A Roommate)" 
                  value={postForm.heading}
                  onChange={(e) => setPostForm({ ...postForm, heading: e.target.value })}
                  className="w-full mt-1 px-3 py-1.5 border border-gray-200 rounded-xl text-xs focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-gray-700">Target Budget:</label>
                <input 
                  type="text" 
                  placeholder="(E.g., Php 4,000)" 
                  value={postForm.budget}
                  onChange={(e) => setPostForm({ ...postForm, budget: e.target.value })}
                  className="w-full mt-1 px-3 py-1.5 border border-gray-200 rounded-xl text-xs focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-gray-700">Description:</label>
                <textarea 
                  rows="4" 
                  placeholder="(E.g., need a guy roommate...)" 
                  value={postForm.description}
                  onChange={(e) => setPostForm({ ...postForm, description: e.target.value })}
                  className="w-full mt-1 px-3 py-1.5 border border-gray-200 rounded-xl text-xs focus:outline-none resize-none"
                ></textarea>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-bold text-gray-700">Post photos</p>
                    <p className="text-[9px] text-gray-500">Preview images, videos, and audio before posting. Maximum 10 MB each.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => roommatePhotoInput.current?.click()}
                    className="shrink-0 rounded-lg border border-emerald-700 px-3 py-2 text-[10px] font-semibold text-emerald-800"
                  >
                    Add photos
                  </button>
                  <ImageUploadInput
                    ref={roommatePhotoInput}
                    type="file"
                    accept="image/*,video/*,audio/*"
                    multiple
                    className="hidden"
                    onChange={addRoommatePostPhotos}
                  />
                </div>
                {roommatePostMedia.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {roommatePostMedia.map((media, index) => {
                      const source = media.previewUrl || media.url;
                      const name = media.name || media.file?.name || 'Roommate post photo';
                      return (
                        <div key={media.previewUrl || media.path || `${media.url}-${index}`} className="space-y-1">
                          {media.mimeType?.startsWith('video/') ? (
                            <div>
                              <UploadedMedia as="video" src={source} controls playsInline aria-label={name} className="h-20 w-full rounded-lg bg-gray-100 object-cover" />
                              <button type="button" onClick={() => setMediaPreview({ src: source, name, mimeType: media.mimeType })} className="text-[9px] font-semibold text-emerald-700 underline">Preview video</button>
                            </div>
                          ) : media.mimeType?.startsWith('audio/') ? (
                            <div className="space-y-1">
                              <UploadedMedia as="audio" src={source} controls aria-label={name} className="w-full" />
                              <button type="button" onClick={() => setMediaPreview({ src: source, name, mimeType: media.mimeType })} className="text-[9px] font-semibold text-emerald-700 underline">Preview audio</button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => media.file
                                ? openImageEditor('roommate', media, index)
                                : setMediaPreview({ src: source, name, mimeType: media.mimeType || 'image/*' })}
                              aria-label={media.file ? `Crop ${name}` : `Preview ${name}`}
                              className="w-full"
                            >
                              <ProfileImage src={source} alt={name} className="h-20 w-full rounded-lg object-cover" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => removeRoommatePostMedia(index)}
                            aria-label={`Remove ${name}`}
                            className="w-full truncate text-[9px] text-red-600 underline"
                          >
                            Remove media
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 text-xs">
                <label htmlFor="roommate-post-location" className="shrink-0 text-emerald-700 font-semibold flex items-center gap-1">
                  <LocationIcon className="h-4 w-4" />
                  Location
                </label>
                <input
                  id="roommate-post-location"
                  type="text"
                  placeholder="Enter your location"
                  aria-label="Roommate post location"
                  value={postForm.location}
                  onChange={event => setPostForm(current => ({ ...current, location: event.target.value }))}
                  className="w-36 px-2 py-1 border border-gray-200 rounded-lg text-[10px]"
                />
              </div>

              <div className="relative">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-700 font-semibold">👤 Select Role</span>
                  <button 
                    type="button" 
                    onClick={() => setShowRoleDropdown(!showRoleDropdown)}
                    className="w-36 px-2 py-1 border border-gray-200 rounded-lg text-[10px] flex justify-between items-center bg-white"
                  >
                    <span>{postForm.role}</span>
                    <span>❯</span>
                  </button>
                </div>

                {showRoleDropdown && (
                  <div className="absolute right-0 bottom-8 bg-white border border-gray-200 rounded-xl shadow-lg p-2 w-32 space-y-1 z-20">
                    {['Student', 'Teacher', 'Worker', 'Other'].map((r) => (
                      <button 
                        key={r}
                        onClick={() => { setPostForm({ ...postForm, role: r }); setShowRoleDropdown(false); }}
                        className="w-full text-left px-2 py-1 text-[10px] rounded-lg border border-gray-300 hover:bg-emerald-50"
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => {
                    cancelRoommatePost();
                  }}
                  className="px-3 py-1 text-[10px] text-gray-500 font-semibold"
                >
                  CANCEL
                </button>
                <button onClick={handleCreatePost} disabled={submittingPost} className="px-4 py-1.5 bg-[#689F78] text-white font-bold rounded-xl text-xs shadow-sm disabled:opacity-50">
                  {submittingPost ? 'SAVING...' : editingRoommatePostId ? 'SAVE CHANGES' : 'UPLOAD'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 4. PROFILE TAB (IMAGE 6) */}
        {activeTab === 'profile' && (
          <div className="bm-profile-page">
            <ProfileHero name={user?.fullName || 'Renter'} avatar={user?.avatar} role="Renter" onPreview={setMediaPreview}
              onPhotoChange={openProfilePhotoCrop} uploading={uploadingPhoto} />
            <ProfileDetails onEdit={openProfileEditor} fields={[
              { label: 'Full name', value: user?.fullName },
              { label: 'Email address', value: user?.email },
              { label: 'Phone number', value: user?.phone },
              { label: 'Date of birth', value: user?.dob },
              { label: 'Gender', value: user?.gender },
            ]} />
            <ProfileSection title="Photos & media" action="See all media" onAction={() => setActiveTab('profile_photos')}>
              <ProfileMediaGallery onPhotoChanged={refreshProfilePhotos} media={ownProfileMedia.slice(0, 6)} onPreview={setMediaPreview} />
            </ProfileSection>
            <ProfileSection title="My posts" action="See all posts" onAction={() => setActiveTab('profile_posts')}>
              <div className="bm-profile-feed">{ownProfilePosts.map(renderProfilePost)}</div>
              {!ownProfilePosts.length && <p className="bm-profile-empty">No posts yet.</p>}
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
            <div className="bm-profile-gallery-page-heading"><h1>My posts</h1><button type="button" className="bm-profile-link" onClick={() => setActiveTab('profile')}>Back to profile</button></div>
            <div className="bm-profile-feed">{ownProfilePosts.map(renderProfilePost)}
              {rejectedRoommatePosts.map(entry => (
                <ProfilePostCard onPhotoChanged={refreshProfilePhotos} key={entry.id} title={entry.details.split('\n')[0]} status="rejected"
                  reason={entry.details.split('\n').slice(1).join('\n')} />
              ))}
            </div>
            {!ownProfilePosts.length && !rejectedRoommatePosts.length && <p className="bm-profile-empty">No posts yet.</p>}
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

        {/* 5. MESSAGES TAB (IMAGE 7 & 8) */}
        {activeTab === 'messages' && (
          <div className={activeChat ? 'flex h-full min-h-0 flex-1 flex-col' : 'space-y-3'}>
            {!activeChat ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-gray-800">
                  <MessageIcon className="h-6 w-6" />
                  <h3 className="font-bold text-base">Messages</h3>
                </div>

                <SearchBar
                  
                  value={messageSearchQuery}
                  onChange={event => setMessageSearchQuery(event.target.value)}
                  placeholder="Find a name in your conversations"
                  aria-label="Search conversations by name"
                />
                <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 min-h-[300px]">
                  {filteredMessageContacts.map(contact => (
                    <div key={contact.userId} className="relative flex items-center">
                      <button
                        type="button"
                        onClick={() => openDirectChat(contact)}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 text-left hover:bg-gray-50"
                      >
                        {contact.avatar ? (
                          <span className="relative shrink-0">
                            <ProfileImage src={contact.avatar} alt="" className="h-9 w-9 rounded-full object-cover" />
                            {isUserActive(contact.lastSeenAt) && <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" />}
                          </span>
                        ) : (
                          <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gray-100 text-gray-500">
                            👤
                            {isUserActive(contact.lastSeenAt) && <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" />}
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-bold text-gray-800">{contact.name}</span>
                          <span className="block truncate text-[10px] text-gray-500">
                            {contact.lastMessage || 'New conversation'}
                            {contact.lastSeenAt && <span className="ml-1">{isUserActive(contact.lastSeenAt) ? '· Active now' : `· ${formatLastSeen(contact.lastSeenAt)}`}</span>}
                          </span>
                        </span>
                        {(contact.unreadCount || 0) > 0 && (
                          <span className="grid min-h-4 min-w-4 place-items-center rounded-full bg-emerald-700 px-1 text-[9px] font-bold text-white">
                            {(contact.unreadCount || 0) > 9 ? '9+' : (contact.unreadCount || 0)}
                          </span>
                        )}
                      </button>
                      <div data-message-popover className="relative shrink-0">
                        <button type="button" aria-label={`Options for ${contact.name}`} aria-expanded={contactOptionsOpenId === contact.userId} onClick={() => setContactOptionsOpenId(current => current === contact.userId ? null : contact.userId)} className="relative z-10 grid h-10 w-10 shrink-0 touch-manipulation place-items-center rounded-full text-gray-500 hover:bg-gray-100">•••</button>
                        {contactOptionsOpenId === contact.userId && (
                          <div data-message-popover className="absolute right-0 top-full z-30 w-44 rounded-xl border border-gray-200 bg-white p-1 shadow-xl">
                            <button type="button" onClick={() => deleteCurrentConversation(contact)} className="w-full rounded-lg px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50">Delete Conversation…</button>
                            {contact.userId !== user?.id && (
                              <>
                              <button type="button" onClick={event => { event.preventDefault(); event.stopPropagation(); reportCurrentConversation(contact); }} className="min-h-10 w-full touch-manipulation rounded-lg px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50">Report</button>
                              <button type="button" onClick={() => { setDashboardError(''); setBlockTargetContact(contact); setContactOptionsOpenId(null); setBlockConfirmationOpen(true); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-red-700 hover:bg-red-50">Block Account</button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {filteredMessageContacts.length === 0 && (
                    <p className="mt-20 text-center text-[10px] text-gray-400">
                      {messageSearchQuery.trim()
                        ? 'No conversations match that name.'
                        : 'No messages yet. Open an approved post and tap the message button to start a conversation.'}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              /* CHAT CONVERSATION VIEW (IMAGE 8) */
              <div className="relative flex min-h-0 flex-1 flex-col rounded-2xl border border-gray-100 bg-white p-3 shadow-sm">
                <div className="relative mb-2 flex items-center justify-between border-b border-gray-100 pb-2">
                  <div className="flex items-center gap-2">
                    <button onClick={() => { setActiveChat(null); setMessages([]); setChatOptionsOpen(false); }} aria-label="Back to messages" className="text-gray-500 text-sm font-bold cursor-pointer">❮</button>
                    <button type="button" onClick={() => setPublicProfileUserId(activeChat.userId)} aria-label={`View ${activeChat.name}'s profile`} className="relative">
                      {activeChat.avatar ? <ProfileImage src={activeChat.avatar} alt="" className="h-9 w-9 rounded-full object-cover" /> : <span className="grid h-9 w-9 place-items-center rounded-full bg-gray-100">👤</span>}
                      {isUserActive(activeChat.lastSeenAt) && <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" />}
                    </button>
                    <button type="button" onClick={() => setPublicProfileUserId(activeChat.userId)} className="text-left">
                      <h5 className="font-bold text-xs text-gray-800">{activeChat.name}</h5>
                      <span className="block text-[9px] text-gray-500">
                        {isUserActive(activeChat.lastSeenAt) ? 'Active now' : formatLastSeen(activeChat.lastSeenAt)}
                      </span>
                    </button>
                  </div>
                  <div data-message-popover className="relative">
                    <button type="button" aria-label="Conversation options" onClick={() => setChatOptionsOpen(open => !open)} className="relative z-10 grid h-10 w-10 shrink-0 touch-manipulation place-items-center rounded-full text-gray-500">•••</button>
                    {chatOptionsOpen && (
                      <div data-message-popover className="absolute right-0 top-full z-30 w-48 rounded-xl border border-gray-200 bg-white p-1 shadow-xl">
                        <button type="button" onClick={() => deleteCurrentConversation(activeChat)} className="w-full rounded-lg px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50">Delete Conversation…</button>
                        {activeChat.userId !== user?.id && (
                          <>
                            <button type="button" onClick={event => { event.preventDefault(); event.stopPropagation(); reportCurrentConversation(activeChat); }} className="min-h-10 w-full touch-manipulation rounded-lg px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50">Report</button>
                            <button type="button" onClick={() => { setDashboardError(''); setBlockTargetContact(activeChat); setChatOptionsOpen(false); setBlockConfirmationOpen(true); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-red-700 hover:bg-red-50">Block Account</button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div ref={chatMessagesRef} role="log" aria-live="polite" aria-label="Conversation messages" className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                  {historyPages[`${user?.id}:${activeChat?.userId}`]?.hasOlder && (
                    <button type="button" onClick={loadOlderMessages} disabled={loadingOlderMessages} className="mx-auto block rounded-lg px-3 py-2 text-xs font-bold text-emerald-800 disabled:opacity-50">
                      {loadingOlderMessages ? 'Loading older messages...' : 'Load older messages'}
                    </button>
                  )}
                  {messages.map((msg) => (
                    <div key={msg.id} className={`flex flex-col ${msg.sender === 'me' ? 'items-end' : 'items-start'}`}>
                      <div className={`flex min-w-0 w-full max-w-full items-start gap-1 ${msg.sender === 'me' ? 'flex-row-reverse' : ''}`}>
                        {!msg.deletedAt && (
                          <div data-message-popover className="relative z-20 shrink-0">
                            <button type="button" aria-label="Message options" onClick={() => setMessageOptionsOpenId(current => current === msg.id ? null : msg.id)} className="grid h-8 w-5 place-items-center text-gray-400">⋮</button>
                            {messageOptionsOpenId === msg.id && (
                              <div onClick={event => event.stopPropagation()} className={`absolute ${msg.sender === 'me' ? 'right-0' : 'left-0'} top-full z-30 w-40 rounded-xl border border-gray-200 bg-white p-1 shadow-xl`}>
                                {msg.sender === 'me' && <button type="button" onClick={() => unsendMessage(msg, true)} className="w-full rounded-lg px-2 py-2 text-left text-[10px] text-red-600 hover:bg-red-50">Unsend for everyone</button>}
                                <button type="button" onClick={() => unsendMessage(msg, false)} className="w-full rounded-lg px-2 py-2 text-left text-[10px] text-gray-700 hover:bg-gray-50">Unsend for you</button>
                              </div>
                            )}
                          </div>
                        )}
                        <div className={`bm-message-bubble ${msg.attachmentUrl ? 'bm-message-attachment' : ''} min-w-0 max-w-[78%] space-y-1 rounded-2xl p-2.5 text-xs ${msg.sender === 'me' ? 'bg-[#DCEBDD] text-gray-800' : 'bg-gray-100 text-gray-800'} ${msg.deletedAt ? 'italic text-gray-500' : ''}`}>
                          {msg.isForwarded && <p className="text-[9px] font-semibold text-emerald-700">Shared</p>}
                          {msg.attachmentMime?.startsWith('image/') && msg.attachmentUrl && (
                            <button className="bm-chat-image-button" type="button" onClick={() => setMediaPreview({ src: msg.attachmentUrl, name: msg.attachmentName || 'Message photo', mimeType: msg.attachmentMime })}>
                              <ProfileImage src={msg.attachmentUrl} alt={msg.attachmentName || 'Message attachment'} className="bm-chat-image" />
                            </button>
                          )}
                          {msg.attachmentMime?.startsWith('video/') && msg.attachmentUrl && (
                            <div>
                              <ConversationMediaPlayer src={msg.attachmentUrl} mimeType={msg.attachmentMime} className="max-h-64 max-w-full rounded-xl" onPreview={() => setMediaPreview({ src: msg.attachmentUrl, name: msg.attachmentName || 'Message video', mimeType: msg.attachmentMime })} />
                            </div>
                          )}
                          {msg.attachmentMime?.startsWith('audio/') && msg.attachmentUrl && (
                            <div>
                              <ConversationMediaPlayer src={msg.attachmentUrl} mimeType={msg.attachmentMime} className="max-w-full" onPreview={() => setMediaPreview({ src: msg.attachmentUrl, name: msg.attachmentName || 'Message audio', mimeType: msg.attachmentMime })} />
                            </div>
                          )}
                          {msg.attachmentUrl && !/^(image|video|audio)\//.test(msg.attachmentMime || '') && <button type="button" className="block max-w-full break-words text-left text-xs underline" onClick={() => setMediaPreview({ src: msg.attachmentUrl, name: msg.attachmentName || 'Attachment', mimeType: msg.attachmentMime || 'application/octet-stream' })}>Preview and download {msg.attachmentName || 'attachment'}</button>}
                          {msg.text && <p className="whitespace-pre-wrap break-words">{msg.text}</p>}
                        </div>
                        {!msg.deletedAt && <button type="button" aria-label="Share message" onClick={() => { setShareTargetMessage(msg); setShareSearch(''); }} className="grid h-8 w-6 shrink-0 self-center place-items-center text-gray-400 hover:text-emerald-700"><span aria-hidden="true">{msg.sender === 'me' ? '←' : '→'}</span></button>}
                      </div>
                      <div className="mt-1 flex items-center gap-1 text-[9px] text-gray-400">
                        <time dateTime={msg.createdAt} title={new Date(msg.createdAt).toLocaleString()}>
                          {new Date(msg.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        </time>
                        {msg.sender === 'me' && (
                          <span className="flex items-center gap-1 text-gray-500">
                            {msg.seenAt
                              ? <><span className="font-bold text-sky-600">✓✓</span> Seen</>
                              : <><span className="font-bold">✓</span> Sent</>}
                          </span>
                        )}
                      </div>
                      {!msg.deletedAt && (
                        <div className="relative mt-1 flex flex-wrap items-center gap-1">
                          {msg.reactions.filter((reaction, index, all) => all.findIndex(item => item.reaction === reaction.reaction) === index).map(reaction => (
                            <button key={reaction.reaction} type="button" onClick={() => toggleMessageReaction(msg, reaction.reaction)} className={`rounded-full border px-1.5 py-0.5 text-[10px] ${msg.reactions.some(item => item.reaction === reaction.reaction && item.isMine) ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 bg-white'}`}>
                              {{ like: '👍', heart: '❤️', laugh: '😂', surprise: '😮', sad: '😢', angry: '😡' }[reaction.reaction]}
                              {' '}{msg.reactions.filter(item => item.reaction === reaction.reaction).length}
                            </button>
                          ))}
                          <button type="button" aria-label="React to message" onClick={() => setReactionPickerMessageId(current => current === msg.id ? null : msg.id)} className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] text-gray-500">＋ React</button>
                          {reactionPickerMessageId === msg.id && (
                            <div data-message-popover className={`absolute bottom-full z-30 mb-1 flex gap-1 rounded-full border border-gray-200 bg-white p-1 shadow-lg ${msg.sender === 'me' ? 'right-0' : 'left-0'}`}>
                              {[['like', '👍'], ['heart', '❤️'], ['laugh', '😂'], ['surprise', '😮'], ['sad', '😢'], ['angry', '😡']].map(([reaction, emoji]) => (
                                <button key={reaction} type="button" aria-label={`React ${reaction}`} onClick={() => toggleMessageReaction(msg, reaction)} className="rounded-full p-1 text-base hover:bg-gray-100">{emoji}</button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  <div aria-hidden="true" />
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-gray-100 mt-2">
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
                        handleSendMessage();
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
                  <button type="button" onClick={handleSendMessage} disabled={!chatInput.trim() && !chatAttachment} aria-label="Send message" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#76A77E] text-white disabled:opacity-40">
                    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M3.4 20.4 21 12 3.4 3.6l.1 6.5 12.2 1.9-12.2 1.9-.1 6.5z" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 6. ROOMMATE POSTS FULL VIEW (IMAGE 9 & 10) */}
        {activeTab === 'roommate_posts' && (
          <div className="space-y-3">
            <h3 className="font-bold text-base text-gray-800">Roommate Posts</h3>
            <SearchBar
              
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="Search roommate posts"
              aria-label="Search roommate posts"
            />

            <div className="space-y-3">
              {filteredRoommatePosts.map((post) => {
                return (
                  <div
                    key={post.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`View roommate post: ${post.title}`}
                    onClick={event => handleRoommatePostCardClick(event, post)}
                    onKeyDown={event => handleRoommatePostCardKeyDown(event, post)}
                    className="cursor-pointer space-y-2 rounded-2xl border border-gray-100 bg-white p-3 shadow-sm hover:border-emerald-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => setPublicProfileUserId(post.userId)} aria-label={`View ${post.name}'s profile`} className="shrink-0">
                          {post.avatar ? (
                            <ProfileImage src={post.avatar} alt="" className="h-10 w-10 rounded-full object-cover" />
                          ) : (
                            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-400"><i className="fa-regular fa-user"></i></span>
                          )}
                        </button>
                        <button type="button" onClick={() => setPublicProfileUserId(post.userId)} className="text-left">
                          <h5 className="font-bold text-xs text-gray-800">{post.name}</h5>
                          <p className="font-bold text-[11px] text-gray-700">{post.title}</p>
                        </button>
                      </div>
                      <button 
                        onClick={() => setSelectedRoommatePost(post)}
                        className="text-[10px] text-emerald-700 font-semibold cursor-pointer"
                      >
                        View details
                      </button>
                    </div>

                    {post.photos?.length > 0 && (
                      <div className="flex gap-2 overflow-x-auto">
                        {post.photos.map((photo, index) => (
                          photo.mimeType?.startsWith('audio/')
                            ? <div key={photo.path || photo.url || index} className="w-56 shrink-0 space-y-1">
                              <UploadedMedia as="audio" src={photo.url} controls aria-label={photo.name || `${post.title} audio`} className="w-full" />
                              <button type="button" onClick={() => setMediaPreview({ src: photo.url, name: photo.name || `${post.title} audio`, mimeType: photo.mimeType })} className="text-[9px] font-semibold text-emerald-700 underline">Preview audio</button>
                            </div>
                            : photo.mimeType?.startsWith('video/')
                              ? <div key={photo.path || photo.url || index} className="w-40 shrink-0 space-y-1">
                                <UploadedMedia as="video" src={photo.url} controls playsInline aria-label={photo.name || `${post.title} video`} className="h-24 w-full rounded-xl bg-gray-100 object-cover" />
                                <button type="button" onClick={() => setMediaPreview({ src: photo.url, name: photo.name || `${post.title} video`, mimeType: photo.mimeType })} className="text-[9px] font-semibold text-emerald-700 underline">Preview video</button>
                              </div>
                              : <button
                                key={photo.path || photo.url || index}
                                type="button"
                                onClick={() => setMediaPreview({
                                  src: photo.url,
                                  name: photo.name || `${post.title} photo`,
                                  mimeType: photo.mimeType || 'image/*',
                                })}
                                aria-label={`Preview ${photo.name || 'roommate post photo'}`}
                                className="shrink-0"
                              >
                                <ProfileImage src={photo.url} alt={photo.name || `${post.title} photo`} className="h-24 w-32 rounded-xl object-cover" />
                              </button>
                        ))}
                      </div>
                    )}
                    <p className="text-[10px] font-semibold text-emerald-700">Budget: {post.budget}</p>
                    <div className="flex justify-between items-center text-[10px] text-gray-500 pt-1">
                      <p>
                        {post.gender || 'Gender not provided'}, {post.age ?? 'Age not provided'}, {post.role}
                        <br />
                        <span className="inline-flex items-center gap-1">
                          <LocationIcon className="h-3 w-3" />
                          {post.location}
                        </span>
                      </p>
                      {renderRoommatePostActions(post)}
                    </div>
                  </div>
                );
              })}
            </div>
            {!loadingData && filteredRoommatePosts.length === 0 && <p className="text-center text-[10px] text-gray-400 mt-6">{publicRoommatePosts.length ? 'No roommate posts match your search.' : 'No roommate posts from other users yet.'}</p>}
          </div>
        )}

        {activeTab === 'accommodation_listings' && (
          <section className="space-y-3">
            <h3 className="font-bold text-base text-gray-800">Accommodation Listings</h3>
            <SearchBar value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search accommodations by place or keyword" aria-label="Search accommodation listings" />
            <button type="button" onClick={() => setShowFilterModal(true)} className="w-full rounded-xl border border-emerald-700 bg-white px-3 py-2 text-left text-xs text-emerald-800">Search filters · {[searchFilters.location, searchFilters.propertyType].filter(Boolean).join(' · ') || 'Update saved preferences'}</button>
            <div className="space-y-3">
              {filteredListings.map(item => <article key={item.id} className="flex min-w-0 gap-3 rounded-2xl border border-gray-100 bg-white p-3 shadow-sm">
                {item.image ? <ProfileImage src={item.image} alt={item.title} className="h-20 w-20 shrink-0 rounded-xl object-cover" /> : <span className="grid h-20 w-20 shrink-0 place-items-center rounded-xl bg-gray-100" aria-hidden="true">⌂</span>}
                <div className="min-w-0 flex-1 space-y-1">
                  <button type="button" onClick={() => setSelectedListing(item)} className="w-full text-left"><h4 className="break-words text-sm font-bold">{item.title}</h4><p className="break-words text-xs text-emerald-700">{item.price}</p><p className="break-words text-xs text-gray-500">{item.location}</p></button>
                  <ListingRating listingTitle={item.title} average={item.ratingAverage} count={item.ratingCount} myRating={item.myRating} disabled={Boolean(user?.suspendedAt)} saving={ratingActionListingId === item.id} onRate={rating => rateListing(item.id, rating)} />
                  <div className="flex flex-wrap gap-3"><button type="button" onClick={() => setSelectedListing(item)} className="text-xs font-semibold text-emerald-700">View details</button><button type="button" onClick={() => toggleFavorite(item.id)} disabled={favoriteActionListingId === item.id} aria-pressed={favoriteIds.includes(item.id)} aria-label={favoriteIds.includes(item.id) ? 'Remove from favourites' : 'Add to favourites'} className="text-xs text-emerald-700">{favoriteIds.includes(item.id) ? 'Saved' : 'Save'} · {listingFavoriteCounts[item.id] || 0}</button></div>
                </div>
              </article>)}
              {!loadingData && filteredListings.length === 0 && <p className="py-4 text-center text-xs text-gray-500">{listings.length ? 'No listings match your search filters.' : 'No available listings yet.'}</p>}
            </div>
          </section>
        )}
      </div>
      {user?.suspendedAt && (
        <div className="absolute inset-0 z-[95] flex items-center justify-center bg-[#FAF7EE]/95 p-5" role="alertdialog" aria-modal="true" aria-labelledby="renter-suspension-title">
          <div className="w-full max-w-sm space-y-3 rounded-2xl border border-red-200 bg-white p-5 shadow-2xl">
            <h2 id="renter-suspension-title" className="text-sm font-bold text-red-800">Account suspended</h2>
            <p className="text-xs text-gray-700">Your account is suspended. Posting, editing, messaging, and other account actions are disabled.</p>
            {user.suspensionReason && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-800">{user.suspensionReason}</p>}
            <button type="button" onClick={onLogout} className="w-full rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white">Log out</button>
          </div>
        </div>
      )}

      {blockConfirmationOpen && blockTargetContact && (
        <div className="absolute inset-0 z-[84] flex items-center justify-center bg-black/55 p-4" role="alertdialog" aria-modal="true" aria-labelledby="renter-block-title">
          <div className="w-full max-w-xs space-y-4 rounded-2xl bg-white p-5 shadow-2xl">
            <h2 id="renter-block-title" className="text-sm font-bold text-gray-900">Are you sure you want to block this person?</h2>
            <p className="text-xs text-gray-600">{blockTargetContact.name} and their posts/listings will no longer appear to you.</p>
            {dashboardError && <p className="text-xs text-red-600" role="alert">{dashboardError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setBlockConfirmationOpen(false); setBlockTargetContact(null); }} className="rounded-lg bg-gray-100 px-4 py-2 text-xs font-semibold text-gray-700">NO</button>
              <button type="button" onClick={() => blockCurrentContact(blockTargetContact)} className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white">YES</button>
            </div>
          </div>
        </div>
      )}

      {messageActionConfirmation && (
        <div className="absolute inset-0 z-[86] flex items-center justify-center bg-black/55 p-4" role="alertdialog" aria-modal="true" aria-labelledby="renter-message-action-title">
          <div className="w-full max-w-xs space-y-4 rounded-2xl bg-white p-5 shadow-2xl">
            <h2 id="renter-message-action-title" className="text-sm font-bold text-gray-900">{messageActionConfirmation.title}</h2>
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
          <section className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-4 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="renter-share-title">
            <div className="flex items-center justify-between">
              <h2 id="renter-share-title" className="text-sm font-bold text-gray-900">Share message</h2>
              <button type="button" onClick={() => setShareTargetMessage(null)} aria-label="Close share dialog" className="text-xl text-gray-500">×</button>
            </div>
            <SearchBar  value={shareSearch} onChange={event => setShareSearch(event.target.value)} placeholder="Search people you've chatted with" aria-label="Search people in your conversations" />
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {shareContacts
                .filter(contact => (contact.name || '').toLowerCase().includes(shareSearch.trim().toLowerCase()))
                .map(contact => (
                  <button key={contact.userId} type="button" onClick={() => shareMessageToContact(contact)} disabled={sharingMessage} className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-xs hover:bg-gray-50 disabled:opacity-50">
                    {contact.avatar ? <ProfileImage src={contact.avatar} alt="" className="h-8 w-8 rounded-full object-cover" /> : <span className="grid h-8 w-8 place-items-center rounded-full bg-gray-100">👤</span>}
                    <span className="flex-1 truncate">{contact.name}</span>
                    <span className="text-emerald-700">{sharingMessage ? 'Sharing…' : 'Share'}</span>
                  </button>
                ))}
              {shareContacts.filter(contact => (contact.name || '').toLowerCase().includes(shareSearch.trim().toLowerCase())).length === 0 && (
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
          <form onSubmit={submitConversationReport} className="max-h-[90cqh] w-full max-w-sm space-y-3 overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="renter-report-title">
            <div className="flex items-center justify-between">
              <h2 id="renter-report-title" className="text-sm font-bold text-gray-900">Report {activeChat?.name || 'account'}</h2>
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
              await saveSearchPreferences(user.id, searchFilters);
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
          listings={filteredListings}
          roommatePosts={searchRoommatePosts}
          filters={searchFilters}
          onSelectListing={listing => {
            setSelectedListing(listing);
          }}
          onSelectRoommatePost={post => {
            setSelectedRoommatePost(post);
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
        message={/^(Report submitted|Post saved\.)/.test(dashboardError) ? '' : dashboardError}
        onClose={() => setDashboardError('')}
      />


      {showSideMenu && (
        <SidebarDrawer
          onClose={() => setShowSideMenu(false)}
          onProfile={() => { setActiveTab('profile'); setShowSideMenu(false); }}
          onSettings={() => { setAccountToolsSection('settings'); setAccountToolsOpen(true); setShowSideMenu(false); }}
          onHistory={() => { setLoadingHistory(true); setActiveTab('history'); setShowSideMenu(false); }}
          onNotifications={openNotifications}
          onReport={() => { setAccountToolsSection('report'); setAccountToolsOpen(true); setShowSideMenu(false); }}
          onLogout={() => setShowLogoutConfirmation(true)}
          notificationCount={unreadNotificationCount}
        />
      )}

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
            <p className="text-[10px] text-gray-400">Email: {user?.email} (managed by your login account)</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowProfileEditor(false)} className="rounded-lg bg-gray-200 px-4 py-2 text-xs font-bold">Cancel</button>
              <button type="submit" className="rounded-lg bg-[#689F78] px-4 py-2 text-xs font-bold text-white">Save</button>
            </div>
          </form>
        </div>
      )}

      {showLogoutConfirmation && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/50 p-5" role="presentation">
          <div className="w-full max-w-xs rounded-2xl bg-white p-5 text-center shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="renter-logout-title">
            <h2 id="renter-logout-title" className="text-sm font-bold text-gray-800">Are you sure to log out?</h2>
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

      {/* FIXED BOTTOM NAVIGATION BAR (Eksaktong 100% Match sa Owner Module) */}
      {!activeChat && <div className="boardmate-mobile-nav bg-[#FAF7EE] border-t border-gray-200 px-3 py-2 flex justify-around items-center shrink-0 z-40">
        
        {/* HOME */}
        <button 
          onClick={() => { setSelectedListing(null); setActiveTab('home'); }}
          className="flex flex-col items-center gap-0.5 cursor-pointer"
        >
          <div className={`w-5 h-5 flex items-center justify-center ${activeTab === 'home' ? 'text-[#689F78]' : 'text-slate-500'}`}>
            <BoardMateHouseIcon className={`h-5 w-5 ${activeTab === 'home' ? 'nav-icon-active' : ''}`} />
          </div>
          <span className={`text-[10px] font-bold ${activeTab === 'home' ? 'text-[#689F78]' : 'text-gray-400'}`}>
            Home
          </span>
        </button>

        {/* LISTINGS / FAVOURITES */}
        <button 
          onClick={() => setActiveTab('favourites')} 
          className="flex flex-col items-center gap-0.5 cursor-pointer"
        >
          <div className={`w-5 h-5 flex items-center justify-center ${activeTab === 'favourites' ? 'text-[#689F78]' : 'text-slate-600'}`}>
            <svg className={`w-5 h-5 ${activeTab === 'favourites' ? 'nav-icon-active' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </div>
          <span className={`text-[10px] font-semibold ${activeTab === 'favourites' ? 'text-[#689F78]' : 'text-slate-500'}`}>
            Favourites
          </span>
        </button>

        {/* PLUS BUTTON (Squircle Rounded Box) */}
        <button aria-label="Create roommate post" 
          onClick={() => setActiveTab('create_post')} 
          className={`w-8 h-8 rounded-xl border-2 flex items-center justify-center font-bold text-lg hover:bg-gray-100 cursor-pointer shadow-sm ${activeTab === 'create_post' ? 'nav-icon-active border-[#689F78] text-[#689F78]' : 'border-slate-700 text-slate-800'}`}
        >
          +
        </button>

        {/* MESSAGES */}
        <button 
          onClick={() => setActiveTab('messages')} 
          className="flex flex-col items-center gap-0.5 cursor-pointer"
        >
          <span className="relative">
            <MessageIcon className={`h-5 w-5 ${activeTab === 'messages' ? 'nav-icon-active text-[#689F78]' : 'text-slate-600'}`} />
            {unreadMessageCount > 0 && <span className="absolute -right-2 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{unreadMessageCount > 9 ? '9+' : unreadMessageCount}</span>}
          </span>
          <span className={`text-[10px] font-semibold ${activeTab === 'messages' ? 'text-[#689F78]' : 'text-slate-500'}`}>
            Messages
          </span>
        </button>

        {/* PROFILE */}
        <button 
          onClick={() => setActiveTab('profile')} 
          className="flex flex-col items-center gap-0.5 cursor-pointer"
        >
          <div className={`w-5 h-5 flex items-center justify-center ${activeTab === 'profile' ? 'text-[#689F78]' : 'text-slate-600'}`}>
            <svg className={`w-5 h-5 ${activeTab === 'profile' ? 'nav-icon-active' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <span className={`text-[10px] font-semibold ${activeTab === 'profile' ? 'text-[#689F78]' : 'text-slate-500'}`}>
            Profile
          </span>
        </button>

      </div>}

    </div>
  );
}
