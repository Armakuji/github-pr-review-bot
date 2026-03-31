import { PullRequestFile } from 'src/github/interfaces/github.interface';

const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.mts': 'TypeScript',
  '.cts': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.swift': 'Swift',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.cs': 'C#',
  '.fs': 'F#',
  '.fsx': 'F#',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.cxx': 'C++',
  '.c': 'C',
  '.h': 'C/C++',
  '.hpp': 'C++',
  '.sql': 'SQL',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.zsh': 'Shell',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.json': 'JSON',
  '.md': 'Markdown',
  '.html': 'HTML',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.less': 'Less',
};

/** Count changed files by inferred language (from extension). */
export function countLanguagesByFile(files: PullRequestFile[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of files) {
    const last = f.filename.lastIndexOf('.');
    const ext = last === -1 ? '' : f.filename.slice(last).toLowerCase();
    const lang = EXT_TO_LANG[ext] ?? 'Other';
    counts[lang] = (counts[lang] ?? 0) + 1;
  }
  return counts;
}
