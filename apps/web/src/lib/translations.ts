export type Lang = 'he' | 'en';

const translations = {
  he: {
    // Shared
    loading: 'טוען…',
    signOut: 'יציאה',
    saving: 'שומר…',
    back: 'חזרה',

    // SignInUp
    restaurantManagement: 'ניהול מסעדה',
    tabSignIn: 'התחברות',
    tabSignUp: 'יצירת חשבון',
    email: 'אימייל',
    password: 'סיסמה',
    forgotPassword: 'שכחתי סיסמה',
    signInBusy: 'רגע…',
    accountCreatedInfo: 'החשבון נוצר. אם נדרש אימות מייל, בדוק/י את תיבת הדואר לפני ההתחברות.',
    forgotPasswordTitle: 'שחזור סיסמה',
    forgotPasswordSubtitle: 'הזן/י את כתובת המייל שלך ונשלח קישור לבחירת סיסמה חדשה.',
    sendResetLink: 'שליחת קישור לאיפוס',
    sendingReset: 'שולח…',
    backToSignIn: 'חזרה להתחברות',
    resetLinkSentInfo: 'אם קיים חשבון עם כתובת המייל הזו, נשלח אליו קישור לאיפוס הסיסמה.',

    // MfaEnroll
    mfaEnrollTitle: 'הגדרת אימות דו-שלבי',
    mfaEnrollSubtitle:
      'נדרש לכל חשבון צוות. סרוק/י את הקוד עם אפליקציית אימות (Google Authenticator, Authy וכו׳) — לא ניתן להתחבר בלעדיו.',
    manualEntryKey: 'מפתח להזנה ידנית',
    sixDigitCode: 'קוד בן 6 ספרות',
    verifyAndContinue: 'אימות והמשך',
    verifying: 'מאמת…',
    signOutAndStartOver: 'יציאה והתחלה מחדש',

    // MfaChallenge
    mfaChallengeTitle: 'הזן/י את קוד האימות',
    mfaChallengeSubtitle: 'פתח/י את אפליקציית האימות והזן/י את הקוד הנוכחי בן 6 הספרות.',
    verify: 'אימות',

    // RestaurantDetailsForm
    restaurantDetailsTitle: 'פרטי המסעדה',
    restaurantDetailsSubtitle:
      'תודה שהצטרפת! נשמח להכיר את המסעדה שלך — הפרטים נשמרים אוטומטית תוך כדי מילוי.',
    restaurantName: 'שם המסעדה',
    address: 'כתובת',
    phone: 'טלפון',
    hours: 'שעות פעילות',
    hoursPlaceholder: "לדוגמה: א'-ה' 09:00-22:00, ו' 09:00-15:00",
    fillRequiredFields: 'יש למלא שם, כתובת וטלפון כדי לשמור',
    savedAsDraft: 'נשמר כטיוטה ✓',
    continue: 'המשך',
    wizardInProgressNote:
      'שלבי ההמשך של ההרשמה (תפריט ראשוני, סקירה והגשה) בבנייה — הפרטים שכבר מילאת שמורים ולא ילכו לאיבוד.',

    // KosherStatusForm
    kosherStepTitle: 'סטטוס כשרות',
    kosherStepSubtitle: 'אופציונלי — ניתן לדלג ולהוסיף מאוחר יותר.',
    kosherQuestion: 'האם המסעדה מאושרת כשרות?',
    kosherYesUpload: 'כן, יש לי תעודה',
    kosherSkip: 'דלג/י בינתיים',
    kosherUploadLabel: 'העלאת תעודת כשרות (JPG, PNG או PDF, עד 10MB)',
    kosherUploading: 'מעלה…',
    kosherCertified: 'המסעדה מאושרת כשרות ✓',
    kosherRemove: 'הסרת תעודה',
    kosherFileTooLarge: 'הקובץ גדול מ-10MB',
    kosherUnsupportedType: 'פורמט קובץ לא נתמך (JPG, PNG או PDF בלבד)',
    // Fixed disclaimer, Content Guidelines §7.2א — not restaurant-editable,
    // do not reword.
    kosherDisclaimer:
      'המידע מבוסס על הצהרה עצמית של המסעדה ואינו מאומת על ידי Feedbook; לבירור נוסף יש לפנות ישירות לצוות המסעדה או לגורם המפקח.',

    // SetNewPassword
    setNewPasswordTitle: 'בחירת סיסמה חדשה',
    setNewPasswordSubtitle: 'בחר/י סיסמה חדשה לחשבון שלך.',
    newPassword: 'סיסמה חדשה',
    confirmPassword: 'אימות סיסמה',
    passwordsDontMatch: 'הסיסמאות אינן תואמות',
    updatePassword: 'עדכון סיסמה',

    // Dashboard
    signedInAs: 'מחובר כ-',
    statusDraft: 'טיוטה',
    statusPendingReview: 'ממתין לאישור',
    statusApproved: 'מאושר',
    statusRejected: 'נדחה',
    dashboardComingSoon: 'ניהול תפריטים, שולחנות והזמנות עדיין בבנייה — יתווספו כאן בהמשך.',

    // WizardStepper
    stepRestaurantDetails: 'פרטי מסעדה',
    stepKosher: 'כשרות',
    stepMenu: 'תפריט',
    stepReview: 'סקירה והסכם',
  },
  en: {
    // Shared
    loading: 'Loading…',
    signOut: 'Sign out',
    saving: 'Saving…',
    back: 'Back',

    // SignInUp
    restaurantManagement: 'Restaurant Management',
    tabSignIn: 'Sign in',
    tabSignUp: 'Create account',
    email: 'Email',
    password: 'Password',
    forgotPassword: 'Forgot password',
    signInBusy: 'One moment…',
    accountCreatedInfo: 'Account created. If email confirmation is required, check your inbox before signing in.',
    forgotPasswordTitle: 'Password recovery',
    forgotPasswordSubtitle: "Enter your email and we'll send a link to choose a new password.",
    sendResetLink: 'Send reset link',
    sendingReset: 'Sending…',
    backToSignIn: 'Back to sign-in',
    resetLinkSentInfo: 'If an account exists for this email, a password reset link has been sent.',

    // MfaEnroll
    mfaEnrollTitle: 'Set up two-factor authentication',
    mfaEnrollSubtitle:
      "Required for every staff account. Scan this code with an authenticator app (Google Authenticator, Authy, etc.) — sign-in isn't possible without it.",
    manualEntryKey: 'Manual entry key',
    sixDigitCode: '6-digit code',
    verifyAndContinue: 'Verify and continue',
    verifying: 'Verifying…',
    signOutAndStartOver: 'Sign out and start over',

    // MfaChallenge
    mfaChallengeTitle: 'Enter your authentication code',
    mfaChallengeSubtitle: 'Open your authenticator app and enter the current 6-digit code.',
    verify: 'Verify',

    // RestaurantDetailsForm
    restaurantDetailsTitle: 'Restaurant Details',
    restaurantDetailsSubtitle:
      "Thanks for joining! We'd love to get to know your restaurant — details are saved automatically as you go.",
    restaurantName: 'Restaurant name',
    address: 'Address',
    phone: 'Phone',
    hours: 'Operating hours',
    hoursPlaceholder: 'e.g. Sun-Thu 09:00-22:00, Fri 09:00-15:00',
    fillRequiredFields: 'Fill in name, address and phone to save',
    savedAsDraft: 'Saved as draft ✓',
    continue: 'Continue',
    wizardInProgressNote:
      "The remaining registration steps (initial menu, review & submit) are still being built — what you've filled in is saved and won't be lost.",

    // KosherStatusForm
    kosherStepTitle: 'Kosher Status',
    kosherStepSubtitle: "Optional — you can skip this and add it later.",
    kosherQuestion: 'Is the restaurant kosher-certified?',
    kosherYesUpload: 'Yes, I have a certificate',
    kosherSkip: 'Skip for now',
    kosherUploadLabel: 'Upload kosher certificate (JPG, PNG, or PDF, up to 10MB)',
    kosherUploading: 'Uploading…',
    kosherCertified: 'Restaurant is kosher-certified ✓',
    kosherRemove: 'Remove certificate',
    kosherFileTooLarge: 'File is larger than 10MB',
    kosherUnsupportedType: 'Unsupported file format (JPG, PNG, or PDF only)',
    // Fixed disclaimer, Content Guidelines §7.2א — not restaurant-editable,
    // do not reword.
    kosherDisclaimer:
      'This information is self-declared by the restaurant and is not verified by Feedbook; for further details, please check directly with restaurant staff or the certifying authority.',

    // SetNewPassword
    setNewPasswordTitle: 'Choose a new password',
    setNewPasswordSubtitle: 'Choose a new password for your account.',
    newPassword: 'New password',
    confirmPassword: 'Confirm password',
    passwordsDontMatch: "Passwords don't match",
    updatePassword: 'Update password',

    // Dashboard
    signedInAs: 'Signed in as',
    statusDraft: 'Draft',
    statusPendingReview: 'Pending Review',
    statusApproved: 'Approved',
    statusRejected: 'Rejected',
    dashboardComingSoon: 'Menu, table, and order management are still being built — they will be added here soon.',

    // WizardStepper
    stepRestaurantDetails: 'Restaurant Details',
    stepKosher: 'Kosher Status',
    stepMenu: 'Menu',
    stepReview: 'Review & Agreement',
  },
} as const;

export type TranslationKey = keyof (typeof translations)['he'];

// Compile-time guarantee that he and en declare exactly the same keys. This
// is exactly the bug class that caused the original language-inconsistency
// report: a key present in one language's object but not the other used to
// silently render `undefined` at runtime instead of failing the build.
type HeKeys = keyof (typeof translations)['he'];
type EnKeys = keyof (typeof translations)['en'];
type MissingInEn = Exclude<HeKeys, EnKeys>;
type ExtraInEn = Exclude<EnKeys, HeKeys>;
const _assertNoMissingInEn: [MissingInEn] extends [never] ? true : ['keys missing from en:', MissingInEn] = true;
const _assertNoExtraInEn: [ExtraInEn] extends [never] ? true : ['extra keys in en not in he:', ExtraInEn] = true;
void _assertNoMissingInEn;
void _assertNoExtraInEn;

export default translations;
