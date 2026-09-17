// Only plain http(s) URLs are allowed anywhere an image URL is user-supplied.
// Blocks javascript:, data:, protocol-relative //... and other scheme tricks.
//
// We additionally reject characters that can break out of the contexts these
// URLs are echoed into (HTML attributes, CSS url('...'), inline script string
// literals): quotes, parentheses, angle brackets, backslashes and whitespace.
// Legitimate image CDN URLs (Cloudinary, Unsplash, i.ibb.co) never contain them.
function isValidImageUrl(url) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return false;
  if (!/^https?:\/\//i.test(trimmed)) return false;
  if (/["'()<>\s\\]/.test(trimmed)) return false;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

module.exports = { isValidImageUrl };
