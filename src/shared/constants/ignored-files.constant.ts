export const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot',
  '.zip', '.tar', '.gz', '.pdf',
  '.lock',
]);

export const IGNORE_PATTERNS = [
  /package-lock\.json$/i,
  /yarn\.lock$/i,
  /\.snap$/i,
  /^dist\//i,
  /^build\//i,
  /^coverage\//i,
  /\.min\.js$/i,
  /readme\.md$/i,
];

export const MAX_FILES = 30;
