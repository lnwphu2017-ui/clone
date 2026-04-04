from fastapi import FastAPI, Depends, HTTPException, Request, Header
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from .database import get_db, init_db, Chat, Message, SessionLocal
from sqlalchemy.orm import Session
from sqlalchemy import desc
import json
from openai import OpenAI

app = FastAPI()

# ตั้งค่า CORS เพื่อให้ Frontend จาก Domain อื่นสามารถคุยกับ API ได้
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# เมื่อแอปพลิเคชันเริ่มทำงาน ให้ทำการสร้างตารางในฐานข้อมูล
@app.on_event("startup")
def on_startup():
    init_db()

# รายการโมเดล AI ที่ผู้ใช้สามารถเลือกใช้งานได้ (เหมือน st.sidebar.selectbox)
AVAILABLE_MODELS = [
    {"id": "google/gemini-2.0-flash-001", "name": "Gemini 2.0 Flash"},
    {"id": "qwen/qwen3.6-plus:free", "name": "Qwen 3.6 Plus "},
]

# API ดึงรายการโมเดลที่สามารถเลือกใช้ได้
@app.get("/api/models")
def get_models():
    return AVAILABLE_MODELS

# API ตรวจสอบว่า API Key ใช้งานได้จริงหรือไม่
@app.post("/api/validate-key")
async def validate_key(request: Request):
    data = await request.json()
    api_key = data.get("api_key", "")
    if not api_key:
        raise HTTPException(status_code=400, detail="กรุณาใส่ API Key")
    try:
        # ลองเรียก OpenRouter API เพื่อทดสอบว่า Key ใช้ได้
        client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=api_key,
        )
        # ส่งข้อความสั้นๆ เพื่อทดสอบ (ใช้โมเดลฟรี)
        response = client.chat.completions.create(
            model="google/gemini-2.0-flash-001",
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=5
        )
        return {"valid": True, "message": "API Key ใช้งานได้!"}
    except Exception as e:
        return {"valid": False, "message": f"API Key ไม่ถูกต้อง: {str(e)}"}

# API ดึงรายการแชททั้งหมด เรียงลำดับจากใหม่ไปเก่า
@app.get("/api/chats")
def get_chats(x_user_id: str = Header("guest"), db: Session = Depends(get_db)):
    chats = db.query(Chat).filter(Chat.user_id == x_user_id).order_by(desc(Chat.created_at)).all()
    return chats

# API สร้างแชทใหม่
@app.post("/api/chats")
def create_chat(x_user_id: str = Header("guest"), db: Session = Depends(get_db)):
    new_chat = Chat(title="New Chat", user_id=x_user_id)
    db.add(new_chat)
    db.commit()
    db.refresh(new_chat)
    return new_chat




# API ลบแชทตาม ID
@app.delete("/api/chats/{chat_id}")
def delete_chat(chat_id: int, x_user_id: str = Header("guest"), db: Session = Depends(get_db)):
    chat = db.query(Chat).filter(Chat.id == chat_id, Chat.user_id == x_user_id).first()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found or access denied")
    db.delete(chat)
    db.commit()
    return {"message": "deleted"}

# API ดึงข้อความทั้งหมดภายในแชทนั้นๆ
@app.get("/api/chats/{chat_id}/messages")
def get_messages(chat_id: int, x_user_id: str = Header("guest"), db: Session = Depends(get_db)):
    chat = db.query(Chat).filter(Chat.id == chat_id, Chat.user_id == x_user_id).first()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found or access denied")
    messages = db.query(Message).filter(Message.chat_id == chat_id).order_by(Message.created_at).all()
    return messages

# ฟังก์ชัน Generator สำหรับส่งข้อมูล AI แบบ Streaming
# รับ api_key และ model จาก Frontend เพื่อสร้าง Client แบบ Dynamic
async def stream_ai_response(chat_id: int, messages_history: list, db: Session, api_key: str, model: str, x_user_id: str):
    try:
        # สร้าง Client ใหม่ทุกครั้งโดยใช้ API Key ที่ผู้ใช้ส่งมาจาก Frontend
        client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=api_key,
        )
        # ส่งคำขอไปที่ OpenRouter API พร้อมระบุโมเดลที่ผู้ใช้เลือก
        response = client.chat.completions.create(
            model=model,
            messages=messages_history,
            stream=True,
            max_tokens=2000 # เพิ่มการจำกัดโทเค็นเพื่อประหยัดเครดิตและป้องกันปัญหาเครดิตไม่พอ (Error 402)
        )   
        
        full_response = ""
        # วนลูปรับข้อมูลที่ค่อยๆ ไหลกลับมา
        for chunk in response:
            if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                content = chunk.choices[0].delta.content
                full_response += content
                # ส่งข้อมูลกลับไปในรูปแบบ Server-Sent Events (SSE)
                yield f"data: {json.dumps({'content': content})}\n\n"
        
        # เมื่อ AI ตอบจบ ให้บันทึกข้อความของ AI ลงในฐานข้อมูล พร้อมเก็บชื่อโมเดล
        ai_message = Message(chat_id=chat_id, user_id=x_user_id, role="assistant", content=full_response, model_name=model)
        db.add(ai_message)
        db.commit()
        
        yield "data: [DONE]\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"

# API หลักสำหรับการแชท (รองรับการสตรีมข้อมูล)
@app.post("/api/chats/{chat_id}/stream")
async def chat_stream(chat_id: int, request: Request, x_user_id: str = Header("guest"), db: Session = Depends(get_db)):
    chat = db.query(Chat).filter(Chat.id == chat_id, Chat.user_id == x_user_id).first()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found or access denied")
    
    data = await request.json()
    user_content = data.get("content")
    api_key = data.get("api_key")  # รับ API Key จาก Frontend
    model = data.get("model", "google/gemini-2.0-flash-001")  # รับโมเดลที่เลือก
    
    # ตรวจสอบว่ามี API Key หรือไม่
    if not api_key:
        raise HTTPException(status_code=400, detail="กรุณาใส่ API Key ก่อนเริ่มใช้งาน")
    
    # 1. บันทึกข้อความของผู้ใช้ที่ส่งเข้ามา
    user_message = Message(chat_id=chat_id, user_id=x_user_id, role="user", content=user_content)
    db.add(user_message)
    db.commit()
    
    # 2. ทำการเปลี่ยนชื่อแชทอัตโนมัติจากข้อความแรกของผู้ใช้
    if chat.title == "New Chat":
        new_title = user_content.strip()
        if len(new_title) > 30:
            new_title = new_title[:30] + "..."
        chat.title = new_title
        db.commit()
            
    # 3. เตรียมประวัติการสนทนาทั้งหมดเพื่อส่งไปให้ AI (จำประวัติทั้งหมด)
    all_messages = db.query(Message).filter(Message.chat_id == chat_id).order_by(Message.created_at).all()
    messages_history = [{"role": msg.role, "content": msg.content} for msg in all_messages]
    
    # 4. ใส่ System Prompt เพื่อบังคับให้ทุกโมเดลจัด Format ให้สวยงามเหมือน Gemini
    system_prompt = {
        "role": "system",
        "content": (
            "You are a helpful AI assistant. IMPORTANT FORMATTING RULES:\n"
            "1. ALWAYS structure your answer beautifully using Markdown.\n"
            "2. For mathematical equations/formulas, ALWAYS use $$...$$ for display math (block) and $...$ for inline math.\n"
            "3. DO NOT use \\( or \\[ or markdown code blocks for math.\n"
            "4. Use headings (##, ###), bullet points, and bold text to make your response easy to read."
        )
    }
    messages_history.insert(0, system_prompt)
    
    # สร้าง Database Session แยกสำหรับ Generator
    db_generator = SessionLocal()
    
    async def wrapped_stream():
        try:
            # ส่ง api_key และ model ไปด้วยเพื่อใช้ในการเรียก API
            async for chunk in stream_ai_response(chat_id, messages_history, db_generator, api_key, model, x_user_id):
                yield chunk
        finally:
            db_generator.close()
            
    return StreamingResponse(wrapped_stream(), media_type="text/event-stream")
