# Prism Size

**EN** — Prism Size turns your disk into a living glass map: see what takes up space at a glance, and tidy real files by simply dragging them. Includes a disk treemap/sunburst, installed-apps sizes, a safe cleaner, search, and an on-demand Microsoft Defender virus scan. Thai / English UI, light / dark mode.

**TH** — Prism Size เปลี่ยนดิสก์ของคุณให้เป็นแผนที่แก้วที่มีชีวิต ดูทันทีว่าอะไรกินพื้นที่ และจัดการไฟล์จริงได้ด้วยการลาก มีทั้งแผนภาพขนาดไฟล์ ขนาดโปรแกรมที่ติดตั้ง ตัวล้างไฟล์ที่ปลอดภัย การค้นหา และสแกนไวรัสด้วย Microsoft Defender รองรับภาษาไทย/อังกฤษ และโหมดสว่าง/มืด

## Download / ดาวน์โหลด

Go to the **[Releases page](../../releases/latest)** and pick one (Windows 10/11, 64-bit):

| File | For |
| --- | --- |
| `Prism-Size-x.y.z-Setup.exe` | Installer — double-click, done. / ติดตั้งแล้วใช้ได้เลย |
| `Prism-Size-x.y.z-Portable.exe` | No install, run from anywhere (e.g. a USB stick). / ไม่ต้องติดตั้ง ดับเบิลคลิกใช้ได้เลย |

> Windows SmartScreen may warn "unknown publisher" because the app is not code-signed. Click **More info → Run anyway**.
> Windows อาจเตือนว่า "ไม่ทราบผู้เผยแพร่" เพราะโปรแกรมยังไม่ได้ลงลายเซ็นดิจิทัล กด **ข้อมูลเพิ่มเติม → เรียกใช้อยู่ดี**

## Updating / การอัปเดต

Open the **ⓘ** button in the title bar → **Check for updates**. Prism Size downloads the newest release from this repository and restarts into it.
กดปุ่ม **ⓘ** บนแถบหัวหน้าต่าง → **ตรวจหาอัปเดต**

## Run from source / รันจากซอร์สโค้ด

Requires Node.js and (for the scanner) Rust.

```bash
npm install
npm run build:scanner   # compiles the Rust scanner
npm start
```

## Build the installers / สร้างไฟล์ติดตั้ง

```bash
npm run dist            # → dist/Prism-Size-<version>-Setup.exe and -Portable.exe
```

Publishing a release: bump `version` in `app/package.json`, push a tag like `v1.0.1`, and GitHub Actions builds and attaches both files automatically.

## License

MIT
