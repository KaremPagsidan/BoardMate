import { useEffect, useState } from 'react';
import App from './App';
import ListingDetailsPage from './components/ListingDetailsPage';
import { readListingRoute } from './lib/listingDetails';
import AppViewport from './components/AppViewport';

export default function UserSite() {
  const [route, setRoute] = useState(() => readListingRoute());
  useEffect(() => {
    const navigate = () => setRoute(readListingRoute());
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  useEffect(() => { if (!route) document.title = 'BoardMate'; }, [route]);
  if (!route) return <App />;
  const details = <ListingDetailsPage key={route.listingId} route={route} />;
  return route.viewport === 'phone' ? <AppViewport>{details}</AppViewport> : details;
}
