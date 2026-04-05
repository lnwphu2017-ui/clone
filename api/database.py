from sqlalchemy import create_engine, Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from datetime import datetime
import os

# กำหนดที่เก็บไฟล์ฐานข้อมูล SQLite
# บน Vercel ระบบไฟล์เป็น Read-only ให้เปลี่ยนไปใช้ /tmp/ เพื่อให้แอปทำงานได้
# สำหรับการเก็บข้อมูลถาวรบน Vercel ให้ตรวจสอบ URL ของ PostgreSQL
# (Vercel จะมีตัวแปรสภาพแวดล้อมให้เมื่อคุณสร้าง Storage > Postgres)
# ตรวจสอบตัวแปรสภาพแวดล้อมที่มีความเป็นไปได้ทั้งหมด (Vercel และ Neon มักใช้ชื่อเหล่านี้)
DATABASE_URL = (
    os.environ.get("DATABASE_URL") or 
    os.environ.get("POSTGRES_URL") or 
    os.environ.get("POSTGRES_URL_NON_POOLING") or 
    os.environ.get("POSTGRES_PRISMA_URL")
)

if DATABASE_URL and os.environ.get("VERCEL"):
    # หากอยู่บน Vercel และพบ URL ให้ใช้งานทันที
    pass
elif os.environ.get("VERCEL"):
    # หากไม่พบ URL บน Vercel ให้ใช้ SQLite ชั่วคราว
    DATABASE_URL = "sqlite:////tmp/database.db"
else:
    # สำหรับการรันบนเครื่อง Local
    DATABASE_URL = "sqlite:///./database.db"

# จัดการ SQLAlchemy URL สำหรับ PostgreSQL (เพื่อให้รองรับ psycopg2 และ SSL)
if DATABASE_URL.startswith("postgres"):
    # เปลี่ยน postgres:// เป็น postgresql://
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
    
    # บังคับใช้ SSL สำหรับความปลอดภัย (Neon/Vercel Postgres ต้องการส่วนนี้ครับ)
    if "sslmode" not in DATABASE_URL:
        if "?" in DATABASE_URL:
            DATABASE_URL += "&sslmode=require"
        else:
            DATABASE_URL += "?sslmode=require"

# สร้าง Engine สำหรับเชื่อมต่อฐานข้อมูล
if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    # สำหรับ PostgreSQL แนะนำให้ตั้งค่า pool_pre_ping=True เพื่อป้องกันการหลุดขัดของ Connection
    engine = create_engine(DATABASE_URL, pool_pre_ping=True)

# สร้าง Session สำหรับการจัดการ Transaction
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# โมเดลสำหรับเก็บข้อมูลการแชท (Chat Session)
class Chat(Base):
    __tablename__ = "chats"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True, default="New Chat")
    user_id = Column(String, index=True, default="guest")
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # ความสัมพันธ์กับโมเดล Message (หนึ่งแชทมีได้หลายข้อความ)
    messages = relationship("Message", back_populates="chat", cascade="all, delete-orphan")

# โมเดลสำหรับเก็บข้อความแต่ละข้อความ (Message)
class Message(Base):
    __tablename__ = "messages"
    
    id = Column(Integer, primary_key=True, index=True)
    chat_id = Column(Integer, ForeignKey("chats.id", ondelete="CASCADE"))
    user_id = Column(String, index=True, default="guest") # รหัสผู้ใช้หรืออีเมลที่ส่งข้อความ
    role = Column(String) # "user" (ผู้ใช้) หรือ "assistant" (AI)
    content = Column(String) # เนื้อหาข้อความ
    model_name = Column(String, nullable=True) # ชื่อโมเดล AI ที่ใช้ตอบ
    created_at = Column(DateTime, default=datetime.utcnow)
    
    chat = relationship("Chat", back_populates="messages")

# ฟังก์ชันสำหรับสร้าง Table ในฐานข้อมูล (ถ้ายังไม่มี)
def init_db():
    Base.metadata.create_all(bind=engine)

# ฟังก์ชันสำหรับสร้าง Database Session เพื่อนำไปใช้งานใน API
def get_db():
    # ในสภาวะ Serverless (เช่น Vercel) การเรียกใช้ init_db() ที่นี่จะช่วยให้มั่นใจว่าตารางถูกสร้างขึ้นจริง
    init_db()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
