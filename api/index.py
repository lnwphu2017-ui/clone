from fastapi import FastAPI, Depends, HTTPException, Request, Header
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from .database import GetDb, InitDb, Chat, Message, SessionLocal, KnowledgeChunk
from .rag import IndexKnowledgeFiles, RetrieveRelevantChunks, BuildRagContext
from sqlalchemy.orm import Session
from sqlalchemy import desc
import json
import os
from pathlib import Path as FilePath
from openai import OpenAI
import httpx

app = FastAPI()

# พิกัดของ Ollama API (เชื่อมต่อจาก Docker ไปยัง Host Machine)
OLLAMA_BASE_URL = "http://host.docker.internal:11434"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------------------------------------
# มาตรฐานรหัสข้อผิดพลาด (Standardized Error Codes)
# -------------------------------------------------------
ERR_AUTH_REQUIRED = "AUTH_REQUIRED"
ERR_INVALID_API_KEY = "INVALID_API_KEY"
ERR_CHAT_NOT_FOUND = "CHAT_NOT_FOUND"
ERR_INTERNAL_ERROR = "INTERNAL_SERVER_ERROR"
ERR_BAD_REQUEST = "BAD_REQUEST"

def RaiseError(status_code: int, code: str, message: str):
    """ฟังก์ชันช่วยในการโยน Exception แบบมาตรฐาน"""
    raise HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message}
    )

AVAILABLE_MODELS = [
    {"id": "google/gemini-2.5-flash", "name": "Gemini 2.5 Flash"},
    {"id": "qwen/qwen3.6-plus:free", "name": "Qwen 3.6 Plus "},
    {"id": "openai/gpt-oss-120b:free", "name": "GPT-OSS 120B (Free)"},
    {"id": "openai/gpt-oss-20b:free", "name": "GPT-OSS 20B (Free)"},
]

@app.get("/api/")
def ReadRoot():
    """Endpoint ทดสอบการทำงานของ API"""
    return {"message": "API is running!"}

@app.get("/api/debug-db")
def DebugDb():
    """ฟังก์ชันสำหรับ Debug สถานะการเชื่อมต่อฐานข้อมูล"""
    import os
    db_url = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL") or os.environ.get("POSTGRES_URL_NON_POOLING")
    if not db_url: return {"status": "error", "message": "No DB URL found"}
    return {"status": "connected" if "postgres" in db_url else "sqlite", "db_type": "PostgreSQL" if "postgres" in db_url else "SQLite", "is_vercel": os.environ.get("VERCEL") is not None}

@app.get("/api/models")
async def GetModels():
    """แสดงรายการ AI Models ทั้งหมดที่แอปพลิเคชันรองรับ (รวมทั้งจากเครื่องและ Cloud)"""
    models = list(AVAILABLE_MODELS) # คัดลอกรายการพื้นฐาน (OpenRouter)
    
    # พยายามดึงรายชื่อโมเดลจาก Ollama (โมเดลในเครื่องคุณ)
    try:
        async with httpx.AsyncClient() as client:
            # เรียกไปที่ Ollama API เพื่อดูว่ามีโมเดลอะไรบ้าง
            response = await client.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=2.0)
            if response.status_code == 200:
                ollama_data = response.json()
                for model in ollama_data.get("models", []):
                    name = model.get("name")
                    models.append({
                        "id": f"ollama/{name}", # ใส่ prefix เพื่อให้ Backend แยกแยะได้ตอนสั่งแชท
                        "name": f"{name} (Local)" # นำไอคอนบ้านออกตามคำขอ
                    })
    except Exception as e:
        # ถ้าเชื่อมต่อ Ollama ไม่ได้ (เช่น ยังไม่ได้เปิดแอป) ให้แสดงแค่โมเดลปกติ ไม่ต้อง error
        print(f"⚠️ ไม่สามารถเชื่อมต่อกับ Ollama ได้: {str(e)}")
        
    return models

# -------------------------------------------------------
# RAG Endpoints — จัดการระบบ Knowledge Base
# -------------------------------------------------------

@app.post("/api/rag/index")
async def IndexRagKnowledge(request: Request, db: Session = Depends(GetDb)):
    """
    Endpoint สำหรับ Trigger การ Index ไฟล์ความรู้ทั้งหมดใน api/knowledge
    เรียกใช้เมื่อเพิ่ม/แก้ไขไฟล์ในโฟลเดอร์ knowledge
    """
    try:
        data = await request.json()
        api_key = data.get("api_key")
        if not api_key:
            RaiseError(400, ERR_BAD_REQUEST, "กรุณาใส่ API Key เพื่อใช้ในการทำ Index")
            
        result = IndexKnowledgeFiles(db, api_key)
        return {
            "success": True,
            "message": f"Index สำเร็จ: {result['files_processed']} ไฟล์, {result['chunks_created']} Chunks",
            **result
        }
    except Exception as e:
        RaiseError(500, ERR_INTERNAL_ERROR, f"เกิดข้อผิดพลาดในการ Index: {str(e)}")

@app.get("/api/rag/status")
def GetRagStatus(db: Session = Depends(GetDb)):
    """ตรวจสอบสถานะของระบบ RAG — มีไฟล์ไหน Index อยู่บ้าง"""
    total_chunks = db.query(KnowledgeChunk).count()
    # ดึงรายชื่อไฟล์ที่ถูก Index ไว้แล้ว (distinct)
    indexed_files = db.query(KnowledgeChunk.source_file).distinct().all()
    file_names = [f[0] for f in indexed_files]
    return {
        "total_chunks": total_chunks,
        "indexed_files": file_names,
        "is_ready": total_chunks > 0
    }
@app.post("/api/validate-key")
async def ValidateKey(request: Request):
    """ตรวจสอบความถูกต้องของ API Key ผ่าน OpenRouter"""
    data = await request.json()
    api_key = data.get("api_key", "")
    model = data.get("model", "") # รับชื่อโมเดลมาเช็คด้วย
    
    # ถ้าเป็นโมเดลในเครื่อง ไม่ต้องเช็ค Key
    if model.startswith("ollama/"):
        return {"valid": True, "message": "Ollama พร้อมใช้งาน!"}
        
    if not api_key: 
        RaiseError(400, ERR_BAD_REQUEST, "กรุณาใส่ API Key")
    try:
        client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)
        client.chat.completions.create(model="google/gemini-2.5-flash", messages=[{"role": "user", "content": "hi"}], max_tokens=5)
        return {"valid": True, "message": "API Key ใช้งานได้!"}
    except Exception as e: return {"valid": False, "message": str(e)}

@app.get("/api/chats")
def GetChats(x_user_id: str = Header("guest"), db: Session = Depends(GetDb)):
    """ดึงรายการแชททั้งหมดของผู้ใช้ที่ระบุ"""
    return db.query(Chat).filter(Chat.user_id == x_user_id).order_by(desc(Chat.created_at)).all()

@app.post("/api/chats")
def CreateChat(x_user_id: str = Header("guest"), db: Session = Depends(GetDb)):
    """สร้างห้องแชทใหม่สำหรับผู้ใช้"""
    new_chat = Chat(title="New Chat", user_id=x_user_id)
    db.add(new_chat)
    db.commit()
    db.refresh(new_chat)
    return new_chat

@app.delete("/api/chats/{chat_id}")
def DeleteChat(chat_id: int, x_user_id: str = Header("guest"), db: Session = Depends(GetDb)):
    """ลบห้องแชทตาม chat_id"""
    chat = db.query(Chat).filter(Chat.id == chat_id, Chat.user_id == x_user_id).first()
    if not chat: 
        RaiseError(404, ERR_CHAT_NOT_FOUND, "ไม่พบข้อมูลห้องแชทที่ต้องการลบ")
    db.delete(chat)
    db.commit()
    return {"message": "deleted"}

@app.get("/api/chats/{chat_id}/messages")
def GetMessages(chat_id: int, x_user_id: str = Header("guest"), db: Session = Depends(GetDb)):
    """ดึงรายการข้อความทั้งหมดภายในแชทที่ระบุ"""
    chat = db.query(Chat).filter(Chat.id == chat_id, Chat.user_id == x_user_id).first()
    if not chat: 
        RaiseError(404, ERR_CHAT_NOT_FOUND, "ไม่พบข้อมูลห้องแชท")
    return db.query(Message).filter(Message.chat_id == chat_id).order_by(Message.created_at).all()

async def StreamAiResponse(chat_id: int, messages_history: list, db: Session, api_key: str, model: str, x_user_id: str):
    """ฟังก์ชัน Streaming ข้อมูลจาก OpenAI/OpenRouter โดยตรง"""
    full_response = ""
    full_reasoning = ""
    # กำหนดพิกัดเป้าหมาย (Routing)
    actual_model = model
    target_base_url = "https://openrouter.ai/api/v1"
    target_api_key = api_key
    
    # ถ้าเป็นโมเดลในเครื่อง (Ollama)
    if model.startswith("ollama/"):
        actual_model = model.replace("ollama/", "")
        target_base_url = f"{OLLAMA_BASE_URL}/v1"
        target_api_key = "ollama" # Ollama ไม่ต้องใช้ Key จริง แต่ OpenAI Client บังคับให้ใส่
        print(f"🏠 Routing chat to Local Ollama: {actual_model}")
    else:
        print(f"☁️ Routing chat to OpenRouter: {actual_model}")

    try:
        client = OpenAI(base_url=target_base_url, api_key=target_api_key)
        # รับ Stream จาก AI
        response = client.chat.completions.create(
            model=actual_model,
            messages=messages_history,
            stream=True,
            max_tokens=4096,
            extra_body={"include_reasoning": True} if not model.startswith("ollama/") else {}
        )
        for chunk in response:
            if not chunk.choices: continue
            delta = chunk.choices[0].delta

            # 1. ตรวจจับและส่งข้อมูลการคิด (Reasoning) — รองรับหลาย field name
            reasoning = getattr(delta, 'reasoning_content', None) or getattr(delta, 'reasoning', None)
            if reasoning:
                full_reasoning += reasoning
                yield f"data: {json.dumps({'reasoning_content': reasoning})}\n\n"

            # 2. ตรวจจับและส่งข้อมูลเนื้อหาหลัก (Content)
            # ใช้ is not None แทน truthy check เพื่อรับ chunk ที่ content เป็น "" ด้วย
            content = getattr(delta, 'content', None)
            if content is not None and content != "":
                full_response += content
                yield f"data: {json.dumps({'content': content})}\n\n"
                
        yield "data: [DONE]\n\n"
    except Exception as e:
        full_response += f"\n[Error: {str(e)}]"
        yield f"data: {json.dumps({'error': str(e)})}\n\n"
    finally:
        # บันทึกข้อมูลลงฐานข้อมูล (รวมทั้งส่วนที่คิดและส่วนที่ตอบ)
        save_content = full_response
        if full_reasoning.strip():
            # หุ้มกระบวนการคิดด้วยแท็ก <thought> เพื่อให้หน้าบ้านนำไปแสดงผลได้ถาวร
            save_content = f"<thought>\n{full_reasoning}\n</thought>\n{full_response}"
            
        if save_content.strip():
            try:
                # ตรวจสอบสถานะ Session ก่อนบันทึก
                db.add(Message(chat_id=chat_id, user_id=x_user_id, role="assistant", content=save_content, model_name=model))
                db.commit()
                print(f"✅ บันทึกข้อความ Assistant สำเร็จ (Chat ID: {chat_id})")
            except Exception as e:
                # ทำการ Rollback เมื่อเกิดข้อผิดพลาดในการบันทึกข้อมูล
                print(f"❌ เกิดข้อผิดพลาดในการบันทึกข้อความ Assistant: {str(e)}")
                db.rollback()

@app.post("/api/chats/{chat_id}/stream")
async def ChatStream(chat_id: int, request: Request, x_user_id: str = Header("guest"), db: Session = Depends(GetDb)):
    """API หลักสำหรับรับคำถามจากผู้ใช้ และส่งข้อมูลกลับแบบ Streaming พร้อมระบบ RAG"""
    chat = db.query(Chat).filter(Chat.id == chat_id, Chat.user_id == x_user_id).first()
    if not chat: 
        RaiseError(404, ERR_CHAT_NOT_FOUND, "ไม่พบข้อมูลห้องแชท")
    data = await request.json()
    user_content, api_key, model = data.get("content"), data.get("api_key"), data.get("model", "google/gemini-2.5-flash")
    
    # บังคับให้ใส่ API Key เฉพาะกรณีที่ใช้โมเดลภายนอก (ไม่ใช่ Ollama)
    if not api_key and not model.startswith("ollama/"): 
        RaiseError(400, ERR_INVALID_API_KEY, "กรุณาใส่ API Key เพื่อใช้ในการสนทนา")
    db.add(Message(chat_id=chat_id, user_id=x_user_id, role="user", content=user_content))
    db.commit()
    if chat.title == "New Chat":
        chat.title = user_content[:30] + ("..." if len(user_content) > 30 else "")
        db.commit()
    all_messages = db.query(Message).filter(Message.chat_id == chat_id).order_by(Message.created_at).all()

    # --- RAG: ค้นหาข้อมูลที่เกี่ยวข้องกับคำถามของผู้ใช้ ---
    rag_context = ""
    try:
        has_knowledge = db.query(KnowledgeChunk).count() > 0
        if has_knowledge:
            relevant_chunks = RetrieveRelevantChunks(user_content, db, api_key)
            rag_context = BuildRagContext(relevant_chunks)
    except Exception:
        # หากระบบ RAG มีปัญหา ให้ข้ามไปตอบตามปกติ ไม่ให้แชทล่ม
        rag_context = ""

    # สร้าง System Prompt — แยกโหมดตามความเกี่ยวข้องของข้อมูล
    DEFAULT_PROMPT = (
        "You are a helpful AI assistant. Use Markdown. "
        "For math formulas, use LaTeX with '$$ ... $$' for blocks and '$ ... $' for inline."
    )
    system_prompt = DEFAULT_PROMPT

    if rag_context:
        # โหมด RAG Hybrid: กู้คืนความเป๊ะสำหรับโมเดล Cloud
        system_prompt = (
            "You are a helpful expert assistant. Answer based on the CONTEXT DATA provided below.\n\n"
            "## ABSOLUTE RULES:\n"
            "0. **No Echo**: DO NOT repeat the user's question. Start your response immediately.\n"
            "1. **Syllabus Logic**: If the user asks for a specific year (e.g., 'ปี 2'), find that year's header in the context and list EVERY subject under it until the next year's header. Do not skip or summarize any course code/title.\n"
            "2. **General Fact Logic**: If the query is about specific info (e.g., birthdays, personal details) and it IS in the context, answer it immediately using that data.\n"
            "3. **No Mix-up**: If a specific year is requested, ONLY provide subjects for that year. Discard context from other years.\n"
            "4. **Format**: Use a numbered list for subjects. Use clear Markdown.\n"
            "5. **Source Citation**: End your response with '- ข้อมูลจากฐานข้อมูล' ONLY if you used context.\n"
            "6. **Fallback**: If the query is unrelated to context, use your general knowledge and do not mention any source file.\n\n"
            "## CONTEXT DATA:\n"
            + rag_context
        )
        # --- Debug ---
        print("\n--- DEBUG: HIGH-QUALITY HYBRID PROMPT ---")
        print(system_prompt)
        print("----------------------------------------\n")

    # คืนค่าการส่ง message แบบมาตรฐาน (แยกบทบาทชัดเจน)
    messages_history = [{"role": "system", "content": system_prompt}]
    messages_history.extend([{"role": msg.role, "content": msg.content} for msg in all_messages])

    db_gen = SessionLocal()
    async def wrapped_stream():
        try:
            async for chunk in StreamAiResponse(chat_id, messages_history, db_gen, api_key, model, x_user_id): yield chunk
        finally: db_gen.close()
    return StreamingResponse(wrapped_stream(), media_type="text/event-stream")

# -------------------------------------------------------
# Static Files — ให้ FastAPI serve หน้าเว็บ Frontend ด้วย
# เพื่อให้เปิดผ่าน http://localhost:8000 ได้โดยตรง
# (Firebase Auth ไม่ทำงานกับ file:// protocol)
# -------------------------------------------------------

# หาตำแหน่งโฟลเดอร์ frontend (อยู่ข้างๆ โฟลเดอร์ api)
FRONTEND_DIR = FilePath(__file__).parent.parent / "frontend"

@app.get("/")
def ServeIndex():
    """ส่งหน้า index.html เมื่อเข้า http://localhost:8000/"""
    return FileResponse(str(FRONTEND_DIR / "index.html"))

# Mount โฟลเดอร์ frontend เป็น static files (ต้องไว้ท้ายสุดเพื่อไม่ให้ชนกับ /api routes)
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR)), name="frontend")
