# Google Apps Script สำหรับระบบ LDO (BU Training)

กรุณาคัดลอกโค้ดด้านล่างนี้ไปวางในเครื่องมือแก้ไข Google Apps Script ของคุณ

```javascript
/**
 * ระบบจัดการ LDO - Google Apps Script
 * รองรับการส่งอีเมลแจ้งเตือน, ประกาศนียบัตร, ลิงก์ประเมินผล และการเชิญปฏิทิน
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
      // ตรรกะการเชิญปฏิทิน (ส่งจากหน้าลงทะเบียน)
      return handleCalendarInvite(data);
    }
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// 1. จัดการคำเชิญในปฏิทิน (ส่งเมื่อมีการลงทะเบียน)
function handleCalendarInvite(data) {
  var guestEmail = data.guestEmail;
  var title = data.courseTitle;
  var description = data.description;
  var location = data.location;
  var dateStr = data.date; // "YYYY-MM-DD"
  var startTime = data.startTime || "09:00";
  var endTime = data.endTime || "16:00";

  // สร้างวัตถุวันที่ (Timezone กรุงเทพ +0700)
  var startDate = new Date(dateStr + 'T' + startTime + ':00+07:00');
  var endDate = new Date(dateStr + 'T' + endTime + ':00+07:00');

  // สร้างเหตุการณ์ในปฏิทิน
  var calendar = CalendarApp.getDefaultCalendar();
  var event = calendar.createEvent(title, startDate, endDate, {
    description: description,
    location: location,
    guests: guestEmail,
    sendInvites: true
  });

  // ส่งอีเมลยืนยันการลงทะเบียนเพิ่มเติม
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

// 3. จัดการส่งอีเมลแจ้งเตือน (Reminder)
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
      
      var htmlBody = "<div style='font-family: sans-serif; padding: 20px; line-height: 1.6; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px;'>" +
                     "<h3 style='color: #1e3a8a; margin-top: 0;'>เรียน " + (recipient.name || "ผู้เข้าร่วมอบรม") + ",</h3>" +
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

## ขั้นตอนการติดตั้ง (สำคัญมาก):

1. ไปที่ [script.google.com](https://script.google.com)
2. สร้างโปรเจกต์ใหม่
3. ลบโค้ดเดิมออกและวางโค้ดด้านบนลงไปทั้งหมด
4. **การให้สิทธิ์ (Authorization):** 
   - ในแถบเครื่องมือด้านบน กดเลือกฟังก์ชัน **`authorizeScript`**
   - กดปุ่ม **Run**
   - จะมีหน้าต่างป๊อปอัปขึ้นมาให้เลือกบัญชี Google ของคุณ
   - กดกดยอมรับ (หากขึ้นหน้าจอ 'Google has not verified this app' ให้กด **Advanced** > **Go to ... (unsafe)** เพื่อยืนยัน)
   - **ถ้าไม่ทำขั้นตอนนี้ ระบบจะส่งอีเมลหรือใช้งานไดรฟ์ไม่ได้**
5. **การ Deploy เพื่อรับ URL:**
   - กดปุ่ม **Deploy** (สีน้ำเงิน) > **New Deployment**
   - เลือกประเภท (**Select type**) เป็น **Web App**
   - ตั้งค่าช่อง **Execute as:** เป็น **Me** (ตัวคุณเอง)
   - ตั้งค่าช่อง **Who has access:** เป็น **Anyone** (ทุกคน - สำคัญที่สุด)
   - กด **Deploy**
   - คัดลอก **Web App URL** ที่ได้ (ลงท้ายด้วย `/exec`) แล้วนำไปวางในระบบหลังบ้าน (Admin Portal)
6. **การตรวจสอบปัญหาการทำงาน:**
   - หากส่งอีเมลไม่ออก ให้ไปที่แถบ **Executions** (รูปนาฬิกาด้านซ้าย) ในหน้า GAS Editor
   - คุณจะเห็นสถานะการทำงานแต่ละครั้ง หากมีข้อผิดพลาดจะขึ้นเป็นสีแดง
