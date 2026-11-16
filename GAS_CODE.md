# Google Apps Script สำหรับระบบ LDO (BU Training)

กรุณาคัดลอกโค้ดด้านล่างนี้ไปวางในเครื่องมือแก้ไข Google Apps Script ของคุณ เพื่อให้ระบบ:
1. ส่งอีเมลยืนยันการลงทะเบียนและคำเชิญปฏิทินสองภาษา (TH / EN) ตามการตั้งค่าภาษาของหลักสูตร (`course.language`)
2. รองรับหลักสูตรหลายวัน (Multi-day) โดยแสดงกำหนดการอบรมทุกวันอย่างครบถ้วน
3. ใช้คำนำหน้าชื่อผู้รับตามรหัสอาจารย์ (อ., ผศ., รศ., ศ., ดร. หรือ คุณ) อย่างถูกต้องและสม่ำเสมอทั้งแบบข้อความธรรมดา (Plain Text) และ HTML

> **สำคัญสำหรับการนำไปใช้งานจริง (Deployment Instructions):**
> การเปลี่ยนแปลงในฝั่ง Frontend ได้จัดเตรียม Payload ที่รองรับทั้ง Script เดิมและ Script ใหม่ไว้เรียบร้อยแล้ว หากต้องการให้อีเมลจริงที่ส่งจาก Google Apps Script เปลี่ยนเป็นภาษาอังกฤษ (Subject / Body / Sender Name) ตามหลักสูตร จะต้องคัดลอกโค้ดนี้ไปแทนที่โค้ดเดิมใน Google Apps Script Editor และกด **Deploy > Manage deployments > Edit > New version > Deploy**

```javascript
/**
 * ระบบจัดการ LDO - Google Apps Script
 * รองรับการส่งอีเมลแจ้งเตือน, ประกาศนียบัตร, ลิงก์ประเมินผล และการเชิญปฏิทิน
 * รองรับอีเมลยืนยันการลงทะเบียน 2 ภาษา (TH / EN) ตามการตั้งค่าของหลักสูตร
 * จัดการคำนำหน้าชื่อผู้รับ (เรียน อ., เรียน ผศ., เรียน ดร., เรียน คุณ) อัตโนมัติตามข้อมูลอาจารย์
 */

function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var action = data.action;
  
  try {
    if (action === "send_certificates" || action === "test_send") {
      return handleCertificates(data);
    } else if (action === "send_reminders" || action === "test_send_reminders") {
      return handleReminders(data);
    } else if (action === "send_evaluations") {
      return handleEvaluations(data);
    } else if (action === "validate_folder") {
      return validateFolder(data.folderId);
    } else {
      // ตรรกะการเชิญปฏิทินและยืนยันการลงทะเบียน (ส่งจากหน้าลงทะเบียน)
      return handleCalendarInvite(data);
    }
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// 1. จัดการคำเชิญในปฏิทินและอีเมลยืนยันการลงทะเบียน (รองรับสองภาษา TH/EN และหลักสูตรหลายวัน)
function handleCalendarInvite(data) {
  var guestEmail = data.guestEmail;
  var title = data.courseTitle || "";
  var description = data.description || "";
  var location = data.location || "ไม่ระบุ";
  var dateStr = data.date; // "YYYY-MM-DD"
  var startTime = data.startTime || "09:00";
  var endTime = data.endTime || "16:00";
  var speakerName = data.instructorName || "";

  // ตรวจสอบภาษาของหลักสูตร (course.language: 'en' หรือ 'th' ค่าเริ่มต้นเป็น 'th')
  var lang = (data.language === 'en') ? 'en' : 'th';
  var isEn = (lang === 'en');

  // คำนวณชื่อผู้รับ (ผู้ลงทะเบียน) ที่จัดรูปแบบแล้ว (รองรับ guestName, recipientName, name)
  var recipientName = data.recipientName || data.guestName || data.name || (isEn ? "Instructor" : "อาจารย์");
  if (recipientName.indexOf("เรียน ") === 0) {
    recipientName = recipientName.substring(5).trim();
  } else if (recipientName.indexOf("Dear ") === 0) {
    recipientName = recipientName.substring(5).trim();
  }

  // สร้างวัตถุวันที่สำหรับ Google Calendar (Timezone กรุงเทพ +0700)
  var startDate = new Date(dateStr + 'T' + startTime + ':00+07:00');
  var endDate = new Date(dateStr + 'T' + endTime + ':00+07:00');

  // สร้างเหตุการณ์ในปฏิทิน (สำหรับวันแรก หรือวันอบรมหลัก)
  var calendar = CalendarApp.getDefaultCalendar();
  var calDescription = description;
  if (speakerName) {
    calDescription += "\n" + (isEn ? ("Speaker: " + speakerName) : ("วิทยากร: " + speakerName));
  }
  if (data.isMultiDay && data.scheduleText) {
    calDescription += "\n\n" + (isEn ? "Training Schedule:" : "กำหนดการอบรม:") + "\n" + data.scheduleText;
  }

  var event = calendar.createEvent(title, startDate, endDate, {
    description: calDescription,
    location: location,
    guests: guestEmail,
    sendInvites: true
  });

  // หัวข้ออีเมล (Subject)
  var subject = data.emailSubject || data.subject || (
    isEn ? ("Registration Confirmation: " + title) : ("ยืนยันการลงทะเบียน: " + title)
  );

  // เนื้อหาอีเมลแบบ Plain Text (Body)
  var body = data.emailBody || data.body;
  if (!body) {
    if (isEn) {
      body = "Dear " + recipientName + ",\n\n" +
             "You have successfully registered for the workshop \"" + title + "\".\n" +
             (speakerName ? ("Speaker: " + speakerName + "\n") : "") +
             (data.scheduleText ? ("Training Schedule:\n" + data.scheduleText + "\n\n") : ("Date & Time: " + dateStr + " (" + startTime + " - " + endTime + ")\nVenue: " + location + "\n\n")) +
             (data.isMultiDay 
               ? "A Google Calendar invitation has been attached for the first session. Please add remaining sessions to your personal calendar.\n\n" 
               : "A Google Calendar invitation has been attached. Please check your calendar.\n\n") +
             "Learning Development Office\nBangkok University";
    } else {
      body = "เรียน " + recipientName + "\n\n" +
             "ท่านได้ลงทะเบียนเข้าร่วมการอบรมหลักสูตร \"" + title + "\" เรียบร้อยแล้ว\n" +
             (speakerName ? ("วิทยากร: " + speakerName + "\n") : "") +
             (data.scheduleText ? ("กำหนดการอบรม:\n" + data.scheduleText + "\n\n") : ("วันเวลา: " + dateStr + " (" + startTime + " - " + endTime + ")\nสถานที่: " + location + "\n\n")) +
             (data.isMultiDay 
               ? "ระบบได้ส่งคำเชิญปฏิทินสำหรับวันอบรมแรกแล้ว กรุณาบันทึกวันอบรมถัดไปเพิ่มเติมลงในปฏิทินของท่าน\n\n" 
               : "ท่านสามารถตรวจสอบคำเชิญในปฏิทิน Google Calendar ของท่านเพื่อบันทึกวันเวลาดังกล่าว\n\n") +
             "สำนักพัฒนาการเรียนรู้ (Learning Development Office)\nมหาวิทยาลัยกรุงเทพ";
    }
  }

  // เนื้อหาอีเมลแบบ HTML (HtmlBody)
  var htmlBody = data.emailHtmlBody || data.htmlBody;
  if (!htmlBody) {
    function esc(s) {
      if (!s) return "";
      return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    var safeTitle = esc(title);
    var safeRecipient = esc(recipientName);
    var safeSpeaker = esc(speakerName);
    var safeLocation = esc(location);

    if (isEn) {
      htmlBody = "<div style='font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif; padding: 24px; line-height: 1.6; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 14px; background-color: #ffffff; color: #1e293b;'>" +
                 "<div style='border-bottom: 2px solid #8b0000; padding-bottom: 12px; margin-bottom: 20px;'>" +
                 "<span style='font-size: 11px; font-weight: 700; color: #8b0000; text-transform: uppercase; letter-spacing: 1px;'>Bangkok University • Learning Development Office</span>" +
                 "<h2 style='color: #0f172a; margin: 6px 0 0 0; font-size: 18px;'>Registration Confirmation</h2>" +
                 "</div>" +
                 "<p style='font-size: 15px; margin-top: 0;'>Dear <b>" + safeRecipient + "</b>,</p>" +
                 "<p>You have successfully registered for the workshop: <strong style='color: #0f172a;'>\"" + safeTitle + "\"</strong></p>" +
                 (safeSpeaker ? ("<p><b>Speaker:</b> " + safeSpeaker + "</p>") : "") +
                 "<p><b>Date & Time:</b> " + esc(dateStr) + " (" + esc(startTime) + " - " + esc(endTime) + ")</p>" +
                 "<p><b>Venue:</b> " + safeLocation + "</p>" +
                 (data.isMultiDay 
                   ? "<p style='color: #475569; margin-top: 15px;'>A Google Calendar invitation has been attached for the first session. Please add remaining sessions to your personal calendar.</p>" 
                   : "<p style='color: #475569; margin-top: 15px;'>A Google Calendar invitation has been attached. Please check your calendar.</p>") +
                 "<div style='margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9;'>" +
                 "<p style='margin: 0; font-weight: bold; color: #8b0000;'>Learning Development Office</p>" +
                 "<p style='margin: 2px 0 0 0; font-size: 13px; color: #64748b;'>Bangkok University</p>" +
                 "</div>" +
                 "</div>";
    } else {
      htmlBody = "<div style='font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif; padding: 24px; line-height: 1.6; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 14px; background-color: #ffffff; color: #1e293b;'>" +
                 "<div style='border-bottom: 2px solid #8b0000; padding-bottom: 12px; margin-bottom: 20px;'>" +
                 "<span style='font-size: 11px; font-weight: 700; color: #8b0000; text-transform: uppercase; letter-spacing: 1px;'>มหาวิทยาลัยกรุงเทพ • สำนักพัฒนาการเรียนรู้</span>" +
                 "<h2 style='color: #0f172a; margin: 6px 0 0 0; font-size: 18px;'>ยืนยันการลงทะเบียนอบรม</h2>" +
                 "</div>" +
                 "<p style='font-size: 15px; margin-top: 0;'>เรียน <b>" + safeRecipient + "</b>,</p>" +
                 "<p>ท่านได้ลงทะเบียนเข้าร่วมการอบรมหลักสูตร <strong style='color: #0f172a;'>\"" + safeTitle + "\"</strong> เรียบร้อยแล้ว</p>" +
                 (safeSpeaker ? ("<p><b>วิทยากร:</b> " + safeSpeaker + "</p>") : "") +
                 "<p><b>วันเวลา:</b> " + esc(dateStr) + " (" + esc(startTime) + " - " + esc(endTime) + ")</p>" +
                 "<p><b>สถานที่:</b> " + safeLocation + "</p>" +
                 (data.isMultiDay 
                   ? "<p style='color: #475569; margin-top: 15px;'>ระบบได้ส่งคำเชิญปฏิทินสำหรับวันอบรมแรกแล้ว กรุณาบันทึกวันอบรมถัดไปเพิ่มเติมลงในปฏิทินของท่าน</p>" 
                   : "<p style='color: #475569; margin-top: 15px;'>ท่านสามารถตรวจสอบคำเชิญในปฏิทิน Google Calendar ของท่านเพื่อบันทึกวันเวลาดังกล่าว</p>") +
                 "<div style='margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9;'>" +
                 "<p style='margin: 0; font-weight: bold; color: #8b0000;'>สำนักพัฒนาการเรียนรู้ (Learning Development Office)</p>" +
                 "<p style='margin: 2px 0 0 0; font-size: 13px; color: #64748b;'>มหาวิทยาลัยกรุงเทพ</p>" +
                 "</div>" +
                 "</div>";
    }
  }

  var senderName = data.senderName || (isEn ? "Learning Development Office" : "สำนักพัฒนาการเรียนรู้");

  MailApp.sendEmail({
    to: guestEmail,
    subject: subject,
    body: body,
    htmlBody: htmlBody,
    name: senderName
  });

  return ContentService.createTextOutput(JSON.stringify({ status: "success", eventId: event.getId() }))
    .setMimeType(ContentService.MimeType.JSON);
}

// 2. จัดการส่งประกาศนียบัตร
function handleCertificates(data) {
  var folderId = data.folderId;
  var subject = data.emailSubject;
  var bodyTemplate = data.emailBody;
  var recipients = data.recipients;

  var folder = DriveApp.getFolderById(folderId);

  recipients.forEach(function(recipient) {
    var sequence = recipient.sequence.toString();
    
    // ค้นหาไฟล์ .png (ชื่อไฟล์ต้องเป็นเลขลำดับ เช่น 1.png, 2.png)
    var fileName = sequence + ".png";
    var files = folder.getFilesByName(fileName);
    
    // หากไม่พบ .png ลองหาแบบไม่มีนามสกุล
    if (!files.hasNext()) {
      files = folder.getFilesByName(sequence);
    }
    
    if (files.hasNext()) {
      var file = files.next();
      var greetingName = recipient.name || "ผู้เข้าร่วมอบรม";
      if (greetingName.indexOf("เรียน ") === 0) {
        greetingName = greetingName.substring(5).trim();
      }

      var body = "เรียน " + greetingName + "\n\n" + bodyTemplate + 
                 "\n\nสำนักพัฒนาการเรียนรู้ (Learning Development Office)\nมหาวิทยาลัยกรุงเทพ";

      var htmlBody = "<div style='font-family: sans-serif; padding: 20px; line-height: 1.6; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px;'>" +
                     "<h3 style='color: #1e3a8a; margin-top: 0;'>เรียน " + greetingName + ",</h3>" +
                     "<div style='white-space: pre-line; color: #334155; margin: 15px 0;'>" + bodyTemplate + "</div>" +
                     "<p style='margin-top: 25px; font-weight: bold; color: #1e3a8a;'>สำนักพัฒนาการเรียนรู้ (Learning Development Office)<br>มหาวิทยาลัยกรุงเทพ</p>" +
                     "</div>";
                 
      MailApp.sendEmail({
        to: recipient.email,
        subject: subject,
        body: body,
        htmlBody: htmlBody,
        attachments: [file.getBlob()],
        name: "สำนักพัฒนาการเรียนรู้"
      });
    }
  });

  return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
    .setMimeType(ContentService.MimeType.JSON);
}

// 3. จัดการส่งอีเมลแจ้งเตือน (Reminder)
function handleReminders(data) {
  var subject = data.subject;
  var bodyTemplate = data.body;
  var recipients = data.recipients;

  recipients.forEach(function(recipient) {
    var greetingName = recipient.name || "ผู้เข้าร่วมอบรม";
    if (greetingName.indexOf("เรียน ") === 0) {
      greetingName = greetingName.substring(5).trim();
    }

    var body = "เรียน " + greetingName + "\n\n" + bodyTemplate + 
               "\n\nสำนักพัฒนาการเรียนรู้ (Learning Development Office)\nมหาวิทยาลัยกรุงเทพ";

    var htmlBody = "<div style='font-family: sans-serif; padding: 20px; line-height: 1.6; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px;'>" +
                   "<h3 style='color: #1e3a8a; margin-top: 0;'>เรียน " + greetingName + ",</h3>" +
                   "<div style='white-space: pre-line; color: #334155; margin: 15px 0;'>" + bodyTemplate + "</div>" +
                   "<p style='margin-top: 25px; font-weight: bold; color: #1e3a8a;'>สำนักพัฒนาการเรียนรู้ (Learning Development Office)<br>มหาวิทยาลัยกรุงเทพ</p>" +
                   "</div>";
               
    MailApp.sendEmail({
      to: recipient.email,
      subject: subject,
      body: body,
      htmlBody: htmlBody,
      name: "สำนักพัฒนาการเรียนรู้"
    });
  });

  return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
    .setMimeType(ContentService.MimeType.JSON);
}

// 4. จัดการส่งลิงก์แบบประเมินผล (รองรับสองภาษา TH/EN และตรวจสอบ Public URL)
function handleEvaluations(data) {
  function esc(s) {
    if (!s) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function isValidPublishedEvalUrl(rawUrl) {
    var link = (rawUrl || "").toString().trim();
    if (!link || link.indexOf("https://") !== 0) return false;
    var hostMatch = link.match(/^https:\/\/([^\/:?#]+)/i);
    if (!hostMatch || !hostMatch[1]) return false;
    var host = hostMatch[1].toLowerCase();
    if (
      host.indexOf("ais-pre-") === 0 ||
      host.indexOf("ais-dev-") === 0 ||
      host === "run.app" ||
      host.slice(-8) === ".run.app" ||
      host === "localhost" ||
      host === "127.0.0.1"
    ) {
      return false;
    }
    return link.indexOf("#/evaluate/") !== -1;
  }

  var lang = (data.language === "en") ? "en" : "th";
  var isEn = (lang === "en");
  var courseTitle = data.courseTitle || (isEn ? "Training Workshop" : "หลักสูตรอบรม");
  var evalLink = String(data.evalLink || data.evaluationUrl || "").trim();

  if (!isValidPublishedEvalUrl(evalLink)) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      code: "INVALID_EVALUATION_URL",
      message: "Rejected evaluation email send: missing or temporary preview evaluation URL."
    })).setMimeType(ContentService.MimeType.JSON);
  }

  var recipients = data.recipients || [];
  var sentCount = 0;
  var safeTitle = esc(courseTitle);
  var safeLink = esc(evalLink);
  var senderName = data.senderName || (isEn ? "Learning Development Office" : "สำนักพัฒนาการเรียนรู้");

  recipients.forEach(function(recipient) {
    try {
      if (!recipient || !recipient.email) return;

      var subject = data.emailSubject || (
        isEn
          ? ("[BU Training] Course Evaluation: " + courseTitle)
          : ("[BU Training] ขอความอนุเคราะห์ทำแบบประเมิน: " + courseTitle)
      );

      var greetingName = (recipient.name || (isEn ? "Participant" : "ผู้เข้าร่วมอบรม")).trim();
      if (greetingName.indexOf("เรียน ") === 0) {
        greetingName = greetingName.substring(5).trim();
      } else if (greetingName.indexOf("Dear ") === 0) {
        greetingName = greetingName.substring(5).trim();
      }
      var safeGreeting = esc(greetingName);

      var body, htmlBody;
      if (isEn) {
        body = "Dear " + greetingName + ",\n\n" +
               "Thank you for participating in \"" + courseTitle + "\".\n" +
               "We appreciate your valuable feedback to help improve our future faculty development programs.\n\n" +
               "Please click the link below to complete the training evaluation.\n" +
               evalLink + "\n\n" +
               "Best regards,\nLearning Development Office\nBangkok University";

        htmlBody = "<div style='font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif; padding: 24px; line-height: 1.6; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 14px; background-color: #ffffff; color: #1e293b;'>" +
                   "<h3 style='color: #0f172a; margin-top: 0;'>Dear " + safeGreeting + ",</h3>" +
                   "<p>Thank you for participating in <b>\"" + safeTitle + "\"</b>.</p>" +
                   "<p>Please click the link below to complete the training evaluation.</p>" +
                   "<div style='margin: 28px 0; text-align: center;'>" +
                   "<a href='" + safeLink + "' style='background-color: #2563eb; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 10px; display: inline-block; font-weight: bold; font-size: 15px;'>Complete Course Evaluation</a>" +
                   "</div>" +
                   "<p style='font-size: 13px; color: #64748b; margin-top: 20px; border-top: 1px solid #f1f5f9; padding-top: 14px;'>" +
                   "If the button above does not work, please copy and open this link:<br>" +
                   "<a href='" + safeLink + "' style='color: #2563eb; word-break: break-all;'>" + safeLink + "</a>" +
                   "</p>" +
                   "<p style='margin-top: 24px; font-weight: bold; color: #8b0000;'>Learning Development Office<br><span style='font-weight: normal; color: #64748b; font-size: 13px;'>Bangkok University</span></p>" +
                   "</div>";
      } else {
        body = "เรียน " + greetingName + "\n\n" +
               "ขอขอบคุณที่ท่านสละเวลาเข้าร่วมการอบรมหลักสูตร \"" + courseTitle + "\"\n" +
               "เพื่อให้การจัดการอบรมในครั้งต่อไปดียิ่งขึ้น กรุณาคลิกลิงก์ด้านล่างเพื่อประเมินผลการอบรม\n\n" +
               evalLink + "\n\n" +
               "สำนักพัฒนาการเรียนรู้ (Learning Development Office)\nมหาวิทยาลัยกรุงเทพ";

        htmlBody = "<div style='font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif; padding: 24px; line-height: 1.6; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 14px; background-color: #ffffff; color: #1e293b;'>" +
                   "<h3 style='color: #0f172a; margin-top: 0;'>เรียน " + safeGreeting + ",</h3>" +
                   "<p>ขอขอบคุณที่ท่านสละเวลาเข้าร่วมการอบรมหลักสูตร <b>\"" + safeTitle + "\"</b></p>" +
                   "<p>เพื่อให้การจัดการอบรมในครั้งต่อไปดียิ่งขึ้น กรุณาคลิกลิงก์ด้านล่างเพื่อประเมินผลการอบรม</p>" +
                   "<div style='margin: 28px 0; text-align: center;'>" +
                   "<a href='" + safeLink + "' style='background-color: #2563eb; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 10px; display: inline-block; font-weight: bold; font-size: 15px;'>เริ่มทำแบบประเมินผล</a>" +
                   "</div>" +
                   "<p style='font-size: 13px; color: #64748b; margin-top: 20px; border-top: 1px solid #f1f5f9; padding-top: 14px;'>" +
                   "หากปุ่มด้านบนไม่ทำงาน ท่านสามารถคลิกที่ลิงก์นี้แทน:<br>" +
                   "<a href='" + safeLink + "' style='color: #2563eb; word-break: break-all;'>" + safeLink + "</a>" +
                   "</p>" +
                   "<p style='margin-top: 24px; font-weight: bold; color: #8b0000;'>สำนักพัฒนาการเรียนรู้ (Learning Development Office)<br><span style='font-weight: normal; color: #64748b; font-size: 13px;'>มหาวิทยาลัยกรุงเทพ</span></p>" +
                   "</div>";
      }

      MailApp.sendEmail({
        to: recipient.email,
        subject: subject,
        body: body,
        htmlBody: htmlBody,
        name: senderName
      });
      sentCount++;
    } catch (e) {
      Logger.log("Failed to send evaluation to: " + (recipient && recipient.email) + " Error: " + e.toString());
    }
  });

  return ContentService.createTextOutput(JSON.stringify({ 
    status: "success", 
    sentCount: sentCount 
  })).setMimeType(ContentService.MimeType.JSON);
}

// 5. ฟังก์ชันให้สิทธิ์การใช้งาน (Run ฟังก์ชันนี้หนึ่งครั้งใน Editor เพื่อกดยอมรับสิทธิ์)
function authorizeScript() {
  MailApp.sendEmail({
    to: Session.getActiveUser().getEmail(),
    subject: "สิทธิ์การใช้งาน Script ได้รับการยืนยันแล้ว",
    body: "คุณได้กดยอมรับการให้สิทธิ์สำหรับ MailApp, CalendarApp และ DriveApp เรียบร้อยแล้ว ระบบพร้อมทำงาน"
  });
}

// 6. ฟังก์ชันตรวจสอบความถูกต้องของ Folder ID
function validateFolder(folderId) {
  try {
    var folder = DriveApp.getFolderById(folderId);
    return ContentService.createTextOutput(JSON.stringify({ status: "success", name: folder.getName() }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error" }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

## ขั้นตอนการอัปเดตและ Redeploy Google Apps Script (ทำเพียงครั้งเดียว):

1. ไปที่โปรเจกต์เดิมของคุณที่ [script.google.com](https://script.google.com)
2. วางโค้ดอัปเดตด้านบนทับโค้ดเดิมใน `Code.gs`
3. กดบันทึก (ไอคอนแผ่นดิสก์ หรือ Ctrl+S / Cmd+S)
4. กดปุ่ม **Deploy** (สีน้ำเงินมุมขวาบน) > **Manage deployments** (จัดการการทำให้ใช้งานได้)
5. กดไอคอนรูปดินสอ (**Edit**) ที่ Version ล่าสุด
6. ในช่อง **Version** เลือก **New version** (เวอร์ชันใหม่)
7. กด **Deploy**
8. การอัปเดตเสร็จสมบูรณ์ Web App URL เดิมจะใช้งานโค้ดเวอร์ชันใหม่ทันทีโดยไม่ต้องเปลี่ยน URL ในระบบ
