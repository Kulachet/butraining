# Google Apps Script สำหรับระบบ LDO (BU Training)

กรุณาคัดลอกโค้ดด้านล่างนี้ไปวางในเครื่องมือแก้ไข Google Apps Script ของคุณ เพื่อให้ระบบส่งอีเมล (คำเชิญปฏิทิน, เกียรติบัตร, การแจ้งเตือน และแบบประเมินผล) ใช้คำนำหน้าชื่อผู้รับตามรหัสอาจารย์ (อ., ผศ., รศ., ศ., ดร. หรือ คุณ) อย่างถูกต้องและสม่ำเสมอทั้งแบบข้อความธรรมดา (Plain Text) และ HTML

```javascript
/**
 * ระบบจัดการ LDO - Google Apps Script
 * รองรับการส่งอีเมลแจ้งเตือน, ประกาศนียบัตร, ลิงก์ประเมินผล และการเชิญปฏิทิน
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

// 1. จัดการคำเชิญในปฏิทินและอีเมลยืนยันการลงทะเบียน
function handleCalendarInvite(data) {
  var guestEmail = data.guestEmail;
  var title = data.courseTitle;
  var description = data.description || "";
  var location = data.location || "ไม่ระบุ";
  var dateStr = data.date; // "YYYY-MM-DD"
  var startTime = data.startTime || "09:00";
  var endTime = data.endTime || "16:00";
  var speakerName = data.instructorName || "";

  // คำนวณชื่อผู้รับ (ผู้ลงทะเบียน) ที่จัดรูปแบบแล้ว (รองรับ guestName, recipientName, name)
  var recipientName = data.guestName || data.recipientName || data.name || "อาจารย์";
  if (recipientName.indexOf("เรียน ") === 0) {
    recipientName = recipientName.substring(5).trim();
  }

  // สร้างวัตถุวันที่ (Timezone กรุงเทพ +0700)
  var startDate = new Date(dateStr + 'T' + startTime + ':00+07:00');
  var endDate = new Date(dateStr + 'T' + endTime + ':00+07:00');

  // สร้างเหตุการณ์ในปฏิทิน
  var calendar = CalendarApp.getDefaultCalendar();
  var event = calendar.createEvent(title, startDate, endDate, {
    description: description + (speakerName ? ("\nวิทยากร: " + speakerName) : ""),
    location: location,
    guests: guestEmail,
    sendInvites: true
  });

  // ส่งอีเมลยืนยันการลงทะเบียนเพิ่มเติม
  var subject = "ยืนยันการลงทะเบียน: " + title;
  var body = "เรียน " + recipientName + "\n\n" +
             "ท่านได้ลงทะเบียนเข้าร่วมการอบรมหลักสูตร \"" + title + "\" เรียบร้อยแล้ว\n" +
             (speakerName ? ("วิทยากร: " + speakerName + "\n") : "") +
             "วันเวลา: " + dateStr + " (" + startTime + " - " + endTime + ")\n" +
             "สถานที่: " + location + "\n\n" +
             "ท่านสามารถตรวจสอบคำเชิญในปฏิทิน Google Calendar ของท่านเพื่อบันทึกวันเวลาดังกล่าว\n\n" +
             "สำนักพัฒนาการเรียนรู้ (Learning Development Office)\nมหาวิทยาลัยกรุงเทพ";

  var htmlBody = "<div style='font-family: sans-serif; padding: 20px; line-height: 1.6; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px;'>" +
                 "<h3 style='color: #1e3a8a; margin-top: 0;'>เรียน " + recipientName + ",</h3>" +
                 "<p>ท่านได้ลงทะเบียนเข้าร่วมการอบรมหลักสูตร <b>\"" + title + "\"</b> เรียบร้อยแล้ว</p>" +
                 (speakerName ? ("<p><b>วิทยากร:</b> " + speakerName + "</p>") : "") +
                 "<p><b>วันเวลา:</b> " + dateStr + " (" + startTime + " - " + endTime + ")</p>" +
                 "<p><b>สถานที่:</b> " + location + "</p>" +
                 "<p style='color: #475569; margin-top: 15px;'>ท่านสามารถตรวจสอบคำเชิญในปฏิทิน Google Calendar ของท่านเพื่อบันทึกวันเวลาดังกล่าว</p>" +
                 "<p style='margin-top: 25px; font-weight: bold; color: #1e3a8a;'>สำนักพัฒนาการเรียนรู้ (Learning Development Office)<br>มหาวิทยาลัยกรุงเทพ</p>" +
                 "</div>";

  MailApp.sendEmail({
    to: guestEmail,
    subject: subject,
    body: body,
    htmlBody: htmlBody,
    name: "สำนักพัฒนาการเรียนรู้"
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

// 4. จัดการส่งลิงก์แบบประเมินผล
function handleEvaluations(data) {
  var courseTitle = data.courseTitle || "บทเรียนของคุณ";
  var evalLink = data.evalLink;
  var recipients = data.recipients || [];
  var sentCount = 0;

  recipients.forEach(function(recipient) {
    try {
      if (!recipient.email) return;

      var subject = "[BU Training] ขอความอนุเคราะห์ทำแบบประเมิน: " + courseTitle;
      var greetingName = recipient.name || "ผู้เข้าร่วมอบรม";
      if (greetingName.indexOf("เรียน ") === 0) {
        greetingName = greetingName.substring(5).trim();
      }
      
      var body = "เรียน " + greetingName + ",\n\n" +
                 "ขอขอบคุณที่ท่านสละเวลาเข้าร่วมการอบรมหลักสูตร \"" + courseTitle + "\"\n" +
                 "เพื่อให้การจัดการอบรมในครั้งต่อไปดียิ่งขึ้น ทางสำนักพัฒนาการเรียนรู้ (LDO) ใคร่ขอความอนุเคราะห์ท่านสละเวลาทำแบบประเมินผลการอบรมตามลิงก์ด้านล่างนี้ครับ/ค่ะ\n\n" +
                 evalLink + "\n\n" +
                 "สำนักพัฒนาการเรียนรู้ (Learning Development Office)\nมหาวิทยาลัยกรุงเทพ";

      var htmlBody = "<div style='font-family: sans-serif; padding: 20px; line-height: 1.6; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px;'>" +
                     "<h3 style='color: #1e3a8a; margin-top: 0;'>เรียน " + greetingName + ",</h3>" +
                     "<p>ขอขอบคุณที่ท่านสละเวลาเข้าร่วมการอบรมหลักสูตร <b>\"" + courseTitle + "\"</b></p>" +
                     "<p>เพื่อให้การจัดการอบรมในครั้งต่อไปดียิ่งขึ้น ทางสำนักพัฒนาการเรียนรู้ (LDO) ใคร่ขอความอนุเคราะห์ท่านสละเวลาทำแบบประเมินผลการอบรมตามลิงก์ด้านล่างนี้ครับ/ค่ะ</p>" +
                     "<div style='margin: 35px 0; text-align: center;'>" +
                     "<a href='" + evalLink + "' style='background-color: #2563eb; color: white; padding: 16px 32px; text-decoration: none; border-radius: 10px; display: inline-block; font-weight: bold; font-size: 16px; box-shadow: 0 4px 10px rgba(37, 99, 235, 0.25);'>เริ่มทำแบบประเมินผล</a>" +
                     "</div>" +
                     "<p style='font-size: 13px; color: #64748b; margin-top: 25px; border-top: 1px solid #f1f5f9; pt: 15px;'>" +
                     "หากปุ่มด้านบนไม่ทำงาน ท่านสามารถคลิกที่ลิงก์นี้แทน:<br>" +
                     "<a href='" + evalLink + "' style='color: #3b82f6; word-break: break-all;'>" + evalLink + "</a>" +
                     "</p>" +
                     "<p style='margin-top: 30px; font-weight: bold; color: #1e3a8a;'>สำนักพัฒนาการเรียนรู้ (Learning Development Office)<br>มหาวิทยาลัยกรุงเทพ</p>" +
                     "</div>";

      MailApp.sendEmail({
        to: recipient.email,
        subject: subject,
        body: body,
        htmlBody: htmlBody,
        name: "สำนักพัฒนาการเรียนรู้"
      });
      sentCount++;
    } catch (e) {
      Logger.log("Failed to send evaluation to: " + recipient.email + " Error: " + e.toString());
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
