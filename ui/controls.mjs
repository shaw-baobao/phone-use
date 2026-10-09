export function inputError(state, action, acting = false) {
  if (!state.device) return 'Connect a device first.';
  if (state.mode !== 'manual') return 'Choose You to take control from AI.';
  if (state.paused) return 'Resume the preview before controlling the device.';
  if (acting || state.busy) return 'The device is processing another command.';
  if (!['home', 'recent'].includes(action) && !state.live) return 'Wait for a fresh screen before sending this input.';
  return null;
}
