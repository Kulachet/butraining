# Google Apps Script for BU Training Portal (LDO)

Please copy and paste this code into your Google Apps Script editor.

```javascript
/*
 * LDO Management System - Google Apps Script
 * Handles Email Notifications, Certificates, and Calendar Invites
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
      // Calendar Invite logic (from LandingPage)
      return handleCalendarInvite(data);
    }
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// 1. Handle Calendar Invites (Triggered during registration)
function handleCalendarInvite(data) {
  var guestEmail = data.guestEmail;
  var title = data.courseTitle;
  var description = data.description;
  var location = data.location;
  var dateStr = data.date; // "YYYY-MM-DD"
  var startTime = data.startTime || "09:00";
  var endTime = data.endTime || "16:00";

  // Create Date objects
  var startDate = new Date(dateStr + 'T' + startTime + ':00+07:00');
  var endDate = new Date(dateStr + 'T' + endTime + ':00+07:00');

  // Simple script just needs to send an email with the ICS or use CalendarApp
  // However, since it runs as ADMIN, it will create it on ADMIN's cal and invite guest.
  var calendar = CalendarApp.getDefaultCalendar();
  var event = calendar.createEvent(title, startDate, endDate, {
    description: description,
    location: location,
    guests: guestEmail,
    sendInvites: true
  });

  // Also send a custom confirmation email
  var subject = "ยืนยันการลงทะเบียน: " + title;
  var body = "เรียน อาจารย์\n\n" +
             "ท่านได้ลงทะเบียนเข้าร่วมการอบรมหลักสูตร \"" + title + "\" เรียบร้อยแล้ว\n" +
             "วันเวลา: " + dateStr + " (" + startTime + " - " + endTime + ")\n" +
             "สถานที่: " + location + "\n\n" +
             "ท่านสามารถตรวจสอบคำเชิญในปฏิทิน Google Calendar ของท่านเพื่อบันทึกวันเวลาดังกล่าว\n\n" +
             "สำนักพัฒนาการเรียนรู้ (Learning Development Office)\nมหาวิทยาลัยกรุงเทพ";

  MailApp.sendEmail({
    to: guestEmail,
    subject: subject,
    body: body,
    name: "สำนักพัฒนาการเรียนรู้"
  });

  return ContentService.createTextOutput(JSON.stringify({ status: "success", eventId: event.getId() }))
    .setMimeType(ContentService.MimeType.JSON);
}

// 2. Handle Certificates
function handleCertificates(data) {
  var folderId = data.folderId;
  var courseTitle = data.courseTitle;
  var subject = data.emailSubject;
  var bodyTemplate = data.emailBody;
  var recipients = data.recipients;

  var folder = DriveApp.getFolderById(folderId);
  var files = folder.getFiles();
  var fileMap = {};
  
  while (files.hasNext()) {
    var file = files.next();
    var name = file.getName().replace(".pdf", "").trim();
    fileMap[name] = file;
  }

  recipients.forEach(function(recipient) {
    var sequence = recipient.sequence.toString();
    var file = fileMap[sequence];
    
    if (file) {
      var body = "เรียน " + recipient.name + "\n\n" + bodyTemplate + 
                 "\n\nสำนักพัฒนาการเรียนรู้ (Learning Development Office)\nมหาวิทยาลัยกรุงเทพ";
                 
      MailApp.sendEmail({
        to: recipient.email,
        subject: subject,
        body: body,
        attachments: [file.getBlob()],
        name: "สำนักพัฒนาการเรียนรู้"
      });
    }
  });

  return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
    .setMimeType(ContentService.MimeType.JSON);
}

// 3. Handle Reminders
function handleReminders(data) {
  var subject = data.subject;
  var bodyTemplate = data.body;
  var recipients = data.recipients;

  recipients.forEach(function(recipient) {
    var body = "เรียน " + recipient.name + "\n\n" + bodyTemplate + 
               "\n\nสำนักพัฒนาการเรียนรู้ (Learning Development Office)\nมหาวิทยาลัยกรุงเทพ";
               
    MailApp.sendEmail({
      to: recipient.email,
      subject: subject,
      body: body,
      name: "สำนักพัฒนาการเรียนรู้"
    });
  });

  return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
    .setMimeType(ContentService.MimeType.JSON);
}

// 4. Handle Evaluation Links
function handleEvaluations(data) {
  var courseTitle = data.courseTitle;
  var evalLink = data.evalLink;
  var recipients = data.recipients;

  recipients.forEach(function(recipient) {
    var subject = "[แบบประเมินผล] การอบรมหลักสูตร: " + courseTitle;
    var body = "เรียน " + recipient.name + "\n\n" +
               "ขอขอบคุณที่ท่านสละเวลาเข้าร่วมการอบรมหลักสูตร \"" + courseTitle + "\"\n" +
               "เพื่อให้การจัดการอบรมในครั้งต่อไปดียิ่งขึ้น ทางสำนักพัฒนาการเรียนรู้ใคร่ขอความอนุเคราะห์ให้ท่านทำแบบประเมินผลการอบรมตามลิงก์ด้านล่างนี้ครับ/ค่ะ\n\n" +
               "ลิงก์แบบประเมิน: " + evalLink + "\n\n" +
               "ขอขอบพระคุณในความร่วมมือครับ/ค่ะ\n\n" +
               "สำนักพัฒนาการเรียนรู้ (Learning Development Office)\nมหาวิทยาลัยกรุงเทพ";
               
    MailApp.sendEmail({
      to: recipient.email,
      subject: subject,
      body: body,
      name: "สำนักพัฒนาการเรียนรู้"
    });
  });

  return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
    .setMimeType(ContentService.MimeType.JSON);
}

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

## Instructions for Use:
1. Go to [script.google.com](https://script.google.com).
2. Create a new project.
3. Replace the default code with the code provided above.
4. Click **Deploy** > **New Deployment**.
5. Select **Type: Web App**.
6. Set **Execute as: Me**.
7. Set **Who has access: Anyone**.
8. Copy the **Web App URL** and update the corresponding URLs in your React application files:
   - `src/components/RegistrantsList.tsx`
   - `src/pages/LandingPage.tsx`
