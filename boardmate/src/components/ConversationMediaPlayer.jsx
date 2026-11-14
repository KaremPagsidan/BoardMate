import '../media.css';

function pauseOtherConversationMedia(event) {
  const activePlayer = event.currentTarget;
  const conversation = activePlayer.closest('[role="log"]');

  conversation?.querySelectorAll('audio, video').forEach(player => {
    if (player !== activePlayer) player.pause();
  });
}

export default function ConversationMediaPlayer({ src, mimeType, className, onPreview }) {
  const mediaProps = {
    src,
    controls: true,
    autoPlay: false,
    preload: 'none',
    onPlay: pauseOtherConversationMedia,
    className: `bm-uploaded-media ${className || ''}`,
    onClick: event => event.stopPropagation(),
    onKeyDown: event => event.stopPropagation(),
  };

  const player = mimeType.startsWith('video/')
    ? <video key={src} {...mediaProps} playsInline />
    : <audio key={src} {...mediaProps} />;
  if (!onPreview) return player;
  return <div className="bm-message-media" role="group" aria-label="Message media" onClick={onPreview}>
    {player}
    <button type="button" className="bm-message-preview" aria-label="Open media preview" onClick={event => { event.stopPropagation(); onPreview(); }}>⛶</button>
  </div>;
}
