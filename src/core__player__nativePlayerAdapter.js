/**
 * Compatibility guard for imports left over from the retired native-overlay
 * player. Android playback must use the page-owned HTMLVideoElement instead.
 * Keeping an explicit failure here prevents any stale caller from reporting a
 * successful invisible Exo/IJK/MediaPlayer session.
 */
export function createNativePlayerAdapter() {
  throw new Error('NATIVE_VIDEO_PLAYBACK_DISABLED: use createHtml5PlayerAdapter with the page-owned video element');
}
