/**
 * Keep an Android native TextureView aligned with its DOM video window.
 *
 * A native TextureView is a separate Android view layered above the WebView,
 * so it must be moved/resized when either the element's size OR its position
 * changes. In particular, scroll events from nested containers do not bubble;
 * the document capture listener is intentional.
 */
export function observeNativeVideoBounds(element, controller) {
  if (!element || !controller || typeof controller.setVideoViewBounds !== 'function'
      || typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  let disposed = false;
  let animationFrame = 0;
  let fallbackTimer = 0;
  let lastBounds = null;
  const resizeObservers = [];
  const mutationObservers = [];
  const requestFrame = typeof window.requestAnimationFrame === 'function'
    ? callback => window.requestAnimationFrame(callback)
    : callback => window.setTimeout(callback, 16);
  const cancelFrame = typeof window.cancelAnimationFrame === 'function'
    ? id => window.cancelAnimationFrame(id)
    : id => window.clearTimeout(id);

  const measureVisibleBounds = () => {
    const rect = element.getBoundingClientRect?.();
    const viewportWidth = Math.max(0, Number(window.innerWidth) || 0);
    const viewportHeight = Math.max(0, Number(window.innerHeight) || 0);
    if (!rect || viewportWidth <= 0 || viewportHeight <= 0) {
      return { left: 0, top: 0, width: 0, height: 0, viewportWidth, viewportHeight };
    }

    let left = Number(rect.left);
    let top = Number(rect.top);
    let right = Number(rect.right ?? (rect.left + rect.width));
    let bottom = Number(rect.bottom ?? (rect.top + rect.height));
    if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) {
      return { left: 0, top: 0, width: 0, height: 0, viewportWidth, viewportHeight };
    }

    // Clip to the WebView's visible viewport first. Never clamp a negative
    // top/left while keeping the original width/height: that pins an oversized
    // native surface to screen edge after its DOM element scrolls away.
    left = Math.max(0, left);
    top = Math.max(0, top);
    right = Math.min(viewportWidth, right);
    bottom = Math.min(viewportHeight, bottom);

    // Also honor overflow clipping of scrollable/hidden ancestors. Native views
    // do not inherit CSS overflow clipping from the WebView DOM tree.
    let ancestor = element.parentElement;
    while (ancestor && ancestor !== document.documentElement) {
      const style = window.getComputedStyle?.(ancestor);
      if (style) {
        const ancestorRect = ancestor.getBoundingClientRect?.();
        if (ancestorRect) {
          const clipX = /(auto|scroll|hidden|clip)/.test(style.overflowX || style.overflow || '');
          const clipY = /(auto|scroll|hidden|clip)/.test(style.overflowY || style.overflow || '');
          const clipLeft = ancestorRect.left + (Number(ancestor.clientLeft) || 0);
          const clipTop = ancestorRect.top + (Number(ancestor.clientTop) || 0);
          const clipRight = clipLeft + Math.max(0, Number(ancestor.clientWidth) || 0);
          const clipBottom = clipTop + Math.max(0, Number(ancestor.clientHeight) || 0);
          if (clipX) {
            left = Math.max(left, clipLeft);
            right = Math.min(right, clipRight);
          }
          if (clipY) {
            top = Math.max(top, clipTop);
            bottom = Math.min(bottom, clipBottom);
          }
        }
      }
      ancestor = ancestor.parentElement;
    }

    if (right <= left || bottom <= top) {
      return { left: 0, top: 0, width: 0, height: 0, viewportWidth, viewportHeight };
    }

    return {
      left,
      top,
      width: right - left,
      height: bottom - top,
      viewportWidth,
      viewportHeight,
    };
  };

  const syncNow = () => {
    if (disposed) return;
    const bounds = measureVisibleBounds();
    // getBoundingClientRect can report tiny fractional differences during
    // scrolling. Round to quarter CSS pixels and avoid flooding the native
    // bridge with identical layout updates.
    const stable = Object.fromEntries(Object.entries(bounds).map(([key, value]) => [
      key,
      key === 'width' || key === 'height' || key === 'left' || key === 'top'
        ? Math.round(value * 4) / 4
        : value,
    ]));
    const signature = [stable.left, stable.top, stable.width, stable.height,
      stable.viewportWidth, stable.viewportHeight].join('|');
    if (signature === lastBounds) return;
    lastBounds = signature;
    try {
      const result = controller.setVideoViewBounds(stable);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {
      // Browser adapters do not expose a native surface; layout tracking must
      // not interrupt ordinary HTML playback.
    }
  };

  const scheduleSync = () => {
    if (disposed || animationFrame) return;
    animationFrame = requestFrame(() => {
      animationFrame = 0;
      syncNow();
    });
  };

  // Sync immediately for initial layout, then again after CSS/layout settles.
  syncNow();
  fallbackTimer = window.setTimeout(scheduleSync, 140);

  const resizeTargets = new Set();
  let resizeTarget = element;
  while (resizeTarget && resizeTarget !== document.documentElement) {
    resizeTargets.add(resizeTarget);
    resizeTarget = resizeTarget.parentElement;
  }
  if (typeof ResizeObserver !== 'undefined') {
    for (const target of resizeTargets) {
      const observer = new ResizeObserver(scheduleSync);
      try {
        observer.observe(target);
        resizeObservers.push(observer);
      } catch {
        observer.disconnect();
      }
    }
  }

  // Observe class/style changes up the tree: toggling immersive mode can move
  // the video element without necessarily changing its own dimensions.
  if (typeof MutationObserver !== 'undefined') {
    resizeTarget = element;
    while (resizeTarget && resizeTarget !== document.documentElement) {
      const observer = new MutationObserver(scheduleSync);
      observer.observe(resizeTarget, { attributes: true, attributeFilter: ['class', 'style'] });
      mutationObservers.push(observer);
      resizeTarget = resizeTarget.parentElement;
    }
  }

  window.addEventListener('resize', scheduleSync, { passive: true });
  window.addEventListener('orientationchange', scheduleSync, { passive: true });
  window.addEventListener('pageshow', scheduleSync, { passive: true });
  // Capture is required because element scroll events generally do not bubble.
  document.addEventListener('scroll', scheduleSync, { capture: true, passive: true });
  document.addEventListener('visibilitychange', scheduleSync);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleSync, { passive: true });
    window.visualViewport.addEventListener('scroll', scheduleSync, { passive: true });
  }

  return () => {
    disposed = true;
    if (animationFrame) cancelFrame(animationFrame);
    if (fallbackTimer) window.clearTimeout(fallbackTimer);
    resizeObservers.forEach(observer => observer.disconnect());
    mutationObservers.forEach(observer => observer.disconnect());
    window.removeEventListener('resize', scheduleSync);
    window.removeEventListener('orientationchange', scheduleSync);
    window.removeEventListener('pageshow', scheduleSync);
    document.removeEventListener('scroll', scheduleSync, true);
    document.removeEventListener('visibilitychange', scheduleSync);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', scheduleSync);
      window.visualViewport.removeEventListener('scroll', scheduleSync);
    }
    // Prevent an Activity-level TextureView from retaining stale coordinates
    // when the owning React playback page unmounts.
    try {
      const result = controller.setVideoViewBounds({
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        viewportWidth: Math.max(0, Number(window.innerWidth) || 0),
        viewportHeight: Math.max(0, Number(window.innerHeight) || 0),
      });
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {
      // Ignore unavailable native bridges during teardown.
    }
  };
}
