// Languages offered by "Translate". Indian languages come first, then widely
// used world languages. Labels show the native name first, then English, so
// everyone can find theirs: "தமிழ் (Tamil)".
export const INDIAN_LANGUAGES = [
  { code: 'ta', native: 'தமிழ்', english: 'Tamil' },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi' },
  { code: 'bn', native: 'বাংলা', english: 'Bengali' },
  { code: 'te', native: 'తెలుగు', english: 'Telugu' },
  { code: 'mr', native: 'मराठी', english: 'Marathi' },
  { code: 'gu', native: 'ગુજરાતી', english: 'Gujarati' },
  { code: 'kn', native: 'ಕನ್ನಡ', english: 'Kannada' },
  { code: 'ml', native: 'മലയാളം', english: 'Malayalam' },
  { code: 'pa', native: 'ਪੰਜਾਬੀ', english: 'Punjabi' },
  { code: 'or', native: 'ଓଡ଼ିଆ', english: 'Odia' },
  { code: 'ur', native: 'اردو', english: 'Urdu', rtl: true },
  { code: 'as', native: 'অসমীয়া', english: 'Assamese' },
];

export const WORLD_LANGUAGES = [
  { code: 'en', native: 'English', english: 'English' },
  { code: 'es', native: 'Español', english: 'Spanish' },
  { code: 'fr', native: 'Français', english: 'French' },
  { code: 'de', native: 'Deutsch', english: 'German' },
  { code: 'pt', native: 'Português', english: 'Portuguese' },
  { code: 'ar', native: 'العربية', english: 'Arabic', rtl: true },
  { code: 'zh', native: '中文（简体）', english: 'Chinese, Simplified' },
  { code: 'ja', native: '日本語', english: 'Japanese' },
  { code: 'ko', native: '한국어', english: 'Korean' },
  { code: 'ru', native: 'Русский', english: 'Russian' },
  { code: 'id', native: 'Bahasa Indonesia', english: 'Indonesian' },
  { code: 'it', native: 'Italiano', english: 'Italian' },
  { code: 'tr', native: 'Türkçe', english: 'Turkish' },
  { code: 'vi', native: 'Tiếng Việt', english: 'Vietnamese' },
];

const ALL = [...INDIAN_LANGUAGES, ...WORLD_LANGUAGES];

export const languageLabel = (l) => (l.native === l.english ? l.english : `${l.native} (${l.english})`);

/**
 * The language for a code from the list, or a typed-in name ("Other…").
 * @returns {{code: string, native: string, english: string, rtl?: boolean}}
 */
export function findLanguage(code, custom = '') {
  const known = ALL.find((l) => l.code === code);
  if (known) return known;
  const name = String(custom || '').trim().slice(0, 40);
  return { code: '', native: name, english: name };
}
