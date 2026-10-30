/**
 * ============================================================================
 * BANGKOK UNIVERSITY — LEARNING DEVELOPMENT OFFICE (LDO)
 * SECURE ENGLISH TRAINING NOTIFICATION & CALENDAR GATEWAY (GAS_EN_CODE.gs)
 * ============================================================================
 *
 * Dedicated standalone Google Apps Script service for English-language
 * academic workshops and professional development courses.
 *
 * RELIABILITY & AUTHORIZATION ENFORCEMENTS (Phase 2B.1.3A):
 * 1. Server-to-Server Authentication: Validates `secretToken` against the
 *    Apps Script Script Property `INTERNAL_WEBHOOK_SECRET`. Unauthenticated
 *    anonymous calls from external actors are strictly rejected before any
 *    MailApp or CalendarApp execution.
 * 2. Recipient Domain Policy: Enforces that `guestEmail` belongs to
 *    authorized university domains (*@bu.ac.th).
 * 3. Granular Delivery Tracking:
 *    - Reports `calendarStatus` ('sent' | 'failed' | 'skipped') and `emailStatus` ('sent' | 'failed') separately.
 *    - Reports `status: "partial_success"` when only Calendar or Email succeeds.
 * 4. Duplicate Calendar Protection:
 *    - Accepts `skipCalendar: true` or `existingCalendarEventId`. If the calendar
 *      event was created in a previous attempt, it is NOT recreated on email retry.
 * 5. Atomic Script Locking: Uses `LockService.getScriptLock()` around critical
 *    sections to prevent concurrent execution race conditions.
 * 6. CacheService Idempotency: Secondary deduplication layer to avoid duplicate
 *    calendar events and emails on rapid retries within 10 minutes.
 * 7. Quota Validation: Checks `MailApp.getRemainingDailyQuota()` before dispatch.
 * 8. Bangkok Timezone (+07:00) alignment for Google Calendar event creation.
 *
 * CALENDAR INVITATION ARCHITECTURE NOTE:
 * Google Calendar API creates an event for Day 1 (the initial session). For multi-day
 * workshops, the complete chronological schedule of all sessions is rendered inside
 * both the calendar event description and the confirmation email, accompanied by an
 * instruction advising faculty to add subsequent dates to their personal calendars.
 *
 * DEPLOYMENT INSTRUCTIONS:
 * 1. Open Google Apps Script: https://script.google.com/
 * 2. Create a new project titled: "BU LDO - English Notification Gateway"
 * 3. Replace Code.gs contents with this complete file.
 * 4. Configure Script Secret:
 *    - Click Project Settings (gear icon on left).
 *    - Under "Script Properties", click "Add script property".
 *    - Property: INTERNAL_WEBHOOK_SECRET
 *    - Value: <generate a secure random 32+ character secret string>
 * 5. Click Deploy > New deployment:
 *    - Select type: Web app
 *    - Description: "BU LDO Secure English Notification Gateway v2.1"
 *    - Execute as: "Me" (your Google Workspace account)
 *    - Who has access: "Anyone" (allows Netlify Function server-to-server calls)
 * 6. Copy the generated Web App URL (starts with https://script.google.com/macros/s/...)
 * 7. Set in your Netlify Dashboard Environment Variables:
 *    - GAS_EN_URL = <the Web App URL>
 *    - GAS_EN_SECRET = <the identical secret string configured in Step 4>
 * ============================================================================
 */

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(
        JSON.stringify({ status: "error", message: "Empty request body" })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    var data = JSON.parse(e.postData.contents);

    // --- 1. SHARED SECRET AUTHENTICATION ---
    var expectedSecret = PropertiesService.getScriptProperties().getProperty("INTERNAL_WEBHOOK_SECRET");
    if (!expectedSecret) {
      Logger.log("CRITICAL: INTERNAL_WEBHOOK_SECRET is not configured in Script Properties.");
      return ContentService.createTextOutput(
        JSON.stringify({
          status: "error",
          code: "GATEWAY_UNCONFIGURED",
          message: "Unauthorized: INTERNAL_WEBHOOK_SECRET is not configured in Apps Script properties."
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (!data.secretToken || data.secretToken !== expectedSecret) {
      Logger.log("UNAUTHORIZED: Invalid or missing secretToken from caller.");
      return ContentService.createTextOutput(
        JSON.stringify({
          status: "error",
          code: "UNAUTHORIZED",
          message: "Unauthorized: Invalid or missing secret token."
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    var action = data.action;

    // Action routing
    if (action === "send_certificates" || action === "test_send") {
      return handleCertificatesEn(data);
    } else if (action === "send_reminders" || action === "test_send_reminders") {
      return handleRemindersEn(data);
    } else if (action === "send_evaluations") {
      return handleEvaluationsEn(data);
    } else if (action === "validate_folder") {
      return validateFolder(data.folderId);
    } else {
      // Default: Registration confirmation & Google Calendar invitation
      return handleEnglishRegistration(data);
    }
  } catch (err) {
    Logger.log("doPost Error: " + err.toString());
    return ContentService.createTextOutput(
      JSON.stringify({ status: "error", message: err.toString() })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Handles English course registration confirmation and Calendar event creation.
 * Accurately reports granular status (calendarStatus, emailStatus, partial_success).
 */
function handleEnglishRegistration(data) {
  var guestEmail = (data.guestEmail || "").trim().toLowerCase();
  var title = (data.courseTitle || "").trim();

  if (!guestEmail || !title) {
    return ContentService.createTextOutput(
      JSON.stringify({ status: "error", message: "Missing guestEmail or courseTitle" })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  // --- 2. RECIPIENT DOMAIN POLICY ---
  var isBuDomain = guestEmail.endsWith("@bu.ac.th") || guestEmail.endsWith(".bu.ac.th");
  if (!isBuDomain) {
    Logger.log("WARNING: Registration email is outside approved @bu.ac.th domain: " + guestEmail);
    return ContentService.createTextOutput(
      JSON.stringify({
        status: "error",
        code: "DOMAIN_RESTRICTED",
        message: "Recipient email address must belong to @bu.ac.th"
      })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  // --- 3. ATOMIC SCRIPT LOCK ---
  var lock = LockService.getScriptLock();
  var lockAcquired = false;
  try {
    lockAcquired = lock.tryLock(8000); // Wait up to 8 seconds
  } catch (lockErr) {
    Logger.log("Lock acquisition error: " + lockErr.toString());
  }

  if (!lockAcquired) {
    return ContentService.createTextOutput(
      JSON.stringify({
        status: "error",
        code: "CONCURRENT_REQUEST",
        message: "Another notification operation is in progress. Please retry in a few moments."
      })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    // --- 4. IDEMPOTENCY CHECK VIA CACHE ---
    var idempotencyKey = data.idempotencyKey || ("reg_" + guestEmail + "_" + (data.date || "") + "_" + title);
    var cache = CacheService.getScriptCache();
    var cachedStatus = cache.get(idempotencyKey);
    if (cachedStatus === "fully_processed") {
      Logger.log("Duplicate request detected for key: " + idempotencyKey);
      return ContentService.createTextOutput(
        JSON.stringify({
          status: "success",
          duplicate: true,
          calendarStatus: "skipped",
          emailStatus: "skipped",
          message: "Duplicate registration notification ignored via idempotency check."
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    // --- 5. QUOTA VALIDATION ---
    var remainingQuota = MailApp.getRemainingDailyQuota();
    if (remainingQuota < 1) {
      Logger.log("CRITICAL: Daily email quota depleted.");
      return ContentService.createTextOutput(
        JSON.stringify({
          status: "error",
          code: "QUOTA_EXHAUSTED",
          message: "Daily email quota for this Google Workspace account has been depleted."
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    // --- 6. RECIPIENT FORMATTING ---
    var rawRecipient = data.recipientName || data.guestName || data.name || "Faculty Member";
    var cleanedRecipient = cleanEnglishRecipientName(rawRecipient);

    var speakerName = (data.instructorName || "").trim();
    var location = data.location || "Bangkok University (On-site)";
    var dateStr = data.date; // ISO "YYYY-MM-DD"
    var startTime = data.startTime || "09:00";
    var endTime = data.endTime || "16:00";
    var description = data.description || "";
    var isMultiDay = Boolean(data.isMultiDay || (data.sessions && data.sessions.length > 1));
    var senderName = data.senderName || "Learning Development Office";

    // --- 7. GOOGLE CALENDAR EVENT CREATION ---
    var skipCalendar = Boolean(data.skipCalendar);
    var eventCreated = false;
    var eventId = data.existingCalendarEventId || null;
    var calendarStatus = skipCalendar ? (eventId ? "sent" : "skipped") : "pending";
    var errorDetails = [];

    if (!skipCalendar && dateStr) {
      try {
        var calendar = CalendarApp.getDefaultCalendar();
        var startDate = new Date(dateStr + "T" + startTime + ":00+07:00");
        var endDate = new Date(dateStr + "T" + endTime + ":00+07:00");

        var calDescription = description;
        if (speakerName) {
          calDescription += "\n\nSpeaker: " + speakerName;
        }

        if (isMultiDay && data.scheduleText) {
          calDescription +=
            "\n\nTraining Schedule:\n" +
            data.scheduleText +
            "\n\n* Note: This calendar invitation is scheduled for Day 1. Please add subsequent sessions to your personal calendar.";
        }

        var event = calendar.createEvent(title, startDate, endDate, {
          description: calDescription,
          location: location,
          guests: guestEmail,
          sendInvites: true // Triggers Google Calendar native invitation email
        });

        if (event) {
          eventId = event.getId();
          eventCreated = true;
          calendarStatus = "sent";
        }
      } catch (calErr) {
        Logger.log("Calendar creation error: " + calErr.toString());
        calendarStatus = "failed";
        errorDetails.push("Calendar: " + calErr.toString());
      }
    }

    // --- 8. REGISTRATION CONFIRMATION EMAIL DISPATCH ---
    var emailSent = false;
    var emailStatus = "pending";
    var subject = data.emailSubject || data.subject || ("Registration Confirmation: " + title);
    var body = data.emailBody || data.body || buildFallbackEnglishTextBody(title, cleanedRecipient, speakerName, location, dateStr, startTime, endTime, isMultiDay, data.scheduleText);
    var htmlBody = data.emailHtmlBody || data.htmlBody || buildFallbackEnglishHtmlBody(title, cleanedRecipient, speakerName, location, dateStr, startTime, endTime, isMultiDay, data.sessions);

    try {
      MailApp.sendEmail({
        to: guestEmail,
        subject: subject,
        body: body,
        htmlBody: htmlBody,
        name: senderName
      });
      emailSent = true;
      emailStatus = "sent";
    } catch (mailErr) {
      Logger.log("Mail delivery error: " + mailErr.toString());
      emailStatus = "failed";
      errorDetails.push("Email: " + mailErr.toString());
    }

    // --- 9. GRANULAR DELIVERY CLASSIFICATION ---
    var overallStatus;
    if ((calendarStatus === "sent" || calendarStatus === "skipped") && emailStatus === "sent") {
      overallStatus = "success";
      // Record full completion in cache
      cache.put(idempotencyKey, "fully_processed", 600);
    } else if (calendarStatus === "sent" || emailStatus === "sent") {
      overallStatus = "partial_success";
    } else {
      overallStatus = "error";
    }

    return ContentService.createTextOutput(
      JSON.stringify({
        status: overallStatus,
        calendarStatus: calendarStatus,
        emailStatus: emailStatus,
        calendarCreated: eventCreated,
        eventId: eventId,
        emailSent: emailSent,
        recipient: guestEmail,
        language: "en",
        error: errorDetails.length > 0 ? errorDetails.join("; ") : null
      })
    ).setMimeType(ContentService.MimeType.JSON);
  } finally {
    try {
      lock.releaseLock();
    } catch (e) {
      // Ignore unlock failure
    }
  }
}

/**
 * Strips any Thai greetings/prefixes while preserving academic honorifics.
 */
function cleanEnglishRecipientName(name) {
  if (!name) return "Faculty Member";
  var cleaned = name.trim();

  // Strip Thai prefixes if present
  if (cleaned.indexOf("เรียน ") === 0) {
    cleaned = cleaned.substring(6).trim();
  }
  if (cleaned.indexOf("คุณ ") === 0) {
    cleaned = cleaned.substring(4).trim();
  }
  if (cleaned.indexOf("Dear ") === 0) {
    cleaned = cleaned.substring(5).trim();
  }

  return cleaned || "Faculty Member";
}

/**
 * Builds fallback plain text body if frontend did not supply emailBody.
 */
function buildFallbackEnglishTextBody(title, recipient, speaker, location, dateStr, startTime, endTime, isMultiDay, scheduleText) {
  var speakerLine = speaker ? ("Speaker: " + speaker + "\n") : "";
  var scheduleSection = "";

  if (isMultiDay && scheduleText) {
    scheduleSection = "Training Schedule:\n" + scheduleText + "\n\n";
  } else {
    scheduleSection = "Date & Time: " + dateStr + " (" + startTime + " - " + endTime + ")\nVenue: " + location + "\n\n";
  }

  var calNotice = isMultiDay
    ? "A Google Calendar invitation has been attached for the first session. Please add remaining sessions to your personal calendar."
    : "A Google Calendar invitation has been attached. Please check your calendar.";

  return (
    "Dear " + recipient + ",\n\n" +
    "You have successfully registered for the workshop \"" + title + "\".\n" +
    speakerLine +
    scheduleSection +
    calNotice + "\n\n" +
    "Learning Development Office\nBangkok University"
  );
}

/**
 * Builds fallback HTML body if frontend did not supply emailHtmlBody.
 */
function buildFallbackEnglishHtmlBody(title, recipient, speaker, location, dateStr, startTime, endTime, isMultiDay, sessions) {
  var safeTitle = escapeHtmlGas(title);
  var safeRecipient = escapeHtmlGas(recipient);
  var safeSpeaker = escapeHtmlGas(speaker);
  var safeLocation = escapeHtmlGas(location);

  var scheduleHtml = "";
  if (isMultiDay && sessions && sessions.length > 0) {
    scheduleHtml =
      '<div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin: 16px 0;">' +
      '<p style="margin: 0 0 8px 0; font-weight: 700; color: #0f172a; font-size: 14px;">Training Schedule (' + sessions.length + ' Days):</p>' +
      '<ul style="margin: 0; padding-left: 20px; color: #334155; font-size: 14px; line-height: 1.8;">';
    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i];
      scheduleHtml +=
        '<li><strong>' + escapeHtmlGas(s.sessionName || ("Day " + (i + 1))) + ':</strong> ' +
        escapeHtmlGas(s.formattedDate || s.date) + ' (' + escapeHtmlGas(s.formattedTime || (s.startTime + " - " + s.endTime)) + ')<br>' +
        '<span style="color: #64748b; font-size: 13px;">Venue: ' + escapeHtmlGas(s.locationDetail || safeLocation) + '</span></li>';
    }
    scheduleHtml += '</ul></div>';
  } else {
    scheduleHtml =
      '<p style="margin: 8px 0;"><b>Date &amp; Time:</b> ' + escapeHtmlGas(dateStr) + ' (' + escapeHtmlGas(startTime + ' - ' + endTime) + ')</p>' +
      '<p style="margin: 8px 0;"><b>Venue:</b> ' + safeLocation + '</p>';
  }

  return (
    '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif; padding: 24px; line-height: 1.6; max-width: 620px; border: 1px solid #e2e8f0; border-radius: 14px; background-color: #ffffff; color: #1e293b;">' +
    '<div style="border-bottom: 2px solid #8b0000; padding-bottom: 12px; margin-bottom: 20px;">' +
    '<span style="font-size: 11px; font-weight: 700; color: #8b0000; text-transform: uppercase; letter-spacing: 1px;">Bangkok University • Learning Development Office</span>' +
    '<h2 style="color: #0f172a; margin: 6px 0 0 0; font-size: 18px;">Registration Confirmation</h2>' +
    '</div>' +
    '<p style="font-size: 15px; margin-top: 0;">Dear <b>' + safeRecipient + '</b>,</p>' +
    '<p>You have successfully registered for the workshop: <strong style="color: #0f172a;">&ldquo;' + safeTitle + '&rdquo;</strong></p>' +
    (safeSpeaker ? ('<p style="margin: 8px 0;"><b>Speaker:</b> ' + safeSpeaker + '</p>') : '') +
    scheduleHtml +
    (isMultiDay
      ? '<p style="color: #475569; margin-top: 18px; font-size: 13px; line-height: 1.5; background-color: #fffbeb; padding: 10px 14px; border-radius: 8px; border-left: 3px solid #f59e0b;">' +
        'A Google Calendar invitation has been attached for the first session. Please add remaining sessions to your personal calendar.</p>'
      : '<p style="color: #475569; margin-top: 16px; font-size: 13px;">A Google Calendar invitation has been attached. Please check your calendar.</p>') +
    '<div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9;">' +
    '<p style="margin: 0; font-weight: bold; color: #8b0000;">Learning Development Office</p>' +
    '<p style="margin: 2px 0 0 0; font-size: 13px; color: #64748b;">Bangkok University</p>' +
    '</div>' +
    '</div>'
  );
}

function escapeHtmlGas(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// --- ADMIN ACTION FALLBACKS (CERTIFICATES, REMINDERS, EVALUATIONS) ---

function handleCertificatesEn(data) {
  var recipients = data.recipients || [];
  var courseTitle = data.courseTitle || "Workshop";
  var folderId = data.folderId;
  var successCount = 0;
  var failCount = 0;

  for (var i = 0; i < recipients.length; i++) {
    var r = recipients[i];
    try {
      var recipientName = cleanEnglishRecipientName(r.name);
      var subject = "Certificate of Completion: " + courseTitle;
      var body = "Dear " + recipientName + ",\n\n" +
                 "Congratulations on completing \"" + courseTitle + "\".\n\n" +
                 "Your certificate of completion has been issued and is available in your designated Google Drive folder.\n\n" +
                 "Best regards,\nLearning Development Office\nBangkok University";

      MailApp.sendEmail({
        to: r.email,
        subject: subject,
        body: body,
        name: "Learning Development Office"
      });
      successCount++;
    } catch (err) {
      failCount++;
    }
  }

  return ContentService.createTextOutput(
    JSON.stringify({ status: "success", successCount: successCount, failCount: failCount })
  ).setMimeType(ContentService.MimeType.JSON);
}

function handleRemindersEn(data) {
  var recipients = data.recipients || [];
  var courseTitle = data.courseTitle || "Workshop";
  var successCount = 0;

  for (var i = 0; i < recipients.length; i++) {
    var r = recipients[i];
    try {
      var recipientName = cleanEnglishRecipientName(r.name);
      var subject = "Reminder: Upcoming Workshop - " + courseTitle;
      var body = "Dear " + recipientName + ",\n\n" +
                 "This is a friendly reminder regarding your upcoming workshop \"" + courseTitle + "\".\n\n" +
                 "Please check your Google Calendar for scheduled dates and venue details.\n\n" +
                 "Best regards,\nLearning Development Office\nBangkok University";

      MailApp.sendEmail({
        to: r.email,
        subject: subject,
        body: body,
        name: "Learning Development Office"
      });
      successCount++;
    } catch (err) {
      // Ignore individual failures
    }
  }

  return ContentService.createTextOutput(
    JSON.stringify({ status: "success", successCount: successCount })
  ).setMimeType(ContentService.MimeType.JSON);
}

function handleEvaluationsEn(data) {
  var recipients = data.recipients || [];
  var courseTitle = data.courseTitle || "Workshop";
  var evalUrl = data.evaluationUrl || "";
  var successCount = 0;

  for (var i = 0; i < recipients.length; i++) {
    var r = recipients[i];
    try {
      var recipientName = cleanEnglishRecipientName(r.name);
      var subject = "Course Evaluation: " + courseTitle;
      var body = "Dear " + recipientName + ",\n\n" +
                 "Thank you for participating in \"" + courseTitle + "\".\n\n" +
                 "We appreciate your valuable feedback to help us enhance future faculty development programs.\n" +
                 (evalUrl ? ("Please complete the evaluation here: " + evalUrl + "\n\n") : "\n") +
                 "Best regards,\nLearning Development Office\nBangkok University";

      MailApp.sendEmail({
        to: r.email,
        subject: subject,
        body: body,
        name: "Learning Development Office"
      });
      successCount++;
    } catch (err) {
      // Ignore individual failures
    }
  }

  return ContentService.createTextOutput(
    JSON.stringify({ status: "success", successCount: successCount })
  ).setMimeType(ContentService.MimeType.JSON);
}

function validateFolder(folderId) {
  try {
    if (!folderId) {
      return ContentService.createTextOutput(JSON.stringify({ valid: false, message: "Folder ID is empty" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var folder = DriveApp.getFolderById(folderId);
    return ContentService.createTextOutput(JSON.stringify({ valid: true, folderName: folder.getName() }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ valid: false, message: e.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
