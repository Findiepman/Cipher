import '../styles/brand.css';

type Props = {
  size?: number;
  className?: string;
  /**
   * Only set this where the logo is the *only* thing identifying the app. Next
   * to the "Cipher" wordmark it is decoration, and a screen reader announcing
   * "Cipher logo, Cipher" is worse than saying nothing.
   */
  label?: string;
};

/**
 * The app mark, in one place.
 *
 * It is served from `public/`, not imported, so the same file backs the favicon,
 * the apple-touch icon, the manifest and every in-app use — one asset to swap
 * when the logo changes, instead of four that drift.
 *
 * `width`/`height` are set as attributes as well as in CSS so the surrounding
 * layout does not jump while the image loads.
 */
export function BrandMark({ size = 24, className, label }: Props) {
  return (
    <img
      className={className ? `brand-mark ${className}` : 'brand-mark'}
      src="/logo.png"
      alt={label ?? ''}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}
