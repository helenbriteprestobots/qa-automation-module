const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const formatDateTime = (iso?: string): string => (iso ? dateTime.format(new Date(iso)) : '—');
export const formatTime = (iso?: string): string => (iso ? time.format(new Date(iso)) : '');

export const formatDuration = (from?: string, to?: string): string => {
  if (!from) return '—';
  const ms = (to ? new Date(to) : new Date()).getTime() - new Date(from).getTime();
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${seconds % 60} s`;
};

export const formatUsd = (value: number): string =>
  `US$ ${value < 1 && value > 0 ? value.toFixed(3) : value.toFixed(2)}`;
