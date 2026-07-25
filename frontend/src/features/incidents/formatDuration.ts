/** "45s", "12m", "2h 15m", "3d 4h" — a fixed duration (MTTR), not a "time ago" like RelativeTime. */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) {
    return `${Math.round(totalSeconds)}s`;
  }

  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}
