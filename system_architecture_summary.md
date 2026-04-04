# สรุปหลักการทำงานของ AI Chatbot (DayOne1)

แอปพลิเคชันนี้ทำงานบนสถาปัตยกรรมแบบ **Client-Server** โดยมีส่วนประกอบหลัก 3 ส่วนคือ Frontend (HTML/JS), Backend (FastAPI) และ Database (SQLite) ที่ทำงานร่วมกับ **OpenRouter API** เพื่อประมวลผล AI ครับ

---

## 1. หลักการทำงานภาพรวม (Architecture)
1. **Frontend (UI):** จัดการด้วย `script.js` แจ้งเตือนผู้ใช้ให้ล็อกอินผ่าน Firebase Google Auth และดึง `email` ของผู้ใช้เก็บไว้
2. **Backend (FastAPI):** ทำหน้าที่เป็นตัวกลาง (Proxy & Storage) รับคำสั่งจากหน้าเว็บ ไปดึงและบันทึกข้อมูลที่ฐานข้อมูล และประสานงานส่งต่อให้ OpenRouter 
3. **การเชื่อมต่อระหว่าง Frontend และ Backend:** สื่อสารผ่าน REST API โดยแนบ `api_key`, `model` เเละยืนยันตัวตนด้วยการแนบ `X-User-Id` (Email) ไปใน Header ของ Request เช่นในโค้ด `script.js` บรรทัดที่รับผิดชอบเรื่องนี้

---

## 2. วิธีการเชื่อมต่อ AI API (OpenRouter)
เนื่องจากเราใช้ OpenRouter ซึ่งสามารถใช้งานร่วมกับไลบรารีของ OpenAI ได้เลย การเชื่อมต่อจึงทำได้ง่ายและทรงพลังมาก

### ฝั่ง Backend (`backend/main.py`)
ระบบจะใช้แพ็กเกจ `openai` เป็นตัวยิง Request ไปยัง **OpenRouter API** 
- โค้ดจะสร้าง `client` ขึ้นมาใหม่ทุกครั้งที่มีการส่งแชท โดยใช้ `api_key` ที่รับมาจากเครื่องผู้ใช้ 
- **บรรทัดที่ 101-111:** กำหนด Base URL ชี้ไปที่ OpenRouter แทนที่จะชี้ไปที่ OpenAI 

```python
# backend/main.py (บรรทัด 102 - 111)
client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=api_key,
)
response = client.chat.completions.create(
    model=model,
    messages=messages_history,
    stream=True # เปิดโหมดส่งข้อมูลกลับเป็นท่อนๆ
)
```

- จากนั้นใน **บรรทัดที่ 114 - 120** ระบบจะทำการแปลงผลที่ค่อยๆ ทยอยกลับมาจาก OpenRouter ให้กลายเป็นรูปแบบ Streaming (SSE - Server-Sent Events) แล้วส่งให้ Frontend ทันที ทำให้ตัวหนังสือบนหน้าจอค่อยๆ พิมพ์ทีละบรรทัด

---

## 3. AI จำบทสนทนาก่อนหน้าได้อย่างไร? (Context Memory)
ความสามารถในการจำสิ่งที่คุยกันไปแล้วทั้งหมด ไม่ได้เกิดขึ้นเพราะตัว AI แต่เกิดจาก **Backend ดึงประวัติทุกข้อความของแชทนั้นๆ มาป้อนกลับให้ AI อ่านใหม่ทั้งหมดทุกครั้ง** 

### ขั้นตอนใน Backend (`backend/main.py`)

1. **บันทึกข้อความปัจจุบันลงฐานข้อมูลก่อน:** ทันทีที่ผู้ใช้ส่งข้อความ จะเก็บข้อมูลนั้นไว้ในฐานข้อมูล 
   - **บรรทัดที่ 147 - 150:** `user_message = Message(chat_id=chat_id, user_id=x_user_id, role="user", content=user_content)` เเละบันทึกลง DB
2. **ดึงประวัติศาสตร์การแชท (Memory):** Backend เรียกดูข้อความ "ทั้งหมด" ที่อยู่ภายใต้ `chat_id` ปัจจุบัน 
   - **บรรทัดที่ 160 - 162:** ส่วนนี้สำคัญที่สุด
```python
# backend/main.py (บรรทัด 161 - 162)
all_messages = db.query(Message).filter(Message.chat_id == chat_id).order_by(Message.created_at).all()
messages_history = [{"role": msg.role, "content": msg.content} for msg in all_messages]
```
3. **แทรกคำแนะนำหลัก (System Prompt):** 
   - **บรรทัดที่ 164 - 175:** ยัดคำสั่งลับ (System Prompt) บังคับให้ AI จัด Format การตอบด้วย Markdown เพื่อความสวยงาม และยัดเข้าไปไว้บนสุดของ `messages_history` 
4. **ส่งประวัติทั้งหมดให้ AI ย่อย:** สุดท้ายใน **บรรทัดที่ 183 (`wrapped_stream`)** ประวัติการสนทนาทั้งหมดจะถูกเรียงร้อยส่งไปให้ OpenRouter วิเคราะห์ต่อ ส่งผลให้เวลาผู้ใช้ถามถึงบริบทเก่าๆ AI จะสามารถตอบได้เพราะมันได้อ่านข้อความเก่าทั้งหมดตั้งแต่บรรทัดแรกที่บันทึกไว้ในฐานข้อมูลนั่นเองครับ

---

## 4. ระบบค้นหาประวัติการแชท (Search History)
การค้นหาประวัติการแชทจะเกิดขึ้นที่ซีกของ **Frontend (หน้าเว็บ)** แบบ 100% โดยมีการทำงานดังนี้:

1. ทันทีที่ระบบโหลดรายการแชทจาก Database ในตอนแรก จะถูกแวะเก็บไว้ในตัวแปร List ที่ชื่อว่า `allChats` ในโค้ด Javascript
2. เมื่อผู้ใช้พิมพ์ข้อความลงในช่องค้นหา ระบบจะเริ่มกรองข้อความ (Filter) จากตัวแปรนั้นทันที (Real-time) โดยไม่ต้องส่ง Request กลับไปรอดึงข้อมูลใหม่จากฐานข้อมูล
3. **บรรทัดที่ 332 - 336 ใน `frontend/script.js`:** คือจุดที่ตรวจจับการพิมพ์ และคัดกรองชื่อแชทที่ตรงเงื่อนไขออกมาเรนเดอร์ใหม่

```javascript
# frontend/script.js (บรรทัด 332 - 336)
searchInput.oninput = (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = allChats.filter(c => c.title.toLowerCase().includes(query));
    renderChatList(filtered);
};
```
