/**
 * One line for an update download, shared by the banner and the settings
 * screen so the two never describe the same download differently.
 */
import type { Translate } from '../../state/I18nProvider';
import type { UpdateProgress } from './types';

export function describeProgress(progress: UpdateProgress | null, t: Translate): string {
  if (!progress) return t('update.downloading');
  if (progress.total === null || progress.total === 0) {
    return t('update.downloadingBytes', { amount: formatBytes(progress.downloaded) });
  }
  const percent = Math.min(100, Math.round((progress.downloaded / progress.total) * 100));
  return percent >= 100 ? t('update.installing') : t('update.downloadingPercent', { percent });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
