import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Remove any service worker left behind by an earlier dev session. A stale
// worker can serve mismatched assets or refresh the page during a local game.
if ('serviceWorker' in navigator) {
  if (import.meta.env.DEV) {
    void navigator.serviceWorker.getRegistrations().then((registrations) =>
      Promise.all(registrations.map((registration) => registration.unregister()))
    );
    if ('caches' in window) {
      void caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))));
    }
  } else {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        void registration.update();
      }
    });
  }
}

createRoot(document.getElementById('root')!).render(<App />);
