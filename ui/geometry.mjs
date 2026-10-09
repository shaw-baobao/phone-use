export function imagePoint(clientX, clientY, rect, size) {
  if (!size || !rect.width || !rect.height) return null;
  const scale = Math.min(rect.width / size.width, rect.height / size.height);
  const width = size.width * scale, height = size.height * scale;
  const x = (clientX - rect.left - (rect.width - width) / 2) / width;
  const y = (clientY - rect.top - (rect.height - height) / 2) / height;
  return x >= 0 && y >= 0 && x <= 1 && y <= 1 ? { x, y } : null;
}
