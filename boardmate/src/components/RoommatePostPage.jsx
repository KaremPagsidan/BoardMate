import PortalPage from './PortalPage';
import PostMedia from './PostMedia';
import '../postDetails.css';

export default function RoommatePostPage({ post, onBack, onPreviewMedia, isLiked, likeCount = 0, likePending, isSuspended, onToggleLike, onMessage, actions }) {
  return <PortalPage title="Roommate post" onBack={onBack}>
    <article className="bm-post-details">
      <p className="bm-post-byline">{post.name || 'BoardMate member'}{post.time ? ` · ${post.time}` : ''}</p>
      <h2>{post.title || 'Roommate search'}</h2>
      <dl className="bm-post-facts">
        <div><dt>Budget</dt><dd>{post.budget || 'Not specified'}</dd></div>
        <div><dt>Location</dt><dd>{post.location || 'Not provided'}</dd></div>
        {post.gender && <div><dt>Gender</dt><dd>{post.gender}</dd></div>}
        {post.age != null && <div><dt>Age</dt><dd>{post.age}</dd></div>}
        {post.role && <div><dt>Role</dt><dd>{post.role}</dd></div>}
        {post.moderationStatus && <div><dt>Status</dt><dd>{post.moderationStatus}</dd></div>}
      </dl>
      <section><h3>About this roommate search</h3><p className="bm-post-description">{post.details || post.description || 'No description provided.'}</p></section>
      {post.moderationReason && <p className="bm-post-description">Review feedback: {post.moderationReason}</p>}
      <PostMedia media={post.photos?.length ? post.photos : post.media || []} onPreview={onPreviewMedia} />
      <footer className="bm-post-actions">
        {onToggleLike && <button type="button" disabled={isSuspended || likePending} aria-pressed={Boolean(isLiked)} onClick={onToggleLike}>{isLiked ? 'Liked' : 'Like'} · {likeCount}</button>}
        {onMessage && <button type="button" disabled={isSuspended} onClick={onMessage}>Message {post.name || 'member'}</button>}
        {actions}
      </footer>
    </article>
  </PortalPage>;
}
