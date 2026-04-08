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

app = FastAPI()

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
    {"id": "google/gemini-2.0-flash-001", "name": "Gemini 2.0 Flash"},
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
def GetModels():
    """แสดงรายการ AI Models ทั้งหมดที่แอปพลิเคชันรองรับ"""
    return AVAILABLE_MODELS

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
    if not api_key: 
        RaiseError(400, ERR_BAD_REQUEST, "กรุณาใส่ API Key")
    try:
        client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)
        client.chat.completions.create(model="google/gemini-2.0-flash-001", messages=[{"role": "user", "content": "hi"}], max_tokens=5)
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
    try:
        client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)
        # รับ Stream จาก AI — เพิ่ม extra_body เพื่อรองรับ reasoning content ของบางโมเดล
        response = client.chat.completions.create(
            model=model,
            messages=messages_history,
            stream=True,
            max_tokens=4096,
            extra_body={"include_reasoning": True}
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
    user_content, api_key, model = data.get("content"), data.get("api_key"), data.get("model", "google/gemini-2.0-flash-001")
    if not api_key: 
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

    # สร้าง System Prompt โดยแทรก RAG Context เข้าไปหากมีข้อมูล
    system_prompt = "You are a helpful AI assistant. Use Markdown. For mathematical formulas, ALWAYS use LaTeX with '$$ ... $$' for block math (standalone lines) and '$ ... $' for inline math. Make formulas clear and well-structured like in professional textbooks."
    if rag_context:
        system_prompt = (
            "You are a helpful AI assistant with access to a knowledge base. "
            "When answering, prioritize information from the knowledge base below. "
            "If the answer is found in the knowledge base, cite the source file name. "
            "If the knowledge base doesn't contain relevant information, answer from your general knowledge. "
            "Use Markdown formatting. For math formulas use LaTeX: '$$ ... $$' for block, '$ ... $' for inline.\n\n"
            + rag_context
        )

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
