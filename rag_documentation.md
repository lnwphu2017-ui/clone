# 📚 เอกสารอธิบายระบบ RAG (Syllabus Chatbot)

เอกสารฉบับนี้อธิบายกลไกการทำงานและจุดประสงค์ของโค้ดในแต่ละส่วนอย่างละเอียด

---

## 🏗️ 1. ขั้นตอนการเตรียมข้อมูล (Indexing Process)
ขั้นตอนนี้คือการนำไฟล์เอกสารมาประมวลผลและเก็บลงฐานข้อมูล

### 🔍 ไฟล์: [api/rag.py](file:///c:/DayOne1/api/rag.py)
- **การปรับจูนระบบ (RAG Parameters) [บรรทัดที่ 24-27]:**
  - `CHUNK_SIZE = 2000` ช่วยให้เนื้อหาวิชาอยู่รวมกันเป็นท่อนใหญ่
  - `TOP_K_RESULTS = 50` สั่งให้ดึงข้อมูลทั้งหมดที่มีให้ AI เห็น 100%
- **การแปะป้ายชั้นปี (Context Injection) [บรรทัดที่ 283-298]:**
  - อยู่ในฟังก์ชัน `IndexKnowledgeFiles` ทำหน้าที่ตรวจหา "ชั้นปีที่ X" และแปะป้ายกำกับให้ทุกข้อความ
- **การทำ Embedding [บรรทัดที่ 32-35]:**
  - ใช้โมเดล `sentence-transformers` แบบ Local เพื่อแปลงข้อความเป็น Vector

---

## 🛠️ 2. ขั้นตอนการดึงข้อมูล (Retrieval Phase)
การค้นหาข้อมูลจากฐานข้อมูลมาให้ AI อ่านก่อนตอบ

### 🔍 ไฟล์: [api/rag.py](file:///c:/DayOne1/api/rag.py)
- **การค้นหาและคืนลำดับข้อมูล [บรรทัดที่ 182-219]:**
  - อยู่ในฟังก์ชัน `RetrieveRelevantChunks`
  - **หัวใจสำคัญ [บรรทัดที่ 214]:** `filtered_chunks.sort(key=lambda x: x["id"])` 
  - บรรทัดนี้จะเรียงลำดับวิชา 1-27 ให้กลับมาเป๊ะตามต้นฉบับเอกสาร ไม่กระโดดไปมา

---

## 🧠 3. ขั้นตอนการตอบคำถาม (Generation Phase)
การสั่งให้ AI ประมวลผลและตอบคำถาม

### 🔍 ไฟล์: [api/index.py](file:///c:/DayOne1/api/index.py)
- **กฎเหล็กของ AI (System Prompt) [บรรทัดที่ 231-248]:**
  - **No Echo:** ห้ามทวนคำถาม
  - **Sequential Listing:** ลิสต์รายชื่อทุกวิชาตามลำดับ
  - **General Knowledge:** ตอบเรื่องทั่วไป (เช่น ม้าลาย) ได้โดยไม่ต้องง้อ syllabus

---

## 📊 ตารางสรุปค่าปรับจูน (Final Parameters)

| พารามิเตอร์ | ค่าปัจจุบัน | ไฟล์ | บรรทัด |
| :--- | :--- | :--- | :--- |
| `CHUNK_SIZE` | `2000` | [api/rag.py](file:///c:/DayOne1/api/rag.py) | 24 |
| `CHUNK_OVERLAP` | `300` | [api/rag.py](file:///c:/DayOne1/api/rag.py) | 25 |
| `TOP_K_RESULTS` | `50` | [api/rag.py](file:///c:/DayOne1/api/rag.py) | 26 |
| `SIMILARITY_THRESHOLD` | `0.01` | [api/rag.py](file:///c:/DayOne1/api/rag.py) | 27 |

---
*อัปเดตล่าสุด: 2026-04-08 | โดย Antigravity AI*
