/**
 * Seasonal theme loader — date-gated CSS variable overrides + event banner.
 *
 * Fetches /events/events.json, checks if any event is active today,
 * and if so: overrides CSS custom properties and shows a seasonal banner.
 *
 * Banner adapts to page layout:
 * - Landing page (flex-centered): injects a card inside .container
 * - Scrollable pages: shows a fixed bottom banner
 *
 * Banners are NOT dismissible — they stay visible for the duration of the event.
 *
 * Default ShyTalk theme = the inline CSS variables in each page's <style>.
 * When no event is active, this script does nothing — defaults remain.
 */

(async function loadSeasonalTheme() {
  try {
    const res = await fetch('/events/events.json');
    if (!res.ok) return;
    const { events } = await res.json();
    if (!events || !events.length) return;

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const active = events.find(e => today >= e.startDate && today < e.endDate);
    if (!active) return;

    // Override CSS custom properties with seasonal theme
    const root = document.documentElement;
    for (const [key, value] of Object.entries(active.theme)) {
      const cssVar = '--' + key.replace(/([A-Z])/g, '-$1').toLowerCase();
      root.style.setProperty(cssVar, value);
    }

    // Detect page layout to choose banner style
    const container = document.querySelector('.container');
    const isLandingPage = container && getComputedStyle(document.body).display === 'flex';

    if (isLandingPage) {
      injectLandingCard(active, container);
    } else {
      injectBottomBanner(active);
    }
  } catch {
    // Silently fail — seasonal theme is non-critical
  }
})();

/**
 * Landing page: a festive seasonal card inside .container.
 * Positioned between the tagline and the roadmap CTA for natural flow.
 */
function injectLandingCard(event, container) {
  const card = document.createElement('a');
  card.id = 'seasonal-ribbon';
  card.href = event.pageUrl;
  card.setAttribute('role', 'banner');
  card.setAttribute('data-log', 'seasonal-event-link');

  const p = event.theme.primary;
  const a = event.theme.accent || p;
  const glow = event.theme.primaryGlow || p;

  card.innerHTML = `
    <span class="seasonal-card-emoji">\u{1FAB7}</span>
    <span class="seasonal-card-body">
      <span class="seasonal-card-title">${event.name}</span>
      <span class="seasonal-card-subtitle">${event.ribbonText || 'Learn more'} \u2192</span>
    </span>
  `;

  card.style.cssText = `
    display: flex; align-items: center; gap: 14px;
    margin: 1.5rem auto 0.5rem; padding: 14px 22px;
    max-width: 400px; width: 100%;
    background: linear-gradient(135deg, ${p}18, ${a}18);
    border: 1px solid ${p}33;
    border-radius: 14px;
    color: #fff; text-decoration: none;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
    cursor: pointer;
    animation: seasonalFadeIn 0.6s ease-out;
  `;

  card.addEventListener('mouseenter', () => {
    card.style.transform = 'translateY(-3px)';
    card.style.boxShadow = `0 8px 32px ${p}30`;
    card.style.borderColor = `${glow}66`;
  });
  card.addEventListener('mouseleave', () => {
    card.style.transform = '';
    card.style.boxShadow = '';
    card.style.borderColor = `${p}33`;
  });

  const emoji = card.querySelector('.seasonal-card-emoji');
  emoji.style.cssText = 'font-size: 1.8rem; flex-shrink: 0; filter: drop-shadow(0 0 8px rgba(212,160,23,0.4));';

  const body = card.querySelector('.seasonal-card-body');
  body.style.cssText = 'display: flex; flex-direction: column; gap: 2px; text-align: left;';

  const title = card.querySelector('.seasonal-card-title');
  title.style.cssText = `font-size: 0.95rem; font-weight: 600; color: ${glow};`;

  const subtitle = card.querySelector('.seasonal-card-subtitle');
  subtitle.style.cssText = 'font-size: 0.8rem; opacity: 0.75; color: #fff;';

  // Add animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes seasonalFadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);

  // Insert after the "Coming Soon" badge for natural reading flow
  const badge = container.querySelector('.badge');
  if (badge) {
    badge.after(card);
  } else {
    const tagline = container.querySelector('.tagline');
    if (tagline) tagline.after(card);
    else container.prepend(card);
  }
}

/**
 * Scrollable pages: a fixed bottom banner that slides up.
 * Always visible during the event — no dismiss button.
 */
function injectBottomBanner(event) {
  const banner = document.createElement('a');
  banner.id = 'seasonal-ribbon';
  banner.href = event.pageUrl;
  banner.setAttribute('role', 'banner');

  const p = event.theme.primary;
  const a = event.theme.accent || p;
  const glow = event.theme.primaryGlow || p;

  banner.innerHTML = `
    <span class="seasonal-bottom-emoji">\u{1FAB7}</span>
    <span class="seasonal-bottom-text">${event.ribbonText || event.name}</span>
    <span class="seasonal-bottom-arrow">\u2192</span>
  `;

  banner.style.cssText = `
    position: fixed; bottom: 0; left: 0; right: 0; z-index: 10000;
    display: flex; align-items: center; justify-content: center; gap: 10px;
    background: linear-gradient(135deg, ${p}, ${a});
    padding: 12px 20px;
    color: #fff; text-decoration: none;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    box-shadow: 0 -4px 20px rgba(0,0,0,0.4);
    animation: seasonalSlideUp 0.5s ease-out;
    transition: filter 0.2s;
  `;

  banner.addEventListener('mouseenter', () => {
    banner.style.filter = 'brightness(1.1)';
  });
  banner.addEventListener('mouseleave', () => {
    banner.style.filter = '';
  });

  const emoji = banner.querySelector('.seasonal-bottom-emoji');
  emoji.style.cssText = 'font-size: 1.2rem;';

  const text = banner.querySelector('.seasonal-bottom-text');
  text.style.cssText = 'font-size: 0.9rem; font-weight: 500;';

  const arrow = banner.querySelector('.seasonal-bottom-arrow');
  arrow.style.cssText = 'font-size: 1rem; opacity: 0.8;';

  const style = document.createElement('style');
  style.textContent = `
    @keyframes seasonalSlideUp {
      from { transform: translateY(100%); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(banner);
}
