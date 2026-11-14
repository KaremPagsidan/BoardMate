import PortalPage from './PortalPage';
import NotificationCard from './NotificationCard';
import ErrorDialog from './ErrorDialog';
export default function NotificationsPage({ notifications, onBack, onDelete, onHide, onOpen, error, onDismissError }) {
  return <PortalPage title="Notifications" onBack={onBack}>
    <div className="space-y-3">{notifications.map(notification => <NotificationCard key={notification.id} notification={notification} onDelete={onDelete} onHide={onHide} onOpen={onOpen} />)}
      {!notifications.length && <p className="py-6 text-center text-sm text-gray-500">You are all caught up.</p>}
    </div>
    <ErrorDialog message={error} onClose={onDismissError} />
  </PortalPage>;
}
