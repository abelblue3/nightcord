import './sentry.js';
import './style.css';
import { initConsentBanner } from './consentBanner.js';
import { initThemeToggle } from './theme.js';

// Terms of Service and Privacy Policy pages: readable signed in or out.
initConsentBanner();
initThemeToggle(document.getElementById('theme-toggle'));
