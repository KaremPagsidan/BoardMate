import '../searchBar.css';

// Search triggers and editable searches share the same dashboard control.
export default function SearchBar({ onClick, children, className = '', ...props }) {
  const classes = `bm-search-bar ${className}`;
  return onClick
    ? <button {...props} type="button" onClick={onClick} className={classes}>{children}</button>
    : <input {...props} type="search" className={classes} />;
}
