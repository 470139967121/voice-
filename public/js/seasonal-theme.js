/**
 * Seasonal theme loader — date-gated CSS variable overrides + event ribbon.
 *
 * Fetches /events/events.json, checks if any event is active today,
 * and if so: overrides CSS custom properties and injects a dismissible ribbon.
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

    // Inject dismissible event ribbon (if not already dismissed this session)
    const dismissKey = `seasonal-ribbon-dismissed-${active.slug}`;
    if (sessionStorage.getItem(dismissKey)) return;

    const ribbon = document.createElement('div');
    ribbon.id = 'seasonal-ribbon';
    ribbon.setAttribute('role', 'banner');
    ribbon.innerHTML = `
      <a href="${active.pageUrl}" class="seasonal-ribbon-link">
        ${active.ribbonText || active.name}
        <span class="seasonal-ribbon-arrow">&rarr;</span>
      </a>
      <button class="seasonal-ribbon-close" aria-label="Dismiss">&times;</button>
    `;

    ribbon.style.cssText = `
      position: relative; z-index: 10000;
      background: linear-gradient(90deg, ${active.theme.primary}, ${active.theme.accent || active.theme.primary});
      color: #fff; text-align: center; padding: 8px 40px 8px 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px; font-weight: 500; box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    `;

    const link = ribbon.querySelector('.seasonal-ribbon-link');
    link.style.cssText = 'color: #fff; text-decoration: none;';

    const arrow = ribbon.querySelector('.seasonal-ribbon-arrow');
    arrow.style.cssText = 'margin-left: 6px;';

    const closeBtn = ribbon.querySelector('.seasonal-ribbon-close');
    closeBtn.style.cssText = `
      position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
      background: none; border: none; color: #fff; font-size: 20px;
      cursor: pointer; padding: 4px 8px; opacity: 0.8;
    `;
    closeBtn.addEventListener('click', () => {
      ribbon.remove();
      sessionStorage.setItem(dismissKey, '1');
    });

    document.body.prepend(ribbon);
  } catch {
    // Silently fail — seasonal theme is non-critical
  }
})();
