/**
 * Legacy compatibility shim. Video pixels now render in the page-owned HTML
 * video element, so there is no Activity-level surface whose bounds need syncing.
 */
export function observeNativeVideoBounds() {
  return () => {};
}
