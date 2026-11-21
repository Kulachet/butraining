/**
 * ============================================================================
 * BANGKOK UNIVERSITY — LEARNING DEVELOPMENT OFFICE (LDO)
 * STANDALONE COURSE PROMOTION EMAIL CAMPAIGN GATEWAY (GAS_PROMOTION_CODE.gs)
 * ============================================================================
 *
 * Dedicated Google Apps Script Web App for MODULE 22 promotional campaigns.
 * Completely separated from registration/evaluation/report GAS deployments.
 *
 * SECURITY & RELIABILITY FEATURES:
 * 1. Shared Secret Auth: Validates `data.secretToken` against Script Property
 *    `INTERNAL_PROMOTION_SECRET` (with fallback to `INTERNAL_WEBHOOK_SECRET`).
 * 2. Strict Domain Guard: Enforces `@bu.ac.th` domain before MailApp invocation.
 * 3. Quota Guard: Calls `MailApp.getRemainingDailyQuota()` before batch start
 *    AND prior to every single recipient email.
 * 4. Individual Delivery: Sends one separate email per recipient (`to: msg.to`)
 *    so recipient lists are never exposed in To/CC/BCC.
 * 5. Inline CID Poster Attachment: Attaches decoded poster image via
 *    `MailApp.sendEmail({ inlineImages: { coursePoster: blob } })` so posters
 *    display cleanly without embedding giant Base64 strings inside HTML.
 * 6. Time-Budget Guard: Stops safely before ~18 seconds so Netlify Functions
 *    receive explicit per-recipient confirmation (`sent` / `failed` / `unattempted`)
 *    instead of timing out with ambiguous states.
 * 7. CacheService Idempotency: Skips immediate duplicate retries for 10 minutes.
 *
 * DEPLOYMENT:
 * 1. Create a NEW Google Apps Script project: "BU LDO - Course Promotion Gateway"
 * 2. Paste this file into Code.gs.
 * 3. Project Settings -> Script Properties -> Add:
 *    - Key: INTERNAL_PROMOTION_SECRET
 *    - Value: <same 32+ char secret configured in Netlify GAS_PROMOTION_SECRET>
 * 4. Deploy -> New deployment -> Web app:
 *    - Execute as: Me (authorized @bu.ac.th Workspace sender)
 *    - Who has access: Anyone
 * 5. Set in Netlify Environment Variables:
 *    - GAS_PROMOTION_URL=<Web App URL>
 *    - GAS_PROMOTION_SECRET=<Secret value>
 * ============================================================================
 */

function doPost(e) {
  var startMs = new Date().getTime();
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ status: "error", code: "EMPTY_BODY", message: "Empty request body" });
    }

    var data = JSON.parse(e.postData.contents);

    var props = PropertiesService.getScriptProperties();
    var expectedSecret =
      props.getProperty("INTERNAL_PROMOTION_SECRET") ||
      props.getProperty("INTERNAL_WEBHOOK_SECRET");

    if (!expectedSecret) {
      return jsonResponse({
        status: "error",
        code: "GATEWAY_UNCONFIGURED",
        message: "INTERNAL_PROMOTION_SECRET is not configured in Apps Script Properties.",
      });
    }

    if (!data.secretToken || data.secretToken !== expectedSecret) {
      return jsonResponse({
        status: "error",
        code: "UNAUTHORIZED",
        message: "Unauthorized: Invalid or missing secretToken.",
      });
    }

    if (data.action === "check_quota") {
      return jsonResponse({
        status: "success",
        remainingDailyQuota: MailApp.getRemainingDailyQuota(),
      });
    }

    if (data.action !== "send_course_promotion") {
      return jsonResponse({
        status: "error",
        code: "INVALID_ACTION",
        message: "Unsupported action for Promotion GAS gateway.",
      });
    }

    return handleCoursePromotionBatch(data, startMs);
  } catch (err) {
    return jsonResponse({
      status: "error",
      code: "SCRIPT_ERROR",
      message: err ? err.toString() : "Unexpected promotion script error",
    });
  }
}

function handleCoursePromotionBatch(data, startMs) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return jsonResponse({
      status: "error",
      code: "LOCK_TIMEOUT",
      message: "Promotion gateway busy processing another request. Please retry in a moment.",
    });
  }

  try {
    var messages = data.messages || [];
    if (!messages.length) {
      return jsonResponse({
        status: "success",
        results: [],
        remainingDailyQuota: MailApp.getRemainingDailyQuota(),
      });
    }

    var remainingQuota = MailApp.getRemainingDailyQuota();
    if (remainingQuota < 1) {
      return jsonResponse({
        status: "error",
        code: "QUOTA_EXHAUSTED",
        remainingDailyQuota: remainingQuota,
        message: "Daily MailApp quota exhausted.",
      });
    }

    // Prepare inline CID poster blob once per batch (if present)
    var inlineImages = null;
    if (data.poster && data.poster.mode === "inline_cid" && data.poster.base64) {
      var decodedBytes = Utilities.base64Decode(data.poster.base64);
      var posterBlob = Utilities.newBlob(
        decodedBytes,
        data.poster.mimeType || "image/jpeg",
        data.poster.filename || "course_poster.jpg"
      );
      var cidKey = data.poster.cidName || "coursePoster";
      inlineImages = {};
      inlineImages[cidKey] = posterBlob;
    }

    var cache = CacheService.getScriptCache();
    var senderName = data.senderName || "Learning Development Office (LDO)";
    var campaignId = String(data.campaignId || "camp");
    var isTest = Boolean(data.isTest);
    var MAX_EXECUTION_BUDGET_MS = 18000;
    var results = [];
    var quotaExhausted = false;

    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      var recId = String(msg.recipientId || ("idx_" + i));
      var toEmail = String(msg.to || "").trim().toLowerCase();

      // Guard elapsed time so Netlify serverless call never hits hard timeout mid-loop
      if (new Date().getTime() - startMs > MAX_EXECUTION_BUDGET_MS) {
        results.push({
          recipientId: recId,
          to: toEmail,
          status: "unattempted",
          error: "Stopped safely before server execution timeout (resumable)",
        });
        continue;
      }

      if (quotaExhausted || MailApp.getRemainingDailyQuota() < 1) {
        quotaExhausted = true;
        results.push({
          recipientId: recId,
          to: toEmail,
          status: "unattempted",
          error: "Daily MailApp quota depleted",
        });
        continue;
      }

      if (!isAuthorizedBuEmailGas(toEmail)) {
        results.push({
          recipientId: recId,
          to: toEmail,
          status: "skipped",
          error: "Rejected non-@bu.ac.th recipient",
        });
        continue;
      }

      var cacheKey = "promo_" + campaignId + "_" + recId;
      if (!isTest && cache.get(cacheKey) === "sent") {
        results.push({
          recipientId: recId,
          to: toEmail,
          status: "sent",
          sentAt: new Date().toISOString(),
          duplicateGuard: true,
        });
        continue;
      }

      try {
        var mailOptions = {
          to: toEmail,
          subject: String(msg.subject || ""),
          body: String(msg.textBody || ""),
          htmlBody: String(msg.htmlBody || ""),
          name: senderName,
        };
        if (inlineImages) {
          mailOptions.inlineImages = inlineImages;
        }

        MailApp.sendEmail(mailOptions);

        if (!isTest) {
          cache.put(cacheKey, "sent", 600);
        }

        results.push({
          recipientId: recId,
          to: toEmail,
          status: "sent",
          sentAt: new Date().toISOString(),
        });
      } catch (sendErr) {
        results.push({
          recipientId: recId,
          to: toEmail,
          status: "failed",
          error: sendErr ? sendErr.toString() : "MailApp.sendEmail failed",
        });
      }
    }

    return jsonResponse({
      status: "success",
      results: results,
      quotaExhausted: quotaExhausted,
      remainingDailyQuota: MailApp.getRemainingDailyQuota(),
    });
  } finally {
    try {
      lock.releaseLock();
    } catch (unlockErr) {
      // Ignore lock release failure
    }
  }
}

function isAuthorizedBuEmailGas(email) {
  if (!email) return false;
  return /^[a-z0-9._%+-]+@bu\.ac\.th$/i.test(String(email).trim());
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
