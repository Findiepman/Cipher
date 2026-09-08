/**
 * One line for an update download, shared by the banner and the settings
 * screen so the two never describe the same download differently.
 */
import type { UpdateProgress } from './types';

export function describeProgress(progress: UpdateProgress | null): string {
  if (!progress) return 'Downloading…';
  if (progress.total === null || progress.total === 0) {
    return `Downloading… ${formatBytes(progress.downloaded)}`;
  }
  const percent = Math.min(100, Math.round((progress.downloaded / progress.total) * 100));
  return percent >= 100 ? 'Verifying and installing…' : `Downloading… ${percent}%`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
