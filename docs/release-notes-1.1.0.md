## Prism Size 1.1.0

### ภาษาไทย

**ใหม่**
- **โหมดคลาสสิก** — กดปุ่มพระจันทร์/ดวงอาทิตย์จะมีเมนูเล็กให้เลือก ธีม (สว่าง / มืด) และสไตล์ (แก้ว / คลาสสิก) โหมดคลาสสิกเป็นพื้นเรียบ ไม่มีพื้นหลังเคลื่อนไหว ไม่มีแสงหักเห ไม่มีแอนิเมชันตกแต่ง เน้นใช้งาน และใช้เครื่องน้อยกว่า
- **โลโก้ใหม่ของ Prism Size** (สีฟ้า + รูปกราฟวงกลม) ทั้งในโปรแกรมและไอคอนบนทาสก์บาร์ พร้อมลายเซ็น "by 543"
- **แจ้งเตือนเวอร์ชันใหม่** — เมื่อมีเวอร์ชันใหม่ จะมีจุดสีชมพูบนปุ่ม ⓘ และป้ายเล็กๆ "มีเวอร์ชันใหม่ · อัปเดต" กดทีเดียวไปหน้าอัปเดตได้เลย

**ปลอดภัยขึ้น**
- ก่อนลบไฟล์ โปรแกรมจะเช็กว่า Windows จะลบทิ้งถาวรหรือไม่ (เช่น แฟลชไดรฟ์, ไดรฟ์ในเครือข่าย, ไฟล์ใหญ่เกินถังขยะ) ถ้าใช่จะถามยืนยันก่อนทุกครั้ง แทนที่จะลบหายไปเงียบๆ
- ล็อกโฟลเดอร์สำคัญเพิ่ม: OneDrive, รูปภาพ/เพลง/วิดีโอ, โฟลเดอร์ของผู้ใช้คนอื่น และโฟลเดอร์ที่ติดตั้ง Prism Size

**แก้ไข**
- ปุ่มอัปเดตในโปรแกรมดาวน์โหลดไม่ได้ (GitHub เปลี่ยนที่อยู่ไฟล์) — แก้แล้ว และถ้าเน็ตหลุดกลางทางจะไม่เหลือไฟล์ติดตั้งที่ไม่ครบ
- เปิดโปรแกรมซ้ำ จะสลับไปหน้าต่างที่เปิดอยู่ แทนที่จะเปิดหน้าต่างว่างอีกอัน
- ถ้าตัวสแกนหลักล้ม จะสแกนต่อด้วยวิธีสำรองให้เอง
- หาไฟล์ซ้ำ: ข้ามไฟล์ OneDrive ที่ยังไม่ได้โหลดลงเครื่อง (ไม่โหลดลงมาโดยไม่ตั้งใจ) ข้ามไฟล์โปรแกรม และไม่เลือกอะไรไว้ล่วงหน้า
- เปิดโปรแกรมแล้วไม่ค้าง: ผลสแกนที่ใหญ่มาก (เกิน 400,000 ไฟล์) จะไม่ถูกเปิดอัตโนมัติตอนเริ่ม

> **ผู้ใช้ 1.0.0:** ปุ่มอัปเดตในเวอร์ชัน 1.0.0 มีปัญหา กรุณาดาวน์โหลดเวอร์ชันนี้ด้วยตัวเองหนึ่งครั้ง หลังจากนี้กดอัปเดตในโปรแกรมได้ตามปกติ

---

### English

**New**
- **Classic look** — the moon/sun button now opens a small menu: Theme (Light / Dark) and Style (Glass / Classic). Classic is flat and still: no moving background, no refraction, no decorative animation — calm, focused, and lighter on your PC.
- **New Prism Size logo** (blue + pie-chart glyph) in the app and on the taskbar, with the "by 543" mark.
- **Update nudge** — when a new version is out, a pink dot appears on ⓘ with a small "New version · Update" chip; one click takes you to the update.

**Safer**
- Before deleting, the app checks whether Windows would delete for good (USB / network drives, items larger than the Recycle Bin…) and asks you first instead of silently deleting permanently.
- More folders are locked: OneDrive, Pictures / Music / Videos, other users' profiles, and Prism Size's own install folder.

**Fixes**
- The in-app updater could not download (GitHub changed its download address) — fixed; a dropped connection no longer leaves a half-downloaded installer.
- Opening the app a second time now brings up the open window instead of a blank second copy.
- If the fast scanner fails, the scan continues with the backup scanner.
- Duplicate finder skips online-only OneDrive files (no accidental downloads) and program files, and pre-selects nothing.
- No freeze at start: very large saved scans (over 400,000 files) are not reopened automatically.

> **Using 1.0.0?** Its update button is broken — please download this version manually once. After that, updating from inside the app works.

---

**Download:** `Prism-Size-1.1.0-Setup.exe` (installer) or `Prism-Size-1.1.0-Portable.exe` (no install). Windows 10/11 64-bit.
SmartScreen may warn because the app is not code-signed: **More info → Run anyway**.
