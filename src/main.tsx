import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Remove any service worker left behind by an earlier dev session. A stale
// worker can serve mismatched assets or refresh the page during a local game.
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) =>
    Promise.all(registrations.map((registration) => registration.unregister()))
  );
  if ('caches' in window) {
    void caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))));
  }
}

createRoot(document.getElementById('root')!).render(<App />);
