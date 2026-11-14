import VerificationHistory from './VerificationHistory';
import AdminFilters from './AdminFilters';
import AdminPostMedia from './AdminPostMedia';
import { filterAdminRecords } from '../lib/adminFilters';
import WeeklyStatistics from './WeeklyStatistics';
import { uiText } from '../lib/uiText';
import UploadedMedia from './UploadedMedia';
import ProfileImage from './ProfileImage';
import useAppDialog from '../hooks/useAppDialog';
import { reviewVerificationSubmission } from '../lib/verification';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { getAuthenticationErrorMessage } from '../lib/authErrors';
import AdminLanding from './AdminLanding';
import PasswordRecovery from './PasswordRecovery';
import ErrorDialog from './ErrorDialog';
import MediaPreviewDialog from './MediaPreviewDialog';
import usePullToRefresh from '../hooks/usePullToRefresh';

const getCurrentWeek = (referenceDate = new Date()) => {
  const start = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(start.getDate() + 7);

  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      date,
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
      label: new Intl.DateTimeFormat('en', { weekday: 'short' }).format(date),
      accounts: 0,
      listings: 0,
      posts: 0,
    };
  });

  return { start, end, days };
};

const getLocalDateKey = (value) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

function getFirstReviewQueueItem({ users = [], listings = [], posts = [] } = {}, reports = []) {
  return [
    ...users.map(item => ({ tab: 'verifications', createdAt: item.created_at })),
    ...listings.map(item => ({ tab: 'listings', createdAt: item.created_at })),
    ...posts.map(item => ({ tab: 'roommates', createdAt: item.created_at })),
    ...reports.filter(item => item.status === 'open').map(item => ({ tab: 'safety', createdAt: item.created_at })),
  ].sort((first, second) => Date.parse(first.createdAt) - Date.parse(second.createdAt))[0] || null;
}

function getEvidenceMimeType(path) {
  const extension = path?.split('.').pop()?.toLowerCase();
  return ({
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    aac: 'audio/aac',
  })[extension] || 'application/octet-stream';
}

export default function AdminDashboard() {
  const { confirm } = useAppDialog();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  const [adminUser, setAdminUser] = useState('');
  const [adminPass, setAdminPass] = useState('');
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [confirmAdminPassword, setConfirmAdminPassword] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [passwordActionLoading, setPasswordActionLoading] = useState(false);
  const [sectionFilters, setSectionFilters] = useState({});
  const [activeTab, setActiveTab] = useState('dashboard');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [adminReviewNotifications, setAdminReviewNotifications] = useState([]);
  const [notificationMenuId, setNotificationMenuId] = useState(null);
  const [notificationConfirmation, setNotificationConfirmation] = useState(null);
  const [processingNotificationAction, setProcessingNotificationAction] = useState(false);
  const [isEvaluatingQueue, setIsEvaluatingQueue] = useState(false);
  const [logoutConfirmationOpen, setLogoutConfirmationOpen] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [adminError, setAdminError] = useState('');
  const [loadingQueues, setLoadingQueues] = useState(false);
  const [adminSearch, setAdminSearch] = useState('');
  const [adminSearchOpen, setAdminSearchOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [processingItemId, setProcessingItemId] = useState(null);
  const [rejectionTarget, setRejectionTarget] = useState(null);
  const [historyAccount, setHistoryAccount] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const [pendingUsers, setPendingUsers] = useState([]);
  const accountReviewInFlight = useRef(false);
  const [pendingListings, setPendingListings] = useState([]);
  const [pendingRoommatePosts, setPendingRoommatePosts] = useState([]);
  const [messageReports, setMessageReports] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [processingReportId, setProcessingReportId] = useState(null);
  const [mediaPreview, setMediaPreview] = useState(null);
  const [userDirectory, setUserDirectory] = useState([]);
  const [reviewedListings, setReviewedListings] = useState([]);
  const [reviewedRoommatePosts, setReviewedRoommatePosts] = useState([]);
  const [weeklyApprovals, setWeeklyApprovals] = useState(() => getCurrentWeek());
  const weeklyChartMax = Math.max(
    4,
    Math.ceil(Math.max(...weeklyApprovals.days.flatMap(day => [day.accounts, day.listings, day.posts])) / 4) * 4,
  );
  const weeklyChartEnd = new Date(weeklyApprovals.end);
  weeklyChartEnd.setDate(weeklyChartEnd.getDate() - 1);
  const weekDateFormatter = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
  const weekYearFormatter = new Intl.DateTimeFormat('en', { year: 'numeric' });
  const weekRangeLabel = weekYearFormatter.format(weeklyApprovals.start) === weekYearFormatter.format(weeklyChartEnd)
    ? `${weekDateFormatter.format(weeklyApprovals.start)} – ${weekDateFormatter.format(weeklyChartEnd)}, ${weekYearFormatter.format(weeklyChartEnd)}`
    : `${new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(weeklyApprovals.start)} – ${new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(weeklyChartEnd)}`;
  const usersById = new Map(userDirectory.map(profile => [profile.id, profile]));
  const searchTerm = adminSearch.trim().toLowerCase();
  const matchingUsers = userDirectory.filter(profile => (
    [profile.full_name, profile.email, profile.phone, profile.role, profile.verification_status]
      .some(value => String(value || '').toLowerCase().includes(searchTerm))
  ));
  const searchableListings = [...pendingListings, ...reviewedListings];
  const matchingListings = searchableListings.filter(listing => (
    [listing.title, listing.location, listing.description, listing.price, listing.owner?.full_name, listing.owner?.email, listing.moderation_status]
      .some(value => String(value || '').toLowerCase().includes(searchTerm))
  ));
  const matchingActivityLogs = activityLogs.filter(log => (
    [log.action, log.details, log.user_id, usersById.get(log.user_id)?.full_name, usersById.get(log.user_id)?.email]
      .some(value => String(value || '').toLowerCase().includes(searchTerm))
  ));
  const adminSearchResults = searchTerm ? [
    ...matchingUsers.slice(0, 4).map(profile => ({
      key: `user-${profile.id}`,
      kind: 'Account',
      label: profile.full_name || profile.email || 'BoardMate member',
      detail: `${profile.email || 'No email'} · ${profile.role || 'Renter'}`,
      tab: 'users',
    })),
    ...matchingListings.slice(0, 4).map(listing => ({
      key: `listing-${listing.id}`,
      kind: 'Listing',
      label: listing.title || 'Accommodation listing',
      detail: `${listing.location || 'Location unavailable'} · ${listing.moderation_status || 'pending'}`,
      tab: listing.moderation_status === 'pending' ? 'listings' : 'accommodations',
    })),
    ...matchingActivityLogs.slice(0, 4).map(log => ({
      key: `log-${log.id}`,
      kind: 'Activity log',
      label: log.action,
      detail: `${usersById.get(log.user_id)?.full_name || 'BoardMate member'} · ${new Date(log.created_at).toLocaleDateString()}`,
      tab: 'activity',
    })),
  ] : [];
  const filterSources = { dashboard: [...pendingUsers, ...pendingListings, ...pendingRoommatePosts], verifications: pendingUsers, users: userDirectory, listings: pendingListings, accommodations: reviewedListings, roommates: pendingRoommatePosts, user_posts: reviewedRoommatePosts, activity: activityLogs.map(log => ({ ...log, administrator_name: usersById.get(log.user_id)?.full_name, administrator_email: usersById.get(log.user_id)?.email })), safety: messageReports };
  const sectionRecords = filterSources[activeTab];
  const filters = sectionFilters[activeTab] || {};
  const dashboardUsers = filterAdminRecords(pendingUsers, sectionFilters.dashboard);
  const dashboardListings = filterAdminRecords(pendingListings, sectionFilters.dashboard);
  const dashboardPosts = filterAdminRecords(pendingRoommatePosts, sectionFilters.dashboard);
  const visibleRecords = filterAdminRecords(sectionRecords || [], filters, adminSearch);
  const visibleAdminReviewNotifications = adminReviewNotifications
    .filter(notification => !notification.hidden_until || Date.parse(notification.hidden_until) <= currentTime.getTime());
  const unreadReviewNotifications = visibleAdminReviewNotifications.filter(notification => !notification.read_at);

  const loadAdminReviewNotifications = useCallback(async () => {
    const { data, error } = await supabase
      .from('admin_review_notifications')
      .select('id, notification_key, title, detail, destination_tab, icon, source_type, source_id, created_at, read_at, hidden_until')
      .order('created_at', { ascending: false });
    if (error) throw error;
    setAdminReviewNotifications(data);
    return data;
  }, []);

  const requestNotificationAction = (notification, action) => {
    setNotificationMenuId(null);
    setNotificationConfirmation({ notification, action });
  };

  const confirmNotificationAction = async () => {
    if (!notificationConfirmation || processingNotificationAction) return;
    const { notification, action } = notificationConfirmation;
    setAdminError('');
    setProcessingNotificationAction(true);
    let actionCompleted = false;
    try {
      const result = action === 'delete'
        ? await supabase.from('admin_review_notifications').delete().eq('id', notification.id)
        : await supabase.from('admin_review_notifications')
          .update({ hidden_until: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString() })
          .eq('id', notification.id);
      if (result.error) throw result.error;
      actionCompleted = true;
      setNotificationConfirmation(null);
      await loadAdminReviewNotifications();
    } catch (error) {
      setAdminError(actionCompleted
        ? `Notification ${action} completed, but the list could not refresh: ${error.message}`
        : `Unable to ${action} notification: ${error.message}`);
    } finally {
      setProcessingNotificationAction(false);
    }
  };

  const handleLogout = async () => {
    setAdminError('');
    const { error: auditError } = await supabase.rpc('record_boardmate_admin_session_event', { p_event: 'logout_requested' });
    if (auditError) {
      setAdminError(`Sign-out audit could not be recorded: ${auditError.message}. Try again.`);
      setIsExiting(false);
      return;
    }
    const { error } = await supabase.auth.signOut();
    if (error) {
      setAdminError(`Unable to sign out: ${error.message}`);
      setIsExiting(false);
      return;
    }

    setIsLoggedIn(false);
    setLogoutConfirmationOpen(false);
    setIsExiting(false);
    setHasStarted(true);
    setAdminPass('');
    setPendingUsers([]);
    setPendingListings([]);
    setPendingRoommatePosts([]);
    setUserDirectory([]);
    setReviewedListings([]);
    setReviewedRoommatePosts([]);
    setWeeklyApprovals(getCurrentWeek());
    setIsPasswordRecovery(false);
    setResetMessage('');
    setActiveTab('dashboard');
  };

  const confirmAdminLogout = async () => {
    setLogoutConfirmationOpen(false);
    setIsExiting(true);
    await new Promise(resolve => window.setTimeout(resolve, 260));
    await handleLogout();
  };

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
        setAdminError('');
        setResetMessage('');
      } else if (event === 'SIGNED_OUT') {
        setIsLoggedIn(false);
        setHasStarted(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadReviewQueues = useCallback(async () => {
    const week = getCurrentWeek();
    const [
      usersResult,
      listingsResult,
      postsResult,
      approvedUsersResult,
      approvedListingsResult,
      directoryResult,
      activityLogsResult,
      adminLogsResult,
    ] = await Promise.all([
      supabase.from('profiles')
        .select('id, full_name, email, phone, role, gender, dob, business_name, address, gov_id_number, property_type, id_uploaded, selfie_uploaded, id_document_path, selfie_document_path, verification_status, verification_revision, verification_reason, created_at')
        .eq('verification_status', 'pending')
        .not('verification_revision', 'is', null)
        .not('id_document_path', 'is', null)
        .not('selfie_document_path', 'is', null)
        .eq('id_uploaded', true)
        .eq('selfie_uploaded', true)
        .order('created_at', { ascending: true }),
      supabase.from('listings').select('*').in('moderation_status', ['pending', 'approved', 'rejected']).order('created_at', { ascending: false }),
      supabase.from('roommate_posts').select('*').in('moderation_status', ['pending', 'approved', 'rejected']).order('created_at', { ascending: false }),
      supabase.from('profiles')
        .select('verified_at')
        .eq('verification_status', 'approved')
        .gte('verified_at', week.start.toISOString())
        .lt('verified_at', week.end.toISOString()),
      supabase.from('listings')
        .select('reviewed_at')
        .eq('moderation_status', 'approved')
        .gte('reviewed_at', week.start.toISOString())
        .lt('reviewed_at', week.end.toISOString()),
      supabase.from('profiles')
        .select('id, full_name, email, phone, role, verification_status, verification_revision, created_at')
        .order('created_at', { ascending: false }),
      supabase.from('activity_history')
        .select('id, user_id, action, details, created_at')
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.from('admin_activity_logs').select('id, user_id, action, details, target_table, target_id, created_at')
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(200),
    ]);

    const error = usersResult.error || listingsResult.error || postsResult.error
      || approvedUsersResult.error || approvedListingsResult.error || directoryResult.error
      || activityLogsResult.error || adminLogsResult.error;
    if (error) throw error;

    const accountCountsByDay = new Map();
    approvedUsersResult.data.forEach(profile => {
      const key = getLocalDateKey(profile.verified_at);
      accountCountsByDay.set(key, (accountCountsByDay.get(key) || 0) + 1);
    });
    const listingCountsByDay = new Map();
    approvedListingsResult.data.forEach(listing => {
      const key = getLocalDateKey(listing.reviewed_at);
      listingCountsByDay.set(key, (listingCountsByDay.get(key) || 0) + 1);
    });
    const postCountsByDay = new Map();
    postsResult.data
      .filter(post => post.moderation_status === 'approved' && post.reviewed_at)
      .forEach(post => {
        const key = getLocalDateKey(post.reviewed_at);
        postCountsByDay.set(key, (postCountsByDay.get(key) || 0) + 1);
      });

    let ownerProfiles = [];
    const ownerIds = [...new Set(listingsResult.data.map(listing => listing.owner_id).filter(Boolean))];
    if (ownerIds.length) {
      const { data, error: ownersError } = await supabase
        .from('profiles')
        .select('id, full_name, email, business_name')
        .in('id', ownerIds);
      if (ownersError) throw ownersError;
      ownerProfiles = data;
    }

    const ownersById = new Map(ownerProfiles.map(profile => [profile.id, profile]));
    const usersWithDocuments = await Promise.all(usersResult.data.map(async profile => {
      const [idResult, selfieResult] = await Promise.all([
        profile.id_document_path
          ? supabase.storage.from('verification-documents').createSignedUrl(profile.id_document_path, 300)
          : Promise.resolve({ data: null, error: null }),
        profile.selfie_document_path
          ? supabase.storage.from('verification-documents').createSignedUrl(profile.selfie_document_path, 300)
          : Promise.resolve({ data: null, error: null }),
      ]);
      const documentError = idResult.error || selfieResult.error;
      return {
        ...profile,
        documentError: documentError?.message || '',
        idDocumentUrl: idResult.data?.signedUrl || null,
        selfieDocumentUrl: selfieResult.data?.signedUrl || null,
      };
    }));

    setPendingUsers(usersWithDocuments);
    const listingsWithOwners = listingsResult.data.map(listing => ({
      ...listing,
      owner: ownersById.get(listing.owner_id),
    }));
    const ownerListings = listingsWithOwners.filter(listing => listing.owner);
    const reviewedPosts = postsResult.data.filter(post => (
      post.deleted_at || ['approved', 'rejected'].includes(post.moderation_status)
    ));
    const rejectedPostKeys = new Set(reviewedPosts
      .filter(post => post.moderation_status === 'rejected')
      .map(post => `${post.user_id}:${post.heading}`));
    const legacyRejectedPosts = activityLogsResult.data
      .filter(receipt => ['Roommate post rejected', 'Roommate post rejected and removed'].includes(receipt.action))
      .filter(receipt => !rejectedPostKeys.has(`${receipt.user_id}:${receipt.details.split('\n')[0]}`))
      .map(receipt => {
        const [heading, ...receiptLines] = receipt.details.split('\n');
        const reasonLine = receiptLines.find(line => line.startsWith('Reason: '));
        return {
          id: `receipt-${receipt.id}`,
          user_id: receipt.user_id,
          author_name: directoryResult.data.find(profile => profile.id === receipt.user_id)?.full_name,
          heading,
          budget: '—',
          location: '—',
          role: '—',
          description: receiptLines.filter(line => !line.startsWith('Reason: ')).join('\n'),
          moderation_status: 'rejected',
          moderation_reason: reasonLine?.slice('Reason: '.length) || null,
          reviewed_at: receipt.created_at,
        };
      });
    setPendingListings(ownerListings
      .filter(listing => listing.moderation_status === 'pending')
      .sort((first, second) => Date.parse(first.created_at) - Date.parse(second.created_at)));
    setReviewedListings(ownerListings.filter(listing => ['approved', 'rejected'].includes(listing.moderation_status)));
    setPendingRoommatePosts(postsResult.data
      .filter(post => !post.deleted_at && post.moderation_status === 'pending')
      .sort((first, second) => Date.parse(first.created_at) - Date.parse(second.created_at)));
    setReviewedRoommatePosts([...reviewedPosts, ...legacyRejectedPosts]);
    setUserDirectory(directoryResult.data);
    setActivityLogs(adminLogsResult.data);
    setWeeklyApprovals({
      ...week,
      days: week.days.map(day => ({
        ...day,
        accounts: accountCountsByDay.get(day.key) || 0,
        listings: listingCountsByDay.get(day.key) || 0,
        posts: postCountsByDay.get(day.key) || 0,
      })),
    });
    setAdminError('');
    return {
      users: usersWithDocuments,
      listings: ownerListings.filter(listing => listing.moderation_status === 'pending'),
      posts: postsResult.data.filter(post => !post.deleted_at && post.moderation_status === 'pending'),
    };
  }, []);

  const loadMessageReports = useCallback(async () => {
    setLoadingReports(true);
    try {
      const { data: reports, error } = await supabase
        .from('direct_message_reports')
        .select('id, reporter_id, reported_user_id, category, reason, evidence_path, status, resolution_note, created_at, reviewed_at')
        .order('created_at', { ascending: true });
      if (error) throw error;

      const profileIds = [...new Set(reports.flatMap(report => [report.reporter_id, report.reported_user_id]))];
      let profilesById = new Map();
      if (profileIds.length) {
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', profileIds);
        if (profilesError) throw profilesError;
        profilesById = new Map(profiles.map(profile => [profile.id, profile]));
      }

      const reportsWithEvidence = await Promise.all(reports.map(async report => {
        let evidenceUrl = null;
        if (report.evidence_path) {
          const { data: signedUrl, error: signedUrlError } = await supabase.storage
            .from('direct-message-report-evidence')
            .createSignedUrl(report.evidence_path, 3600);
          if (signedUrlError) throw signedUrlError;
          evidenceUrl = signedUrl.signedUrl;
        }
        return {
          ...report,
          evidenceUrl,
          evidenceMimeType: getEvidenceMimeType(report.evidence_path),
          reporter: profilesById.get(report.reporter_id),
          reportedUser: profilesById.get(report.reported_user_id),
        };
      }));
      setMessageReports(reportsWithEvidence);
      setAdminError('');
      return reportsWithEvidence;
    } finally {
      setLoadingReports(false);
    }
  }, []);

  const advanceReviewQueue = async (queueData, reports) => {
    if (!isEvaluatingQueue) return;
    try {
      const [latestQueue, latestReports] = await Promise.all([
        queueData ? Promise.resolve(queueData) : loadReviewQueues(),
        reports ? Promise.resolve(reports) : loadMessageReports(),
      ]);
      const next = getFirstReviewQueueItem(latestQueue, latestReports);
      if (next) {
        setActiveTab(next.tab);
      } else {
        setIsEvaluatingQueue(false);
        setActiveTab('dashboard');
      }
    } catch (error) {
      setAdminError(`Unable to continue the review queue: ${error.message}`);
    }
  };

  const startEvaluatingQueue = async () => {
    setLoadingQueues(true);
    setAdminError('');
    try {
      const [queueData, reports] = await Promise.all([loadReviewQueues(), loadMessageReports()]);
      const first = getFirstReviewQueueItem(queueData, reports);
      if (!first) {
        setIsEvaluatingQueue(false);
        setAdminError('There are no pending items in the review queue.');
        return;
      }
      setIsEvaluatingQueue(true);
      setActiveTab(first.tab);
    } catch (error) {
      setAdminError(`Unable to start the review queue: ${error.message}`);
    } finally {
      setLoadingQueues(false);
    }
  };

  const resolveMessageReport = async (reportId, decision) => {
    if (processingReportId) return;
    setProcessingReportId(reportId);
    if (decision === 'suspended' && !(await confirm('Suspend this account? It will be unable to post, edit listings, message, or take other account actions.'))) {
      setProcessingReportId(null);
      return;
    }
    setAdminError('');
    try {
      const { error } = await supabase.rpc('resolve_boardmate_message_report', {
        p_report_id: reportId,
        p_decision: decision,
        p_resolution_note: null,
      });
      if (error) throw error;
      const reports = await loadMessageReports();
      if (isEvaluatingQueue) {
        const queueData = await loadReviewQueues();
        await advanceReviewQueue(queueData, reports);
      }
    } catch (error) {
      setAdminError(`Unable to resolve report: ${error.message}`);
    } finally {
      setProcessingReportId(null);
    }
  };

  useEffect(() => {
    let active = true;
    const restoreAdminSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!data.session) return;

        const { data: isAdmin, error: authorizationError } = await supabase.rpc('is_boardmate_admin');
        if (authorizationError) throw authorizationError;
        if (!isAdmin) {
          if (active) {
            setHasStarted(true);
            setAdminError('The saved session is not authorized for the BoardMate admin portal. Sign in with an administrator account.');
          }
          return;
        }

        if (active) {
          setHasStarted(true);
          setIsLoggedIn(true);
          setLoadingQueues(true);
        }
        try {
          await loadReviewQueues();
        } catch (error) {
          if (active) setAdminError(`Unable to load review queues: ${error.message}`);
        } finally {
          if (active) setLoadingQueues(false);
        }
      } catch (error) {
        if (active) {
          setHasStarted(true);
          setAdminError(`Unable to restore administrator session: ${error.message}`);
        }
      } finally {
        if (active) setIsRestoringSession(false);
      }
    };

    restoreAdminSession();
    return () => { active = false; };
  }, [loadReviewQueues]);

  useEffect(() => {
    if (!isLoggedIn) return undefined;

    let active = true;
    const refreshNotifications = () => {
      loadAdminReviewNotifications().catch(error => {
        if (active) setAdminError(`Unable to load admin notifications: ${error.message}`);
      });
    };
    refreshNotifications();

    const channel = supabase
      .channel(`admin-review-notifications-${Date.now()}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'admin_review_notifications',
      }, refreshNotifications)
      .subscribe(status => {
        if (active && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')) {
          setAdminError('Live admin notifications are unavailable. Refresh the dashboard to see updates.');
        }
      });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [isLoggedIn, loadAdminReviewNotifications]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setAdminError('');
    setLoadingQueues(true);
    let signedIn = false;
    try {
      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: adminUser.trim(),
        password: adminPass,
      });
      if (loginError) throw loginError;
      signedIn = true;

      const { data: isAdmin, error: authorizationError } = await supabase.rpc('is_boardmate_admin');
      if (authorizationError) throw authorizationError;
      if (!isAdmin) throw new Error('This account is not authorized for the BoardMate admin portal.');
      const { error: auditError } = await supabase.rpc('record_boardmate_admin_session_event', { p_event: 'login' });
      if (auditError) throw new Error(`Admin login audit failed: ${auditError.message}`);
      await loadReviewQueues();
      setIsLoggedIn(true);
    } catch (error) {
      if (signedIn) {
        const { error: signOutError } = await supabase.auth.signOut();
        setAdminError(signOutError
          ? `${getAuthenticationErrorMessage(error)} Sign-out also failed: ${getAuthenticationErrorMessage(signOutError)}`
          : getAuthenticationErrorMessage(error));
      } else {
        setAdminError(getAuthenticationErrorMessage(error));
      }
    } finally {
      setLoadingQueues(false);
    }
  };

  const handlePasswordResetRequest = async () => {
    setAdminError('');
    setResetMessage('');
    setRecoveryOpen(true);
  };

  const handlePasswordUpdate = async (event) => {
    event.preventDefault();
    setAdminError('');
    setResetMessage('');
    if (newAdminPassword.length < 8) {
      setAdminError('Choose a password with at least 8 characters.');
      return;
    }
    if (newAdminPassword !== confirmAdminPassword) {
      setAdminError('The passwords do not match.');
      return;
    }

    setPasswordActionLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newAdminPassword });
      if (error) throw error;
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw new Error(`Your password was changed, but sign-out failed: ${signOutError.message}`);
      setIsPasswordRecovery(false);
      setNewAdminPassword('');
      setConfirmAdminPassword('');
      setAdminPass('');
      setResetMessage('Password updated. Sign in with your new password.');
    } catch (error) {
      setAdminError(`Unable to update password: ${error.message}`);
    } finally {
      setPasswordActionLoading(false);
    }
  };

  const refreshReviewQueues = useCallback(() => {
    setLoadingQueues(true);
    loadReviewQueues()
      .catch(error => setAdminError(`Unable to refresh review queues: ${error.message}`))
      .finally(() => setLoadingQueues(false));
  }, [loadReviewQueues]);

  const pullRefreshIndicator = usePullToRefresh(async () => {
    if (!isLoggedIn) return;
    setLoadingQueues(true);
    try {
      await loadReviewQueues();
    } catch (error) {
      setAdminError(`Unable to refresh review queues: ${error.message}`);
      throw error;
    } finally {
      setLoadingQueues(false);
    }
  }, isLoggedIn);

  useEffect(() => {
    if (!isLoggedIn) return undefined;
    let active = true;
    const refreshReports = () => {
      loadMessageReports().catch(error => {
        if (active) setAdminError(`Unable to load message reports: ${error.message}`);
      });
    };
    refreshReports();
    const channel = supabase
      .channel('boardmate-admin-message-reports')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'direct_message_reports' }, refreshReports)
      .subscribe(status => {
        if (active && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')) {
          setAdminError('Live report updates are unavailable. Refresh the reports to check for new submissions.');
        }
      });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [isLoggedIn, loadMessageReports]);

  useEffect(() => {
    if (!isLoggedIn) return undefined;
    let refreshTimer;
    const refresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(refreshReviewQueues, 200);
    };
    const channel = supabase
      .channel('boardmate-admin-review-queues')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'listings' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roommate_posts' }, refresh)
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setAdminError('Live updates are unavailable. Use Refresh to check the review queues.');
        }
      });

    return () => {
      window.clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [isLoggedIn, refreshReviewQueues]);

  const reviewAccount = async (profile, status, reason = '') => {
    if (accountReviewInFlight.current || processingItemId) return false;
    if (profile.verification_status !== 'pending') {
      setAdminError('This account has already been reviewed. Refresh the queue.');
      return false;
    }
    if (!profile.id_document_path || !profile.selfie_document_path || !profile.id_uploaded || !profile.selfie_uploaded) {
      setAdminError('Both verification documents must be submitted before this account can be reviewed.');
      return false;
    }
    if (status === 'rejected' && !reason.trim()) {
      setAdminError('Enter a reason before rejecting this account.');
      return false;
    }
    accountReviewInFlight.current = true;
    setProcessingItemId(`profile-${profile.id}`);
    setAdminError('');
    let reviewCompleted = false;
    try {
      const reviewed = await reviewVerificationSubmission(profile, status, reason);
      reviewCompleted = true;
      setPendingUsers(current => current.filter(item => item.id !== profile.id));
      setUserDirectory(current => current.map(item => item.id === profile.id ? { ...item, ...reviewed } : item));
      const queueData = await loadReviewQueues();
      if (isEvaluatingQueue) await advanceReviewQueue(queueData);
      return true;
    } catch (error) {
      setAdminError(reviewCompleted ? `Account ${status}, but the queue could not refresh: ${error.message}. Refresh the page to update the queue.` : `Unable to review account: ${error.message}`);
      return reviewCompleted;
    } finally {
      accountReviewInFlight.current = false;
      setProcessingItemId(null);
    }
  };

  const reviewContent = async (table, item, status, reason = '') => {
    if (status === 'rejected' && !reason.trim()) {
      setAdminError('Enter a reason before rejecting this post.');
      return false;
    }
    setProcessingItemId(`${table}-${item.id}`);
    setAdminError('');
    try {
      if (table === 'roommate_posts' && status === 'rejected') {
        const { error } = await supabase.rpc('reject_roommate_post', {
          p_post_id: item.id,
          p_reason: reason.trim(),
        });
        if (error) throw error;
        const queueData = await loadReviewQueues();
        if (isEvaluatingQueue) await advanceReviewQueue(queueData);
        return true;
      }

      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!authData.user) throw new Error('Your admin session has expired. Sign in again.');
      const { data, error } = await supabase
        .from(table)
        .update({
          moderation_status: status,
          moderation_reason: reason?.trim() || null,
          reviewed_at: new Date().toISOString(),
          reviewed_by: authData.user.id,
        })
        .eq('id', item.id)
        .eq('moderation_status', 'pending')
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('This post was already reviewed. Refresh the queue and try again.');
      const queueData = await loadReviewQueues();
      if (isEvaluatingQueue) await advanceReviewQueue(queueData);
      return true;
    } catch (error) {
      setAdminError(`Unable to review post: ${error.message}`);
      return false;
    } finally {
      setProcessingItemId(null);
    }
  };

  const confirmRejection = async () => {
    if (!rejectionTarget) return;
    const reason = rejectionReason.trim();
    if (!reason) {
      setAdminError('Enter a reason before rejecting.');
      return;
    }

    const reviewed = rejectionTarget.type === 'account'
      ? await reviewAccount(rejectionTarget.item, 'rejected', reason)
      : await reviewContent(rejectionTarget.table, rejectionTarget.item, 'rejected', reason);
    if (reviewed) {
      setRejectionTarget(null);
      setRejectionReason('');
    }
  };

  if (recoveryOpen) return <PasswordRecovery initialEmail={adminUser} onBack={() => setRecoveryOpen(false)} onComplete={message => {
    setRecoveryOpen(false); setAdminPass(''); setIsPasswordRecovery(false); setResetMessage(message); setHasStarted(true);
  }} />;

  if (isRestoringSession) {
    return (
      <>
        {pullRefreshIndicator}
        <div className="admin-login-screen" role="status">Restoring administrator session…</div>
      </>
    );
  }

  if (!hasStarted && !isLoggedIn) {
    return (
      <>
        {pullRefreshIndicator}
        <AdminLanding onEnter={() => setHasStarted(true)} />
      </>
    );
  }

  // 1. LOGIN SCREEN WITH BACK BUTTON
  if (!isLoggedIn) {
    return (
      <>
      {pullRefreshIndicator}
      <div className="admin-login-screen">
        <section className="admin-login-panel">
          <div className="admin-login-panel-inner">
            <div className="admin-login-heading">
              <span className="admin-eyebrow">BOARDMATE ADMIN PORTAL</span>
              <h1>{isPasswordRecovery ? <>Choose a<br />new password</> : <>Welcome<br />Administrator!</>}</h1>
              <p>{isPasswordRecovery
                ? 'Set a new password for your administrator account.'
                : 'Sign in to manage your community and keep BoardMate running smoothly.'}</p>
            </div>

            {isPasswordRecovery ? (
              <form onSubmit={handlePasswordUpdate} className="admin-login-form">
                <p className="admin-login-label">Reset administrator password</p>
                <label className="admin-login-input">
                  <span aria-hidden="true">⌑</span>
                  <input
                    type="password"
                    placeholder="New password (at least 8 characters)"
                    aria-label="New administrator password"
                    autoComplete="new-password"
                    value={newAdminPassword}
                    onChange={event => setNewAdminPassword(event.target.value)}
                    required
                  />
                </label>
                <label className="admin-login-input">
                  <span aria-hidden="true">⌑</span>
                  <input
                    type="password"
                    placeholder="Confirm new password"
                    aria-label="Confirm new administrator password"
                    autoComplete="new-password"
                    value={confirmAdminPassword}
                    onChange={event => setConfirmAdminPassword(event.target.value)}
                    required
                  />
                </label>
                <button type="submit" className="admin-submit-button" disabled={passwordActionLoading}>
                  {passwordActionLoading ? 'Updating password…' : 'Save new password'} <span aria-hidden="true">→</span>
                </button>
              </form>
            ) : (
              <form onSubmit={handleLogin} className="admin-login-form">
                <p className="admin-login-label">Administrator sign in</p>
                <label className="admin-login-input">
                  <span aria-hidden="true">♙</span>
                  <input
                    type="email"
                    placeholder="Administrator email"
                    aria-label="Administrator email"
                    autoComplete="username"
                    value={adminUser}
                    onChange={event => setAdminUser(event.target.value)}
                    required
                  />
                </label>

                <label className="admin-login-input">
                  <span aria-hidden="true">⌑</span>
                  <input
                    type="password"
                    placeholder="Password"
                    aria-label="Administrator password"
                    autoComplete="current-password"
                    value={adminPass}
                    onChange={event => setAdminPass(event.target.value)}
                    required
                  />
                </label>

                <button
                  type="button"
                  className="admin-forgot-button"
                  onClick={handlePasswordResetRequest}
                  disabled={passwordActionLoading}
                >
                  {passwordActionLoading ? 'Sending reset email…' : 'Forgot Password?'}
                </button>

                {resetMessage && <p className="text-center text-xs font-semibold text-green-900" role="status">{resetMessage}</p>}
                <button type="submit" className="admin-submit-button" disabled={loadingQueues}>
                  {loadingQueues ? <>Loading review queues… <span className="admin-login-spinner" aria-hidden="true" /></> : <>Sign in to dashboard <span aria-hidden="true">→</span></>}
                </button>
              </form>
            )}

            <div className="admin-login-footer">
              <span className="admin-login-footer-label">Authorized administrator access</span>
              <p>Manage your app</p>
            </div>
          </div>
        </section>

        <section className="admin-login-brand">
          <div className="admin-login-brand-content">
            <h2>Board<span>Mate</span></h2>
            <p>An Accommodation Finder &amp;<br />Roommate Finder System</p>
            <span>BoardMate @app</span>
          </div>
        </section>
      </div>
      <ErrorDialog message={adminError} onClose={() => setAdminError('')} />
      </>
    );
  }

  // 2. MAIN ADMIN PORTAL DASHBOARD (FULL CONTENT & DESIGN)
  return (
    <>
    {pullRefreshIndicator}
    <div className={`admin-dashboard-shell admin-portal w-full min-h-screen bg-[#1E293B] text-gray-800 font-sans flex flex-col ${isExiting ? 'admin-dashboard-exiting' : ''}`}>
      
      {/* TOP HEADER */}
      <header className="admin-portal-header relative z-20 bg-[#7BAE87] px-3 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3 shadow-md shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 text-emerald-900 bg-white rounded-lg p-1">
            <svg fill="currentColor" viewBox="0 0 24 24">
              <path d="M10.707 2.293a1 1 0 011.414 0l7 7A1 1 0 0119 11h-1v7a2 2 0 01-2 2H8a2 2 0 01-2-2v-7H5a1 1 0 01-.707-1.707l7-7z" />
            </svg>
          </div>
          <div>
            <h1 className="font-extrabold text-lg text-gray-900 leading-tight">BoardMate</h1>
            <p className="text-[9px] font-bold text-emerald-900 tracking-wider">ADMIN PORTAL</p>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative order-3 w-full md:order-none md:w-80">
          <input 
            type="text" 
            placeholder="Search accounts, listings, logs..." 
            aria-label="Search accounts, listings, and activity logs"
            value={adminSearch}
            onChange={event => setAdminSearch(event.target.value)}
            onFocus={() => setAdminSearchOpen(true)}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                setAdminSearch('');
                setAdminSearchOpen(false);
              }
              if (event.key === 'Enter' && adminSearchResults.length) {
                setActiveTab(adminSearchResults[0].tab);
                setAdminSearchOpen(false);
              }
            }}
            className="w-full rounded-full bg-[#D3E4D7] py-2 pl-9 pr-4 text-xs text-gray-800 placeholder-gray-600 transition focus:outline-none focus:ring-2 focus:ring-emerald-800"
          />
          <span className="pointer-events-none absolute left-3 top-2 text-xs text-gray-600">🔍</span>
          {searchTerm && adminSearchOpen && (
            <div className="absolute left-0 right-0 top-full z-40 mt-2 max-h-80 overflow-y-auto rounded-xl border border-gray-200 bg-white p-2 shadow-xl">
              {adminSearchResults.map(result => (
                <button
                  type="button"
                  key={result.key}
                  onClick={() => {
                    setActiveTab(result.tab);
                    setAdminSearchOpen(false);
                  }}
                  className="w-full rounded-lg px-3 py-2 text-left transition hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700"
                >
                  <span className="block text-[9px] font-bold uppercase tracking-wide text-emerald-800">{result.kind}</span>
                  <span className="block truncate text-xs font-bold text-gray-900">{result.label}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-gray-500">{result.detail}</span>
                </button>
              ))}
              {adminSearchResults.length === 0 && <p className="p-3 text-center text-xs text-gray-500">No accounts, listings, or logs match.</p>}
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          <div className="relative">
            <button
              type="button"
              onClick={() => setNotificationsOpen(open => !open)}
              aria-label={`Notifications: ${unreadReviewNotifications.length} unread items need review`}
              aria-expanded={notificationsOpen}
              className="relative rounded-full p-2 text-lg text-gray-800 hover:bg-[#D3E4D7] focus:outline-none focus:ring-2 focus:ring-emerald-700 cursor-pointer"
            >
              🔔
              {unreadReviewNotifications.length > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                  {unreadReviewNotifications.length}
                </span>
              )}
            </button>
            {notificationsOpen && (
              <div className="absolute right-0 z-30 mt-2 flex max-h-[min(75dvh,48rem)] w-[min(90vw,40rem)] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl lg:w-[min(42vw,40rem)]">
                <div className="border-b border-gray-100 px-5 py-4">
                  <p className="text-base font-bold text-gray-900">Review notifications</p>
                  <p className="mt-1 text-xs text-gray-500">Items remain here after review until you delete them. Hidden items return after five days.</p>
                </div>
                <div className="min-h-24 flex-1 overflow-y-auto">
                  {visibleAdminReviewNotifications.map(notification => (
                    <article
                      key={notification.id}
                      className={`flex items-start gap-3 border-b border-gray-100 px-5 py-4 transition-opacity ${notification.read_at ? 'bg-gray-50 opacity-60' : 'bg-white'}`}
                    >
                      <span className="mt-0.5 text-lg" aria-hidden="true">{notification.icon}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab(notification.destination_tab);
                          setNotificationsOpen(false);
                        }}
                        className="min-w-0 flex-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700"
                      >
                        <span className="block text-sm font-bold text-gray-900">{uiText(notification.title)}</span>
                        <span className="mt-1 block whitespace-normal break-words text-xs leading-relaxed text-gray-600">{uiText(notification.detail)}</span>
                        <time className="mt-2 block text-[10px] text-gray-400">{new Date(notification.created_at).toLocaleString()}</time>
                        <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold ${notification.read_at ? 'bg-gray-200 text-gray-600' : 'bg-amber-100 text-amber-800'}`}>
                          {notification.read_at ? 'Reviewed' : 'Needs review'}
                        </span>
                      </button>
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={() => setNotificationMenuId(id => id === notification.id ? null : notification.id)}
                          aria-label={`Options for ${uiText(notification.title)}`}
                          aria-expanded={notificationMenuId === notification.id}
                          className="rounded-lg px-2 py-1 text-lg leading-none text-gray-500 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700"
                        >
                          ⋮
                        </button>
                        {notificationMenuId === notification.id && (
                          <div className="absolute right-0 top-full z-40 mt-1 min-w-32 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 text-xs shadow-xl">
                            <button
                              type="button"
                              onClick={() => requestNotificationAction(notification, 'delete')}
                              className="block w-full px-4 py-2.5 text-left font-semibold text-red-700 hover:bg-red-50"
                            >
                              Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => requestNotificationAction(notification, 'hide')}
                              className="block w-full px-4 py-2.5 text-left text-gray-700 hover:bg-gray-50"
                            >
                              Hide for 5 days
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                  {visibleAdminReviewNotifications.length === 0 && (
                    <p className="px-5 py-10 text-center text-sm text-gray-500">
                      {adminReviewNotifications.length ? 'All notifications are hidden for now.' : 'No review notifications yet.'}
                    </p>
                  )}
                </div>
                {visibleAdminReviewNotifications.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('dashboard');
                      setNotificationsOpen(false);
                    }}
                    className="w-full bg-gray-50 px-5 py-3 text-xs font-bold text-emerald-800 hover:bg-emerald-50 cursor-pointer"
                  >
                    View review dashboard
                  </button>
                )}
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-2 bg-[#D3E4D7] px-3 py-1 rounded-full border border-emerald-600">
            <span className="text-xs font-bold text-gray-900">Welcome Administrator!</span>
            <button onClick={() => setLogoutConfirmationOpen(true)} title="Sign out of the admin portal" className="text-xs bg-red-500 text-white rounded-full px-2.5 py-1 font-bold hover:bg-red-600 transition cursor-pointer">Exit 🚪</button>
          </div>
        </div>
      </header>

      {/* MAIN BODY AREA */}
      <div className="admin-portal-body flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        
        {/* LEFT SIDEBAR NAVIGATION */}
        <aside className="admin-portal-sidebar max-h-[34vh] w-full shrink-0 overflow-y-auto bg-black p-3 md:max-h-none md:w-56 md:p-4 flex flex-col justify-between">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:block md:space-y-2">
            <button 
              onClick={() => setActiveTab('dashboard')} 
              className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between cursor-pointer transition duration-200 hover:-translate-y-0.5 ${activeTab === 'dashboard' ? 'bg-[#7BAE87] text-gray-900' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
            >
              <span className="flex items-center gap-2">📊 Dashboard</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('statistics')}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between cursor-pointer transition duration-200 hover:-translate-y-0.5 ${activeTab === 'statistics' ? 'bg-[#7BAE87] text-gray-900' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
            >
              <span className="flex items-center gap-2">📈 Statistic Reports</span>
            </button>

            <button 
              onClick={() => setActiveTab('verifications')} 
              className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between cursor-pointer ${activeTab === 'verifications' ? 'bg-[#7BAE87] text-gray-900' : 'text-gray-400 hover:text-white'}`}
            >
              <span className="flex items-center gap-2">👤 User Verifications</span>
              <span className="bg-amber-500 text-black text-[9px] px-1.5 py-0.5 rounded-full font-black">{pendingUsers.length}</span>
            </button>

            <button 
              onClick={() => setActiveTab('users')} 
              className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between cursor-pointer ${activeTab === 'users' ? 'bg-[#7BAE87] text-gray-900' : 'text-gray-400 hover:text-white'}`}
            >
              <span className="flex items-center gap-2">👥 User Directory</span>
              <span className="bg-slate-300 text-slate-900 text-[9px] px-1.5 py-0.5 rounded-full font-black">{userDirectory.length}</span>
            </button>

            <button 
              onClick={() => setActiveTab('listings')} 
              className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between cursor-pointer ${activeTab === 'listings' ? 'bg-[#7BAE87] text-gray-900' : 'text-gray-400 hover:text-white'}`}
            >
              <span className="flex items-center gap-2">🏢 Listings Review</span>
              <span className="bg-emerald-500 text-black text-[9px] px-1.5 py-0.5 rounded-full font-black">{pendingListings.length}</span>
            </button>

            <button 
              onClick={() => setActiveTab('accommodations')} 
              className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between cursor-pointer ${activeTab === 'accommodations' ? 'bg-[#7BAE87] text-gray-900' : 'text-gray-400 hover:text-white'}`}
            >
              <span className="flex items-center gap-2">🏘️ Accommodation Listings</span>
              <span className="bg-slate-300 text-slate-900 text-[9px] px-1.5 py-0.5 rounded-full font-black">{reviewedListings.length}</span>
            </button>

            <button 
              onClick={() => setActiveTab('roommates')} 
              className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between cursor-pointer ${activeTab === 'roommates' ? 'bg-[#7BAE87] text-gray-900' : 'text-gray-400 hover:text-white'}`}
            >
              <span className="flex items-center gap-2">👥 Roommate Posts</span>
              <span className="bg-blue-500 text-white text-[9px] px-1.5 py-0.5 rounded-full font-black">{pendingRoommatePosts.length}</span>
            </button>

            <button 
              onClick={() => setActiveTab('user_posts')} 
              className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between cursor-pointer ${activeTab === 'user_posts' ? 'bg-[#7BAE87] text-gray-900' : 'text-gray-400 hover:text-white'}`}
            >
              <span className="flex items-center gap-2">📝 User Posts</span>
              <span className="bg-slate-300 text-slate-900 text-[9px] px-1.5 py-0.5 rounded-full font-black">{reviewedRoommatePosts.length}</span>
            </button>

            <button 
              onClick={() => setActiveTab('safety')} 
              className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between cursor-pointer transition duration-200 hover:-translate-y-0.5 ${activeTab === 'safety' ? 'bg-[#7BAE87] text-gray-900' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
            >
              <span className="flex items-center gap-2">🛡️ Safety & Chat Monitor</span>
              <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[9px] font-black text-white">{messageReports.filter(report => report.status === 'open').length}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('activity')}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between cursor-pointer transition duration-200 hover:-translate-y-0.5 ${activeTab === 'activity' ? 'bg-[#7BAE87] text-gray-900' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
            >
              <span className="flex items-center gap-2">📋 Activity Logs</span>
              <span className="rounded-full bg-slate-300 px-1.5 py-0.5 text-[9px] font-black text-slate-900">{activityLogs.length}</span>
            </button>
          </div>

          <div className="bg-[#1C2C20] p-2.5 rounded-xl border border-emerald-900 text-[10px] text-emerald-400 flex items-center justify-between">
            <div>
              <p className="font-bold">System Status</p>
              <p className="text-[8px] text-gray-400">All core services active & synced</p>
            </div>
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
          </div>
        </aside>

        {/* RIGHT CONTENT DISPLAY AREA */}
        <main className="admin-portal-main min-h-0 flex-1 overflow-y-auto bg-[#F7F4EB] p-3 sm:p-6">
          {loadingQueues && (
            <p className="mb-4 rounded-xl bg-white px-4 py-3 text-xs text-gray-600" role="status">
              Loading live review queues…
            </p>
          )}

          {sectionRecords && <AdminFilters tab={activeTab} records={sectionRecords} filters={filters} onChange={next => setSectionFilters(current => ({ ...current, [activeTab]: next }))} />}
          {/* TAB 1: ADMINISTRATOR DASHBOARD */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-extrabold text-gray-900">Administrator Dashboard</h2>
                  <p className="text-xs text-gray-500">System-wide monitoring & evaluation queues for BoardMate</p>
                </div>
                <div className="flex items-center gap-2">
                  <time dateTime={currentTime.toISOString()} className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-800" aria-label="Current local date and time">
                    {currentTime.toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' })}
                  </time>
                  <button type="button" onClick={refreshReviewQueues} disabled={loadingQueues} aria-label={loadingQueues ? 'Refreshing review queues' : 'Refresh review queues'} className="group inline-flex items-center gap-1.5 rounded-full bg-emerald-700 px-3 py-1.5 text-[10px] font-bold text-white transition duration-200 hover:bg-emerald-800 active:scale-95 disabled:cursor-wait disabled:opacity-60">
                    <span aria-hidden="true" className={`inline-block transition-transform duration-500 ${loadingQueues ? 'animate-spin' : 'group-hover:rotate-180'}`}>⟳</span>
                    {loadingQueues ? 'Refreshing…' : 'Refresh'}
                  </button>
                </div>
              </div>

              {/* Stat Cards Row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="admin-stat-card bg-white p-4 rounded-2xl shadow-sm border border-gray-100 relative">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-[10px] font-extrabold text-gray-700 tracking-wider">PENDING USERS</p>
                      <h3 className="text-2xl font-black text-gray-900 mt-1">{dashboardUsers.length}</h3>
                    </div>
                    <span className="p-2 bg-amber-100 text-amber-700 rounded-xl text-base">👤</span>
                  </div>
                  <span className="inline-block mt-2 text-[9px] bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-md">Action req.</span>
                  <p className="text-[9px] text-gray-400 mt-1">Waiting for account review</p>
                </div>

                <div className="admin-stat-card bg-white p-4 rounded-2xl shadow-sm border border-gray-100 relative">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-[10px] font-extrabold text-gray-700 tracking-wider">PENDING LISTINGS</p>
                      <h3 className="text-2xl font-black text-gray-900 mt-1">{dashboardListings.length}</h3>
                    </div>
                    <span className="p-2 bg-emerald-100 text-emerald-700 rounded-xl text-base">🏠</span>
                  </div>
                  <span className="inline-block mt-2 text-[9px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-md">Awaiting Safety</span>
                  <p className="text-[9px] text-gray-400 mt-1">New property submissions</p>
                </div>

                <div className="admin-stat-card bg-white p-4 rounded-2xl shadow-sm border border-gray-100 relative">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-[10px] font-extrabold text-gray-700 tracking-wider">ROOMMATE POSTS</p>
                      <h3 className="text-2xl font-black text-gray-900 mt-1">{dashboardPosts.length}</h3>
                    </div>
                    <span className="p-2 bg-blue-100 text-blue-700 rounded-xl text-base">💬</span>
                  </div>
                  <span className="inline-block mt-2 text-[9px] bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded-md">Guidelines Review</span>
                  <p className="text-[9px] text-gray-400 mt-1">Awaiting publication review</p>
                </div>

                <div className="admin-stat-card bg-white p-4 rounded-2xl shadow-sm border border-gray-100 relative">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-[10px] font-extrabold text-gray-700 tracking-wider">REVIEW QUEUE</p>
                      <h3 className="text-2xl font-black text-gray-900 mt-1">{dashboardUsers.length + dashboardListings.length + dashboardPosts.length}</h3>
                    </div>
                    <span className="p-2 bg-blue-100 text-blue-700 rounded-xl text-base">✓</span>
                  </div>
                  <span className="inline-block mt-2 text-[9px] bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded-md">Needs review</span>
                  <p className="text-[9px] text-gray-400 mt-1">Accounts and posts awaiting approval</p>
                </div>
              </div>

              {/* Weekly approval statistics & workflow */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
                <section className="admin-panel-card md:col-span-2 bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-gray-100">
                  <div className="flex flex-wrap justify-between items-start gap-2 mb-3">
                    <div>
                      <h4 className="font-bold text-sm text-gray-800">Weekly Verification &amp; Approval Status</h4>
                      <p className="mt-1 text-[10px] text-gray-500">Approved accounts, listings, and roommate posts by day</p>
                    </div>
                    <span className="text-[10px] text-gray-400 font-semibold">{weekRangeLabel}</span>
                  </div>
                  <svg
                    className="w-full"
                    viewBox="0 0 600 220"
                    role="img"
                    aria-label={`Weekly account, listing, and post approvals from ${weekRangeLabel}`}
                  >
                    <title>Daily approved accounts, listings, and roommate posts for this week</title>
                    {[0, 1, 2, 3, 4].map(step => {
                      const y = 16 + step * 36;
                      const value = weeklyChartMax - (weeklyChartMax / 4) * step;
                      return (
                        <g key={step}>
                          <line x1="40" y1={y} x2="592" y2={y} stroke="#e8ece7" strokeWidth="1" />
                          <text x="32" y={y + 3} textAnchor="end" fill="#849084" fontSize="9">{value}</text>
                        </g>
                      );
                    })}
                    {weeklyApprovals.days.map((day, index) => {
                      const center = 40 + (552 / 7) * (index + 0.5);
                      const accountHeight = (day.accounts / weeklyChartMax) * 144;
                      const listingHeight = (day.listings / weeklyChartMax) * 144;
                      const postHeight = (day.posts / weeklyChartMax) * 144;
                      return (
                        <g key={day.key}>
                          <rect
                            x={center - 22}
                            y={160 - accountHeight}
                            width="12"
                            height={accountHeight}
                            rx="4"
                            fill="#78a981"
                          >
                            <title>{`${day.accounts} approved ${day.accounts === 1 ? 'account' : 'accounts'}`}</title>
                          </rect>
                          <rect
                            x={center - 6}
                            y={160 - listingHeight}
                            width="12"
                            height={listingHeight}
                            rx="4"
                            fill="#17341d"
                          >
                            <title>{`${day.listings} approved ${day.listings === 1 ? 'listing' : 'listings'}`}</title>
                          </rect>
                          <rect
                            x={center + 10}
                            y={160 - postHeight}
                            width="12"
                            height={postHeight}
                            rx="4"
                            fill="#4a80bb"
                          >
                            <title>{`${day.posts} approved ${day.posts === 1 ? 'post' : 'posts'}`}</title>
                          </rect>
                          <text x={center} y="182" textAnchor="middle" fill="#59645b" fontSize="10">{day.label}</text>
                          <text x={center} y="197" textAnchor="middle" fill="#849084" fontSize="9">
                            {day.date.getDate()}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                  <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 pt-1 text-[10px] font-semibold text-gray-600">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-3 h-3 rounded-sm bg-[#78a981]" aria-hidden="true"></span>
                      Approved Accounts
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <span className="w-3 h-3 rounded-sm bg-[#17341d]" aria-hidden="true"></span>
                      Approved Listings
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <span className="w-3 h-3 rounded-sm bg-[#4a80bb]" aria-hidden="true"></span>
                      Approved Posts
                    </span>
                  </div>
                </section>

                {/* Workflow Card */}
                <div className="admin-panel-card bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
                  <div>
                    <h4 className="font-bold text-sm text-gray-800 mb-4">Administrator Workflow</h4>
                    <div className="space-y-3 text-xs">
                      <div className="flex items-start gap-2">
                        <span className="w-5 h-5 bg-[#2D4D36] text-white rounded-full flex items-center justify-center text-[10px] font-bold shrink-0">1</span>
                        <p className="text-gray-600"><strong className="text-gray-800">Evaluate Registrations:</strong> Check submitted account details before activation.</p>
                      </div>

                      <div className="flex items-start gap-2">
                        <span className="w-5 h-5 bg-[#2D4D36] text-white rounded-full flex items-center justify-center text-[10px] font-bold shrink-0">2</span>
                        <p className="text-gray-600"><strong className="text-gray-800">Listing Review:</strong> Ensure property posts are legitimate, safe, and priced fairly.</p>
                      </div>

                      <div className="flex items-start gap-2">
                        <span className="w-5 h-5 bg-[#2D4D36] text-white rounded-full flex items-center justify-center text-[10px] font-bold shrink-0">3</span>
                        <p className="text-gray-600"><strong className="text-gray-800">Monitor Roommate Ads:</strong> Filter inappropriate content and guarantee safety.</p>
                      </div>
                    </div>
                  </div>

                  <button type="button" onClick={startEvaluatingQueue} disabled={loadingQueues} className="w-full mt-4 bg-[#7BAE87] hover:bg-emerald-700 text-gray-900 hover:text-white font-bold py-2 rounded-xl text-xs flex items-center justify-center gap-2 transition cursor-pointer disabled:cursor-wait disabled:opacity-60">
                    {isEvaluatingQueue ? 'Continue Evaluating Queue' : 'Start Evaluating Queue'} ➔
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'statistics' && <WeeklyStatistics />}

          {/* TAB 2: USER SIGN-UP VERIFICATION */}
          {activeTab === 'verifications' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-extrabold text-gray-900">User Sign-up Verification</h2>
                <p className="text-xs text-gray-500">Review submitted identity documents for Renters & Owners before account activation</p>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 text-gray-700 font-extrabold">
                      <th className="pb-3">USER DETAILS</th>
                      <th className="pb-3 text-center">ACCOUNT ROLE</th>
                      <th className="pb-3">DATE REGISTERED</th>
                      <th className="pb-3">STATUS</th>
                      <th className="pb-3 text-center">EVALUATION ACTION</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {visibleRecords.map((u) => (
                      <tr key={u.id} className="hover:bg-gray-50">
                        <td className="py-3">
                          <p className="font-bold text-gray-900">{u.full_name || 'Name not provided'}</p>
                          <p className="text-[10px] text-gray-400">{u.email}</p>
                          <p className="mt-1 text-[10px] leading-5 text-gray-600">
                            Phone: {u.phone || '—'} · Gender: {u.gender || '—'} · DOB: {u.dob || '—'}
                            {u.business_name && <> · Business: {u.business_name}</>}
                            {u.address && <> · Address: {u.address}</>}
                            {u.property_type && <> · Property: {u.property_type}</>}
                            {u.gov_id_number && <> · ID ending {u.gov_id_number.slice(-4)}</>}
                            <br />ID file selected: {u.id_uploaded ? 'Yes' : 'No'} · Selfie selected: {u.selfie_uploaded ? 'Yes' : 'No'}
                          </p>
                          <button type="button" className="mt-2 text-xs font-bold text-emerald-800 underline" onClick={() => setHistoryAccount(u)}>View review history</button>
                          {u.documentError && <p className="mt-1 text-[10px] text-red-700">Document preview unavailable. Refresh before approving.</p>}
                          <div className="mt-1 flex gap-3 text-[10px] font-bold">
                            {u.idDocumentUrl
                              ? <a href={u.idDocumentUrl} target="_blank" rel="noreferrer" className="text-emerald-700 underline">View ID (private)</a>
                              : <span className="text-gray-400">ID document not submitted</span>}
                            {u.selfieDocumentUrl
                              ? <a href={u.selfieDocumentUrl} target="_blank" rel="noreferrer" className="text-emerald-700 underline">View selfie (private)</a>
                              : <span className="text-gray-400">Selfie not submitted</span>}
                          </div>
                        </td>
                        <td className="py-3 text-center">
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${String(u.role).toUpperCase() === 'RENTER' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'}`}>
                            {['OWNER', 'LANDLORD'].includes(String(u.role || '').toUpperCase()) ? 'Owner' : 'Renter'}
                          </span>
                        </td>
                        <td className="py-3 text-gray-600">
                          {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                        </td>
                        <td className="py-3">
                          <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded-md text-[10px] font-bold">{u.verification_status}</span>
                        </td>
                        <td className="py-3 text-center space-x-2">
                          <button title="Approve this pending verification submission" disabled={Boolean(processingItemId) || u.verification_status !== 'pending'} onClick={() => reviewAccount(u, 'approved')} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold px-3 py-1 rounded-lg text-[10px] cursor-pointer">
                            ✓ Approve
                          </button>
                          <button disabled={Boolean(processingItemId)} onClick={() => { setAdminError(''); setRejectionReason(''); setRejectionTarget({ type: 'account', item: u }); }} className="bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-bold px-3 py-1 rounded-lg text-[10px] cursor-pointer">
                            Request corrections
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!loadingQueues && visibleRecords.length === 0 && (
                      <tr><td colSpan="5" className="py-8 text-center text-xs text-gray-500">No pending accounts match the current filters.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: LISTINGS REVIEW */}
          {activeTab === 'listings' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-extrabold text-gray-900">Accommodation Listings Review</h2>
                <p className="text-xs text-gray-500">Evaluate owner submissions for legitimacy, complete details, and pricing guidelines</p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
                {visibleRecords.map((item) => (
                  <div key={item.id} className="admin-compact-listing bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="bg-[#7BAE87] h-40 flex items-center justify-center text-white font-black text-lg relative">
                      {item.image_url || item.photos?.length ? <AdminPostMedia photos={item.image_url ? [item.image_url] : item.photos} onPreview={setMediaPreview} bucket="listing-photos" cover /> : <span>Accommodation listing</span>}
                      <span className="absolute top-3 right-3 bg-emerald-900 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{item.price}</span>
                    </div>

                    <div className="p-4 space-y-2">
                      <h4 className="font-bold text-sm text-gray-900">{item.title}</h4>
                      <p className="text-[10px] text-gray-500">📍 {item.location}</p>
                      <p className="text-[10px] text-gray-700 font-bold">Owner: {item.owner?.business_name || item.owner?.full_name || 'Profile unavailable'} · {item.owner?.email || item.owner_id}</p>
                      <p className="text-[10px] text-gray-600 italic">{item.description || 'No description provided.'}</p>
                      <AdminPostMedia photos={item.photos} onPreview={setMediaPreview} bucket="listing-photos" />

                      <div className="flex gap-2 pt-3">
                        <button disabled={processingItemId === `listings-${item.id}`} onClick={() => reviewContent('listings', item, 'approved')} className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-1.5 rounded-xl text-xs cursor-pointer">
                          ✓ Approve & Publish
                        </button>
                        <button disabled={processingItemId === `listings-${item.id}`} onClick={() => { setAdminError(''); setRejectionReason(''); setRejectionTarget({ type: 'content', table: 'listings', item }); }} className="flex-1 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-bold py-1.5 rounded-xl text-xs cursor-pointer">
                          ✕ Reject
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {!loadingQueues && visibleRecords.length === 0 && <p className="col-span-2 rounded-2xl bg-white p-8 text-center text-xs text-gray-500">No listings match the current filters.</p>}
              </div>
            </div>
          )}

          {/* TAB 4: ROOMMATE POSTS MODERATION */}
          {activeTab === 'roommates' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-extrabold text-gray-900">Roommate Posts Moderation</h2>
                <p className="text-xs text-gray-500">Audit "Looking for a Roommate" posts for safety, appropriate content, and user guidelines</p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {visibleRecords.map((post) => (
                  <div key={post.id} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 space-y-3 relative">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-bold text-sm text-gray-900">{post.author_name || 'BoardMate member'}</h4>
                        <p className="text-xs font-semibold text-gray-800">{post.heading}</p>
                        <p className="text-[10px] text-emerald-700 font-medium">Target Budget: {post.budget}</p>
                        <p className="text-[10px] text-gray-400">📍 {post.location}</p>
                      </div>
                      <span className="text-[9px] text-blue-600 font-bold bg-blue-50 px-2 py-0.5 rounded-full">Roommate Ad</span>
                    </div>

                    <p className="bg-[#FAF7EE] p-3 rounded-xl text-xs text-gray-700 italic border border-gray-100">
                      "{post.description}"
                    </p>

                    <AdminPostMedia photos={post.photos} onPreview={setMediaPreview} />
                    <div className="flex gap-2 pt-1">
                      <button disabled={processingItemId === `roommate_posts-${post.id}`} onClick={() => reviewContent('roommate_posts', post, 'approved')} className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-1.5 rounded-xl text-xs cursor-pointer">
                        ✓ Approve Post
                      </button>
                      <button disabled={processingItemId === `roommate_posts-${post.id}`} onClick={() => { setAdminError(''); setRejectionReason(''); setRejectionTarget({ type: 'content', table: 'roommate_posts', item: post }); }} className="flex-1 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-bold py-1.5 rounded-xl text-xs cursor-pointer">
                        ✕ Reject Post
                      </button>
                    </div>
                  </div>
                ))}
                {!loadingQueues && visibleRecords.length === 0 && <p className="col-span-2 rounded-2xl bg-white p-8 text-center text-xs text-gray-500">No pending posts match the current filters.</p>}
              </div>
            </div>
          )}

          {activeTab === 'users' && (
            <section className="space-y-4">
              <div>
                <h2 className="text-xl font-extrabold text-gray-900">User Directory</h2>
                <p className="text-xs text-gray-500">All registered renter and owner accounts.</p>
              </div>
              <div className="overflow-x-auto rounded-2xl bg-white p-4 shadow-sm">
                <table className="w-full min-w-[680px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 text-gray-700">
                      <th className="pb-3">USER</th>
                      <th className="pb-3">PHONE</th>
                      <th className="pb-3">ROLE</th>
                      <th className="pb-3">ACCOUNT VERIFICATION</th>
                      <th className="pb-3">DATE REGISTERED</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {visibleRecords.map(profile => (
                      <tr key={profile.id}>
                        <td className="py-3">
                          <p className="font-bold text-gray-900">{profile.full_name || 'Name not provided'}</p>
                          <p className="text-[10px] text-gray-500">{profile.email || 'Email not provided'}</p>
                        </td>
                        <td className="py-3 text-gray-600">{profile.phone || '—'}</td>
                        <td className="py-3 text-gray-600">{String(profile.role || 'RENTER').toUpperCase() === 'LANDLORD' ? 'Owner' : String(profile.role || 'Renter')}</td>
                        <td className="py-3">
                          <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${
                            profile.verification_status === 'approved'
                              ? 'bg-emerald-100 text-emerald-800'
                              : profile.verification_status === 'rejected'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-amber-100 text-amber-800'
                          }`}>{profile.verification_status || 'not_submitted'}</span>
                          <button type="button" className="mt-2 block text-xs font-bold text-emerald-800 underline" onClick={() => setHistoryAccount(profile)}>View review history</button>
                          {!profile.verification_revision && <p className="mt-1 text-[10px] text-gray-500">Existing status retained. New document submission required before another review.</p>}
                        </td>
                        <td className="py-3 text-gray-600">{profile.created_at ? new Date(profile.created_at).toLocaleDateString() : '—'}</td>
                      </tr>
                    ))}
                    {!loadingQueues && visibleRecords.length === 0 && (
                      <tr><td colSpan="5" className="py-8 text-center text-xs text-gray-500">{searchTerm ? 'No accounts match your search.' : 'No user accounts found.'}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeTab === 'accommodations' && (
            <section className="space-y-4">
              <div>
                <h2 className="text-xl font-extrabold text-gray-900">Accommodation Listings</h2>
                <p className="text-xs text-gray-500">Approved and rejected accommodation submissions.</p>
              </div>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {visibleRecords.map(item => (
                  <article key={item.id} className="admin-compact-listing overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                    <div className="relative flex h-40 items-center justify-center bg-[#7BAE87] text-white">
                      {item.image_url || item.photos?.length ? <AdminPostMedia photos={item.image_url ? [item.image_url] : item.photos} onPreview={setMediaPreview} bucket="listing-photos" cover /> : <span>Accommodation listing</span>}
                      <span className={`absolute right-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-bold text-white ${item.moderation_status === 'approved' ? 'bg-emerald-800' : 'bg-red-700'}`}>
                        {item.moderation_status}
                      </span>
                    </div>
                    <div className="space-y-2 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-sm font-bold text-gray-900">{item.title}</h3>
                        <span className="text-xs font-bold text-emerald-800">{item.price}</span>
                      </div>
                      <p className="text-[10px] text-gray-500">📍 {item.location}</p>
                      <p className="text-[10px] text-gray-600">
                        Owner: {item.owner?.business_name || item.owner?.full_name || 'Profile unavailable'} · {item.owner?.email || item.owner_id}
                      </p>
                      <p className="text-xs text-gray-700">{item.description || 'No description provided.'}</p>
                      <AdminPostMedia photos={item.photos} onPreview={setMediaPreview} bucket="listing-photos" />
                      {item.moderation_reason && (
                        <p className="rounded-lg bg-red-50 p-2 text-[10px] text-red-800">Rejection reason: {item.moderation_reason}</p>
                      )}
                      <p className="text-[10px] text-gray-400">
                        Reviewed {item.reviewed_at ? new Date(item.reviewed_at).toLocaleString() : 'date unavailable'}
                      </p>
                    </div>
                  </article>
                ))}
                {!loadingQueues && visibleRecords.length === 0 && (
                  <p className="rounded-2xl bg-white p-8 text-center text-xs text-gray-500">No listings match the current filters.</p>
                )}
              </div>
            </section>
          )}

          {activeTab === 'user_posts' && (
            <section className="space-y-4">
              <div>
                <h2 className="text-xl font-extrabold text-gray-900">User Posts</h2>
                <p className="text-xs text-gray-500">Roommate posts after administrator review.</p>
              </div>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {visibleRecords.map(post => {
                  const author = usersById.get(post.user_id);
                  return (
                    <article key={post.id} className="space-y-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-bold text-gray-900">{post.heading}</h3>
                          <p className="text-[10px] text-gray-500">
                            {post.author_name || author?.full_name || 'BoardMate member'} · {author?.email || 'Email unavailable'}
                          </p>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                          post.deleted_at
                            ? 'bg-slate-200 text-slate-700'
                            : post.moderation_status === 'approved'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-red-100 text-red-800'
                        }`}>{post.deleted_at ? 'deleted' : post.moderation_status}</span>
                      </div>
                      <AdminPostMedia photos={post.photos} onPreview={setMediaPreview} />
                      <p className="text-xs text-gray-700">{post.description || 'No description provided.'}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-gray-500">
                        <span>Budget: {post.budget}</span>
                        <span>📍 {post.location}</span>
                        <span>Role: {post.role}</span>
                      </div>
                      {post.moderation_reason && (
                        <p className="rounded-lg bg-red-50 p-2 text-[10px] text-red-800">Rejection reason: {post.moderation_reason}</p>
                      )}
                      <p className="text-[10px] text-gray-400">
                        {post.deleted_at
                          ? `Deleted by owner ${new Date(post.deleted_at).toLocaleString()}`
                          : `Reviewed ${post.reviewed_at ? new Date(post.reviewed_at).toLocaleString() : 'date unavailable'}`}
                      </p>
                    </article>
                  );
                })}
                {!loadingQueues && visibleRecords.length === 0 && (
                  <p className="rounded-2xl bg-white p-8 text-center text-xs text-gray-500">No posts match the current filters.</p>
                )}
              </div>
            </section>
          )}

          {activeTab === 'activity' && (
            <section className="space-y-4">
              <div>
                <h2 className="text-xl font-extrabold text-gray-900">Admin Activity Logs</h2>
                <p className="text-xs text-gray-500">Latest 200 administrator actions. Use the header search to filter actions, records, and administrator names.</p>
              </div>
              <div className="space-y-2">
                {visibleRecords.map(log => (
                  <article key={log.id} className="flex flex-col gap-2 rounded-xl border border-gray-100 bg-white p-3 shadow-sm sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-gray-900">{log.action}</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-[10px] text-gray-600">{log.details || 'No details provided.'}</p>
                      <p className="mt-1 truncate text-[9px] text-gray-400">
                        Administrator: {usersById.get(log.user_id)?.full_name || usersById.get(log.user_id)?.email || log.user_id}
                      </p>
                    </div>
                    <time className="shrink-0 text-[9px] text-gray-400">{new Date(log.created_at).toLocaleString()}</time>
                  </article>
                ))}
                {!loadingQueues && visibleRecords.length === 0 && (
                  <p className="rounded-2xl bg-white p-8 text-center text-xs text-gray-500">{searchTerm ? 'No activity logs match your search.' : 'No activity logs have been recorded.'}</p>
                )}
              </div>
            </section>
          )}

          {/* TAB 5: SAFETY & CHAT MONITOR */}
          {activeTab === 'safety' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-extrabold text-gray-900">Platform Safety & Chat Monitor</h2>
                <p className="text-xs text-gray-500">Review user-submitted conversation reports and protect BoardMate users</p>
              </div>

              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-800">Conversation reports ({messageReports.filter(report => report.status === 'open').length} pending)</h3>
                <button type="button" onClick={() => loadMessageReports().catch(error => setAdminError(`Unable to refresh reports: ${error.message}`))} disabled={loadingReports} className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-gray-700 shadow-sm disabled:opacity-50">
                  {loadingReports ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>

              {loadingReports && visibleRecords.length === 0 && <p className="rounded-2xl bg-white p-8 text-center text-xs text-gray-500">Loading reports…</p>}
              {!loadingReports && visibleRecords.length === 0 && (
                <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-xs text-gray-500">
                  No reports match the current filters.
                </p>
              )}
              <div className="space-y-3">
                {visibleRecords.map(report => (
                  <article key={report.id} className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-bold text-gray-800">
                          {report.reporter?.full_name || report.reporter?.email || 'BoardMate member'} reported {report.reportedUser?.full_name || report.reportedUser?.email || 'a user'}
                        </p>
                        <time className="mt-1 block text-[10px] text-gray-400">{new Date(report.created_at).toLocaleString()}</time>
                      </div>
                      <label className="flex items-center gap-2 text-[10px] font-bold text-gray-600">
                        STATUS
                        <select
                          value={report.status}
                          onChange={event => resolveMessageReport(report.id, event.target.value)}
                          disabled={processingReportId === report.id}
                          aria-label={`Change report status for ${report.reportedUser?.full_name || 'reported user'}`}
                          className={`rounded-full border-0 px-2.5 py-1 text-[10px] font-bold ${
                            report.status === 'open' ? 'bg-amber-100 text-amber-800'
                              : report.status === 'suspended' ? 'bg-red-100 text-red-800'
                                : report.status === 'warning_issued' ? 'bg-orange-100 text-orange-800'
                                  : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {report.status === 'open' && <option value="open">Pending</option>}
                          {report.status === 'warning_issued' && <option value="warning_issued">Warning</option>}
                          {report.status === 'suspended' && <option value="suspended">Suspended</option>}
                          {report.status === 'dismissed' && <option value="dismissed">Dismissed</option>}
                          {report.status === 'open' && <option value="warning_issued">Warning</option>}
                          {['open', 'warning_issued'].includes(report.status) && <option value="suspended">Suspended</option>}
                          {report.status === 'open' && <option value="dismissed">Dismissed</option>}
                        </select>
                      </label>
                    </div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Category: {report.category.replaceAll('_', ' ')}</p>
                    <p className="whitespace-pre-wrap rounded-xl bg-gray-50 p-3 text-xs text-gray-700">{report.reason}</p>
                    {report.evidenceUrl && (
                      <div className="space-y-1">
                        {report.evidenceMimeType.startsWith('audio/')
                          ? <UploadedMedia as="audio" src={report.evidenceUrl} controls aria-label="Submitted audio evidence" className="max-w-full" />
                          : report.evidenceMimeType.startsWith('video/')
                            ? <UploadedMedia as="video" src={report.evidenceUrl} controls playsInline aria-label="Submitted video evidence" className="max-h-40 max-w-full rounded-lg" />
                            : <ProfileImage src={report.evidenceUrl} alt="Submitted report evidence" className="h-16 w-16 rounded-lg border object-cover" />}
                        <button
                          type="button"
                          onClick={() => setMediaPreview({
                            src: report.evidenceUrl,
                            name: `Report evidence (${report.evidenceMimeType.split('/')[0]})`,
                            mimeType: report.evidenceMimeType,
                          })}
                          className="block text-xs font-semibold text-emerald-700 underline"
                        >
                          Preview evidence
                        </button>
                      </div>
                    )}
                    {report.status === 'open' && (
                      <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-3">
                        <button
                          type="button"
                          onClick={() => resolveMessageReport(report.id, 'dismissed')}
                          disabled={processingReportId === report.id}
                          className="rounded-lg bg-gray-100 px-3 py-2 text-xs font-bold text-gray-700 disabled:opacity-50"
                        >
                          Dismiss
                        </button>
                        {processingReportId === report.id && <span className="self-center text-xs text-gray-500">Saving…</span>}
                      </div>
                    )}
                    {['warning_issued', 'suspended'].includes(report.status) && (
                      <div className="flex justify-end border-t border-gray-100 pt-3">
                        <button
                          type="button"
                          onClick={() => resolveMessageReport(report.id, 'suspended')}
                          disabled={report.status === 'suspended' || processingReportId === report.id}
                          className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Suspend account
                        </button>
                      </div>
                    )}
                    {report.resolution_note && <p className="text-[10px] text-gray-600">Admin note: {report.resolution_note}</p>}
                    {report.reviewed_at && <time className="block text-[10px] text-gray-400">Reviewed {new Date(report.reviewed_at).toLocaleString()}</time>}
                  </article>
                ))}
              </div>
            </div>
          )}

        </main>
      </div>

      {historyAccount && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Verification review history">
        <section className="verification-status-card max-h-[90dvh] overflow-y-auto"><h2 className="font-bold">Verification history: {historyAccount.full_name}</h2>
          <VerificationHistory userId={historyAccount.id} revision={historyAccount.verification_revision} />
          <div className="verification-status-actions"><button type="button" onClick={() => setHistoryAccount(null)}>Close review history</button></div>
        </section>
      </div>}
      {rejectionTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <form
            className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5 shadow-2xl"
            onSubmit={event => { event.preventDefault(); confirmRejection(); }}
          >
            <h2 className="text-sm font-bold text-gray-900">
              Reject {rejectionTarget.type === 'account' ? 'account verification' : rejectionTarget.table === 'roommate_posts' ? 'roommate post' : 'accommodation listing'}?
            </h2>
            <p className="text-xs text-gray-600">
              {rejectionTarget.type === 'content' && rejectionTarget.table === 'roommate_posts'
                ? 'The rejected post will remain in User Posts with its reason.'
                : rejectionTarget.type === 'account' ? 'The applicant will be notified and can correct and resubmit. The current decision and remarks will remain in review history.' : 'The user will be informed of the rejection reason.'}
            </p>
            <label className="block text-xs font-semibold text-gray-700">
              {rejectionTarget.type === 'account' ? 'Required corrections and rejection reason' : 'Rejection reason'}
              <textarea
                autoFocus
                value={rejectionReason}
                onChange={event => setRejectionReason(event.target.value)}
                rows={3}
                maxLength={2000}
                placeholder={rejectionTarget.type === 'account' ? 'Specify the personal details or documents that must be corrected. This feedback will be sent to the applicant.' : 'Explain the reason.'}
                required
                className="mt-1 w-full resize-y rounded-xl border border-gray-300 p-3 text-xs font-normal outline-none focus:border-emerald-600"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setRejectionTarget(null); setRejectionReason(''); setAdminError(''); }}
                className="rounded-xl bg-gray-100 px-4 py-2 text-xs font-bold text-gray-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={Boolean(processingItemId)}
                className="rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
              >
                {processingItemId ? 'Processing…' : 'Confirm rejection'}
              </button>
            </div>
          </form>
        </div>
      )}

      {notificationConfirmation && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4" role="alertdialog" aria-modal="true" aria-labelledby="admin-notification-action-title">
          <section className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-5 shadow-2xl">
            <div>
              <h2 id="admin-notification-action-title" className="text-sm font-bold text-gray-900">
                {notificationConfirmation.action === 'delete' ? 'Delete this notification?' : 'Hide this notification?'}
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-gray-600">
                {notificationConfirmation.action === 'delete'
                  ? 'This notification will be permanently deleted. This cannot be undone.'
                  : 'This notification will be hidden for five days, then it will appear here again.'}
              </p>
            </div>
            <p className="rounded-xl bg-gray-50 p-3 text-xs font-semibold text-gray-700">
              {uiText(notificationConfirmation.notification.title)}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNotificationConfirmation(null)}
                disabled={processingNotificationAction}
                className="rounded-xl bg-gray-100 px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmNotificationAction}
                disabled={processingNotificationAction}
                className={`rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50 ${notificationConfirmation.action === 'delete' ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-700 hover:bg-emerald-800'}`}
              >
                {processingNotificationAction ? 'Saving…' : `Yes, ${notificationConfirmation.action === 'delete' ? 'delete' : 'hide'}`}
              </button>
            </div>
          </section>
        </div>
      )}

      {logoutConfirmationOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/55 p-4" role="alertdialog" aria-modal="true" aria-labelledby="admin-logout-title">
          <section className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-5 text-center shadow-2xl">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-red-50 text-2xl text-red-600" aria-hidden="true">↗</span>
            <h2 id="admin-logout-title" className="text-sm font-bold text-gray-900">Exit the admin dashboard?</h2>
            <p className="text-xs text-gray-600">You will be signed out and returned to the administrator sign-in screen.</p>
            <div className="flex justify-center gap-2">
              <button type="button" onClick={() => setLogoutConfirmationOpen(false)} className="rounded-lg bg-gray-100 px-4 py-2 text-xs font-semibold text-gray-700">NO</button>
              <button type="button" onClick={confirmAdminLogout} className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white">YES, EXIT</button>
            </div>
          </section>
        </div>
      )}
      {mediaPreview && <MediaPreviewDialog media={mediaPreview} onClose={() => setMediaPreview(null)} />}

    </div>
    <ErrorDialog message={adminError} onClose={() => setAdminError('')} />
    </>
  );
}
