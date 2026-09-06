// Only plain http(s) URLs are allowed anywhere an image URL is user-supplied.
// Blocks javascript:, data:, protocol-relative //... and other scheme tricks
// that would otherwise end up rendered in CSS background-image / <img> contexts.
function isValidImageUrl(url) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  return trimmed.length > 0 && trimmed.length <= 2048 && /^https?:\/\//i.test(trimmed);
}

module.exports = { isValidImageUrl };
