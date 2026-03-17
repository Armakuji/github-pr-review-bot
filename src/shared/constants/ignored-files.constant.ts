export const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot',
  '.zip', '.tar', '.gz', '.pdf',
  '.lock',
]);

export const IGNORED_FILES = new Set([
  'readme.md',
  'package-lock.json',
]);
