import { useI18n } from '../lib/i18n';
import { FeedbookBrand } from '../components/FeedbookBrand';

// Shown exactly once, before anything else (even sign-in) — first launch on
// this device. Not RTL or LTR by default, since we don't know the answer
// yet: both options get equal visual weight.
export function LanguageSelect() {
  const { chooseLang } = useI18n();

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 text-center shadow-md">
        <div className="mb-6 flex justify-center">
          <FeedbookBrand />
        </div>
        <p className="mb-1 text-base font-semibold text-blue-900">בחר/י שפה</p>
        <p className="mb-6 text-base font-semibold text-blue-900">Choose a language</p>

        <div className="flex flex-col gap-3">
          <button
            onClick={() => chooseLang('he')}
            className="rounded border border-gray-300 py-3 text-base font-medium text-gray-800 hover:border-blue-700 hover:bg-blue-50"
          >
            עברית
          </button>
          <button
            onClick={() => chooseLang('en')}
            className="rounded border border-gray-300 py-3 text-base font-medium text-gray-800 hover:border-blue-700 hover:bg-blue-50"
          >
            English
          </button>
        </div>
      </div>
    </div>
  );
}
