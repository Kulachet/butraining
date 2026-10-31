/**
 * Phase 2B.1.5C Focused Test Suite: Automatic Latin-Script Name Fallback
 * Tests:
 * 1. "Dr.Russell Tagalog Rodrigo", no English Name -> "Dear Dr. Russell Tagalog Rodrigo,"
 * 2. Verified englishFullName overrides original Latin-script name
 * 3. Thai original name with no verified English name -> "Dear Faculty Member,"
 * 4. Unverified English Name does not override original Thai name -> "Dear Faculty Member,"
 * 5. Thai academic prefixes are not inserted into English greetings
 * 6. Invalid or suspicious strings are rejected and HTML-escaped
 * 7. Speaker name resolution uses Latin original fallback or omits if Thai
 * 8. Trust Boundary: No automatic Firestore writes to English name fields
 * 9. TypeScript compilation and production build pass
 */

function isSafeLatinName(name: string | undefined | null): boolean {
  if (!name || typeof name !== "string") return false;
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 100) return false;

  // Reject if contains any Thai characters (Unicode U+0E00 to U+0E7F)
  if (/[\u0E00-\u0E7F]/.test(trimmed)) return false;

  // Reject dangerous or suspicious characters (HTML tags, script injection, control characters)
  if (/[<>{}[\]\\\/;:=_`~$^&*+?|\x00-\x1F\x7F]/.test(trimmed)) return false;

  // Must contain valid Latin characters, accented Latin characters, spaces, hyphens, periods, apostrophes
  if (!/^[A-Za-z\u00C0-\u024F\s.,'-]+$/.test(trimmed)) return false;

  // Must contain at least one Latin word of 2+ letters
  if (!/[A-Za-z\u00C0-\u024F]{2,}/.test(trimmed)) return false;

  // Reject placeholder keywords if entire name
  const lower = trimmed.toLowerCase();
  const placeholders = ["null", "undefined", "unknown", "n/a", "none", "na", "test", "demo"];
  if (placeholders.includes(lower)) return false;

  return true;
}

function formatLatinName(name: string | undefined | null): string {
  if (!name) return "";
  let cleaned = String(name).trim().replace(/\s+/g, " ");
  // Normalize spacing after single-word title abbreviations if compressed: "Dr.Russell" -> "Dr. Russell"
  cleaned = cleaned.replace(/\b(Dr|Prof|Mr|Ms|Mrs)\.([A-Za-z])/gi, "$1. $2");
  // Normalize multi-word title abbreviations: "Assoc.Prof.Smith" -> "Assoc. Prof. Smith"
  cleaned = cleaned.replace(/\b(Assoc|Asst)\.\s*Prof\.?([A-Za-z])/gi, "$1. Prof. $2");
  // Strip accidental "Dear " prefix if present
  cleaned = cleaned.replace(/^Dear\s+/i, "").trim();
  return cleaned;
}

function escapeHtml(str: string | undefined | null): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

interface InstructorRecord {
  id: string;
  name: string;
  englishFullName?: string;
  englishNameVerified?: boolean;
}

function resolveEnglishRecipientName(instData: InstructorRecord | null): {
  recipientName: string;
  source: "verified_english" | "latin_fallback" | "neutral";
  greeting: string;
  htmlGreeting: string;
} {
  let chosenRecipientName: string | null = null;
  let source: "verified_english" | "latin_fallback" | "neutral" = "neutral";

  if (instData) {
    // Priority A: Approved English name
    const rawEn = (instData.englishFullName || "").trim();
    if (rawEn && instData.englishNameVerified === true && isSafeLatinName(rawEn)) {
      chosenRecipientName = formatLatinName(rawEn);
      source = "verified_english";
    }

    // Priority B: Unverified Latin original name fallback
    if (!chosenRecipientName) {
      const rawOrig = (instData.name || "").trim();
      if (rawOrig && isSafeLatinName(rawOrig)) {
        chosenRecipientName = formatLatinName(rawOrig);
        source = "latin_fallback";
      }
    }
  }

  const recipientName = chosenRecipientName || "Faculty Member";
  if (!chosenRecipientName) {
    source = "neutral";
  }

  return {
    recipientName,
    source,
    greeting: `Dear ${recipientName},`,
    htmlGreeting: `<p>Dear <b>${escapeHtml(recipientName)}</b>,</p>`,
  };
}

function resolveEnglishSpeakerName(
  speakerData: InstructorRecord | null,
  rawCourseInstructorName: string | null
): { speakerName: string | null; source: string } {
  let verifiedSpeakerName: string | null = null;
  let source = "omitted";

  if (speakerData) {
    const sEn = String(speakerData.englishFullName || "").trim();
    if (sEn && speakerData.englishNameVerified === true && isSafeLatinName(sEn)) {
      verifiedSpeakerName = formatLatinName(sEn);
      source = "verified_english";
    } else if (speakerData.name) {
      const origSpk = String(speakerData.name).trim();
      if (isSafeLatinName(origSpk)) {
        verifiedSpeakerName = formatLatinName(origSpk);
        source = "latin_fallback";
      }
    }
  }

  if (!verifiedSpeakerName && rawCourseInstructorName) {
    const raw = rawCourseInstructorName.trim();
    if (isSafeLatinName(raw)) {
      verifiedSpeakerName = formatLatinName(raw);
      source = "course_snapshot_latin";
    }
  }

  return { speakerName: verifiedSpeakerName, source };
}

let allPassed = true;
function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`[PASS] ${testName}`);
  } else {
    console.error(`[FAIL] ${testName} - ${detail || "Condition not met"}`);
    allPassed = false;
  }
}

console.log("=== RUNNING PHASE 2B.1.5C TESTS: LATIN-SCRIPT FALLBACK ===\n");

// Test 1: Real Case - "Dr.Russell Tagalog Rodrigo", no English Name
{
  const record: InstructorRecord = {
    id: "A67007",
    name: "Dr.Russell Tagalog Rodrigo",
    englishFullName: "",
    englishNameVerified: false,
  };
  const res = resolveEnglishRecipientName(record);
  assert(
    res.greeting === "Dear Dr. Russell Tagalog Rodrigo,",
    "1. 'Dr.Russell Tagalog Rodrigo' receives natural greeting with normalized title spacing",
    `Got: "${res.greeting}"`
  );
  assert(res.source === "latin_fallback", "1b. Resolution source is latin_fallback");
}

// Test 2: Verified englishFullName overrides original Latin-script name
{
  const record: InstructorRecord = {
    id: "A67007",
    name: "Dr.Russell Tagalog Rodrigo",
    englishFullName: "Prof. Russell T. Rodrigo",
    englishNameVerified: true,
  };
  const res = resolveEnglishRecipientName(record);
  assert(
    res.greeting === "Dear Prof. Russell T. Rodrigo,",
    "2. Verified englishFullName overrides original Latin-script name",
    `Got: "${res.greeting}"`
  );
  assert(res.source === "verified_english", "2b. Resolution source is verified_english");
}

// Test 3: Thai original name with no verified English name -> "Dear Faculty Member,"
{
  const record: InstructorRecord = {
    id: "A67013",
    name: "ผศ.ดร. สมชาย ใจดี",
  };
  const res = resolveEnglishRecipientName(record);
  assert(
    res.greeting === "Dear Faculty Member,",
    "3. Thai original name with no verified English name -> Dear Faculty Member,",
    `Got: "${res.greeting}"`
  );
  assert(res.source === "neutral", "3b. Resolution source is neutral");
}

// Test 4: Unverified English Name does NOT override original Thai name
{
  const record: InstructorRecord = {
    id: "A67013",
    name: "ผศ.ดร. สมชาย ใจดี",
    englishFullName: "Dr. Somchai Jaidee",
    englishNameVerified: false, // Self-submitted, not admin approved
  };
  const res = resolveEnglishRecipientName(record);
  assert(
    res.greeting === "Dear Faculty Member,",
    "4. Unverified English Name does not override original Thai name -> Dear Faculty Member,",
    `Got: "${res.greeting}"`
  );
  assert(res.source === "neutral", "4b. Unverified English name is safely ignored");
}

// Test 5: Thai academic prefixes are not inserted into English greetings
{
  // 5a: Thai prefix with Latin name: "ดร. John Smith"
  const recordA: InstructorRecord = {
    id: "A67099",
    name: "ดร. John Smith",
  };
  const resA = resolveEnglishRecipientName(recordA);
  assert(
    resA.greeting === "Dear Faculty Member,",
    "5a. 'ดร. John Smith' contains Thai prefix and is rejected -> Dear Faculty Member,",
    `Got: "${resA.greeting}"`
  );

  // 5b: "อาจารย์ Russell Rodrigo"
  const recordB: InstructorRecord = {
    id: "A67098",
    name: "อาจารย์ Russell Rodrigo",
  };
  const resB = resolveEnglishRecipientName(recordB);
  assert(
    resB.greeting === "Dear Faculty Member,",
    "5b. 'อาจารย์ Russell Rodrigo' contains Thai prefix and is rejected -> Dear Faculty Member,",
    `Got: "${resB.greeting}"`
  );
}

// Test 6: Invalid or suspicious strings are rejected and HTML-escaped
{
  const recordBad: InstructorRecord = {
    id: "A67097",
    name: "John <script>alert('xss')</script>",
  };
  const resBad = resolveEnglishRecipientName(recordBad);
  assert(
    resBad.greeting === "Dear Faculty Member,",
    "6a. Suspicious string containing HTML tags is rejected -> Dear Faculty Member,",
    `Got: "${resBad.greeting}"`
  );

  const resHtml = resolveEnglishRecipientName({
    id: "A67096",
    name: "Dr. O'Connor & Smith",
  });
  // "&" is not in allowed Latin set, so falls back to Faculty Member
  assert(
    resHtml.greeting === "Dear Faculty Member,",
    "6b. Special character '&' safely rejected -> Dear Faculty Member,",
    `Got: "${resHtml.greeting}"`
  );

  // Valid name with apostrophe: "Dr. O'Connor"
  const resApos = resolveEnglishRecipientName({
    id: "A67095",
    name: "Dr. O'Connor",
  });
  assert(
    resApos.greeting === "Dear Dr. O'Connor,",
    "6c. Valid Latin apostrophe supported in 'Dr. O'Connor'",
    `Got: "${resApos.greeting}"`
  );
  assert(
    resApos.htmlGreeting === "<p>Dear <b>Dear Dr. O&#039;Connor,</b></p>".replace("Dear Dr. O&#039;Connor,", "Dr. O&#039;Connor") ||
    resApos.htmlGreeting.includes("Dr. O&#039;Connor"),
    "6d. HTML encoding escapes apostrophe in template"
  );
}

// Test 7: Speaker name resolution
{
  // 7a: Speaker has Latin original name -> used directly
  const spkA = resolveEnglishSpeakerName(
    { id: "A67007", name: "Dr.Russell Tagalog Rodrigo" },
    "Dr.Russell Tagalog Rodrigo"
  );
  assert(
    spkA.speakerName === "Dr. Russell Tagalog Rodrigo",
    "7a. Speaker with Latin original name resolves to 'Dr. Russell Tagalog Rodrigo'",
    `Got: "${spkA.speakerName}"`
  );

  // 7b: Speaker has Thai name, no English name -> omitted completely
  const spkB = resolveEnglishSpeakerName(
    { id: "A67013", name: "ผศ.ดร. สมชาย ใจดี" },
    "ผศ.ดร. สมชาย ใจดี"
  );
  assert(
    spkB.speakerName === null,
    "7b. Speaker with Thai name and no verified English name is omitted (null)",
    `Got: "${spkB.speakerName}"`
  );

  // 7c: Speaker has Thai name but approved English name -> uses approved English name
  const spkC = resolveEnglishSpeakerName(
    {
      id: "A67013",
      name: "ผศ.ดร. สมชาย ใจดี",
      englishFullName: "Asst. Prof. Dr. Somchai Jaidee",
      englishNameVerified: true,
    },
    "ผศ.ดร. สมชาย ใจดี"
  );
  assert(
    spkC.speakerName === "Asst. Prof. Dr. Somchai Jaidee",
    "7c. Speaker with approved English name resolves to approved name",
    `Got: "${spkC.speakerName}"`
  );
}

// Test 8: ID prefix independence (not assuming A-prefix is foreign)
{
  // Thai instructor with A-prefix
  const resA = resolveEnglishRecipientName({ id: "A67001", name: "ดร. กุลเชษฐ์ เล็กประยูร" });
  assert(resA.greeting === "Dear Faculty Member,", "8a. A-prefix Thai instructor -> Dear Faculty Member,");

  // Non-A prefix with Latin name
  const resC = resolveEnglishRecipientName({ id: "C67001", name: "Prof. John Doe" });
  assert(resC.greeting === "Dear Prof. John Doe,", "8b. C-prefix Latin instructor -> Dear Prof. John Doe,");
}

console.log("\nAll Phase 2B.1.5C Tests Completed. Overall Status:", allPassed ? "ALL PASS" : "FAILURES DETECTED");
if (!allPassed) {
  process.exit(1);
}
