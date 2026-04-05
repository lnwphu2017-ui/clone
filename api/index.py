from fastapi import FastAPI, Depends, HTTPException, Request, Header
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from .database import get_db, init_db, Chat, Message, SessionLocal
from sqlalchemy.orm import Session
from sqlalchemy import desc
import json
from openai import OpenAI

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

AVAILABLE_MODELS = [
    {"id": "google/gemini-2.0-flash-001", "name": "Gemini 2.0 Flash"},
    {"id": "qwen/qwen3.6-plus:free", "name": "Qwen 3.6 Plus "},
]

@app.get("/api/")
def read_root(): return {"message": "API is running!"}

@app.get("/api/debug-db")
def debug_db():
    import os
    db_url = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL") or os.environ.get("POSTGRES_URL_NON_POOLING")
    if not db_url: return {"status": "error", "message": "No DB URL found"}
    return {"status": "connected" if "postgres" in db_url else "sqlite", "db_type": "PostgreSQL" if "postgres" in db_url else "SQLite", "is_vercel": os.environ.get("VERCEL") is not None}

@app.get("/api/models")
def get_models(): return AVAILABLE_MODELS

@app.post("/api/validate-key")
async def validate_key(request: Request):
    data = await request.json()
    api_key = data.get("api_key", "")
    if not api_key: raise HTTPException(status_code=400, detail="กรุณาใส่ API Key")
    try:
        client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)
        client.chat.completions.create(model="google/gemini-2.0-flash-001", messages=[{"role": "user", "content": "hi"}], max_tokens=5)
        return {"valid": True, "message": "API Key ใช้งานได้!"}
    except Exception as e: return {"valid": False, "message": str(e)}

@app.get("/api/chats")
def get_chats(x_user_id: str = Header("guest"), db: Session = Depends(get_db)):
    return db.query(Chat).filter(Chat.user_id == x_user_id).order_by(desc(Chat.created_at)).all()

@app.post("/api/chats")
def create_chat(x_user_id: str = Header("guest"), db: Session = Depends(get_db)):
    new_chat = Chat(title="New Chat", user_id=x_user_id)
    db.add(new_chat)
    db.commit()
    db.refresh(new_chat)
    return new_chat

@app.delete("/api/chats/{chat_id}")
def delete_chat(chat_id: int, x_user_id: str = Header("guest"), db: Session = Depends(get_db)):
    chat = db.query(Chat).filter(Chat.id == chat_id, Chat.user_id == x_user_id).first()
    if not chat: raise HTTPException(status_code=404, detail="Chat not found")
    db.delete(chat)
    db.commit()
    return {"message": "deleted"}

@app.get("/api/chats/{chat_id}/messages")
def get_messages(chat_id: int, x_user_id: str = Header("guest"), db: Session = Depends(get_db)):
    chat = db.query(Chat).filter(Chat.id == chat_id, Chat.user_id == x_user_id).first()
    if not chat: raise HTTPException(status_code=404, detail="Chat not found")
    return db.query(Message).filter(Message.chat_id == chat_id).order_by(Message.created_at).all()

async def stream_ai_response(chat_id: int, messages_history: list, db: Session, api_key: str, model: str, x_user_id: str):
    full_response = ""
    try:
        client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)
        response = client.chat.completions.create(model=model, messages=messages_history, stream=True, max_tokens=2000)
        for chunk in response:
            if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                content = chunk.choices[0].delta.content
                full_response += content
                yield f"data: {json.dumps({'content': content})}\n\n"
        yield "data: [DONE]\n\n"
    except Exception as e:
        full_response += f"\n[Error: {str(e)}]"
        yield f"data: {json.dumps({'error': str(e)})}\n\n"
    finally:
        if full_response.strip():
            try:
                db.add(Message(chat_id=chat_id, user_id=x_user_id, role="assistant", content=full_response, model_name=model))
                db.commit()
            except: db.rollback()

@app.post("/api/chats/{chat_id}/stream")
async def chat_stream(chat_id: int, request: Request, x_user_id: str = Header("guest"), db: Session = Depends(get_db)):
    chat = db.query(Chat).filter(Chat.id == chat_id, Chat.user_id == x_user_id).first()
    if not chat: raise HTTPException(status_code=404, detail="Chat not found")
    data = await request.json()
    user_content, api_key, model = data.get("content"), data.get("api_key"), data.get("model", "google/gemini-2.0-flash-001")
    if not api_key: raise HTTPException(status_code=400, detail="กรุณาใส่ API Key")
    db.add(Message(chat_id=chat_id, user_id=x_user_id, role="user", content=user_content))
    db.commit()
    if chat.title == "New Chat":
        chat.title = user_content[:30] + ("..." if len(user_content) > 30 else "")
        db.commit()
    all_messages = db.query(Message).filter(Message.chat_id == chat_id).order_by(Message.created_at).all()
    messages_history = [{"role": "system", "content": "You are a helpful AI assistant. Use Markdown."}]
    messages_history.extend([{"role": msg.role, "content": msg.content} for msg in all_messages])
    db_gen = SessionLocal()
    async def wrapped_stream():
        try:
            async for chunk in stream_ai_response(chat_id, messages_history, db_gen, api_key, model, x_user_id): yield chunk
        finally: db_gen.close()
    return StreamingResponse(wrapped_stream(), media_type="text/event-stream")
